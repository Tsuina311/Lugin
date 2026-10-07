#!/usr/bin/env node
/**
 * Offline test of one area-score shape.
 * Production weights, nested rule, and candidate generation stay as they are.
 *
 *   node scripts/geometry/peaked-area-prior.mjs
 *
 * Verdict thresholds below were fixed before this run.
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
import { quadArea, quadIoU } from './lib/frame-regions/report.mjs';
import { quadInImageSpace } from './lib/source-space.mjs';

const CARD_ASPECT = 63 / 88;
const PEAK = 0.35;
const ZERO = 0.7;
const WEIGHTS = { aspect: 0.4, parallel: 0.25, area: 0.25, center: 0.1 };
const GOOD = 0.8;
const IOU_EPS = 0.01;

const TARGETS = [
  { slug: 'island-cq', card: 'Island cq-120629', image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png' },
  { slug: 'wand', card: 'Wand cq-120751', image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png' },
  { slug: 'livaan', card: 'Livaan cq-120813', image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png' },
  { slug: 'bulk-up', card: 'Bulk Up', image: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png' },
  { slug: 'mudbutton', card: 'Mudbutton Torchrunner', image: '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png' },
];
const TARGET_IMAGES = new Set(TARGETS.map(row => row.image));
const RANKING_SLUGS = new Set(['island-cq', 'wand', 'livaan', 'mudbutton']);

/**
 * Locked before scores were read.
 * A ranking frame materially improves when its peaked max-score IoU is >= 0.80
 * and is not lower than the current max-score IoU. All four are required.
 * Bulk Up passes the control when its peaked max-score IoU stays >= 0.80.
 * Collateral regression uses trusted real fixtures other than these five images,
 * judged on the max-score quad (the area-score decision), before nested selection.
 * Meaningful collateral regression: GOOD count drops by >= 2, median IoU drops
 * by >= 0.02, or any fixture falls from IoU >= 0.80 to < 0.70.
 * A close-up is a trusted human card covering more than 35% of the frame.
 * Close-up damage is systematic when two or more GOOD max-score selections drop
 * by more than 0.05, or any card covering more than half the frame does so.
 * PROMISING needs all four improvements, the Bulk control, and neither kind of damage.
 * Anything short of the four improvements, or a failed Bulk control, is INSUFFICIENT.
 * Damage after the four and the control pass is OVERFIT.
 */
const chooseVerdict = ({ rankingGood, bulkMaxGood, collateral, closeupSystematic }) => {
  if (rankingGood < 4 || !bulkMaxGood) return 'PEAKED_AREA_INSUFFICIENT';
  if (collateral.meaningful || closeupSystematic) return 'PEAKED_AREA_OVERFIT';
  return 'PEAKED_AREA_PROMISING';
};

const peakedAreaScore = frameFrac => {
  let score;
  if (frameFrac <= PEAK) score = frameFrac / PEAK;
  else if (frameFrac <= ZERO) score = 1 - (frameFrac - PEAK) / PEAK;
  else score = 0;
  return Math.min(1, Math.max(0, score));
};

const assertAreaShape = () => {
  const samples = [
    [0, 0],
    [0.175, 0.5],
    [0.35, 1],
    [0.525, 0.5],
    [0.7, 0],
    [0.9, 0],
  ];
  for (const [frac, expected] of samples) {
    const got = peakedAreaScore(frac);
    if (Math.abs(got - expected) > 1e-12) throw new Error(`area shape ${frac} -> ${got}, expected ${expected}`);
  }
};

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const KEYS = ['tl', 'tr', 'br', 'bl'];

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-peaked-area-'));
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
        export { selectPrimaryAmongDebugCandidates } from '${join(rootDir, 'src/lib/scan/detection/multi.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'peaked-area-entry.ts',
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
  const currentArea = Math.min(1, frameFrac / PEAK);
  const peakedArea = peakedAreaScore(frameFrac);
  const rest = aspectScore * WEIGHTS.aspect + parallel * WEIGHTS.parallel;
  const centerDist = Math.hypot((tl.x + tr.x + br.x + bl.x) / 4 - imageW / 2, (tl.y + tr.y + br.y + bl.y) / 4 - imageH / 2);
  const centerScore = 1 - Math.min(1, centerDist / (Math.hypot(imageW, imageH) / 2));
  const centerWeighted = centerScore * WEIGHTS.center;
  return {
    frameFrac,
    currentArea,
    peakedArea,
    currentTotal: rest + currentArea * WEIGHTS.area + centerWeighted,
    peakedTotal: rest + peakedArea * WEIGHTS.area + centerWeighted,
    aspectScore,
    parallel,
    centerScore,
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

const bucketOf = frac => {
  if (frac < 0.1) return '<0.10';
  if (frac < 0.2) return '0.10–0.20';
  if (frac <= 0.35) return '0.20–0.35';
  if (frac <= 0.5) return '0.35–0.50';
  if (frac <= 0.7) return '0.50–0.70';
  return '>0.70';
};
const BUCKETS = ['<0.10', '0.10–0.20', '0.20–0.35', '0.35–0.50', '0.50–0.70', '>0.70'];

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
  const photo = metadata?.photo ?? null;
  try {
    const fitted = quadInImageSpace({
      quad: card.groundTruthQuad,
      imageWidth: width,
      imageHeight: height,
      captureWidth: photo?.decodedWidth ?? null,
      captureHeight: photo?.decodedHeight ?? null,
      label: fixture.id,
    });
    return { quad: fitted.quad, space: fitted.space, scale: fitted.scale };
  } catch (error) {
    return { error: error.message };
  }
};

const rankOf = (rows, scoreKey) => {
  const order = [...rows].sort((a, b) => b[scoreKey] - a[scoreKey] || a.index - b.index);
  const rank = new Map();
  order.forEach((row, index) => rank.set(row.index, index + 1));
  return { order, rank };
};

const maxRow = (rows, scoreKey) => rows.reduce((best, row) => (row[scoreKey] > best[scoreKey] ? row : best));

const withScores = (candidates, rows, scoreKey) => candidates.map((candidate, index) => {
  const row = rows.find(item => item.index === index);
  if (!row) return candidate;
  return { ...candidate, score: row[scoreKey] };
});

const select = (scan, candidates, rows, scoreKey, width, height) => {
  if (!rows.length) return { index: -1, row: null };
  const picked = scan.selectPrimaryAmongDebugCandidates(withScores(candidates, rows, scoreKey), width, height);
  const row = rows.find(item => item.index === picked.selectedIndex) ?? null;
  const top = maxRow(rows, scoreKey);
  return { index: picked.selectedIndex, row, max: top, nestedChanged: row != null && row.index !== top.index };
};

const analyzeImage = (scan, decoded) => {
  const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
  const det = scan.detectCardQuad(source);
  const rows = [];
  det.debug.candidates.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause.length) return;
    const quad = fromCorners(candidate.corners);
    const terms = termsOf(quad, decoded.width, decoded.height);
    if (!terms) throw new Error('accepted candidate has a side under 8 px');
    if (Math.abs(terms.currentTotal - candidate.score) > 1e-6) {
      throw new Error(`${candidate.method} current total ${terms.currentTotal} != detector ${candidate.score}`);
    }
    if (terms.frameFrac <= PEAK + 1e-12 && Math.abs(terms.peakedArea - terms.currentArea) > 1e-9) {
      throw new Error('peaked area diverges at or below the peak');
    }
    rows.push({ index, method: candidate.method, quad, ...terms });
  });
  const currentPick = select(scan, det.debug.candidates, rows, 'currentTotal', decoded.width, decoded.height);
  if (currentPick.index !== det.debug.selectedIndex) {
    throw new Error(`current rescore selected ${currentPick.index}, detector selected ${det.debug.selectedIndex}`);
  }
  const peakedPick = select(scan, det.debug.candidates, rows, 'peakedTotal', decoded.width, decoded.height);
  return { width: decoded.width, height: decoded.height, rows, currentPick, peakedPick, candidates: det.debug.candidates };
};

const attachGt = (analyzed, human) => {
  const rows = analyzed.rows.map(row => ({ ...row, iou: human ? quadIoU(row.quad, human.quad) : null }));
  const currentRank = rankOf(rows, 'currentTotal');
  const peakedRank = rankOf(rows, 'peakedTotal');
  for (const row of rows) {
    row.currentRank = currentRank.rank.get(row.index);
    row.peakedRank = peakedRank.rank.get(row.index);
  }
  const iouOf = row => row?.iou ?? null;
  const currentMax = rows.length ? maxRow(rows, 'currentTotal') : null;
  const peakedMax = rows.length ? maxRow(rows, 'peakedTotal') : null;
  const currentFinal = rows.find(row => row.index === analyzed.currentPick.index) ?? null;
  const peakedFinal = rows.find(row => row.index === analyzed.peakedPick.index) ?? null;
  const best = rows.length ? rows.reduce((a, b) => (b.iou > a.iou ? b : a)) : null;
  return {
    rows,
    humanFrac: human ? quadArea(human.quad) / (analyzed.width * analyzed.height) : null,
    humanSpace: human?.space ?? null,
    currentMax,
    peakedMax,
    currentFinal,
    peakedFinal,
    best,
    currentMaxIou: iouOf(currentMax),
    peakedMaxIou: iouOf(peakedMax),
    currentFinalIou: iouOf(currentFinal),
    peakedFinalIou: iouOf(peakedFinal),
    bestIou: iouOf(best),
    currentBestRank: best ? best.currentRank : null,
    peakedBestRank: best ? best.peakedRank : null,
    nestedCurrent: analyzed.currentPick.nestedChanged,
    nestedPeaked: analyzed.peakedPick.nestedChanged,
  };
};

const outcome = (current, peaked) => {
  if (current == null || peaked == null) return 'unmeasured';
  if (peaked > current + IOU_EPS) return 'improved';
  if (peaked < current - IOU_EPS) return 'regressed';
  return 'unchanged';
};

const summarize = rows => {
  const current = rows.map(row => row.currentFinalIou).filter(value => value != null);
  const peaked = rows.map(row => row.peakedFinalIou).filter(value => value != null);
  const currentMax = rows.map(row => row.currentMaxIou).filter(value => value != null);
  const peakedMax = rows.map(row => row.peakedMaxIou).filter(value => value != null);
  const finals = rows.filter(row => row.currentFinal && row.peakedFinal);
  return {
    n: rows.length,
    currentGood: current.filter(value => value >= GOOD).length,
    peakedGood: peaked.filter(value => value >= GOOD).length,
    currentMedian: median(current),
    peakedMedian: median(peaked),
    currentP10: quantile(current, 0.1),
    peakedP10: quantile(peaked, 0.1),
    currentMaxGood: currentMax.filter(value => value >= GOOD).length,
    peakedMaxGood: peakedMax.filter(value => value >= GOOD).length,
    currentMaxMedian: median(currentMax),
    peakedMaxMedian: median(peakedMax),
    currentMaxP10: quantile(currentMax, 0.1),
    peakedMaxP10: quantile(peakedMax, 0.1),
    changed: finals.filter(row => row.currentFinal.index !== row.peakedFinal.index).length,
    improved: finals.filter(row => outcome(row.currentFinalIou, row.peakedFinalIou) === 'improved').length,
    unchanged: finals.filter(row => outcome(row.currentFinalIou, row.peakedFinalIou) === 'unchanged').length,
    regressed: finals.filter(row => outcome(row.currentFinalIou, row.peakedFinalIou) === 'regressed').length,
    maxImproved: rows.filter(row => outcome(row.currentMaxIou, row.peakedMaxIou) === 'improved').length,
    maxUnchanged: rows.filter(row => outcome(row.currentMaxIou, row.peakedMaxIou) === 'unchanged').length,
    maxRegressed: rows.filter(row => outcome(row.currentMaxIou, row.peakedMaxIou) === 'regressed').length,
  };
};

const collateralDamage = summary => {
  const goodDrop = summary.currentMaxGood - summary.peakedMaxGood;
  const medianDrop = (summary.currentMaxMedian ?? 0) - (summary.peakedMaxMedian ?? 0);
  return {
    goodDrop,
    medianDrop,
    meaningful: goodDrop >= 2 || medianDrop >= 0.02,
  };
};

const bucketsFor = rows => {
  const groups = Object.fromEntries(BUCKETS.map(name => [name, { accepted: [], current: [], peaked: [] }]));
  for (const row of rows) {
    for (const candidate of row.rows) {
      groups[bucketOf(candidate.frameFrac)].accepted.push(candidate.iou);
    }
    if (row.currentFinal) groups[bucketOf(row.currentFinal.frameFrac)].current.push(row.currentFinal.iou);
    if (row.peakedFinal) groups[bucketOf(row.peakedFinal.frameFrac)].peaked.push(row.peakedFinal.iou);
  }
  return BUCKETS.map(name => ({
    bucket: name,
    accepted: groups[name].accepted.length,
    currentSelected: groups[name].current.length,
    peakedSelected: groups[name].peaked.length,
    medianIou: median(groups[name].accepted.filter(value => value != null)),
    medianSelectedCurrent: median(groups[name].current),
    medianSelectedPeaked: median(groups[name].peaked),
  }));
};

const markdownTable = rows => [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');

const loadRealFixtures = async () => {
  const names = (await readdir(FIXTURES_DIR)).filter(name => name.endsWith('.json'));
  const fixtures = [];
  for (const name of names) fixtures.push(JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8')));
  return fixtures;
};

const loadSyntheticFixtures = async () => {
  const root = join(CORPUS_ROOT, 'synthetic/scenes');
  if (!existsSync(root)) return [];
  const fixtures = [];
  for (const name of await readdir(root)) {
    const path = join(root, name, 'fixture.json');
    if (!existsSync(path)) continue;
    const fixture = JSON.parse(await readFile(path, 'utf8'));
    const multi = (fixture.cards ?? []).length !== 1 || (fixture.tags ?? []).includes('multi-card') || (fixture.cards ?? []).some(card => (card.tags ?? []).includes('multi-card'));
    if (multi) continue;
    fixtures.push(fixture);
  }
  return fixtures;
};

const classOf = fixture => {
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

const evaluateFixture = async (scan, fixture, cache) => {
  const abs = join(rootDir, fixture.image);
  if (!existsSync(abs)) return { id: fixture.id, image: fixture.image, error: 'missing image' };
  let analyzed = cache.get(abs);
  if (!analyzed) {
    const decoded = PNG.sync.read(readFileSync(abs));
    if ((fixture.imageWidth != null && decoded.width !== fixture.imageWidth) || (fixture.imageHeight != null && decoded.height !== fixture.imageHeight)) {
      return { id: fixture.id, image: fixture.image, error: `PNG ${decoded.width}x${decoded.height} != fixture ${fixture.imageWidth}x${fixture.imageHeight}` };
    }
    analyzed = analyzeImage(scan, decoded);
    cache.set(abs, analyzed);
  }
  const metadata = await loadMetadata(fixture);
  const human = humanQuadFor(fixture, analyzed.width, analyzed.height, metadata);
  if (human.error) return { id: fixture.id, image: fixture.image, error: human.error };
  const view = attachGt(analyzed, human);
  return {
    id: fixture.id,
    image: fixture.image,
    label: fixture.label,
    source: fixture.source,
    width: analyzed.width,
    height: analyzed.height,
    ...view,
    severeDrop: view.currentMaxIou >= GOOD && view.peakedMaxIou < 0.7,
    closeupDrop: view.humanFrac > PEAK && view.currentMaxIou >= GOOD && view.peakedMaxIou < view.currentMaxIou - 0.05,
  };
};

const main = async () => {
  assertAreaShape();
  const scan = await loadScan();
  const previous = JSON.parse(await readFile(join(reportsDir, 'card-score-decomposition-v1/summary.json'), 'utf8'));
  const real = await loadRealFixtures();
  const synthetic = await loadSyntheticFixtures();
  const groups = { 'trusted-real': [], bootstrap: [], synthetic: [], frozen: [], multi: [], skip: [] };
  for (const fixture of real) groups[classOf(fixture)].push(fixture);
  groups.synthetic.push(...synthetic);
  const cache = new Map();
  const evaluated = {};
  for (const [name, fixtures] of Object.entries(groups)) {
    if (name === 'frozen' || name === 'multi' || name === 'skip') continue;
    evaluated[name] = [];
    log(`${name} ${fixtures.length}`);
    for (const fixture of fixtures) {
      const row = await evaluateFixture(scan, fixture, cache);
      evaluated[name].push(row);
      if (evaluated[name].length % 25 === 0) log(`${name} ${evaluated[name].length}/${fixtures.length}`);
    }
  }

  const trusted = evaluated['trusted-real'].filter(row => !row.error);
  const trustedErrors = evaluated['trusted-real'].filter(row => row.error);
  const byImage = new Map();
  for (const row of trusted) if (!byImage.has(row.image)) byImage.set(row.image, row);
  const five = TARGETS.map(target => {
    const row = byImage.get(target.image);
    if (!row) throw new Error(`missing trusted fixture for ${target.card}`);
    const prior = previous.frames.find(frame => frame.card === target.card);
    if (!prior) throw new Error(`missing prior decomposition for ${target.card}`);
    if (Math.abs(row.currentMaxIou - prior.maxScore.iou) > 1e-3 || Math.abs(row.bestIou - prior.best.iou) > 1e-3) {
      throw new Error(`${target.card} candidate set drifted from the prior audit`);
    }
    return { ...target, ...row, ranking: RANKING_SLUGS.has(target.slug) };
  });

  const collateralRows = trusted.filter(row => !TARGET_IMAGES.has(row.image));
  const collateral = summarize(collateralRows);
  const collateralRule = collateralDamage(collateral);
  collateralRule.severeDrops = collateralRows.filter(row => row.severeDrop).length;
  collateralRule.meaningful = collateralRule.meaningful || collateralRule.severeDrops >= 1;
  const closeups = trusted.filter(row => row.humanFrac > PEAK);
  const halfFrame = closeups.filter(row => row.humanFrac > 0.5);
  const closeupDrops = closeups.filter(row => row.closeupDrop);
  const halfDrops = halfFrame.filter(row => row.closeupDrop);
  const closeupSystematic = closeupDrops.length >= 2 || halfDrops.length >= 1;
  const rankingGood = five.filter(row => row.ranking && row.peakedMaxIou >= GOOD && row.peakedMaxIou + 1e-9 >= row.currentMaxIou).length;
  const bulk = five.find(row => row.slug === 'bulk-up');
  const bulkMaxGood = bulk.peakedMaxIou >= GOOD;
  const verdict = chooseVerdict({ rankingGood, bulkMaxGood, collateral: collateralRule, closeupSystematic });

  const report = {
    verdict,
    rankingGood,
    bulkMaxGood,
    nestedStillDamagesBulk: bulk.nestedPeaked && bulk.peakedFinalIou + IOU_EPS < bulk.peakedMaxIou,
    rules: {
      good: GOOD,
      iouEpsilon: IOU_EPS,
      collateral: 'trusted real fixtures other than the five diagnostic images; max-score IoU',
      meaningful: 'GOOD count drops by >= 2, median drops by >= 0.02, or any GOOD max-score falls below 0.70',
      closeupSystematic: '>= 2 GOOD close-ups drop by > 0.05, or any >50% frame card does',
    },
    five: five.map(frame => ({
      card: frame.card,
      humanFrac: frame.humanFrac,
      currentMax: brief(frame.currentMax),
      peakedMax: brief(frame.peakedMax),
      currentFinal: brief(frame.currentFinal),
      peakedFinal: brief(frame.peakedFinal),
      best: brief(frame.best),
      nestedPeaked: frame.nestedPeaked,
      candidates: frame.rows
        .slice()
        .sort((a, b) => a.currentRank - b.currentRank)
        .map(row => ({
          method: row.method,
          frameFrac: row.frameFrac,
          currentArea: row.currentArea,
          peakedArea: row.peakedArea,
          currentTotal: row.currentTotal,
          peakedTotal: row.peakedTotal,
          currentRank: row.currentRank,
          peakedRank: row.peakedRank,
          iou: row.iou,
        })),
    })),
    trusted: summarize(trusted),
    collateral: { ...collateral, ...collateralRule },
    bootstrap: summarize(evaluated.bootstrap.filter(row => !row.error)),
    synthetic: summarize(evaluated.synthetic.filter(row => !row.error)),
    errors: {
      trusted: trustedErrors,
      bootstrap: evaluated.bootstrap.filter(row => row.error).length,
      synthetic: evaluated.synthetic.filter(row => row.error).length,
    },
    excluded: { frozen: groups.frozen.length, multi: groups.multi.length, skip: groups.skip.length, syntheticMultiOmitted: true },
    closeups: closeups.map(row => ({
      id: row.id,
      label: row.label,
      humanFrac: row.humanFrac,
      currentMaxIou: row.currentMaxIou,
      peakedMaxIou: row.peakedMaxIou,
      currentFinalIou: row.currentFinalIou,
      peakedFinalIou: row.peakedFinalIou,
      closeupDrop: row.closeupDrop,
    })),
    buckets: {
      trusted: bucketsFor(trusted),
      collateral: bucketsFor(collateralRows),
      synthetic: bucketsFor(evaluated.synthetic.filter(row => !row.error)),
    },
    collateralRegressions: collateralRows
      .filter(row => outcome(row.currentMaxIou, row.peakedMaxIou) === 'regressed')
      .map(row => ({ id: row.id, label: row.label, humanFrac: row.humanFrac, currentMaxIou: row.currentMaxIou, peakedMaxIou: row.peakedMaxIou, currentFinalIou: row.currentFinalIou, peakedFinalIou: row.peakedFinalIou })),
    selectedRegressions: collateralRows
      .filter(row => outcome(row.currentFinalIou, row.peakedFinalIou) === 'regressed')
      .map(row => ({ id: row.id, label: row.label, humanFrac: row.humanFrac, currentFinalIou: row.currentFinalIou, peakedFinalIou: row.peakedFinalIou, currentMaxIou: row.currentMaxIou, peakedMaxIou: row.peakedMaxIou })),
  };

  const outDir = join(reportsDir, 'peaked-area-prior-v1');
  mkdirSync(outDir, { recursive: true });
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(report, null, 2));
  await writeFile(join(reportsDir, 'peaked-area-prior-v1.md'), render(report, five));
  log(verdict);
  log(`ranking good ${rankingGood}/4 bulk max ${fmt(bulk.peakedMaxIou)} nested damages bulk ${report.nestedStillDamagesBulk}`);
  log(`trusted selected good ${report.trusted.currentGood} -> ${report.trusted.peakedGood} collateral max good ${collateral.currentMaxGood} -> ${collateral.peakedMaxGood}`);
};

const brief = row => row ? ({ method: row.method, iou: row.iou, score: row.currentTotal, peaked: row.peakedTotal, frameFrac: row.frameFrac, rank: row.currentRank, peakedRank: row.peakedRank }) : null;

const metricRow = (name, summary) => [
  name,
  String(summary.n),
  fmt(summary.currentMedian),
  fmt(summary.peakedMedian),
  fmt(summary.currentP10),
  fmt(summary.peakedP10),
  `${summary.currentGood}/${summary.n}`,
  `${summary.peakedGood}/${summary.n}`,
  String(summary.changed),
  `${summary.improved}/${summary.unchanged}/${summary.regressed}`,
  `${summary.currentMaxGood} → ${summary.peakedMaxGood}`,
  `${summary.maxImproved}/${summary.maxUnchanged}/${summary.maxRegressed}`,
];

const render = (report, five) => {
  const lines = [];
  lines.push('# PEAKED AREA PRIOR V1');
  lines.push('');
  lines.push('One offline change: the area term peaks at 35% of the frame and is 0 after 70%. Weights, the other three terms, candidate generation, and nested selection are unchanged.');
  lines.push('');
  lines.push(`**${report.verdict}**`);
  lines.push('');
  lines.push('## FIVE FRAMES');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Candidate', 'Frame fraction', 'Old area', 'New area', 'Old total', 'New total', 'Old rank', 'New rank', 'IoU'],
    ...five.flatMap(frame => frame.rows.slice().sort((a, b) => a.currentRank - b.currentRank).map(row => [
      frame.card,
      row.method,
      fmt(row.frameFrac),
      fmt(row.currentArea),
      fmt(row.peakedArea),
      fmt(row.currentTotal),
      fmt(row.peakedTotal),
      String(row.currentRank),
      String(row.peakedRank),
      fmt(row.iou),
    ])),
  ]));
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Old max IoU', 'New max', 'New max IoU', 'Oracle best rank', 'Nested changed?', 'Final IoU'],
    ...five.map(frame => [
      frame.card,
      fmt(frame.currentMax.iou),
      `${frame.peakedMax.method} rank ${frame.peakedMax.peakedRank}`,
      fmt(frame.peakedMax.iou),
      String(frame.peakedBestRank),
      frame.nestedPeaked ? 'yes' : 'no',
      fmt(frame.peakedFinal.iou),
    ]),
  ]));
  lines.push('');
  lines.push('## CORPUS');
  lines.push('');
  lines.push('Selected IoU is the quad returned after the unchanged nested rule. Max-score IoU is the area-score decision before that rule. Bootstrap quads are prior detector or snapshot geometry, not a human review. Synthetic scenes are generated. Neither is real accuracy.');
  lines.push('');
  lines.push(markdownTable([
    ['Set', 'n', 'Selected median old', 'new', 'p10 old', 'new', 'Selected ≥0.80 old', 'new', 'Selection changed', 'Selected improved/same/worse', 'Max-score ≥0.80', 'Max improved/same/worse'],
    metricRow('Trusted real', report.trusted),
    metricRow('Trusted except the five', report.collateral),
    metricRow('Bootstrap', report.bootstrap),
    metricRow('Synthetic single-card', report.synthetic),
  ]));
  lines.push('');
  lines.push(`Trusted measurement errors: ${report.errors.trusted.length}. Bootstrap errors: ${report.errors.bootstrap}. Synthetic errors: ${report.errors.synthetic}. Excluded frozen ${report.excluded.frozen}, multi-card real ${report.excluded.multi}.`);
  lines.push('');
  lines.push('## CLOSE-UPS');
  lines.push('');
  lines.push('Trusted fixtures whose human card covers more than 35% of the frame.');
  lines.push('');
  if (!report.closeups.length) lines.push('None.');
  else {
    lines.push(markdownTable([
      ['Fixture', 'Human fraction', 'Old max IoU', 'New max IoU', 'Old final IoU', 'New final IoU', 'Drop > 0.05 from GOOD'],
      ...report.closeups.map(row => [row.label || row.id, fmt(row.humanFrac), fmt(row.currentMaxIou), fmt(row.peakedMaxIou), fmt(row.currentFinalIou), fmt(row.peakedFinalIou), row.closeupDrop ? 'yes' : 'no']),
    ]));
  }
  lines.push('');
  lines.push('## AREA BUCKETS');
  lines.push('');
  lines.push('Accepted candidates on the trusted real fixtures. A fraction of 0.35 stays in the 0.20–0.35 bucket. A fraction of 0.70 stays in the 0.50–0.70 bucket.');
  lines.push('');
  lines.push(markdownTable([
    ['Frame fraction', 'Accepted', 'Selected current', 'Selected peaked', 'Median candidate IoU', 'Median selected IoU current', 'Median selected IoU peaked'],
    ...report.buckets.trusted.map(row => [row.bucket, String(row.accepted), String(row.currentSelected), String(row.peakedSelected), fmt(row.medianIou), fmt(row.medianSelectedCurrent), fmt(row.medianSelectedPeaked)]),
  ]));
  lines.push('');
  lines.push('## COLLATERAL SELECTED REGRESSIONS');
  lines.push('');
  lines.push('Trusted fixtures other than the five diagnostics, judged on the quad returned after nested selection.');
  lines.push('');
  if (!report.selectedRegressions.length) lines.push('None beyond 0.01 IoU.');
  else {
    lines.push(markdownTable([
      ['Fixture', 'Human fraction', 'Old final IoU', 'New final IoU', 'Old max IoU', 'New max IoU'],
      ...report.selectedRegressions.map(row => [row.label || row.id, fmt(row.humanFrac), fmt(row.currentFinalIou), fmt(row.peakedFinalIou), fmt(row.currentMaxIou), fmt(row.peakedMaxIou)]),
    ]));
  }
  lines.push('');
  lines.push('## COLLATERAL MAX-SCORE REGRESSIONS');
  lines.push('');
  if (!report.collateralRegressions.length) lines.push('None beyond 0.01 IoU.');
  else {
    lines.push(markdownTable([
      ['Fixture', 'Human fraction', 'Old max IoU', 'New max IoU', 'Old final', 'New final'],
      ...report.collateralRegressions.map(row => [row.label || row.id, fmt(row.humanFrac), fmt(row.currentMaxIou), fmt(row.peakedMaxIou), fmt(row.currentFinalIou), fmt(row.peakedFinalIou)]),
    ]));
  }
  lines.push('');
  return lines.join('\n');
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
