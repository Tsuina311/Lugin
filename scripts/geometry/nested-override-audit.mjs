#!/usr/bin/env node
/**
 * Offline audit of nested-selection overrides.
 * Scores and the nested rule stay as they are.
 *
 *   node scripts/geometry/nested-override-audit.mjs
 *
 * Class boundaries and the separation test were fixed before this run.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir, reportsDir } from '../scanner-benchmark/lib/paths.mjs';
import { FIXTURES_DIR, CORPUS_ROOT } from './lib/paths.mjs';
import { fixtureTrustedEval, fixtureUsableForGeometry, isCompleteQuad } from './lib/schema.mjs';
import { quadArea, quadCoverage, quadIoU } from './lib/frame-regions/report.mjs';
import { quadInImageSpace } from './lib/source-space.mjs';
import { cornerErrors } from './lib/metrics.mjs';

const CARD_ASPECT = 63 / 88;
const PEAK = 0.35;
const GOOD_IOU = 0.8;
const POOR_IOU = 0.7;
const MATERIAL = 0.05;
const COUNT_EPS = 0.01;
const MOSTLY = 0.5;

const CANON = {
  livaan: {
    image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png',
    provisional: 0.611,
    final: 0.93,
  },
  bulk: {
    image: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png',
    provisional: 0.867,
    final: 0.418,
  },
};

/**
 * Locked before pair metrics were read.
 * GOOD / NEUTRAL / BAD use ±0.05 IoU and are labels only.
 * A non-IoU feature separates a mode only when that mode has at least two
 * GOOD overrides and two BAD overrides, and the GOOD values and BAD values
 * do not overlap. IoU features cannot separate the classes, because the
 * labels are defined from IoU.
 * Both classes present and a separating feature: MIXED_BUT_SEPARABLE.
 * Both classes present and no such feature: MIXED_NOT_SEPARABLE.
 * Otherwise the side with more material outcomes decides net positive or negative.
 */
const FEATURES = [
  ['areaFraction', 'inner/outer area'],
  ['innerFrac', 'inner frame fraction'],
  ['outerFrac', 'outer frame fraction'],
  ['innerScore', 'inner score'],
  ['outerScore', 'outer score'],
  ['provisionalScore', 'provisional score'],
  ['innerMinusProvisional', 'inner − provisional score'],
  ['scoreSacrifice', 'provisional − inner score'],
  ['centerDistNorm', 'center offset'],
  ['aspectDiff', 'aspect difference'],
];

const rangesDisjoint = (left, right) => {
  if (left.length < 2 || right.length < 2) return false;
  const maxL = Math.max(...left);
  const minL = Math.min(...left);
  const maxR = Math.max(...right);
  const minR = Math.min(...right);
  return maxL < minR || maxR < minL;
};

const chooseVerdict = modes => {
  const trusted = modes.filter(mode => mode.set === 'trusted-real');
  const goods = trusted.reduce((sum, mode) => sum + mode.good, 0);
  const bads = trusted.reduce((sum, mode) => sum + mode.bad, 0);
  const separable = trusted.some(mode => mode.separable.length > 0);
  if (goods >= 1 && bads >= 1 && separable) return 'NESTED_RULE_MIXED_BUT_SEPARABLE';
  if (goods >= 1 && bads >= 1) return 'NESTED_RULE_MIXED_NOT_SEPARABLE';
  if (bads > goods) return 'NESTED_RULE_NET_NEGATIVE';
  if (goods > bads) return 'NESTED_RULE_NET_POSITIVE';
  return 'NESTED_RULE_MIXED_NOT_SEPARABLE';
};

const peakedAreaScore = frameFrac => {
  if (frameFrac <= PEAK) return Math.min(1, Math.max(0, frameFrac / PEAK));
  if (frameFrac <= 0.7) return Math.min(1, Math.max(0, 1 - (frameFrac - PEAK) / PEAK));
  return 0;
};

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const familyOf = method => {
  if (!method) return 'none';
  if (method.startsWith('edge')) return 'edge';
  if (method.startsWith('luma')) return 'luma';
  if (method.startsWith('chroma')) return 'chroma';
  return method;
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-nested-audit-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export { containsCandidate, selectPrimaryAmongDebugCandidates } from '${join(rootDir, 'src/lib/scan/detection/multi.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'nested-audit-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const fromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const toCorners = quad => ({
  topLeft: { x: quad.tl[0], y: quad.tl[1] },
  topRight: { x: quad.tr[0], y: quad.tr[1] },
  bottomRight: { x: quad.br[0], y: quad.br[1] },
  bottomLeft: { x: quad.bl[0], y: quad.bl[1] },
});

const termsOf = (quad, imageW, imageH) => {
  const tl = { x: quad.tl[0], y: quad.tl[1] };
  const tr = { x: quad.tr[0], y: quad.tr[1] };
  const br = { x: quad.br[0], y: quad.br[1] };
  const bl = { x: quad.bl[0], y: quad.bl[1] };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 8 || bottom < 8 || left < 8 || right < 8) return null;
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspect = width / height;
  const aspectScore = 1 - Math.min(1, Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT);
  const parallel = 1 - Math.min(1, (Math.abs(top - bottom) / width + Math.abs(left - right) / height) / 2);
  const area = Math.abs(
    tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y - (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
  ) / 2;
  const frameFrac = area / (imageW * imageH);
  const centerDist = Math.hypot((tl.x + tr.x + br.x + bl.x) / 4 - imageW / 2, (tl.y + tr.y + br.y + bl.y) / 4 - imageH / 2);
  const centerScore = 1 - Math.min(1, centerDist / (Math.hypot(imageW, imageH) / 2));
  const rest = aspectScore * 0.4 + parallel * 0.25 + centerScore * 0.1;
  const currentArea = Math.min(1, frameFrac / PEAK);
  return {
    frameFrac,
    aspect,
    centerScore,
    currentTotal: rest + currentArea * 0.25,
    peakedTotal: rest + peakedAreaScore(frameFrac) * 0.25,
  };
};

const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
};

const median = values => quantile(values, 0.5);
const spread = values => ({
  n: values.length,
  min: values.length ? Math.min(...values) : null,
  median: median(values),
  max: values.length ? Math.max(...values) : null,
});

const classOfDelta = delta => {
  if (delta >= MATERIAL) return 'GOOD_OVERRIDE';
  if (delta <= -MATERIAL) return 'BAD_OVERRIDE';
  return 'NEUTRAL_OVERRIDE';
};

const traceMode = (scan, candidates, rows, scoreKey, width, height) => {
  const scored = candidates.map((candidate, index) => {
    const row = rows.find(item => item.index === index);
    return row ? { ...candidate, score: row[scoreKey] } : candidate;
  });
  const official = scan.selectPrimaryAmongDebugCandidates(scored, width, height);
  const accepted = [];
  scored.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause.length) return;
    const row = rows.find(item => item.index === index);
    accepted.push({ index, score: candidate.score, corners: candidate.corners, areaRatio: row.frameFrac, row });
  });
  if (!accepted.length) return { empty: true, changed: false };
  const ranked = accepted
    .map(row => ({ row }))
    .sort((a, b) => b.row.score - a.row.score)
    .slice(0, 8);
  const nested = [];
  for (let a = 0; a < ranked.length; a++) {
    for (let b = 0; b < ranked.length; b++) {
      if (a === b) continue;
      if (ranked[a].row.areaRatio <= ranked[b].row.areaRatio) continue;
      const rel = scan.containsCandidate(ranked[a].row.corners, ranked[b].row.corners);
      if (!rel.ok) continue;
      nested.push({
        outer: ranked[a].row.index,
        inner: ranked[b].row.index,
        areaFraction: rel.areaFraction,
        centerDistNorm: rel.centerDistNorm,
        outerScore: ranked[a].row.score,
        innerScore: ranked[b].row.score,
      });
    }
  }
  let max = accepted[0];
  for (const row of accepted) if (row.score > max.score) max = row;
  let final = max;
  let pair = null;
  let reason = 'no nested pair; keep max score';
  if (nested.length) {
    pair = nested[0];
    for (const next of nested) if (next.innerScore > pair.innerScore) pair = next;
    const innerGate = pair.innerScore >= 0.28;
    const ratioGate = pair.innerScore >= pair.outerScore * 0.75;
    if (innerGate || ratioGate) {
      final = accepted.find(row => row.index === pair.inner);
      reason = innerGate ? 'inner.score >= 0.28' : 'inner.score >= 0.75 * outer.score';
    } else {
      final = accepted.find(row => row.index === pair.outer);
      reason = 'inner below both gates; keep outer';
    }
  }
  if (final.index !== official.selectedIndex) {
    throw new Error(`nested trace selected ${final.index}, detector selected ${official.selectedIndex}`);
  }
  return { max, final, pair, reason, changed: final.index !== max.index };
};

const loadMetadata = async fixture => {
  const metaPath = fixture.provenance?.metadataPaths?.[0];
  if (!metaPath) return null;
  try {
    return JSON.parse(await readFile(join(rootDir, metaPath), 'utf8'));
  } catch {
    return null;
  }
};

const humanQuadFor = (fixture, width, height, metadata) => {
  const card = (fixture.cards ?? []).find(row => isCompleteQuad(row.groundTruthQuad));
  if (!card) return { error: 'no quad' };
  try {
    const fitted = quadInImageSpace({
      quad: card.groundTruthQuad,
      imageWidth: width,
      imageHeight: height,
      captureWidth: metadata?.photo?.decodedWidth ?? null,
      captureHeight: metadata?.photo?.decodedHeight ?? null,
      label: fixture.id,
    });
    return { quad: fitted.quad };
  } catch (error) {
    return { error: error.message };
  }
};

const analyzeImage = (scan, decoded) => {
  const det = scan.detectCardQuad({
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  });
  const rows = [];
  det.debug.candidates.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause.length) return;
    const quad = fromCorners(candidate.corners);
    const terms = termsOf(quad, decoded.width, decoded.height);
    if (!terms) throw new Error('accepted candidate has a side under 8 px');
    if (Math.abs(terms.currentTotal - candidate.score) > 1e-6) {
      throw new Error(`${candidate.method} reconstructed ${terms.currentTotal} != ${candidate.score}`);
    }
    rows.push({ index, method: candidate.method, quad, corners: candidate.corners, ...terms });
  });
  return { width: decoded.width, height: decoded.height, candidates: det.debug.candidates, rows };
};

const describe = (row, human) => {
  const errors = cornerErrors(row.corners, toCorners(human));
  return {
    method: row.method,
    family: familyOf(row.method),
    frameFrac: row.frameFrac,
    aspect: row.aspect,
    centerScore: row.centerScore,
    iou: quadIoU(row.quad, human),
    meanCorner: errors.mean,
    maxCorner: errors.max,
    onCard: quadCoverage(row.quad, human),
  };
};

const auditFixture = (scan, analyzed, human) => {
  const modes = {};
  for (const scoreKey of ['currentTotal', 'peakedTotal']) {
    const traced = traceMode(scan, analyzed.candidates, analyzed.rows, scoreKey, analyzed.width, analyzed.height);
    if (traced.empty) {
      modes[scoreKey] = { empty: true };
      continue;
    }
    const provisional = describe(traced.max.row, human);
    provisional.score = traced.max.score;
    const finalRow = traced.final.row;
    const final = describe(finalRow, human);
    final.score = traced.final.score;
    let override = null;
    if (traced.changed && traced.pair) {
      const outer = analyzed.rows.find(row => row.index === traced.pair.outer);
      const inner = analyzed.rows.find(row => row.index === traced.pair.inner);
      const outerDesc = describe(outer, human);
      const innerDesc = describe(inner, human);
      outerDesc.score = traced.pair.outerScore;
      innerDesc.score = traced.pair.innerScore;
      const delta = final.iou - provisional.iou;
      override = {
        reason: traced.reason,
        provisional,
        outer: outerDesc,
        inner: innerDesc,
        final,
        areaFraction: traced.pair.areaFraction,
        centerDistNorm: traced.pair.centerDistNorm,
        innerMinusOuter: innerDesc.score - outerDesc.score,
        innerMinusProvisional: innerDesc.score - provisional.score,
        scoreSacrifice: provisional.score - innerDesc.score,
        aspectDiff: Math.abs(innerDesc.aspect - outerDesc.aspect),
        outerContainsInner: quadCoverage(inner.quad, outer.quad),
        humanInsideOuter: quadCoverage(human, outer.quad),
        innerOnCard: innerDesc.onCard,
        delta,
        klass: classOfDelta(delta),
        bothLarge: outerDesc.frameFrac > 0.5 && innerDesc.frameFrac > 0.5,
        finalIsInner: traced.final.index === traced.pair.inner,
      };
    }
    modes[scoreKey] = {
      provisionalIou: provisional.iou,
      finalIou: final.iou,
      provisionalScore: provisional.score,
      changed: traced.changed,
      override,
    };
  }
  return modes;
};

const statsOf = rows => {
  const nested = rows.map(row => row.finalIou);
  const plain = rows.map(row => row.provisionalIou);
  const up = rows.filter(row => row.finalIou > row.provisionalIou + COUNT_EPS).length;
  const down = rows.filter(row => row.finalIou < row.provisionalIou - COUNT_EPS).length;
  return {
    n: rows.length,
    nestedGood: nested.filter(value => value >= GOOD_IOU).length,
    plainGood: plain.filter(value => value >= GOOD_IOU).length,
    nestedMedian: median(nested),
    plainMedian: median(plain),
    nestedP10: quantile(nested, 0.1),
    plainP10: quantile(plain, 0.1),
    nestedHelped: up,
    nestedHurt: down,
  };
};

const modeSummary = (setName, scoreName, fixtures) => {
  const measured = fixtures.filter(row => row.modes?.[scoreName] && !row.modes[scoreName].empty);
  const overrides = measured.filter(row => row.modes[scoreName].override).map(row => ({
    id: row.id,
    label: row.label,
    image: row.image,
    humanFrac: row.humanFrac,
    ...row.modes[scoreName].override,
  }));
  const good = overrides.filter(row => row.klass === 'GOOD_OVERRIDE');
  const bad = overrides.filter(row => row.klass === 'BAD_OVERRIDE');
  const neutral = overrides.filter(row => row.klass === 'NEUTRAL_OVERRIDE');
  const separable = [];
  for (const [key, name] of FEATURES) {
    const left = good.map(row => row[key] ?? row.inner?.[key] ?? row.provisional?.[key]).filter(value => value != null);
    const right = bad.map(row => row[key] ?? row.inner?.[key] ?? row.provisional?.[key]).filter(value => value != null);
    const goodValues = good.map(row => featureValue(row, key));
    const badValues = bad.map(row => featureValue(row, key));
    if (rangesDisjoint(goodValues, badValues)) separable.push(name);
    void left;
    void right;
  }
  const destroyed = overrides.filter(row => row.provisional.iou >= GOOD_IOU);
  const destroyedToPoor = destroyed.filter(row => row.final.iou < POOR_IOU);
  const rescued = overrides.filter(row => row.provisional.iou < POOR_IOU && row.final.iou >= GOOD_IOU);
  return {
    set: setName,
    score: scoreName,
    measured: measured.length,
    overrides,
    good: good.length,
    neutral: neutral.length,
    bad: bad.length,
    separable,
    changedGoodProvisional: destroyed.length,
    goodBecamePoor: destroyedToPoor.length,
    rescued,
    destroyed,
    distributions: Object.fromEntries(FEATURES.map(([key, name]) => [name, {
      good: spread(good.map(row => featureValue(row, key))),
      bad: spread(bad.map(row => featureValue(row, key))),
    }])),
    h1: {
      good: good.filter(row => row.bothLarge).length,
      bad: bad.filter(row => row.bothLarge).length,
    },
    families: countFamilies(overrides),
    policy: statsOf(measured.map(row => ({
      provisionalIou: row.modes[scoreName].provisionalIou,
      finalIou: row.modes[scoreName].finalIou,
    }))),
  };
};

const featureValue = (row, key) => {
  if (key === 'innerFrac') return row.inner.frameFrac;
  if (key === 'outerFrac') return row.outer.frameFrac;
  if (key === 'innerScore') return row.inner.score;
  if (key === 'outerScore') return row.outer.score;
  if (key === 'provisionalScore') return row.provisional.score;
  return row[key];
};

const countFamilies = overrides => {
  const out = {};
  for (const row of overrides) {
    const key = `${row.outer.family}→${row.inner.family}`;
    out[key] = out[key] ?? { total: 0, GOOD_OVERRIDE: 0, NEUTRAL_OVERRIDE: 0, BAD_OVERRIDE: 0 };
    out[key].total += 1;
    out[key][row.klass] += 1;
  }
  return out;
};

const className = fixture => {
  if ((fixture.tags ?? []).includes('frozen-quad-series')) return 'frozen';
  if ((fixture.tags ?? []).includes('synthetic') || fixture.cards?.some(card => (card.tags ?? []).includes('synthetic'))) return 'synthetic';
  const usable = fixtureUsableForGeometry(fixture);
  if (!usable.ok || fixture.negative) return 'skip';
  const quads = (fixture.cards ?? []).filter(card => isCompleteQuad(card.groundTruthQuad));
  if (quads.length !== 1) return 'multi';
  if (fixtureTrustedEval(fixture) && (quads[0].groundTruthSource === 'manually-reviewed' || quads[0].groundTruthSource === 'existing-annotation')) {
    return 'trusted-real';
  }
  return 'bootstrap';
};

const loadReal = async () => {
  const names = (await readdir(FIXTURES_DIR)).filter(name => name.endsWith('.json'));
  const fixtures = [];
  for (const name of names) fixtures.push(JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8')));
  return fixtures;
};

const loadSynthetic = async () => {
  const root = join(CORPUS_ROOT, 'synthetic/scenes');
  if (!existsSync(root)) return [];
  const fixtures = [];
  for (const name of await readdir(root)) {
    const path = join(root, name, 'fixture.json');
    if (!existsSync(path)) continue;
    const fixture = JSON.parse(await readFile(path, 'utf8'));
    const multi = (fixture.cards ?? []).length !== 1 || (fixture.tags ?? []).includes('multi-card') || (fixture.cards ?? []).some(card => (card.tags ?? []).includes('multi-card'));
    if (!multi) fixtures.push(fixture);
  }
  return fixtures;
};

const evaluateFixture = async (scan, fixture, cache) => {
  const abs = join(rootDir, fixture.image);
  if (!existsSync(abs)) return { id: fixture.id, error: 'missing image' };
  let analyzed = cache.get(abs);
  if (!analyzed) {
    const decoded = PNG.sync.read(readFileSync(abs));
    if ((fixture.imageWidth != null && decoded.width !== fixture.imageWidth) || (fixture.imageHeight != null && decoded.height !== fixture.imageHeight)) {
      return { id: fixture.id, error: 'png size mismatch' };
    }
    analyzed = analyzeImage(scan, decoded);
    cache.set(abs, analyzed);
  }
  const human = humanQuadFor(fixture, analyzed.width, analyzed.height, await loadMetadata(fixture));
  if (human.error) return { id: fixture.id, image: fixture.image, error: human.error };
  return {
    id: fixture.id,
    image: fixture.image,
    label: fixture.label,
    humanFrac: quadArea(human.quad) / (analyzed.width * analyzed.height),
    modes: auditFixture(scan, analyzed, human.quad),
  };
};

const markdownTable = rows => [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');

const overrideRow = (row, score) => [
  row.label || row.id,
  score,
  fmt(row.provisional.iou),
  fmt(row.inner.iou),
  fmt(row.delta),
  fmt(row.outer.frameFrac),
  fmt(row.inner.frameFrac),
  fmt(row.areaFraction),
  fmt(row.scoreSacrifice),
  fmt(row.centerDistNorm),
  row.klass.replace('_OVERRIDE', ''),
];

const pairBlock = (title, row) => {
  const lines = [`### ${title}`, ''];
  if (!row) {
    lines.push('Missing.');
    lines.push('');
    return lines;
  }
  lines.push(markdownTable([
    ['Metric', 'Provisional max', 'Outer', 'Inner / final'],
    ['Method', row.provisional.method, row.outer.method, row.inner.method],
    ['Frame fraction', fmt(row.provisional.frameFrac), fmt(row.outer.frameFrac), fmt(row.inner.frameFrac)],
    ['Aspect', fmt(row.provisional.aspect), fmt(row.outer.aspect), fmt(row.inner.aspect)],
    ['Center score', fmt(row.provisional.centerScore), fmt(row.outer.centerScore), fmt(row.inner.centerScore)],
    ['Detector score', fmt(row.provisional.score), fmt(row.outer.score), fmt(row.inner.score)],
    ['IoU', fmt(row.provisional.iou), fmt(row.outer.iou), fmt(row.inner.iou)],
    ['Mean corner px', fmt(row.provisional.meanCorner, 1), fmt(row.outer.meanCorner, 1), fmt(row.inner.meanCorner, 1)],
    ['Max corner px', fmt(row.provisional.maxCorner, 1), fmt(row.outer.maxCorner, 1), fmt(row.inner.maxCorner, 1)],
  ]));
  lines.push('');
  lines.push(`Inner/outer area ${fmt(row.areaFraction)}. Center offset ${fmt(row.centerDistNorm)}. Inner − outer score ${fmt(row.innerMinusOuter)}. Inner − provisional score ${fmt(row.innerMinusProvisional)}. Score sacrifice ${fmt(row.scoreSacrifice)}. Aspect difference ${fmt(row.aspectDiff)}.`);
  lines.push(`Outer covers inner ${fmt(row.outerContainsInner)}. Human card inside outer ${fmt(row.humanInsideOuter)}. Inner on the card ${fmt(row.innerOnCard)}. Reason: ${row.reason}. Class ${row.klass}.`);
  lines.push('');
  return lines;
};

const render = report => {
  const lines = [];
  lines.push('# NESTED OVERRIDE AUDIT V1');
  lines.push('');
  lines.push('The nested rule and both score formulas are unchanged. Human IoU labels the outcome. It is not a selection feature.');
  lines.push('');
  lines.push(`**${report.verdict}**`);
  lines.push('');
  lines.push('## COUNTS');
  lines.push('');
  lines.push(markdownTable([
    ['Set', 'Score', 'Measured', 'Overrides', 'GOOD', 'NEUTRAL', 'BAD', 'GOOD provisional changed', 'of which final < 0.70', 'Poor provisional rescued to ≥ 0.80'],
    ...report.modes.map(mode => [
      mode.set,
      mode.score === 'currentTotal' ? 'current' : 'peaked',
      String(mode.measured),
      String(mode.overrides.length),
      String(mode.good),
      String(mode.neutral),
      String(mode.bad),
      String(mode.changedGoodProvisional),
      String(mode.goodBecamePoor),
      String(mode.rescued.length),
    ]),
  ]));
  lines.push('');
  lines.push('## LIVAAN AND BULK UP');
  lines.push('');
  lines.push(...pairBlock('Livaan, peaked', report.canon.livaan));
  lines.push(...pairBlock('Bulk Up, peaked', report.canon.bulk));
  lines.push('## TRUSTED OVERRIDES');
  lines.push('');
  const trusted = report.modes.filter(mode => mode.set === 'trusted-real');
  const rows = trusted.flatMap(mode => mode.overrides.map(row => overrideRow(row, mode.score === 'currentTotal' ? 'current' : 'peaked')));
  if (!rows.length) lines.push('None.');
  else {
    lines.push(markdownTable([
      ['Fixture', 'Score mode', 'Provisional IoU', 'Inner IoU', 'ΔIoU', 'Outer frac', 'Inner frac', 'Inner/outer', 'Score sacrifice', 'Center offset', 'Class'],
      ...rows,
    ]));
  }
  lines.push('');
  lines.push('## NO NESTED OVERRIDE');
  lines.push('');
  lines.push(markdownTable([
    ['Set', 'Score', 'Nested ≥0.80', 'Max-score ≥0.80', 'Nested median', 'Max-score median', 'Nested p10', 'Max-score p10', 'Nested higher', 'Nested lower'],
    ...report.modes.map(mode => [
      mode.set,
      mode.score === 'currentTotal' ? 'current' : 'peaked',
      `${mode.policy.nestedGood}/${mode.policy.n}`,
      `${mode.policy.plainGood}/${mode.policy.n}`,
      fmt(mode.policy.nestedMedian),
      fmt(mode.policy.plainMedian),
      fmt(mode.policy.nestedP10),
      fmt(mode.policy.plainP10),
      String(mode.policy.nestedHelped),
      String(mode.policy.nestedHurt),
    ]),
  ]));
  lines.push('');
  lines.push('## RELATIONS');
  lines.push('');
  for (const mode of trusted) {
    lines.push(`### ${mode.score === 'currentTotal' ? 'Current' : 'Peaked'} trusted`);
    lines.push('');
    lines.push(markdownTable([
      ['Feature', 'GOOD min', 'GOOD median', 'GOOD max', 'BAD min', 'BAD median', 'BAD max'],
      ...Object.entries(mode.distributions).map(([name, dist]) => [
        name,
        fmt(dist.good.min),
        fmt(dist.good.median),
        fmt(dist.good.max),
        fmt(dist.bad.min),
        fmt(dist.bad.median),
        fmt(dist.bad.max),
      ]),
    ]));
    lines.push('');
    lines.push(`Separating features under the locked test: ${mode.separable.join(', ') || 'none'}.`);
    lines.push(`Both candidates above half the frame: GOOD ${mode.h1.good}, BAD ${mode.h1.bad}.`);
    lines.push('');
    lines.push('Source pairs:');
    lines.push('');
    lines.push(markdownTable([
      ['Outer → inner', 'Total', 'GOOD', 'NEUTRAL', 'BAD'],
      ...Object.entries(mode.families).map(([name, counts]) => [name, String(counts.total), String(counts.GOOD_OVERRIDE), String(counts.NEUTRAL_OVERRIDE), String(counts.BAD_OVERRIDE)]),
    ]));
    lines.push('');
  }
  return lines.join('\n');
};

const main = async () => {
  const scan = await loadScan();
  const groups = { 'trusted-real': [], bootstrap: [], synthetic: [] };
  for (const fixture of await loadReal()) {
    const name = className(fixture);
    if (groups[name]) groups[name].push(fixture);
  }
  groups.synthetic.push(...await loadSynthetic());
  const cache = new Map();
  const evaluated = {};
  for (const [name, fixtures] of Object.entries(groups)) {
    evaluated[name] = [];
    log(`${name} ${fixtures.length}`);
    for (const fixture of fixtures) {
      evaluated[name].push(await evaluateFixture(scan, fixture, cache));
      if (evaluated[name].length % 40 === 0) log(`${name} ${evaluated[name].length}`);
    }
  }
  const modes = [];
  for (const [name, rows] of Object.entries(evaluated)) {
    const ok = rows.filter(row => !row.error);
    modes.push(modeSummary(name, 'currentTotal', ok));
    modes.push(modeSummary(name, 'peakedTotal', ok));
  }
  const trustedPeaked = modes.find(mode => mode.set === 'trusted-real' && mode.score === 'peakedTotal');
  const findCanon = image => trustedPeaked.overrides.find(row => row.image === image) ?? null;
  const livaan = findCanon(CANON.livaan.image);
  const bulk = findCanon(CANON.bulk.image);
  if (!livaan || !bulk) throw new Error('canonical peaked overrides were not produced');
  if (Math.abs(livaan.provisional.iou - CANON.livaan.provisional) > 0.02) throw new Error(`Livaan provisional ${livaan.provisional.iou}`);
  if (Math.abs(livaan.final.iou - CANON.livaan.final) > 0.02) throw new Error(`Livaan final ${livaan.final.iou}`);
  if (Math.abs(bulk.provisional.iou - CANON.bulk.provisional) > 0.02) throw new Error(`Bulk provisional ${bulk.provisional.iou}`);
  if (Math.abs(bulk.final.iou - CANON.bulk.final) > 0.02) throw new Error(`Bulk final ${bulk.final.iou}`);
  const verdict = chooseVerdict(modes);
  const report = {
    verdict,
    errors: Object.fromEntries(Object.entries(evaluated).map(([name, rows]) => [name, rows.filter(row => row.error).length])),
    modes: modes.map(mode => ({
      ...mode,
      overrides: mode.overrides.map(row => ({
        ...row,
        provisional: stripQuad(row.provisional),
        outer: stripQuad(row.outer),
        inner: stripQuad(row.inner),
        final: stripQuad(row.final),
      })),
    })),
    canon: { livaan, bulk },
  };
  const outDir = join(reportsDir, 'nested-override-audit-v1');
  mkdirSync(outDir, { recursive: true });
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(report, null, 2));
  await writeFile(join(reportsDir, 'nested-override-audit-v1.md'), render(report));
  log(verdict);
  for (const mode of modes.filter(row => row.set === 'trusted-real')) {
    log(`${mode.score} overrides ${mode.overrides.length} good ${mode.good} neutral ${mode.neutral} bad ${mode.bad} separable ${mode.separable.join('|') || 'none'}`);
  }
};

const stripQuad = row => row;

main().catch(error => {
  console.error(error);
  process.exit(1);
});
