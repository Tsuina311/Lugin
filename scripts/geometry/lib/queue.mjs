/**
 * Annotation priority queue — rank untrusted fixtures for Geometry Lab review.
 * Does not run or change the detector; uses inventory quads + optional last benchmark.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CORPUS_ROOT,
  RUNS_DIR,
  SCHEMA_VERSION,
} from './paths.mjs';
import {
  fixtureTrustedEval,
  fixtureUsableForGeometry,
  isCompleteQuad,
} from './schema.mjs';

export const PRIORITY_QUEUE_PATH = join(CORPUS_ROOT, 'priority-queue.json');
export const PARITY_REPORT_PATH = join(CORPUS_ROOT, 'js-native-parity.json');

/** Tags we want represented in the trusted corpus. */
export const COVERAGE_TAGS = [
  'hard-case',
  'glare',
  'dark-card',
  'dark-background',
  'sleeved',
  'unsleeved',
  'foil',
  'perspective',
  'bad-lighting',
  'partial',
  'binder',
  'overlap',
  'multi-card',
  'showcase',
  'borderless',
  'classic-frame',
  'bad-capture',
  'language-fr',
  'language-it',
];

const TAG_WEIGHTS = {
  'hard-case': 40,
  glare: 28,
  'dark-card': 24,
  'dark-background': 22,
  'dark-border': 16,
  sleeved: 14,
  foil: 14,
  perspective: 12,
  'bad-lighting': 12,
  partial: 10,
  showcase: 8,
  binder: 18,
  overlap: 18,
  'multi-card': 16,
  'bad-capture': 10,
};

const shoelace = pts => {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

const edgeIntersect = (p, q, a, b) => {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / det;
  return { x: p.x + t * dx, y: p.y + t * dy };
};

const clipPolygon = (subject, clip) => {
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = cross(a, b, p) >= 0;
      const qin = cross(a, b, q) >= 0;
      if (pin && qin) output.push(q);
      else if (pin && !qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
      } else if (!pin && qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
        output.push(q);
      }
    }
  }
  return output;
};

const cornersIoU = (a, b) => {
  if (!a?.topLeft || !b?.topLeft) return null;
  const pa = [a.topLeft, a.topRight, a.bottomRight, a.bottomLeft];
  const pb = [b.topLeft, b.topRight, b.bottomRight, b.bottomLeft];
  const areaA = shoelace(pa);
  const areaB = shoelace(pb);
  const inter = shoelace(clipPolygon(pa, pb));
  const union = areaA + areaB - inter;
  return union > 1e-6 ? inter / union : 0;
};

const loadInventoryByPath = async () => {
  const p = join(CORPUS_ROOT, 'inventory.json');
  if (!existsSync(p)) return new Map();
  const inv = JSON.parse(await readFile(p, 'utf8'));
  const map = new Map();
  for (const row of inv.rows ?? []) {
    if (row.path) map.set(row.path, row);
  }
  return map;
};

const loadLatestBenchmarkById = async () => {
  if (!existsSync(RUNS_DIR)) return new Map();
  const names = (await readdir(RUNS_DIR)).filter(n => n.endsWith('.json')).sort();
  if (!names.length) return new Map();
  const run = JSON.parse(await readFile(join(RUNS_DIR, names[names.length - 1]), 'utf8'));
  const map = new Map();
  for (const row of run.perFixture ?? []) {
    if (row.id) map.set(row.id, row);
  }
  return map;
};

const loadParityById = async () => {
  if (!existsSync(PARITY_REPORT_PATH)) return new Map();
  const report = JSON.parse(await readFile(PARITY_REPORT_PATH, 'utf8'));
  const map = new Map();
  for (const row of report.rows ?? []) {
    if (row.id) map.set(row.id, row);
  }
  return map;
};

const fixtureTags = f => {
  const set = new Set([...(f.tags ?? [])]);
  for (const c of f.cards ?? []) for (const t of c.tags ?? []) set.add(t);
  return [...set];
};

const bootstrapProvenance = f =>
  f.cards?.[0]?.groundTruthSource ?? f.provenance?.groundTruthSource ?? 'none';

export const coverageSummary = fixtures => {
  const trusted = fixtures.filter(f => fixtureTrustedEval(f) || (f.trusted && f.negative));
  const byTag = {};
  for (const tag of COVERAGE_TAGS) {
    const n = trusted.filter(f => fixtureTags(f).includes(tag)).length;
    if (n > 0) byTag[tag] = n;
  }
  const bySplit = { train: 0, validation: 0, test: 0, unset: 0 };
  for (const f of trusted) {
    const s = f.split || 'unset';
    bySplit[s] = (bySplit[s] ?? 0) + 1;
  }
  const missingCategories = COVERAGE_TAGS.filter(t => !byTag[t]);
  const trustedGroups = new Set(trusted.map(f => f.captureGroup || f.seriesId || f.id));
  return {
    trustedTotal: trusted.length,
    trustedByTag: byTag,
    trustedBySplit: bySplit,
    missingCategories,
    trustedCaptureGroups: trustedGroups.size,
    untrustedUsable: fixtures.filter(
      f => !fixtureTrustedEval(f) && !f.trusted && fixtureUsableForGeometry(f).ok,
    ).length,
  };
};

/**
 * Score one fixture. Returns null if not a queue candidate.
 */
export const scoreFixture = (fixture, ctx) => {
  if (fixtureTrustedEval(fixture) || fixture.trusted) return null;
  const use = fixtureUsableForGeometry(fixture);
  if (!use.ok && fixture.source !== 'swap-test') return null;

  const tags = fixtureTags(fixture);
  const reasons = [];
  let score = 0;

  for (const [tag, w] of Object.entries(TAG_WEIGHTS)) {
    if (tags.includes(tag)) {
      score += w;
      reasons.push(tag);
    }
  }
  if (fixture.hardRegression && !tags.includes('hard-case')) {
    score += TAG_WEIGHTS['hard-case'];
    reasons.push('hard-regression-flag');
  }

  const inv = ctx.inventory.get(fixture.image);
  const tracked = inv?.quads?.tracked ?? null;
  const recognition = inv?.quads?.recognition ?? inv?.quads?.snapshot ?? null;
  let disagreementIoU = null;
  if (tracked && recognition) {
    disagreementIoU = cornersIoU(tracked, recognition);
    if (disagreementIoU != null && disagreementIoU < 0.85) {
      const boost = Math.round((0.85 - disagreementIoU) * 50);
      score += boost;
      reasons.push(`track/recog IoU ${disagreementIoU.toFixed(2)}`);
    }
  }

  const bench = ctx.benchmark.get(fixture.id);
  let bootstrapIoU = null;
  let bootstrapScore = null;
  if (bench) {
    bootstrapScore = bench.score ?? null;
    const pairIoU = bench.pairs?.[0]?.iou;
    bootstrapIoU = pairIoU ?? null;
    if (bootstrapIoU != null && bootstrapIoU < 0.8) {
      score += Math.round((0.8 - bootstrapIoU) * 35);
      reasons.push(`bootstrap IoU ${bootstrapIoU.toFixed(2)}`);
    }
    if (bootstrapScore != null && bootstrapScore < 0.45) {
      score += Math.round((0.45 - bootstrapScore) * 40);
      reasons.push(`low detect score ${bootstrapScore.toFixed(2)}`);
    }
    if (bench.falseDetections > 0) {
      score += 12;
      reasons.push('false-detection');
    }
  }

  const parity = ctx.parity.get(fixture.id);
  let jsNativeIoU = null;
  if (parity?.substantialDisagreement) {
    jsNativeIoU = parity.iouJsNative;
    score += 45;
    reasons.push('native-js-disagreement');
    if (parity.agreement === 'js-only') {
      score += 12;
      reasons.push('js-detects-native-misses');
    } else if (parity.agreement === 'native-only') {
      score += 12;
      reasons.push('native-detects-js-misses');
    } else if (jsNativeIoU != null) {
      score += Math.round((0.85 - jsNativeIoU) * 40);
      reasons.push(`js↔native IoU ${jsNativeIoU.toFixed(2)}`);
    }
  }

  const group = fixture.captureGroup || fixture.seriesId || fixture.id;
  if (!ctx.trustedGroups.has(group)) {
    score += 18;
    reasons.push('unique-captureGroup');
  }

  // Underrepresented vs trusted tag counts
  for (const tag of tags) {
    if (!COVERAGE_TAGS.includes(tag)) continue;
    const have = ctx.trustedTagCounts[tag] ?? 0;
    if (have === 0) {
      score += 15;
      reasons.push(`missing-category:${tag}`);
    } else if (have < 3) {
      score += 8;
      reasons.push(`underrepresented:${tag}`);
    }
  }

  if (tags.includes('frozen-quad-series')) {
    score -= 20;
    reasons.push('frozen-quad-penalty');
  }

  // Prefer fixtures that already have a bootstrap quad (faster review)
  if (fixture.cards?.some(c => isCompleteQuad(c.groundTruthQuad))) {
    score += 5;
  } else {
    score += 8;
    reasons.push('needs-quad-from-scratch');
  }

  if (!reasons.length) reasons.push('default-review');

  return {
    id: fixture.id,
    source: fixture.source,
    captureGroup: group,
    tags,
    bootstrapProvenance: bootstrapProvenance(fixture),
    trackRecogDisagreementIoU: disagreementIoU,
    jsNativeIoU,
    bootstrapDetectorIoU: bootstrapIoU,
    bootstrapDetectorScore: bootstrapScore,
    score,
    reasons: [...new Set(reasons)],
    split: fixture.split ?? null,
    image: fixture.image,
  };
};

/**
 * Rank candidates; demote near-duplicates within the same captureGroup.
 */
export const buildPriorityQueue = async (fixtures, { top = 50 } = {}) => {
  const inventory = await loadInventoryByPath();
  const benchmark = await loadLatestBenchmarkById();
  const parity = await loadParityById();
  const coverage = coverageSummary(fixtures);
  const trustedGroups = new Set(
    fixtures
      .filter(f => fixtureTrustedEval(f) || f.trusted)
      .map(f => f.captureGroup || f.seriesId || f.id),
  );
  const trustedTagCounts = {};
  for (const f of fixtures.filter(f => fixtureTrustedEval(f) || f.trusted)) {
    for (const t of fixtureTags(f)) {
      trustedTagCounts[t] = (trustedTagCounts[t] ?? 0) + 1;
    }
  }

  const ctx = { inventory, benchmark, parity, trustedGroups, trustedTagCounts };
  const scored = [];
  for (const f of fixtures) {
    const row = scoreFixture(f, ctx);
    if (row) scored.push(row);
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // Avoid near-duplicates: keep best per captureGroup at full rank; demote rest.
  const seenGroup = new Map();
  const ranked = [];
  for (const row of scored) {
    const n = seenGroup.get(row.captureGroup) ?? 0;
    seenGroup.set(row.captureGroup, n + 1);
    if (n === 0) {
      ranked.push({
        ...row,
        duplicateOfSeries: false,
        priorityScore: row.score,
      });
    } else {
      ranked.push({
        ...row,
        duplicateOfSeries: true,
        priorityScore: Math.round(row.score * 0.12) - n * 3,
        reasons: [...row.reasons, `series-duplicate#${n + 1}`],
      });
    }
  }
  ranked.sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));

  const queue = ranked.slice(0, Math.max(1, top)).map((row, i) => ({
    rank: i + 1,
    ...row,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    top,
    coverage,
    queue,
    allScoredCount: scored.length,
  };
};

export const savePriorityQueue = async payload => {
  await writeFile(PRIORITY_QUEUE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  return PRIORITY_QUEUE_PATH;
};

export const loadPriorityQueue = async () => {
  if (!existsSync(PRIORITY_QUEUE_PATH)) return null;
  return JSON.parse(await readFile(PRIORITY_QUEUE_PATH, 'utf8'));
};

export const printQueue = (payload, { limit = 40 } = {}) => {
  const { coverage, queue } = payload;
  console.log('GEOMETRY PRIORITY QUEUE');
  console.log('─'.repeat(72));
  console.log('CORPUS COVERAGE (trusted)');
  console.log(`  trusted total:           ${coverage.trustedTotal}`);
  console.log(
    `  train/val/test:          ${coverage.trustedBySplit.train ?? 0}/${coverage.trustedBySplit.validation ?? 0}/${coverage.trustedBySplit.test ?? 0}`,
  );
  console.log(`  trusted captureGroups:   ${coverage.trustedCaptureGroups}`);
  console.log(`  untrusted usable:        ${coverage.untrustedUsable}`);
  const tagEntries = Object.entries(coverage.trustedByTag).sort((a, b) => b[1] - a[1]);
  if (tagEntries.length) {
    console.log('  trusted by tag:');
    for (const [t, n] of tagEntries) console.log(`    ${t.padEnd(20)} ${n}`);
  } else {
    console.log('  trusted by tag:          (none yet)');
  }
  console.log(
    `  missing categories:      ${coverage.missingCategories.length ? coverage.missingCategories.join(', ') : '(none)'}`,
  );

  console.log('\nTOP REVIEW CANDIDATES');
  console.log(
    `${'#'.padStart(3)}  ${'score'.padStart(5)}  ${'id'.padEnd(42)}  ${'source'.padEnd(14)}  tags / why`,
  );
  for (const row of queue.slice(0, limit)) {
    const tags = row.tags.slice(0, 4).join(',') || '—';
    const why = row.reasons.slice(0, 3).join('; ');
    const disagree =
      row.trackRecogDisagreementIoU != null
        ? `  trIoU=${row.trackRecogDisagreementIoU.toFixed(2)}`
        : '';
    console.log(
      `${String(row.rank).padStart(3)}  ${String(row.priorityScore).padStart(5)}  ${row.id.slice(0, 42).padEnd(42)}  ${String(row.source).padEnd(14)}  ${tags}`,
    );
    console.log(
      `       ${''.padEnd(5)}  group=${row.captureGroup}  prov=${row.bootstrapProvenance}${disagree}`,
    );
    console.log(`       ${''.padEnd(5)}  why: ${why}`);
  }
  console.log(`\nShowing ${Math.min(limit, queue.length)} of ${queue.length} queued (${payload.allScoredCount} scored).`);
  console.log(`Wrote ${PRIORITY_QUEUE_PATH}`);
  console.log('\nNext: yarn geometry:lab  →  open http://127.0.0.1:8766/?queue=priority');
};
