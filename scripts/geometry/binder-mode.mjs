#!/usr/bin/env node
/**
 * yarn geometry:binder-mode
 *
 * Binder Mode v0 — host-only research pipeline.
 * Does NOT change production detector / Single mode / recognition.
 *
 * Stages:
 *   A  top4 + final single
 *   B  top7 multi-return (NMS)
 *   C  top7 + temporal tracks
 *   D  top7 + temporal + grid inference
 *   E  top7 + temporal + grid + targeted local recovery
 *
 *   yarn geometry:binder-mode
 *   yarn geometry:binder-mode --quick
 *
 * SYNTHETIC ONLY — not real-device accuracy.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderBinderPage, tagsFromWarp } from './lib/binder-diagnose/pages.mjs';
import { inferBinderGrid } from './lib/binder-mode/grid.mjs';
import { recoverMissingSlot, edgeEvidenceAll } from './lib/binder-mode/local-recovery.mjs';
import { multiReturnNms, nmsStats } from './lib/binder-mode/multi-return.mjs';
import { BINDER_MODE_V0_POLICY, SINGLE_MODE_POLICY } from './lib/binder-mode/policy.mjs';
import { decodeImageFile, loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { formatPct, matchQuadsByIoU } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { gtQuadToCorners, isCompleteQuad } from './lib/schema.mjs';
import { discoverCardWarps } from './lib/synthetic/cards.mjs';
import { createMultiCardTracker } from './lib/temporal/tracker.mjs';
import { generateBinderSequence } from './lib/temporal/sequences.mjs';
import { hashSeed, mulberry32 } from './lib/synthetic/rng.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const flag = name => process.argv.includes(`--${name}`);

const quick = flag('quick');
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const seed = Number(arg('seed') || 42);
const frames = Number(arg('frames') || (quick ? 6 : 8));
const seqN = Number(arg('sequences') || (quick ? 3 : 5));
const iouThr = 0.8;

const OUT = join(CORPUS_ROOT, 'synthetic/binder-mode');
const policy = BINDER_MODE_V0_POLICY;

const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

console.log('BINDER MODE v0 — HOST PIPELINE');
console.log('─'.repeat(56));
console.log('Host-only research. Production / Single mode UNCHANGED.');
console.log(
  `Binder policy: topComponents=${policy.diagnosticTopComponents} dedupe=${policy.diagnosticDedupeCap} multiReturn max=${policy.maxCards}`,
);
console.log(`Single-equivalent: top=${SINGLE_MODE_POLICY.diagnosticTopComponents}`);
console.log(`input=${nativeInput} quick=${quick} sequences=${seqN} frames=${frames}`);
console.log('');

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;

const recover = (image, predicted, occupied) =>
  recoverMissingSlot(image, predicted, {
    ...policy,
    occupiedCorners: occupied || [],
    polygonIoU,
  });

const warps = await discoverCardWarps({ limit: 24 });
if (warps.length < 9) {
  console.error('Need ≥9 warps');
  process.exit(1);
}
const teferi = warps.find(w => /teferi|federica|veil-old/i.test(w.id));
const livaan = warps.find(w => /livaan/i.test(w.id));
const fillers = warps.filter(w => w !== teferi && w !== livaan);
console.log(`Teferi: ${teferi?.id}`);
console.log(`Livaan control: ${livaan?.id}`);

await mkdir(join(OUT, 'pages'), { recursive: true });

const assignNine = (specials = {}) => {
  const a = new Array(9);
  for (const [slot, w] of Object.entries(specials)) a[Number(slot)] = w;
  let fi = 0;
  for (let s = 0; s < 9; s++) {
    if (!a[s]) a[s] = fillers[fi++ % fillers.length];
  }
  return a;
};

const gtList = fixture =>
  (fixture.cards || [])
    .filter(c => isCompleteQuad(c.groundTruthQuad))
    .map(c => ({
      slot: c.slot,
      row: c.row,
      col: c.col,
      sourceWarp: c.sourceWarp,
      corners: gtQuadToCorners(c.groundTruthQuad),
      empty: false,
    }));

const coverage = (preds, gts) => {
  const matching = matchQuadsByIoU(preds, gts.map(g => g.corners), polygonIoU);
  const hit = matching.pairs.filter(p => p.iou >= iouThr).length;
  return {
    hit,
    gt: gts.length,
    recall: gts.length ? hit / gts.length : null,
    unmatchedPred: matching.unmatchedPredictions.length,
    pairs: matching.pairs,
  };
};

const bestIouTo = (corners, gts) => {
  let best = 0;
  let slot = null;
  for (const g of gts) {
    const iou = polygonIoU(corners, g.corners);
    if (iou > best) {
      best = iou;
      slot = g.slot;
    }
  }
  return { iou: best, slot };
};

// ─── 1. Static full pages (pipeline B + grid D/E on single frame) ───────────
console.log('\n1. Static binder pages (full 3×3)…');
const staticPages = [];
const staticPlans = [
  { id: 'full-livaan-s1-teferi-s8', specials: { 1: livaan, 8: teferi } },
  { id: 'full-livaan-s4-teferi-s0', specials: { 4: livaan, 0: teferi } },
  { id: 'full-livaan-s0', specials: { 0: livaan } },
  ...(quick
    ? []
    : [
        { id: 'full-livaan-s2-teferi-s6', specials: { 2: livaan, 6: teferi } },
        { id: 'full-identity', specials: {} },
      ]),
];
for (const plan of staticPlans) {
  const assignment = assignNine(plan.specials);
  // identity: use first 9 warps including livaan/teferi if present
  if (plan.id === 'full-identity') {
    const nine = warps.slice(0, 9);
    const { fixture } = await renderBinderPage(nine, { id: `bm-${plan.id}`, gapPx: 16 });
    staticPages.push(fixture);
  } else {
    const { fixture } = await renderBinderPage(assignment, { id: `bm-${plan.id}`, gapPx: 16 });
    staticPages.push(fixture);
  }
}

// Empty-pocket controls
console.log('2. Empty-pocket controls…');
const emptyControls = [];
const emptyPlans = [
  { id: 'empty-1-slot4', empty: new Set([4]), specials: { 1: livaan, 8: teferi } },
  { id: 'empty-2-slot1-7', empty: new Set([1, 7]), specials: { 4: teferi } },
  { id: 'empty-row0', empty: new Set([0, 1, 2]), specials: { 4: teferi, 8: livaan } },
];
for (const plan of emptyPlans) {
  const assignment = assignNine(plan.specials);
  const occupied = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8].filter(s => !plan.empty.has(s)));
  const { fixture } = await renderBinderPage(assignment, {
    id: `bm-${plan.id}`,
    gapPx: 16,
    occupiedSlots: occupied,
  });
  fixture.provenance = {
    ...fixture.provenance,
    emptySlots: [...plan.empty],
    emptyControl: true,
  };
  emptyControls.push(fixture);
}

// ─── Detect A (top4) and B (top7) on static + empty ─────────────────────────
const detectPack = [...staticPages, ...emptyControls];
console.log(`\n3. Native detect pack n=${detectPack.length}…`);

console.log('   A: Single-equivalent top=4…');
const detA = await runNativeDetectorBatch(detectPack, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-mode-A'),
  exportPipeline: true,
  diagnosticTopComponents: SINGLE_MODE_POLICY.diagnosticTopComponents,
  diagnosticDedupeCap: SINGLE_MODE_POLICY.diagnosticDedupeCap,
});

console.log('   B: Binder policy top=7…');
const detB = await runNativeDetectorBatch(detectPack, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-mode-B'),
  exportPipeline: true,
  diagnosticTopComponents: policy.diagnosticTopComponents,
  diagnosticDedupeCap: policy.diagnosticDedupeCap,
});

const evalStaticStage = (dets, mode) => {
  const rows = [];
  for (const f of staticPages) {
    const det = dets.get(f.id);
    const gts = gtList(f);
    const pipe = det?.pipeline;
    let preds = [];
    let candStats = null;
    if (mode === 'A') {
      preds = det?.corners ? [det.corners] : [];
    } else {
      const raw = pipe?.rawAfterQuad || [];
      const kept = multiReturnNms(raw, polygonIoU, {
        maxCards: policy.maxCards,
        nmsIou: policy.nmsIou,
        minScore: policy.minScore,
      });
      preds = kept.map(k => k.corners);
      candStats = nmsStats(raw, kept, polygonIoU, policy.nmsIou);
    }
    const cov = coverage(preds, gts);
    rows.push({
      id: f.id,
      recall: cov.recall,
      hit: cov.hit,
      gt: cov.gt,
      falseUnmatched: cov.unmatchedPred,
      candStats,
      runtimeMs: det?.runtimeMs,
    });
  }
  return {
    meanRecall: mean(rows.map(r => r.recall)),
    meanFalse: mean(rows.map(r => r.falseUnmatched)),
    candP50: percentile(
      rows.map(r => r.candStats?.keptCount ?? (r.hit ? 1 : 0)),
      50,
    ),
    candP95: percentile(
      rows.map(r => r.candStats?.keptCount ?? (r.hit ? 1 : 0)),
      95,
    ),
    candMax: Math.max(...rows.map(r => r.candStats?.keptCount ?? (r.hit ? 1 : 0)), 0),
    dupRateMean: mean(rows.map(r => r.candStats?.duplicateRate).filter(x => x != null)),
    runtimeP50: percentile(
      rows.map(r => r.runtimeMs).filter(x => x != null),
      50,
    ),
    runtimeP95: percentile(
      rows.map(r => r.runtimeMs).filter(x => x != null),
      95,
    ),
    rows,
  };
};

const stageA = evalStaticStage(detA, 'A');
const stageB = evalStaticStage(detB, 'B');

console.log(`   A mean GT recall (single): ${formatPct(stageA.meanRecall)}`);
console.log(
  `   B mean GT recall (multi): ${formatPct(stageB.meanRecall)}  false≈${stageB.meanFalse?.toFixed(2)}  kept p50=${stageB.candP50}`,
);

// Shortlist coverage under top7
let binderShortHit = 0;
let binderShortGt = 0;
for (const f of staticPages) {
  const det = detB.get(f.id);
  const gts = gtList(f);
  const cov = coverage(
    (det?.pipeline?.shortlist || []).map(c => c.quad || c.corners).filter(Boolean),
    gts,
  );
  binderShortHit += cov.hit;
  binderShortGt += cov.gt;
}

// ─── Grid + local recovery on static (D/E single-frame) ─────────────────────
console.log('\n4. Grid inference + targeted recovery (static)…');
const gridRows = [];
const predictIous = [];
const livaanCases = [];
const emptyRecovery = [];

for (const f of staticPages) {
  const det = detB.get(f.id);
  const gts = gtList(f);
  const raw = det?.pipeline?.rawAfterQuad || [];
  const kept = multiReturnNms(raw, polygonIoU, {
    maxCards: policy.maxCards,
    nmsIou: policy.nmsIou,
    minScore: policy.minScore,
  });
  const tGrid0 = performance.now();
  const grid = inferBinderGrid(
    kept.map(k => k.corners),
    { rows: policy.gridRows, cols: policy.gridCols },
  );
  const gridMs = performance.now() - tGrid0;

  // Assignment accuracy vs GT slots
  let assignCorrect = 0;
  let assignN = 0;
  for (const a of grid.assignments || []) {
    const match = bestIouTo(a.corners, gts);
    if (match.iou >= iouThr) {
      assignN += 1;
      const gt = gts.find(g => g.slot === match.slot);
      if (gt && gt.row === a.row && gt.col === a.col) assignCorrect += 1;
    }
  }

  const image = await decodeImageFile(join(rootDir, f.image));
  const recovered = [];
  let localMs = 0;
  for (const miss of grid.missing || []) {
    // Predicted IoU vs GT if any card should be there
    const gtAt = gts.find(g => g.row === miss.row && g.col === miss.col);
    if (gtAt) {
      const predIou = polygonIoU(miss.corners, gtAt.corners);
      predictIous.push(predIou);
    }
    const rec = recover(image, miss.corners, kept.map(k => k.corners));
    localMs += rec.runtimeMs;
    if (gtAt) {
      const recIou = rec.corners ? polygonIoU(rec.corners, gtAt.corners) : 0;
      recovered.push({
        row: miss.row,
        col: miss.col,
        warp: gtAt.sourceWarp,
        predictedIou: polygonIoU(miss.corners, gtAt.corners),
        accepted: rec.accepted,
        recoveredIou: recIou,
        evidence: rec.evidence,
        reason: rec.reason,
      });
      if (/livaan/i.test(gtAt.sourceWarp || '')) {
        const globalHit = coverage(kept.map(k => k.corners), [gtAt]).hit >= 1;
        livaanCases.push({
          page: f.id,
          slot: gtAt.slot,
          row: miss.row,
          col: miss.col,
          globalGenerated: globalHit,
          predictedIou: polygonIoU(miss.corners, gtAt.corners),
          localEdge: rec.evidence,
          locallyRecovered: rec.accepted,
          recoveredIou: recIou,
          reason: rec.reason,
        });
      }
    }
  }

  // Also: Livaan may be missing from multi-return but present in GT occupied cell not in grid.missing
  // If Livaan GT exists and not covered by kept, force check via grid cell prediction
  for (const g of gts) {
    if (!/livaan/i.test(g.sourceWarp || '')) continue;
    if (livaanCases.some(c => c.page === f.id && c.slot === g.slot)) continue;
    const globalHit = coverage(kept.map(k => k.corners), [g]).hit >= 1;
    if (globalHit) {
      livaanCases.push({
        page: f.id,
        slot: g.slot,
        row: g.row,
        col: g.col,
        globalGenerated: true,
        predictedIou: null,
        localEdge: null,
        locallyRecovered: null,
        recoveredIou: null,
        reason: 'already-global',
      });
      continue;
    }
    // Predict this cell even if grid thought it occupied wrongly, or use missing prediction
    const pred =
      grid.predicted?.[g.row]?.[g.col]?.corners ||
      grid.missing?.find(m => m.row === g.row && m.col === g.col)?.corners;
    if (!pred) {
      // synthesize from grid predict API — re-call missing for that cell
      const forced = inferBinderGrid(
        kept.map(k => k.corners),
        { rows: 3, cols: 3 },
      );
      // Remove any assignment that weakly matches and re-predict — simpler: use GT-free neighbor interpolate
      // Fall back: use mean of all kept shape at GT center is cheating. Use grid cell if marked observed wrongly.
      const cell = forced.predicted?.[g.row]?.[g.col];
      if (cell?.corners) {
        const predIou = polygonIoU(cell.corners, g.corners);
        predictIous.push(predIou);
        const rec = recover(image, cell.corners, kept.map(k => k.corners));
        localMs += rec.runtimeMs;
        livaanCases.push({
          page: f.id,
          slot: g.slot,
          row: g.row,
          col: g.col,
          globalGenerated: false,
          predictedIou: predIou,
          localEdge: rec.evidence,
          locallyRecovered: rec.accepted,
          recoveredIou: rec.corners ? polygonIoU(rec.corners, g.corners) : 0,
          reason: rec.reason,
          note: 'forced-cell-predict',
        });
      }
      continue;
    }
    const predIou = polygonIoU(pred, g.corners);
    predictIous.push(predIou);
    const rec = recover(image, pred, kept.map(k => k.corners));
    localMs += rec.runtimeMs;
    livaanCases.push({
      page: f.id,
      slot: g.slot,
      row: g.row,
      col: g.col,
      globalGenerated: false,
      predictedIou: predIou,
      localEdge: rec.evidence,
      locallyRecovered: rec.accepted,
      recoveredIou: rec.corners ? polygonIoU(rec.corners, g.corners) : 0,
      reason: rec.reason,
    });
  }

  const multiHit = coverage(kept.map(k => k.corners), gts);
  const withRecovery = [...kept.map(k => k.corners)];
  for (const r of recovered) {
    if (r.accepted && r.recoveredIou >= iouThr) withRecovery.push(
      // find corners from last recover — store in recovered
      null,
    );
  }
  // rebuild recovered corners list
  const recoveredCorners = [];
  for (const miss of grid.missing || []) {
    const gtAt = gts.find(g => g.row === miss.row && g.col === miss.col);
    if (!gtAt) continue;
    const rec = recover(image, miss.corners, kept.map(k => k.corners));
    if (rec.accepted) recoveredCorners.push(rec.corners);
  }
  // Also accepted Livaan recoveries from forced path
  for (const lc of livaanCases.filter(c => c.page === f.id && c.locallyRecovered && c.recoveredIou >= iouThr)) {
    // corners not stored — re-run quickly for aggregation only via flag
    void lc;
  }
  const ePreds = [...kept.map(k => k.corners), ...recoveredCorners];
  const eCov = coverage(ePreds, gts);

  gridRows.push({
    id: f.id,
    gridConfidence: grid.confidence,
    occupancy: grid.occupancy,
    assignAccuracy: assignN ? assignCorrect / assignN : null,
    missingPredicted: grid.missing?.length ?? 0,
    multiRecall: multiHit.recall,
    withLocalRecall: eCov.recall,
    gridMs,
    localMs,
  });
}

// Empty pocket false recovery — force-predict every provenance empty slot
for (const f of emptyControls) {
  const det = detB.get(f.id);
  const emptySlots = [...(f.provenance?.emptySlots || [])];
  const raw = det?.pipeline?.rawAfterQuad || [];
  const kept = multiReturnNms(raw, polygonIoU, {
    maxCards: policy.maxCards,
    nmsIou: policy.nmsIou,
    minScore: policy.minScore,
  });
  const grid = inferBinderGrid(
    kept.map(k => k.corners),
    { rows: 3, cols: 3 },
  );
  const image = await decodeImageFile(join(rootDir, f.image));
  for (const slot of emptySlots) {
    const row = Math.floor(slot / 3);
    const col = slot % 3;
    const pred =
      grid.predicted?.[row]?.[col]?.corners ||
      grid.missing?.find(m => m.row === row && m.col === col)?.corners;
    if (!pred) {
      emptyRecovery.push({
        page: f.id,
        row,
        col,
        slot,
        trulyEmpty: true,
        accepted: false,
        evidenceMean: null,
        reason: 'no-prediction',
        falsePositive: false,
      });
      continue;
    }
    const rec = recover(image, pred, kept.map(k => k.corners));
    emptyRecovery.push({
      page: f.id,
      row,
      col,
      slot,
      trulyEmpty: true,
      accepted: rec.accepted,
      evidenceMean: rec.evidence?.mean ?? null,
      reason: rec.reason,
      falsePositive: rec.accepted,
    });
  }
  // Also any grid.missing that isn't a real GT card
  for (const miss of grid.missing || []) {
    const slot = miss.row * 3 + miss.col;
    if (emptySlots.includes(slot)) continue;
    const hasGt = (f.cards || []).some(c => c.slot === slot);
    if (hasGt) continue;
    const rec = recover(image, miss.corners, kept.map(k => k.corners));
    emptyRecovery.push({
      page: f.id,
      row: miss.row,
      col: miss.col,
      slot,
      trulyEmpty: true,
      accepted: rec.accepted,
      evidenceMean: rec.evidence?.mean ?? null,
      reason: rec.reason,
      falsePositive: rec.accepted,
    });
  }
}

const falseEmpty = emptyRecovery.filter(e => e.trulyEmpty);
const falsePosRate = falseEmpty.length
  ? falseEmpty.filter(e => e.falsePositive).length / falseEmpty.length
  : null;

console.log(
  `   Predicted missing IoU: median=${percentile(predictIous, 50)?.toFixed(3)} p10=${percentile(predictIous, 10)?.toFixed(3)} ≥.8=${formatPct(predictIous.filter(x => x >= 0.8).length / Math.max(predictIous.length, 1))} ≥.9=${formatPct(predictIous.filter(x => x >= 0.9).length / Math.max(predictIous.length, 1))} n=${predictIous.length}`,
);
console.log(`   Livaan cases: ${livaanCases.length}`);
for (const lc of livaanCases) {
  console.log(
    `     ${lc.page} slot=${lc.slot} global=${lc.globalGenerated} predIoU=${lc.predictedIou?.toFixed?.(3) ?? '—'} recovered=${lc.locallyRecovered} recIoU=${lc.recoveredIou?.toFixed?.(3) ?? '—'} edgeMean=${lc.localEdge?.mean?.toFixed?.(3) ?? '—'} (${lc.reason})`,
  );
}
console.log(
  `   Empty-pocket false recovery: ${falseEmpty.filter(e => e.falsePositive).length}/${falseEmpty.length} (${formatPct(falsePosRate)})`,
);

// ─── Temporal sequences C/D/E ───────────────────────────────────────────────
console.log('\n5. Temporal sequences (MEDIUM motion)…');
const temporalResults = [];
const stageC_recalls = [];
const stageD_recalls = [];
const stageE_recalls = [];

for (let si = 0; si < seqN; si++) {
  const seqSeed = hashSeed(seed, `bm-seq-${si}`);
  // Ensure Livaan+Teferi in first sequence
  let warpOrder = null;
  if (si === 0 && livaan && teferi) {
    const nine = assignNine({ 1: livaan, 8: teferi });
    warpOrder = nine;
  }
  const seq = await generateBinderSequence({
    seed: seqSeed,
    motion: 'MEDIUM',
    glare: 'none',
    frames,
    fps: 15,
    writeImages: true,
    warpOrder,
  });
  const fixtures = [];
  for (const fm of seq.manifest.frameManifests) {
    const fp = join(rootDir, fm.fixturePath);
    fixtures.push(JSON.parse(await (await import('node:fs/promises')).readFile(fp, 'utf8')));
  }

  const dets = await runNativeDetectorBatch(fixtures, {
    inputMode: nativeInput,
    batchDir: join(CORPUS_ROOT, `native-batch-binder-mode-temp-${si}`),
    exportPipeline: true,
    diagnosticTopComponents: policy.diagnosticTopComponents,
    diagnosticDedupeCap: policy.diagnosticDedupeCap,
  });

  const tracker = createMultiCardTracker({ polygonIoU });
  const everSeen = new Set();
  let lastGrid = null;
  const everWithGrid = new Set();
  const everWithLocal = new Set();
  let livaanTemporal = null;

  for (const f of fixtures) {
    const det = dets.get(f.id);
    const raw = det?.pipeline?.rawAfterQuad || [];
    const kept = multiReturnNms(raw, polygonIoU, {
      maxCards: policy.maxCards,
      nmsIou: policy.nmsIou,
      minScore: policy.minScore,
    });
    tracker.step(f.frameIndex, kept);
    const tracks = tracker.getTracks().filter(t => t.state === 'confirmed' || t.state === 'candidate');
    const gts = gtList(f);

    // C: temporal eventual
    const acqPreds = tracks.filter(t => t.best?.corners).map(t => t.best.corners);
    const acq = coverage(acqPreds, gts);
    for (const p of acq.pairs) {
      if (p.iou >= iouThr) everSeen.add(gts[p.gi].slot);
    }

    // D: grid from current tracks
    const grid = inferBinderGrid(acqPreds, { rows: 3, cols: 3 });
    lastGrid = grid;
    for (const a of grid.assignments || []) {
      const m = bestIouTo(a.corners, gts);
      if (m.iou >= iouThr) everWithGrid.add(m.slot);
    }
    for (const s of everSeen) everWithGrid.add(s);

    // E: local recovery on missing
    const image = await decodeImageFile(join(rootDir, f.image));
    for (const miss of grid.missing || []) {
      const gtAt = gts.find(g => g.row === miss.row && g.col === miss.col);
      const rec = recover(image, miss.corners, kept.map(k => k.corners));
      if (rec.accepted && rec.corners) {
        const m = bestIouTo(rec.corners, gts);
        if (m.iou >= iouThr) everWithLocal.add(m.slot);
      }
      if (gtAt && /livaan/i.test(gtAt.sourceWarp || '')) {
        const globalHit = coverage(kept.map(k => k.corners), [gtAt]).hit >= 1;
        livaanTemporal = {
          frame: f.frameIndex,
          globalGenerated: globalHit,
          predictedIou: polygonIoU(miss.corners, gtAt.corners),
          locallyRecovered: rec.accepted,
          recoveredIou: rec.corners ? polygonIoU(rec.corners, gtAt.corners) : 0,
          evidenceMean: rec.evidence?.mean,
          reason: rec.reason,
        };
      }
    }
    for (const s of everSeen) everWithLocal.add(s);
    for (const s of everWithGrid) everWithLocal.add(s);
  }

  const gtSlots = 9;
  stageC_recalls.push(everSeen.size / gtSlots);
  stageD_recalls.push(everWithGrid.size / gtSlots);
  stageE_recalls.push(everWithLocal.size / gtSlots);
  temporalResults.push({
    seqId: seq.manifest.sequenceId,
    C: everSeen.size / gtSlots,
    D: everWithGrid.size / gtSlots,
    E: everWithLocal.size / gtSlots,
    gridConfidence: lastGrid?.confidence,
    livaanTemporal,
  });
  console.log(
    `   seq ${si}: C=${formatPct(everSeen.size / gtSlots)} D=${formatPct(everWithGrid.size / gtSlots)} E=${formatPct(everWithLocal.size / gtSlots)} livaan=${livaanTemporal ? `global=${livaanTemporal.globalGenerated} rec=${livaanTemporal.locallyRecovered} iou=${livaanTemporal.recoveredIou?.toFixed(3)}` : 'n/a'}`,
  );
}

// Pipeline contribution table
const pipeline = {
  A: {
    label: 'top4 + final single',
    eventualRecall: stageA.meanRecall,
    note: 'static single-select (not multi)',
  },
  B: {
    label: 'top7 multi-return',
    eventualRecall: stageB.meanRecall,
    falseUnmatched: stageB.meanFalse,
    candP50: stageB.candP50,
    candP95: stageB.candP95,
    candMax: stageB.candMax,
  },
  C: {
    label: 'top7 + temporal tracks',
    eventualRecall: mean(stageC_recalls),
  },
  D: {
    label: 'top7 + temporal + grid',
    eventualRecall: mean(stageD_recalls),
  },
  E: {
    label: 'top7 + temporal + grid + local recovery',
    eventualRecall: mean(stageE_recalls),
  },
};

console.log('\n' + '═'.repeat(56));
console.log('PIPELINE CONTRIBUTION (eventual / static mean GT @IoU≥0.8)');
console.log('═'.repeat(56));
for (const k of ['A', 'B', 'C', 'D', 'E']) {
  console.log(`  ${k}  ${pipeline[k].label.padEnd(42)} ${formatPct(pipeline[k].eventualRecall)}`);
}

const livaanRecovered = livaanCases.some(c => c.locallyRecovered && (c.recoveredIou ?? 0) >= 0.8);
const livaanAnyLocal = livaanCases.some(c => c.locallyRecovered);
const livaanTemporalOk = temporalResults.some(
  t => t.livaanTemporal?.locallyRecovered && (t.livaanTemporal.recoveredIou ?? 0) >= 0.8,
);

console.log('\nLIVAAN CONTROL');
console.log(`  global generated (any static): ${livaanCases.some(c => c.globalGenerated)}`);
console.log(`  targeted local recovery ≥0.8: ${livaanRecovered || livaanTemporalOk}`);
console.log(`  any local accept (may be weak IoU): ${livaanAnyLocal}`);

console.log('\nFINAL QUESTION');
const canExploit =
  (pipeline.E.eventualRecall ?? 0) > (pipeline.B.eventualRecall ?? 0) + 0.01 ||
  livaanRecovered ||
  livaanTemporalOk;
console.log(
  `  Can Binder Mode recover cards global detector cannot? ${
    livaanRecovered || livaanTemporalOk
      ? 'YES — Livaan recovered via grid+local'
      : canExploit
        ? 'PARTIAL — pipeline gains without confirming Livaan ≥0.8'
        : 'NOT YET — local recovery did not confirm hard-generation misses'
  }`,
);
console.log('  Production unchanged. Single mode unchanged.');

const report = {
  kind: 'binder-mode-v0',
  note: 'SYNTHETIC host research. Production DetectCard / Single mode unchanged. No OCR.',
  generatedAt: new Date().toISOString(),
  policy: { binder: policy, single: SINGLE_MODE_POLICY },
  stages: {
    A: stageA,
    B: stageB,
    binderShortlistRecall: binderShortGt ? binderShortHit / binderShortGt : null,
    grid: {
      meanConfidence: mean(gridRows.map(r => r.gridConfidence)),
      meanAssignAccuracy: mean(gridRows.map(r => r.assignAccuracy).filter(x => x != null)),
      predictedIou: {
        median: percentile(predictIous, 50),
        p10: percentile(predictIous, 10),
        ge08: predictIous.length
          ? predictIous.filter(x => x >= 0.8).length / predictIous.length
          : null,
        ge09: predictIous.length
          ? predictIous.filter(x => x >= 0.9).length / predictIous.length
          : null,
        n: predictIous.length,
      },
      rows: gridRows,
    },
    livaan: livaanCases,
    emptyPocket: {
      falsePositiveRate: falsePosRate,
      cases: emptyRecovery,
    },
    temporal: temporalResults,
    pipeline,
  },
  performance: {
    note: 'HOST_JVM_NOT_DEVICE_LATENCY',
    detectRuntimeP50_A: stageA.runtimeP50,
    detectRuntimeP50_B: stageB.runtimeP50,
    meanGridMs: mean(gridRows.map(r => r.gridMs)),
    meanLocalMs: mean(gridRows.map(r => r.localMs)),
  },
  answers: {
    teferiViaBudget: 'handled by top=7 multi-return (prior frontier)',
    livaanViaLocal: livaanRecovered || livaanTemporalOk,
    emptyFalseRate: falsePosRate,
    canExploitSeenCardsForMissing: livaanRecovered || livaanTemporalOk || canExploit,
  },
};

await writeFile(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWrote ${join(OUT, 'report.json')}`);
void mulberry32;
void edgeEvidenceAll;
void tagsFromWarp;
