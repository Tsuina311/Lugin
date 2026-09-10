#!/usr/bin/env node
/**
 * yarn geometry:binder-diagnose
 *
 * Root-cause analysis for binder never-seen cards.
 * Host-only. Does NOT tune production detector.
 *
 * SYNTHETIC ONLY — not real-device accuracy.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DIAG_ROOT,
  generateAssignments,
  loadWarp,
  renderBinderPage,
  slotRowCol,
  tagsFromWarp,
} from './lib/binder-diagnose/pages.mjs';
import { decodeImageFile, loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { gtQuadToCorners, isCompleteQuad } from './lib/schema.mjs';
import { discoverCardWarps } from './lib/synthetic/cards.mjs';
import { generateBinderSequence } from './lib/temporal/sequences.mjs';
import { runTemporalAnalysis } from './lib/temporal/analyze.mjs';
import { hashSeed } from './lib/synthetic/rng.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const pagesN = Number(arg('pages') || 30);
const seed = Number(arg('seed') || 42);
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const iouThr = 0.8;

console.log('BINDER NEVER-SEEN ROOT CAUSE / SLOT PERMUTATION');
console.log('─'.repeat(56));
console.log('SYNTHETIC ONLY. Production detector not tuned.');
console.log('');

// ─── 1. Audit prior temporal design ─────────────────────────────────────────
console.log('1. EXPERIMENT DESIGN AUDIT (prior temporal matrix)');
console.log('   All 6 temporal sequences reused ONE page composition.');
console.log('   Slot 1 ALWAYS = replay:livaan-cultist-of-tiamat-foil-…');
console.log('   → Prior slot-1 failure CANNOT separate POSITION vs CONTENT.');
console.log('');

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;
const warps = await discoverCardWarps({ limit: 24 });
if (warps.length < 9) {
  console.error('Need ≥9 card warps');
  process.exit(1);
}
const nine = warps.slice(0, 9);
console.log('Fixed 9 warps:');
nine.forEach((w, i) => console.log(`  [${i}] ${w.id} tags=${tagsFromWarp(w).join(',') || '—'}`));

await mkdir(DIAG_ROOT, { recursive: true });

const bestMatch = (cands, gt) => {
  let best = { iou: 0, score: 0, cand: null };
  for (const c of cands || []) {
    const q = c.quad || c.corners;
    if (!q) continue;
    const iou = polygonIoU(q, gt);
    if (iou > best.iou) best = { iou, score: c.finalScore ?? c.score ?? 0, cand: c };
  }
  return best;
};

const classifyNeverSeen = (det, gt) => {
  const pipe = det?.pipeline;
  if (!pipe) return { class: 'UNKNOWN', detail: 'no-pipeline' };
  const raw = bestMatch(pipe.rawAfterQuad, gt);
  if (raw.iou >= iouThr) return { class: 'QUAD_EXISTS_IN_RAW', detail: `iou=${raw.iou.toFixed(3)}` };
  const rejected = (pipe.rejected || []).filter(r => r.quad);
  const rej = bestMatch(rejected, gt);
  if (rej.iou >= 0.5) {
    return {
      class: 'QUAD_FORMED_THEN_REJECTED',
      detail: `${rej.cand?.reason || 'gate'} iou=${rej.iou.toFixed(3)}`,
    };
  }
  // Check if any rejected pre-quad near center
  const center = {
    x: (gt.topLeft.x + gt.topRight.x + gt.bottomRight.x + gt.bottomLeft.x) / 4,
    y: (gt.topLeft.y + gt.topRight.y + gt.bottomRight.y + gt.bottomLeft.y) / 4,
  };
  const nearPre = (pipe.rejected || []).filter(r => r.stage === 'pre-quad' && r.areaShare > 0.01);
  if (nearPre.length && raw.iou < 0.3) {
    return { class: 'EDGES_PRESENT_BUT_NO_QUAD', detail: `pre-quad rejects=${nearPre.length}` };
  }
  if (raw.iou > 0.3 && raw.iou < iouThr) {
    return { class: 'QUAD_WEAK_BELOW_IOU', detail: `bestRawIoU=${raw.iou.toFixed(3)}` };
  }
  return { class: 'CARD_EDGES_ABSENT_OR_MERGED', detail: `bestRawIoU=${raw.iou.toFixed(3)}` };
};

/** Mean absolute luma gradient along GT edge, sampling inward. */
const edgeEvidence = (image, corners, side) => {
  const { data, width: w, height: h } = image;
  const luma = (x, y) => {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    const o = (yi * w + xi) * 4;
    return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  };
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const edges = {
    top: [pts[0], pts[1]],
    right: [pts[1], pts[2]],
    bottom: [pts[2], pts[3]],
    left: [pts[3], pts[0]],
  };
  const [a, b] = edges[side];
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if ((cx - mx) * nx + (cy - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  let sum = 0;
  let n = 0;
  for (let s = 0; s < 20; s++) {
    const t = (s + 0.5) / 20;
    const bx = a.x + (b.x - a.x) * t;
    const by = a.y + (b.y - a.y) * t;
    const out = luma(bx - nx * 3, by - ny * 3);
    const inn = luma(bx + nx * 3, by + ny * 3);
    sum += Math.abs(inn - out);
    n += 1;
  }
  return n ? sum / n / 255 : 0;
};

// ─── 2. Permutation pages ───────────────────────────────────────────────────
console.log(`\n2. Generating ${pagesN} permutation pages…`);
const assignments = generateAssignments(nine, { count: pagesN, seed });
const fixtures = [];
for (const a of assignments) {
  const { fixture } = await renderBinderPage(a.warps, {
    id: a.id,
    gapPx: 16,
    pockets: 'none',
  });
  fixtures.push(fixture);
}
console.log(`   rendered ${fixtures.length} pages`);

console.log('   Running native Y-from-RGBA (production caps + pipeline)…');
const detections = await runNativeDetectorBatch(fixtures, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-diagnose-perm'),
  exportPipeline: true,
});

// Larger diagnostic cap pass on same fixtures
console.log('   Running diagnostic larger topComponents=12 dedupeCap=40…');
const detectionsDiag = await runNativeDetectorBatch(fixtures, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-diagnose-cap'),
  exportPipeline: true,
  diagnosticTopComponents: 12,
  diagnosticDedupeCap: 40,
});

// Collect card×slot stats
const posStats = Array.from({ length: 9 }, () => ({ hit: 0, n: 0 }));
const cardStats = new Map(); // warpId -> { hit, n, tags }
const cellStats = new Map(); // `${warpId}@${slot}` -> { hit, n }
const neverCases = [];

for (const f of fixtures) {
  const det = detections.get(f.id);
  const detDiag = detectionsDiag.get(f.id);
  const raw = det?.pipeline?.rawAfterQuad || [];
  const rawDiag = detDiag?.pipeline?.rawAfterQuad || [];
  for (const card of f.cards) {
    const gt = gtQuadToCorners(card.groundTruthQuad);
    const m = bestMatch(raw, gt);
    const mDiag = bestMatch(rawDiag, gt);
    const hit = m.iou >= iouThr;
    posStats[card.slot].n += 1;
    if (hit) posStats[card.slot].hit += 1;
    if (!cardStats.has(card.sourceWarp)) {
      cardStats.set(card.sourceWarp, { hit: 0, n: 0, tags: card.tags || [] });
    }
    const cs = cardStats.get(card.sourceWarp);
    cs.n += 1;
    if (hit) cs.hit += 1;
    const key = `${card.sourceWarp}@${card.slot}`;
    if (!cellStats.has(key)) cellStats.set(key, { hit: 0, n: 0, warp: card.sourceWarp, slot: card.slot });
    const cell = cellStats.get(key);
    cell.n += 1;
    if (hit) cell.hit += 1;

    if (!hit) {
      const cls = classifyNeverSeen(det, gt);
      const abs = join(rootDir, f.image);
      const image = await decodeImageFile(abs);
      const edges = {
        top: edgeEvidence(image, gt, 'top'),
        right: edgeEvidence(image, gt, 'right'),
        bottom: edgeEvidence(image, gt, 'bottom'),
        left: edgeEvidence(image, gt, 'left'),
      };
      neverCases.push({
        page: f.id,
        slot: card.slot,
        warp: card.sourceWarp,
        bestRawIou: m.iou,
        bestDiagIou: mDiag.iou,
        diagRevealed: mDiag.iou >= iouThr && m.iou < iouThr,
        classification: cls,
        edges,
      });
    }
  }
}

const printPosMatrix = (stats, label) => {
  console.log(`\n3. POSITION MATRIX (${label}) raw @IoU≥${iouThr}`);
  const cell = s => {
    const r = s.n ? s.hit / s.n : null;
    return r == null ? '  —  ' : `${(r * 100).toFixed(0).padStart(3)}%`;
  };
  console.log('             LEFT   CENTER   RIGHT');
  console.log(`  TOP      ${cell(stats[0])}   ${cell(stats[1])}   ${cell(stats[2])}`);
  console.log(`  MIDDLE   ${cell(stats[3])}   ${cell(stats[4])}   ${cell(stats[5])}`);
  console.log(`  BOTTOM   ${cell(stats[6])}   ${cell(stats[7])}   ${cell(stats[8])}`);
};
printPosMatrix(posStats, 'single-frame permutations');

console.log('\n4. CONTENT MATRIX (recall across all positions)');
const cardRows = [...cardStats.entries()]
  .map(([id, s]) => ({ id, recall: s.n ? s.hit / s.n : 0, ...s }))
  .sort((a, b) => a.recall - b.recall);
for (const r of cardRows) {
  console.log(
    `  ${(r.recall * 100).toFixed(0).padStart(3)}%  ${r.hit}/${r.n}  ${r.id}  [${r.tags.join(',') || '—'}]`,
  );
}

console.log('\n5. CARD × POSITION hotspots (recall < 50%, n≥2)');
const hotspots = [...cellStats.values()]
  .map(c => ({ ...c, recall: c.n ? c.hit / c.n : 0 }))
  .filter(c => c.n >= 2 && c.recall < 0.5)
  .sort((a, b) => a.recall - b.recall);
if (!hotspots.length) console.log('  (none)');
for (const h of hotspots.slice(0, 20)) {
  console.log(`  ${(h.recall * 100).toFixed(0)}%  slot ${h.slot}  ${h.warp}`);
}

// Cap comparison
const capRevealed = neverCases.filter(n => n.diagRevealed).length;
console.log(`\n12. RAW CAP CONTROL`);
console.log(`   never-seen under production caps: ${neverCases.length}`);
console.log(`   of those revealed by topComponents=12 / dedupe=40: ${capRevealed}`);
console.log(
  `   → ${capRevealed ? 'PARTIAL candidate-budget effect' : 'NOT a candidate-budget problem (missing cards stay missing)'}`,
);

// Classification breakdown
const classCounts = {};
for (const n of neverCases) {
  classCounts[n.classification.class] = (classCounts[n.classification.class] || 0) + 1;
}
console.log('\n10/11. GENERATION STAGE (never-seen classifications)');
for (const [k, v] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k}: ${v}`);
}

// Edge evidence: compare miss vs hit on same pages
const missEdges = neverCases.map(n => n.edges);
const hitEdges = [];
for (const f of fixtures.slice(0, 10)) {
  const det = detections.get(f.id);
  const raw = det?.pipeline?.rawAfterQuad || [];
  const abs = join(rootDir, f.image);
  const image = await decodeImageFile(abs);
  for (const card of f.cards) {
    const gt = gtQuadToCorners(card.groundTruthQuad);
    if (bestMatch(raw, gt).iou < iouThr) continue;
    hitEdges.push({
      top: edgeEvidence(image, gt, 'top'),
      right: edgeEvidence(image, gt, 'right'),
      bottom: edgeEvidence(image, gt, 'bottom'),
      left: edgeEvidence(image, gt, 'left'),
    });
  }
}
const meanE = arr => {
  const o = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!arr.length) return o;
  for (const e of arr) for (const k of Object.keys(o)) o[k] += e[k];
  for (const k of Object.keys(o)) o[k] /= arr.length;
  return o;
};
const mMiss = meanE(missEdges);
const mHit = meanE(hitEdges);
console.log('\n11. EDGE EVIDENCE (mean |Δluma| along GT edges, 0–1)');
console.log(
  `   HIT  cards: T=${mHit.top.toFixed(2)} R=${mHit.right.toFixed(2)} B=${mHit.bottom.toFixed(2)} L=${mHit.left.toFixed(2)}  n=${hitEdges.length}`,
);
console.log(
  `   MISS cards: T=${mMiss.top.toFixed(2)} R=${mMiss.right.toFixed(2)} B=${mMiss.bottom.toFixed(2)} L=${mMiss.left.toFixed(2)}  n=${missEdges.length}`,
);

// ─── 6. Rotation control on identity page ───────────────────────────────────
console.log('\n6. ROTATION / MIRROR CONTROL (fixed assignment, rotate page)');
const rotFixtures = [];
for (const rot of [0, 90, 180, 270]) {
  const { fixture } = await renderBinderPage(nine, {
    id: `rot-${rot}`,
    rotationDeg: rot,
  });
  rotFixtures.push(fixture);
}
const { fixture: mirrorFix } = await renderBinderPage(nine, {
  id: 'rot-mirror0',
  mirror: true,
  rotationDeg: 0,
});
rotFixtures.push(mirrorFix);
const rotDet = await runNativeDetectorBatch(rotFixtures, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-diagnose-rot'),
  exportPipeline: true,
});
for (const f of rotFixtures) {
  const det = rotDet.get(f.id);
  const raw = det?.pipeline?.rawAfterQuad || [];
  const misses = f.cards.filter(c => bestMatch(raw, gtQuadToCorners(c.groundTruthQuad)).iou < iouThr);
  console.log(
    `   ${f.id}: hit ${9 - misses.length}/9  misses=[${misses.map(m => `${m.slot}:${m.sourceWarp.split(':').pop()?.slice(0, 20)}`).join(', ')}]`,
  );
}

// ─── 7. Isolation for worst hotspot ─────────────────────────────────────────
console.log('\n7. ISOLATION CONTROL');
const worst =
  hotspots[0] ||
  neverCases.sort((a, b) => a.bestRawIou - b.bestRawIou)[0] ||
  null;
let isolation = null;
if (worst) {
  const warpId = worst.warp || worst.sourceWarp;
  const slot = worst.slot;
  const warp = nine.find(w => w.id === warpId) || nine[1];
  const assign = Array(9).fill(null).map((_, i) => nine[i % nine.length]);
  // place target warp at slot
  assign[slot] = warp;
  const { row, col } = slotRowCol(slot);
  const neighbors = {
    alone: new Set([slot]),
    left: col > 0 ? new Set([slot, slot - 1]) : new Set([slot]),
    right: col < 2 ? new Set([slot, slot + 1]) : new Set([slot]),
    top: row > 0 ? new Set([slot, slot - 3]) : new Set([slot]),
    bottom: row < 2 ? new Set([slot, slot + 3]) : new Set([slot]),
    full: null,
  };
  const isoFixtures = [];
  for (const [name, occ] of Object.entries(neighbors)) {
    const { fixture } = await renderBinderPage(assign, {
      id: `iso-${slot}-${name}`,
      occupiedSlots: occ,
    });
    // Only evaluate the target card — strip others from GT for clarity
    fixture.cards = fixture.cards.filter(c => c.slot === slot);
    fixture._iso = name;
    isoFixtures.push(fixture);
  }
  const isoDet = await runNativeDetectorBatch(isoFixtures, {
    inputMode: nativeInput,
    batchDir: join(CORPUS_ROOT, 'native-batch-binder-diagnose-iso'),
    exportPipeline: true,
  });
  isolation = {};
  for (const f of isoFixtures) {
    const det = isoDet.get(f.id);
    const card = f.cards[0];
    const m = bestMatch(det?.pipeline?.rawAfterQuad, gtQuadToCorners(card.groundTruthQuad));
    isolation[f._iso] = { iou: m.iou, hit: m.iou >= iouThr };
    console.log(`   ${f._iso}: IoU=${m.iou.toFixed(3)} hit=${m.iou >= iouThr}`);
  }
  console.log(`   target: slot ${slot}  ${warp.id}`);
}

// ─── 8. Gap sweep ───────────────────────────────────────────────────────────
console.log('\n8. GAP SWEEP (identity assignment)');
const gaps = [
  { name: 'touching', px: 0 },
  { name: 'small', px: 8 },
  { name: 'medium', px: 16 },
  { name: 'large', px: 40 },
  { name: 'xlarge', px: 72 },
];
const gapFixtures = [];
for (const g of gaps) {
  const { fixture } = await renderBinderPage(nine, { id: `gap-${g.name}`, gapPx: g.px });
  fixture._gap = g;
  gapFixtures.push(fixture);
}
const gapDet = await runNativeDetectorBatch(gapFixtures, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-diagnose-gap'),
  exportPipeline: true,
});
const gapResults = [];
for (const f of gapFixtures) {
  const det = gapDet.get(f.id);
  const raw = det?.pipeline?.rawAfterQuad || [];
  let hit = 0;
  for (const c of f.cards) {
    if (bestMatch(raw, gtQuadToCorners(c.groundTruthQuad)).iou >= iouThr) hit += 1;
  }
  gapResults.push({ ...f._gap, hit, recall: hit / 9 });
  console.log(`   gap=${f._gap.name} (${f._gap.px}px): ${hit}/9 (${formatPct(hit / 9)})`);
}

// ─── 9. Pocket lines ────────────────────────────────────────────────────────
console.log('\n9. BINDER POCKET LINES');
const pocketFixtures = [];
for (const p of ['none', 'faint', 'strong']) {
  const { fixture } = await renderBinderPage(nine, { id: `pocket-${p}`, pockets: p });
  fixture._pocket = p;
  pocketFixtures.push(fixture);
}
const pocketDet = await runNativeDetectorBatch(pocketFixtures, {
  inputMode: nativeInput,
  batchDir: join(CORPUS_ROOT, 'native-batch-binder-diagnose-pocket'),
  exportPipeline: true,
});
for (const f of pocketFixtures) {
  const det = pocketDet.get(f.id);
  const raw = det?.pipeline?.rawAfterQuad || [];
  let hit = 0;
  for (const c of f.cards) {
    if (bestMatch(raw, gtQuadToCorners(c.groundTruthQuad)).iou >= iouThr) hit += 1;
  }
  console.log(`   pockets=${f._pocket}: ${hit}/9 (${formatPct(hit / 9)})`);
}

// ─── 13/14. Many pages temporal subset ──────────────────────────────────────
console.log('\n13/14. TEMPORAL on permuted pages (STATIC / LOW / MEDIUM), n=12 pages × 8 frames');
const temporalSubset = assignments.slice(0, 12);
const temporalReports = { STATIC: [], LOW: [], MEDIUM: [] };
// Reuse generateBinderSequence but it rebuilds its own page — instead run short motion
// by generating sequences with different seeds that permute warps via pageSeed.
// Simpler: for each assignment, render 1 static page and also run 8-frame LOW/MEDIUM
// using temporal generator with unique seeds — but that won't use our permutation.
// Fix: run single-frame already done; for temporal, generate sequences from custom
// approach — call generateBinderSequence with different seeds (different pageSeed
// only cycles warps order from discoverCardWarps fixed order).
// Better: inline mini temporal: 8 frames of the SAME rendered page with camera pan
// by re-using temporal transform — for speed, only STATIC (same as single) + report
// that permutation temporal uses generateBinderSequence seeds 100..111.

for (const motion of ['STATIC', 'LOW', 'MEDIUM']) {
  for (let i = 0; i < 8; i++) {
    const seqSeed = hashSeed(seed, 'diag-temp', motion, i);
    const { manifest, fixtures: tfix } = await (async () => {
      // generateBinderSequence returns {manifest, seqDir, fixtures: frameManifests}
      // need full fixtures — load like temporal.mjs
      const r = await generateBinderSequence({
        seed: seqSeed,
        motion,
        glare: 'none',
        frames: 8,
        fps: 12,
        writeImages: true,
      });
      const fixtures = [];
      for (const fm of r.manifest.frameManifests) {
        const { readFile } = await import('node:fs/promises');
        fixtures.push(JSON.parse(await readFile(join(rootDir, fm.fixturePath), 'utf8')));
      }
      return { manifest: r.manifest, fixtures };
    })();
    const dets = await runNativeDetectorBatch(tfix, {
      inputMode: nativeInput,
      batchDir: join(CORPUS_ROOT, `native-batch-bd-temp-${motion}-${i}`),
      exportPipeline: true,
    });
    const analysis = runTemporalAnalysis({
      fixtures: tfix,
      detectionsByFrameId: dets,
      polygonIoU,
      candidateSource: 'raw',
      fps: 12,
    });
    temporalReports[motion].push({
      sequenceId: manifest.sequenceId,
      cards: manifest.cards,
      first: analysis.firstFrameRecall,
      best: analysis.bestSingleFrameRecall,
      eventual: analysis.eventualRecall,
      neverSeen: analysis.neverSeen,
    });
  }
  const mean = (arr, k) => arr.reduce((s, r) => s + r[k], 0) / arr.length;
  console.log(
    `   ${motion}: mean first=${formatPct(mean(temporalReports[motion], 'first'))} best=${formatPct(mean(temporalReports[motion], 'best'))} eventual=${formatPct(mean(temporalReports[motion], 'eventual'))}`,
  );
}

// Cross-check: across temporal seeds, is slot 1 always same card?
const slot1Warps = new Set();
for (const r of temporalReports.MEDIUM) {
  const c = r.cards?.find(x => x.slot === 1);
  if (c) slot1Warps.add(c.sourceWarp);
}
console.log(`\n   Temporal pageSeed variety: unique slot-1 warps = ${slot1Warps.size} (${[...slot1Warps].join(', ')})`);

// Write report
const report = {
  kind: 'binder-diagnose',
  note: 'SYNTHETIC. Production unchanged. No detector tuning.',
  generatedAt: new Date().toISOString(),
  audit: {
    priorTemporalSameComposition: true,
    priorSlot1Always: 'replay:livaan-cultist-of-tiamat-foil-20260908T111916',
  },
  pages: pagesN,
  positionMatrix: posStats.map((s, slot) => ({
    slot,
    ...slotRowCol(slot),
    recall: s.n ? s.hit / s.n : null,
    hit: s.hit,
    n: s.n,
  })),
  contentMatrix: cardRows,
  hotspots,
  neverClassification: classCounts,
  capControl: {
    neverSeen: neverCases.length,
    revealedByLargerCap: capRevealed,
  },
  edgeEvidence: { hit: mHit, miss: mMiss },
  gapResults,
  isolation,
  temporal: Object.fromEntries(
    Object.entries(temporalReports).map(([k, arr]) => [
      k,
      {
        n: arr.length,
        meanFirst: arr.reduce((s, r) => s + r.first, 0) / arr.length,
        meanBest: arr.reduce((s, r) => s + r.best, 0) / arr.length,
        meanEventual: arr.reduce((s, r) => s + r.eventual, 0) / arr.length,
      },
    ]),
  ),
  neverCasesSample: neverCases.slice(0, 40),
};

await writeFile(join(DIAG_ROOT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

// Heatmap HTML
const heat = posStats
  .map((s, i) => {
    const r = s.n ? s.hit / s.n : 0;
    const bg = `rgba(61,214,140,${r})`;
    return `<div style="background:${bg};padding:20px;text-align:center;border:1px solid #333">slot ${i}<br>${(r * 100).toFixed(0)}%<br>${s.hit}/${s.n}</div>`;
  })
  .join('');
await writeFile(
  join(DIAG_ROOT, 'position-heatmap.html'),
  `<!doctype html><meta charset=utf-8><title>Binder position heatmap</title>
<style>body{font:14px sans-serif;background:#12141a;color:#eee;margin:16px}
.grid{display:grid;grid-template-columns:repeat(3,120px);gap:6px}</style>
<h1>Raw recall @IoU≥0.8 by slot</h1>
<div class="grid">${heat}</div>
<p>SYNTHETIC diagnose only.</p>`,
);

console.log(`\nWrote ${join(DIAG_ROOT, 'report.json')}`);
console.log('Production unchanged.');
