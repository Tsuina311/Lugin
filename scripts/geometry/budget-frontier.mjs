#!/usr/bin/env node
/**
 * yarn geometry:budget-frontier
 *
 * Host-only sweep of diagnostic topComponents × dedupeCap around production (4 / 12).
 * Does NOT change DetectCard.kt production constants or selection.
 *
 * Goal: minimum budget increase that recovers Teferi-class (candidate-budget) misses
 * without candidate explosion or single-card selected-IoU regressions.
 *
 * Livaan foil remains a hard-generation control (expected still missing in full grid).
 *
 *   yarn geometry:budget-frontier
 *   yarn geometry:budget-frontier --quick
 *   yarn geometry:budget-frontier --native-input=y-from-rgba
 *
 * SYNTHETIC ONLY — not real-device accuracy.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderBinderPage, tagsFromWarp } from './lib/binder-diagnose/pages.mjs';
import { loadDetectScan } from './lib/detect-host.mjs';
import { exportNativeBatch, runNativeDetectorBatch } from './lib/detect-native.mjs';
import { formatPct, matchQuadsByIoU } from './lib/metrics.mjs';
import { CORPUS_ROOT } from './lib/paths.mjs';
import { gtQuadToCorners, isCompleteQuad } from './lib/schema.mjs';
import { discoverCardWarps } from './lib/synthetic/cards.mjs';
import { generateSuite, loadSyntheticFixtures, SYNTHETIC_ROOT } from './lib/synthetic/generate.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const flag = name => process.argv.includes(`--${name}`);

const quick = flag('quick');
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const iouMatch = 0.8;
const singleLimit = Number(arg('single-limit') || (quick ? 8 : 12));

/** Production equivalents — must match DetectParams / DetectCard defaults. */
const PROD_TOP = 4;
const PROD_DEDUPE = 12;

const TOP_GRID = quick ? [4, 5, 6, 7, 8, 12] : [4, 5, 6, 7, 8, 10, 12];
const DEDUPE_GRID = quick ? [12, 16, 24, 40] : [12, 16, 20, 24, 32, 40];

const OUT_ROOT = join(CORPUS_ROOT, 'synthetic/budget-frontier');
const BATCH_DIR = join(CORPUS_ROOT, 'native-batch-budget-frontier');

const TEFERI_RE = /teferi|federica|veil-old/i;
const LIVAAN_RE = /livaan/i;

const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
};

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const bestMatch = (cands, gt, polygonIoU) => {
  let best = { iou: 0, score: 0, cand: null };
  for (const c of cands || []) {
    const q = c.quad || c.corners;
    if (!q) continue;
    const iou = polygonIoU(q, gt);
    if (iou > best.iou) best = { iou, score: c.finalScore ?? c.score ?? 0, cand: c };
  }
  return best;
};

const coverageAt = (cands, gts, polygonIoU, thr) => {
  const preds = (cands || []).map(c => c.quad || c.corners).filter(Boolean);
  const matching = matchQuadsByIoU(preds, gts, polygonIoU);
  const hit = matching.pairs.filter(p => p.iou >= thr).length;
  return {
    hit,
    gt: gts.length,
    recall: gts.length ? hit / gts.length : null,
    unmatchedPred: matching.unmatchedPredictions.length,
  };
};

const gtCornersOf = fixture =>
  (fixture.cards || [])
    .map(c => (isCompleteQuad(c.groundTruthQuad) ? gtQuadToCorners(c.groundTruthQuad) : null))
    .filter(Boolean);

const findCard = (fixture, re) =>
  (fixture.cards || []).find(c => re.test(`${c.sourceWarp || ''} ${c.id || ''}`));

/** Classify a newly recovered GT relative to production pipeline. */
const classifyRecovery = (prodDet, newDet, gt, polygonIoU) => {
  const thr = iouMatch;
  const pRaw = bestMatch(prodDet?.pipeline?.rawAfterQuad, gt, polygonIoU);
  const pGates = bestMatch(prodDet?.pipeline?.postGates, gt, polygonIoU);
  const pDedupe = bestMatch(prodDet?.pipeline?.postDedupe, gt, polygonIoU);
  const pShort = bestMatch(prodDet?.pipeline?.shortlist, gt, polygonIoU);
  const nRaw = bestMatch(newDet?.pipeline?.rawAfterQuad, gt, polygonIoU);
  const nDedupe = bestMatch(newDet?.pipeline?.postDedupe, gt, polygonIoU);
  const nShort = bestMatch(newDet?.pipeline?.shortlist, gt, polygonIoU);

  if (nRaw.iou < thr) {
    return {
      class: 'NOT_RECOVERED_IN_RAW',
      detail: `newRaw=${nRaw.iou.toFixed(3)}`,
      stages: { pRaw: pRaw.iou, pGates: pGates.iou, pDedupe: pDedupe.iou, nRaw: nRaw.iou },
    };
  }
  if (pRaw.iou < thr && nRaw.iou >= thr) {
    return {
      class: 'WAS_OUTSIDE_TOP_COMPONENTS',
      detail: `prodRaw=${pRaw.iou.toFixed(3)} → newRaw=${nRaw.iou.toFixed(3)}`,
      stages: { pRaw: pRaw.iou, nRaw: nRaw.iou, nDedupe: nDedupe.iou },
      alreadyPresentEarlier: false,
    };
  }
  if (pRaw.iou >= thr && pGates.iou >= thr && pDedupe.iou < thr && nDedupe.iou >= thr) {
    return {
      class: 'WAS_OUTSIDE_DEDUPE_CAP',
      detail: `prodDedupe=${pDedupe.iou.toFixed(3)} → newDedupe=${nDedupe.iou.toFixed(3)}`,
      stages: { pRaw: pRaw.iou, pDedupe: pDedupe.iou, nDedupe: nDedupe.iou },
      alreadyPresentEarlier: true,
    };
  }
  if (pDedupe.iou >= thr && pShort.iou < thr && nShort.iou >= thr) {
    return {
      class: 'WAS_OUTSIDE_SHORTLIST',
      detail: `prodShort=${pShort.iou.toFixed(3)}`,
      alreadyPresentEarlier: true,
    };
  }
  if (pShort.iou >= thr) {
    return {
      class: 'ALREADY_IN_PROD_SHORTLIST',
      detail: `prodShort=${pShort.iou.toFixed(3)}`,
      alreadyPresentEarlier: true,
    };
  }
  return {
    class: 'OTHER_RECOVERY',
    detail: `pRaw=${pRaw.iou.toFixed(3)} nRaw=${nRaw.iou.toFixed(3)}`,
    alreadyPresentEarlier: pRaw.iou >= thr,
  };
};

console.log('NATIVE CANDIDATE BUDGET FRONTIER');
console.log('─'.repeat(56));
console.log('Host-only. Production DetectCard constants unchanged.');
console.log(`Grid topComponents=${TOP_GRID.join(',')}  dedupeCap=${DEDUPE_GRID.join(',')}`);
console.log(`Baseline production = top=${PROD_TOP} dedupe=${PROD_DEDUPE}`);
console.log(`input=${nativeInput}  quick=${quick}`);
console.log('');

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;

// ─── Build fixture pack ─────────────────────────────────────────────────────
const warps = await discoverCardWarps({ limit: 24 });
if (warps.length < 9) {
  console.error('Need ≥9 card warps');
  process.exit(1);
}
const teferi = warps.find(w => TEFERI_RE.test(w.id));
const livaan = warps.find(w => LIVAAN_RE.test(w.id));
if (!teferi || !livaan) {
  console.error('Need Teferi + Livaan warps in corpus');
  process.exit(1);
}
console.log(`Teferi control warp: ${teferi.id}`);
console.log(`Livaan hard-gen control: ${livaan.id}`);

const fillers = warps.filter(w => w.id !== teferi.id && w.id !== livaan.id).slice(0, 7);
const probeFixtures = [];
const probeSlotPlans = [
  { teferiSlot: 8, livaanSlot: 1 },
  { teferiSlot: 0, livaanSlot: 4 },
  { teferiSlot: 4, livaanSlot: 0 },
  { teferiSlot: 2, livaanSlot: 6 },
  { teferiSlot: 6, livaanSlot: 2 },
  { teferiSlot: 7, livaanSlot: 3 },
  ...(quick ? [] : [
    { teferiSlot: 3, livaanSlot: 5 },
    { teferiSlot: 5, livaanSlot: 7 },
  ]),
];

await mkdir(join(OUT_ROOT, 'pages'), { recursive: true });
for (let i = 0; i < probeSlotPlans.length; i++) {
  const { teferiSlot, livaanSlot } = probeSlotPlans[i];
  const assignment = new Array(9);
  assignment[teferiSlot] = teferi;
  assignment[livaanSlot] = livaan;
  let fi = 0;
  for (let s = 0; s < 9; s++) {
    if (!assignment[s]) assignment[s] = fillers[fi++ % fillers.length];
  }
  const id = `budget-probe-${i}-t${teferiSlot}-l${livaanSlot}`;
  const { fixture } = await renderBinderPage(assignment, {
    id,
    gapPx: 16,
    writeImage: true,
  });
  fixture.suite = 'budget-probe';
  fixture.tags = [...(fixture.tags || []), 'budget-frontier-probe'];
  fixture.provenance = {
    ...fixture.provenance,
    teferiSlot,
    livaanSlot,
    teferiId: teferi.id,
    livaanId: livaan.id,
  };
  probeFixtures.push(fixture);
}
console.log(`Probe binder pages: ${probeFixtures.length}`);

const suiteFixtures = [];
const singleSuites = ['dark', 'perspective', 'glare', 'sleeve', 'occlusion'];
const multiSuites = ['binder', 'overlap', 'scattered'];

for (const suite of [...singleSuites, ...multiSuites]) {
  let fixtures = await loadSyntheticFixtures({ suite });
  if (!fixtures.length && suite === 'scattered') {
    console.log('Generating scattered suite (missing fixtures)…');
    await generateSuite({ suite: 'scattered', limit: quick ? 8 : 12 });
    fixtures = await loadSyntheticFixtures({ suite: 'scattered' });
  }
  if (!fixtures.length) {
    console.warn(`skip suite=${suite} (no fixtures)`);
    continue;
  }
  const take =
    singleSuites.includes(suite) ? fixtures.slice(0, singleLimit) : fixtures;
  for (const f of take) {
    suiteFixtures.push({ ...f, _evalSuite: suite });
  }
  console.log(`  suite=${suite} n=${take.length}`);
}

const allFixtures = [...probeFixtures, ...suiteFixtures];
console.log(`Total fixtures in pack: ${allFixtures.length}`);
console.log('');

// ─── Export RGBA once ───────────────────────────────────────────────────────
console.log('Exporting RGBA batch once…');
await exportNativeBatch(allFixtures, { batchDir: BATCH_DIR });

const configs = [];
for (const top of TOP_GRID) {
  for (const dedupe of DEDUPE_GRID) {
    configs.push({ top, dedupe });
  }
}

/** @type {Map<string, Map<string, object>>} configKey → detections */
const byConfig = new Map();

for (let ci = 0; ci < configs.length; ci++) {
  const { top, dedupe } = configs[ci];
  const key = `${top}x${dedupe}`;
  const isProd = top === PROD_TOP && dedupe === PROD_DEDUPE;
  process.stdout.write(
    `\n▸ [${ci + 1}/${configs.length}] topComponents=${top} dedupeCap=${dedupe}${
      isProd ? ' (PRODUCTION)' : ''
    }\n`,
  );
  const det = await runNativeDetectorBatch(allFixtures, {
    inputMode: nativeInput,
    batchDir: BATCH_DIR,
    exportPipeline: true,
    diagnosticTopComponents: top,
    diagnosticDedupeCap: dedupe,
    skipExport: true,
  });
  byConfig.set(key, det);
}

const prodKey = `${PROD_TOP}x${PROD_DEDUPE}`;
const prodDets = byConfig.get(prodKey);

// ─── Evaluate each config ───────────────────────────────────────────────────
const evaluateConfig = (top, dedupe) => {
  const key = `${top}x${dedupe}`;
  const dets = byConfig.get(key);
  const row = {
    top,
    dedupe,
    deltaTop: top - PROD_TOP,
    deltaDedupe: dedupe - PROD_DEDUPE,
    isProduction: top === PROD_TOP && dedupe === PROD_DEDUPE,
  };

  // Teferi / Livaan on probe pages
  const teferiHits = { 0.8: 0, 0.9: 0, 0.95: 0, n: 0, bestIous: [] };
  const livaanHits = { 0.8: 0, n: 0, bestIous: [] };
  for (const f of probeFixtures) {
    const det = dets.get(f.id);
    const tCard = findCard(f, TEFERI_RE);
    const lCard = findCard(f, LIVAAN_RE);
    const raw = det?.pipeline?.rawAfterQuad || [];
    if (tCard && isCompleteQuad(tCard.groundTruthQuad)) {
      teferiHits.n += 1;
      const gt = gtQuadToCorners(tCard.groundTruthQuad);
      const m = bestMatch(raw, gt, polygonIoU);
      teferiHits.bestIous.push(m.iou);
      if (m.iou >= 0.8) teferiHits[0.8] += 1;
      if (m.iou >= 0.9) teferiHits[0.9] += 1;
      if (m.iou >= 0.95) teferiHits[0.95] += 1;
    }
    if (lCard && isCompleteQuad(lCard.groundTruthQuad)) {
      livaanHits.n += 1;
      const gt = gtQuadToCorners(lCard.groundTruthQuad);
      const m = bestMatch(raw, gt, polygonIoU);
      livaanHits.bestIous.push(m.iou);
      if (m.iou >= 0.8) livaanHits[0.8] += 1;
    }
  }
  row.teferi = {
    n: teferiHits.n,
    at08: teferiHits.n ? teferiHits[0.8] / teferiHits.n : null,
    at09: teferiHits.n ? teferiHits[0.9] / teferiHits.n : null,
    at095: teferiHits.n ? teferiHits[0.95] / teferiHits.n : null,
    hit08: teferiHits[0.8],
    hit09: teferiHits[0.9],
    hit095: teferiHits[0.95],
    meanBestIou: mean(teferiHits.bestIous),
  };
  row.livaan = {
    n: livaanHits.n,
    at08: livaanHits.n ? livaanHits[0.8] / livaanHits.n : null,
    hit08: livaanHits[0.8],
    meanBestIou: mean(livaanHits.bestIous),
  };

  // Multi-suite coverage
  const multiCov = {};
  for (const suite of multiSuites) {
    const fixtures = suiteFixtures.filter(f => f._evalSuite === suite);
    if (!fixtures.length) {
      multiCov[suite] = null;
      continue;
    }
    let rawHit = 0;
    let shortHit = 0;
    let gtN = 0;
    for (const f of fixtures) {
      const det = dets.get(f.id);
      const gts = gtCornersOf(f);
      gtN += gts.length;
      const raw = coverageAt(det?.pipeline?.rawAfterQuad, gts, polygonIoU, iouMatch);
      const short = coverageAt(det?.pipeline?.shortlist, gts, polygonIoU, iouMatch);
      rawHit += raw.hit;
      shortHit += short.hit;
    }
    multiCov[suite] = {
      rawRecall: gtN ? rawHit / gtN : null,
      shortlistRecall: gtN ? shortHit / gtN : null,
      rawHit,
      shortHit,
      gt: gtN,
      n: fixtures.length,
    };
  }
  row.multi = multiCov;

  // Single-card selected IoU + detection
  const single = {};
  for (const suite of singleSuites) {
    const fixtures = suiteFixtures.filter(f => f._evalSuite === suite);
    const ious = [];
    let detected = 0;
    for (const f of fixtures) {
      const det = dets.get(f.id);
      const gts = gtCornersOf(f);
      if (!gts.length) continue;
      if (det?.corners) {
        const iou = polygonIoU(det.corners, gts[0]);
        ious.push(iou);
        if (iou >= iouMatch) detected += 1;
      } else {
        ious.push(0);
      }
    }
    single[suite] = {
      n: fixtures.length,
      meanSelectedIou: mean(ious),
      recall08: fixtures.length ? detected / fixtures.length : null,
      p50Iou: percentile(ious, 50),
    };
  }
  row.single = single;

  // Candidate / runtime / unmatched stats across full pack
  const candCounts = [];
  const unmatched = [];
  const runtimes = [];
  let considerAttempts = [];
  for (const f of allFixtures) {
    const det = dets.get(f.id);
    if (!det) continue;
    const shortN = det.pipeline?.shortlistCount ?? det.candidates?.length ?? 0;
    const rawN = det.pipeline?.rawAfterQuadCount ?? det.pipeline?.rawAfterQuad?.length ?? 0;
    const dedupeN = det.pipeline?.postDedupeCount ?? det.pipeline?.postDedupe?.length ?? 0;
    candCounts.push({ raw: rawN, dedupe: dedupeN, shortlist: shortN });
    const gts = gtCornersOf(f);
    const cov = coverageAt(det.pipeline?.rawAfterQuad, gts, polygonIoU, iouMatch);
    unmatched.push(cov.unmatchedPred);
    if (det.runtimeMs != null) runtimes.push(det.runtimeMs);
    if (det.pipeline?.considerAttempts != null) considerAttempts.push(det.pipeline.considerAttempts);
  }
  row.candidates = {
    rawP50: percentile(
      candCounts.map(c => c.raw),
      50,
    ),
    rawP95: percentile(
      candCounts.map(c => c.raw),
      95,
    ),
    rawMax: candCounts.length ? Math.max(...candCounts.map(c => c.raw)) : null,
    dedupeP50: percentile(
      candCounts.map(c => c.dedupe),
      50,
    ),
    dedupeP95: percentile(
      candCounts.map(c => c.dedupe),
      95,
    ),
    shortlistP50: percentile(
      candCounts.map(c => c.shortlist),
      50,
    ),
    shortlistP95: percentile(
      candCounts.map(c => c.shortlist),
      95,
    ),
    unmatchedPredP50: percentile(unmatched, 50),
    unmatchedPredP95: percentile(unmatched, 95),
    unmatchedPredMean: mean(unmatched),
    considerP50: percentile(considerAttempts, 50),
    considerP95: percentile(considerAttempts, 95),
  };
  row.runtime = {
    p50: percentile(runtimes, 50),
    p95: percentile(runtimes, 95),
    mean: mean(runtimes),
    note: 'HOST_JVM_NOT_DEVICE_LATENCY',
  };

  // Recoveries vs production (probe Teferi + any multi GT newly in raw)
  const recoveries = [];
  if (prodDets && !row.isProduction) {
    for (const f of probeFixtures) {
      const tCard = findCard(f, TEFERI_RE);
      if (!tCard || !isCompleteQuad(tCard.groundTruthQuad)) continue;
      const gt = gtQuadToCorners(tCard.groundTruthQuad);
      const prod = prodDets.get(f.id);
      const neu = dets.get(f.id);
      const prodRaw = bestMatch(prod?.pipeline?.rawAfterQuad, gt, polygonIoU);
      const newRaw = bestMatch(neu?.pipeline?.rawAfterQuad, gt, polygonIoU);
      if (prodRaw.iou < iouMatch && newRaw.iou >= iouMatch) {
        recoveries.push({
          fixtureId: f.id,
          warp: tCard.sourceWarp,
          kind: 'teferi',
          ...classifyRecovery(prod, neu, gt, polygonIoU),
          prodBestRawIou: prodRaw.iou,
          newBestRawIou: newRaw.iou,
        });
      }
    }
    for (const f of suiteFixtures.filter(x => multiSuites.includes(x._evalSuite))) {
      const prod = prodDets.get(f.id);
      const neu = dets.get(f.id);
      const gts = (f.cards || []).filter(c => isCompleteQuad(c.groundTruthQuad));
      for (const card of gts) {
        const gt = gtQuadToCorners(card.groundTruthQuad);
        const prodRaw = bestMatch(prod?.pipeline?.rawAfterQuad, gt, polygonIoU);
        const newRaw = bestMatch(neu?.pipeline?.rawAfterQuad, gt, polygonIoU);
        if (prodRaw.iou < iouMatch && newRaw.iou >= iouMatch) {
          recoveries.push({
            fixtureId: f.id,
            warp: card.sourceWarp || card.id,
            kind: 'suite-gt',
            suite: f._evalSuite,
            ...classifyRecovery(prod, neu, gt, polygonIoU),
            prodBestRawIou: prodRaw.iou,
            newBestRawIou: newRaw.iou,
          });
        }
      }
    }
  }
  row.recoveries = recoveries;
  row.recoveryClassCounts = recoveries.reduce((acc, r) => {
    acc[r.class] = (acc[r.class] || 0) + 1;
    return acc;
  }, {});

  return row;
};

// Precompute prod single-card means for regression delta
const prodRow = evaluateConfig(PROD_TOP, PROD_DEDUPE);
const rows = [];
for (const { top, dedupe } of configs) {
  const row = top === PROD_TOP && dedupe === PROD_DEDUPE ? prodRow : evaluateConfig(top, dedupe);
  // attach single-card deltas vs production
  row.singleIouDeltaVsProd = {};
  row.selectedIouRegression = false;
  for (const suite of singleSuites) {
    const base = prodRow.single[suite]?.meanSelectedIou;
    const cur = row.single[suite]?.meanSelectedIou;
    const delta = base != null && cur != null ? cur - base : null;
    row.singleIouDeltaVsProd[suite] = delta;
    if (delta != null && delta < -0.02) row.selectedIouRegression = true;
  }
  row.binderRawDelta =
    (row.multi.binder?.rawRecall ?? 0) - (prodRow.multi.binder?.rawRecall ?? 0);
  row.overlapRawDelta =
    (row.multi.overlap?.rawRecall ?? 0) - (prodRow.multi.overlap?.rawRecall ?? 0);
  row.scatteredRawDelta =
    (row.multi.scattered?.rawRecall ?? 0) - (prodRow.multi.scattered?.rawRecall ?? 0);
  row.unmatchedDelta =
    (row.candidates.unmatchedPredMean ?? 0) - (prodRow.candidates.unmatchedPredMean ?? 0);
  row.runtimeP50Delta = (row.runtime.p50 ?? 0) - (prodRow.runtime.p50 ?? 0);
  rows.push(row);
}

// ─── Pareto / recommendation ────────────────────────────────────────────────
/**
 * Feasible = Teferi full recovery @0.8 on probes, no selected IoU regression,
 * unmatchedPredMean not exploding (> +4 vs prod), Livaan still ~0 (control).
 */
const feasible = rows.filter(
  r =>
    !r.isProduction &&
    r.teferi.at08 >= 0.999 &&
    !r.selectedIouRegression &&
    (r.unmatchedDelta ?? 0) <= 4 &&
    (r.livaan.at08 ?? 0) <= 0.01,
);

const cost = r => r.deltaTop * 10 + r.deltaDedupe + (r.runtimeP50Delta ?? 0) * 0.1;

feasible.sort((a, b) => cost(a) - cost(b) || a.deltaTop - b.deltaTop || a.deltaDedupe - b.deltaDedupe);

const recommended = feasible[0] || null;

/** Pareto: maximize teferi@0.8, minimize cost; keep non-dominated. */
const pareto = [];
const sortedForPareto = [...rows].sort(
  (a, b) => (b.teferi.at08 ?? 0) - (a.teferi.at08 ?? 0) || cost(a) - cost(b),
);
for (const r of sortedForPareto) {
  const dominated = pareto.some(
    p =>
      (p.teferi.at08 ?? 0) >= (r.teferi.at08 ?? 0) &&
      cost(p) <= cost(r) &&
      (p.teferi.at08 > r.teferi.at08 || cost(p) < cost(r)),
  );
  if (!dominated) {
    // remove points dominated by r
    for (let i = pareto.length - 1; i >= 0; i--) {
      const p = pareto[i];
      if (
        (r.teferi.at08 ?? 0) >= (p.teferi.at08 ?? 0) &&
        cost(r) <= cost(p) &&
        (r.teferi.at08 > p.teferi.at08 || cost(r) < cost(p))
      ) {
        pareto.splice(i, 1);
      }
    }
    pareto.push(r);
  }
}
pareto.sort((a, b) => cost(a) - cost(b));

// ─── Print report ───────────────────────────────────────────────────────────
const pct = (x, digits = 0) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);

console.log('\n' + '═'.repeat(56));
console.log('RESULTS (vs production top=4 dedupe=12)');
console.log('═'.repeat(56));
console.log(
  'top×dedupe | Teferi@.8/.9/.95 | Livaan@.8 | binder raw/short | overlap | scat | unmatchedΔ | rtP50Δ | selIoU↓',
);

for (const r of rows) {
  const mark = r.isProduction ? '*' : recommended && r.top === recommended.top && r.dedupe === recommended.dedupe ? '←' : ' ';
  console.log(
    `${mark}${String(r.top).padStart(2)}×${String(r.dedupe).padStart(2)} | ${pct(r.teferi.at08)}/${pct(r.teferi.at09)}/${pct(r.teferi.at095)} (${r.teferi.hit08}/${r.teferi.n}) | ${pct(r.livaan.at08)} | ${pct(r.multi.binder?.rawRecall)}/${pct(r.multi.binder?.shortlistRecall)} | ${pct(r.multi.overlap?.rawRecall)} | ${pct(r.multi.scattered?.rawRecall)} | ${r.unmatchedDelta?.toFixed?.(2) ?? '—'} | ${r.runtimeP50Delta?.toFixed?.(1) ?? '—'}ms | ${r.selectedIouRegression ? 'YES' : 'no'}`,
  );
}

console.log('\nSINGLE-CARD mean selected IoU Δ vs prod:');
for (const r of rows.filter(x => !x.isProduction && (recommended ? x.top === recommended.top && x.dedupe === recommended.dedupe : x.teferi.at08 === 1))) {
  const bits = singleSuites.map(s => `${s}:${r.singleIouDeltaVsProd[s]?.toFixed?.(3) ?? '—'}`).join('  ');
  console.log(`  ${r.top}×${r.dedupe}  ${bits}`);
}

console.log('\nRECOVERY CLASSIFICATION (newly in raw vs prod):');
for (const r of rows.filter(x => x.recoveries?.length)) {
  console.log(`  ${r.top}×${r.dedupe}: ${JSON.stringify(r.recoveryClassCounts)}`);
  const sample = r.recoveries.filter(x => x.kind === 'teferi').slice(0, 2);
  for (const s of sample) {
    console.log(`    teferi ${s.fixtureId}: ${s.class} — ${s.detail}`);
  }
}

console.log('\nPARETO FRONTIER (Teferi@.8 vs cost=10*Δtop+Δdedupe+0.1*rtΔ):');
for (const p of pareto) {
  console.log(
    `  ${p.top}×${p.dedupe}  teferi@.8=${pct(p.teferi.at08)}  cost=${cost(p).toFixed(1)}  binderΔ=${((p.binderRawDelta || 0) * 100).toFixed(1)}pt  unmatchedΔ=${p.unmatchedDelta?.toFixed?.(2)}  rtΔ=${p.runtimeP50Delta?.toFixed?.(1)}ms`,
  );
}

console.log('\n' + '═'.repeat(56));
console.log('RECOMMENDATION');
if (recommended) {
  console.log(
    `  Minimum useful budget: topComponents ${PROD_TOP}→${recommended.top} (+${recommended.deltaTop}), dedupeCap ${PROD_DEDUPE}→${recommended.dedupe} (+${recommended.deltaDedupe})`,
  );
  console.log(
    `  Teferi probe recall @IoU≥0.8: ${pct(prodRow.teferi.at08)} → ${pct(recommended.teferi.at08)} (${recommended.teferi.hit08}/${recommended.teferi.n})`,
  );
  console.log(
    `  Teferi @0.95: ${pct(prodRow.teferi.at095)} → ${pct(recommended.teferi.at095)}`,
  );
  console.log(
    `  Binder raw recall: ${pct(prodRow.multi.binder?.rawRecall)} → ${pct(recommended.multi.binder?.rawRecall)} (Δ ${((recommended.binderRawDelta || 0) * 100).toFixed(1)}pt)`,
  );
  console.log(
    `  Candidates raw p50/p95: ${prodRow.candidates.rawP50}/${prodRow.candidates.rawP95} → ${recommended.candidates.rawP50}/${recommended.candidates.rawP95}`,
  );
  console.log(
    `  Unmatched pred mean: ${prodRow.candidates.unmatchedPredMean?.toFixed(2)} → ${recommended.candidates.unmatchedPredMean?.toFixed(2)} (Δ ${recommended.unmatchedDelta?.toFixed(2)})`,
  );
  console.log(
    `  Host runtime p50: ${prodRow.runtime.p50?.toFixed(1)} → ${recommended.runtime.p50?.toFixed(1)} ms (Δ ${recommended.runtimeP50Delta?.toFixed(1)}; HOST_JVM)`,
  );
  console.log(`  Selected IoU regression (single-card ≤−0.02): ${recommended.selectedIouRegression ? 'YES' : 'no'}`);
  console.log(`  Livaan still missing (hard-gen control): ${pct(recommended.livaan.at08)} (expected ~0)`);
  const teferiRec = recommended.recoveries.filter(x => x.kind === 'teferi');
  const classes = [...new Set(teferiRec.map(x => x.class))];
  console.log(`  Teferi recovery mechanism: ${classes.join(', ') || 'n/a'}`);
} else {
  console.log('  No feasible config recovered all Teferi probes without regressions.');
  const bestTeferi = [...rows].sort((a, b) => (b.teferi.at08 ?? 0) - (a.teferi.at08 ?? 0) || cost(a) - cost(b))[0];
  console.log(
    `  Best Teferi@.8 anyway: ${bestTeferi.top}×${bestTeferi.dedupe} = ${pct(bestTeferi.teferi.at08)} (regression=${bestTeferi.selectedIouRegression})`,
  );
}

console.log('\nANSWERS');
console.log(
  `1. Cheap Teferi fix via small budget? ${
    recommended && recommended.deltaTop <= 4 && recommended.deltaDedupe <= 12
      ? 'YES'
      : recommended
        ? 'PARTIAL — needs larger jump'
        : 'NO feasible cheap point'
  }`,
);
console.log(
  `2. Minimum useful increase: ${
    recommended
      ? `topComponents +${recommended.deltaTop} (${PROD_TOP}→${recommended.top}), dedupeCap +${recommended.deltaDedupe} (${PROD_DEDUPE}→${recommended.dedupe})`
      : 'none found'
  }`,
);
console.log(
  `3. Recall gain: Teferi probes ${pct(prodRow.teferi.at08)}→${pct(recommended?.teferi.at08)}; binder raw Δ ${((recommended?.binderRawDelta || 0) * 100).toFixed(1)}pt`,
);
console.log(
  `4. Cost: raw cand p50 ${prodRow.candidates.rawP50}→${recommended?.candidates.rawP50}; unmatchedΔ ${recommended?.unmatchedDelta?.toFixed?.(2)}; rtP50Δ ${recommended?.runtimeP50Delta?.toFixed?.(1)}ms host`,
);
console.log(
  `5. New false-selection risk: ${
    recommended?.selectedIouRegression
      ? 'YES (selected IoU drop)'
      : (recommended?.unmatchedDelta ?? 0) > 1.5
        ? 'ELEVATED unmatched preds (multi-select risk if caps raised later)'
        : 'LOW on single-select path (shortlist still 8; no selected IoU regression)'
  }`,
);
console.log('\nProduction unchanged. Livaan full-grid generation NOT addressed.');

const report = {
  kind: 'budget-frontier',
  note: 'SYNTHETIC. Production DetectCard constants unchanged. Host JVM runtime ≠ device.',
  generatedAt: new Date().toISOString(),
  production: { topComponents: PROD_TOP, dedupeCap: PROD_DEDUPE },
  grid: { top: TOP_GRID, dedupe: DEDUPE_GRID },
  nativeInput,
  quick,
  probe: {
    teferiId: teferi.id,
    livaanId: livaan.id,
    pages: probeFixtures.length,
    tags: { teferi: tagsFromWarp(teferi), livaan: tagsFromWarp(livaan) },
  },
  fixtureCounts: {
    total: allFixtures.length,
    probe: probeFixtures.length,
    bySuite: Object.fromEntries(
      [...singleSuites, ...multiSuites].map(s => [
        s,
        suiteFixtures.filter(f => f._evalSuite === s).length,
      ]),
    ),
  },
  productionBaseline: prodRow,
  rows,
  pareto: pareto.map(p => ({
    top: p.top,
    dedupe: p.dedupe,
    teferiAt08: p.teferi.at08,
    cost: cost(p),
    binderRawDelta: p.binderRawDelta,
    unmatchedDelta: p.unmatchedDelta,
    runtimeP50Delta: p.runtimeP50Delta,
  })),
  recommended: recommended
    ? {
        top: recommended.top,
        dedupe: recommended.dedupe,
        deltaTop: recommended.deltaTop,
        deltaDedupe: recommended.deltaDedupe,
        teferi: recommended.teferi,
        livaan: recommended.livaan,
        multi: recommended.multi,
        candidates: recommended.candidates,
        runtime: recommended.runtime,
        recoveryClassCounts: recommended.recoveryClassCounts,
        singleIouDeltaVsProd: recommended.singleIouDeltaVsProd,
        unmatchedDelta: recommended.unmatchedDelta,
        binderRawDelta: recommended.binderRawDelta,
      }
    : null,
};

await mkdir(OUT_ROOT, { recursive: true });
const outPath = join(OUT_ROOT, 'report.json');
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

// Compact CSV for spreadsheet
const csvLines = [
  'top,dedupe,teferi08,teferi09,teferi095,livaan08,binderRaw,binderShort,overlapRaw,scatteredRaw,unmatchedMean,rawP50,rawP95,rtP50,selRegression,cost',
];
for (const r of rows) {
  csvLines.push(
    [
      r.top,
      r.dedupe,
      r.teferi.at08?.toFixed(4),
      r.teferi.at09?.toFixed(4),
      r.teferi.at095?.toFixed(4),
      r.livaan.at08?.toFixed(4),
      r.multi.binder?.rawRecall?.toFixed(4) ?? '',
      r.multi.binder?.shortlistRecall?.toFixed(4) ?? '',
      r.multi.overlap?.rawRecall?.toFixed(4) ?? '',
      r.multi.scattered?.rawRecall?.toFixed(4) ?? '',
      r.candidates.unmatchedPredMean?.toFixed(3),
      r.candidates.rawP50,
      r.candidates.rawP95,
      r.runtime.p50?.toFixed(2),
      r.selectedIouRegression ? 1 : 0,
      cost(r).toFixed(2),
    ].join(','),
  );
}
await writeFile(join(OUT_ROOT, 'frontier.csv'), `${csvLines.join('\n')}\n`);
console.log(`\nWrote ${outPath}`);
console.log(`Wrote ${join(OUT_ROOT, 'frontier.csv')}`);
void SYNTHETIC_ROOT;
