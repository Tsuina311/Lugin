#!/usr/bin/env node
/**
 * yarn geometry:refine
 *
 * Host-only physical-card edge refinement experiment.
 * Starts from DetectCard selected candidate — does NOT change production.
 *
 *   yarn geometry:refine --suite=sleeve
 *   yarn geometry:refine --suite=dark --mode=y
 *   yarn geometry:refine --suite=sleeve --mode=both   # Y + offline RGB compare
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeImageFile, loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import {
  buildEdgeDiagnostics,
  refineCardEdges,
} from './lib/edge-refine.mjs';
import { formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { gtQuadToCorners, isCompleteQuad } from './lib/schema.mjs';
import { loadSyntheticFixtures, SYNTHETIC_ROOT } from './lib/synthetic/generate.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const suite = arg('suite') || 'sleeve';
const modeArg = (arg('mode') || 'y').toLowerCase(); // y | rgb | both
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const modes = modeArg === 'both' ? ['y', 'rgb'] : [modeArg === 'rgb' ? 'rgb' : 'y'];

const suites =
  suite === 'all'
    ? ['sleeve', 'dark', 'perspective', 'glare', 'occlusion']
    : [suite];

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;

const summarize = rows => {
  const ious = rows.map(r => r.afterIou).filter(x => x != null).sort((a, b) => a - b);
  const before = rows.map(r => r.beforeIou).filter(x => x != null).sort((a, b) => a - b);
  const pct = (arr, p) =>
    arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * (arr.length - 1)))] : null;
  const rate = (arr, thr) => (arr.length ? arr.filter(x => x >= thr).length / arr.length : null);
  return {
    n: rows.length,
    before: {
      median: pct(before, 50),
      p10: pct(before, 10),
      iou90: rate(before, 0.9),
      iou95: rate(before, 0.95),
      iou98: rate(before, 0.98),
    },
    after: {
      median: pct(ious, 50),
      p10: pct(ious, 10),
      iou90: rate(ious, 0.9),
      iou95: rate(ious, 0.95),
      iou98: rate(ious, 0.98),
    },
    improved: rows.filter(r => r.afterIou > r.beforeIou + 0.005).length,
    worsened: rows.filter(r => r.afterIou < r.beforeIou - 0.005).length,
    applied: rows.filter(r => r.applied).length,
    sleeveLike: rows.filter(r => r.sleeveLike).length,
    meanDelta:
      rows.length
        ? rows.reduce((s, r) => s + ((r.afterIou ?? 0) - (r.beforeIou ?? 0)), 0) / rows.length
        : null,
  };
};

console.log('PHYSICAL CARD EDGE REFINER (host experiment)');
console.log('─'.repeat(56));
console.log('Does NOT modify DetectCard production. No global redetection.');
console.log(`Suites: ${suites.join(', ')}  modes: ${modes.join('+')}  native=${nativeInput}`);
console.log('');

const allByMode = {};

for (const mode of modes) {
  allByMode[mode] = { bySuite: {}, rows: [], diagnostics: [] };
}

for (const s of suites) {
  const fixtures = await loadSyntheticFixtures({ suite: s });
  if (!fixtures.length) {
    console.warn(`skip ${s}: no fixtures`);
    continue;
  }
  console.log(`▸ ${s} n=${fixtures.length}`);
  const detections = await runNativeDetectorBatch(fixtures, {
    inputMode: nativeInput,
    batchDir: join(CORPUS_ROOT, `native-batch-refine-${s}`),
    exportPipeline: false,
  });

  for (const mode of modes) {
    const rows = [];
    const diags = [];
    for (const f of fixtures) {
      const det = detections.get(f.id);
      if (!det?.corners) continue;
      const card = f.cards?.[0];
      if (!card || !isCompleteQuad(card.groundTruthQuad)) continue;
      const cardGt = gtQuadToCorners(card.groundTruthQuad);
      const sleeveGt = isCompleteQuad(card.sleeveQuad)
        ? gtQuadToCorners(card.sleeveQuad)
        : null;
      const abs = join(rootDir, f.image);
      const image = await decodeImageFile(abs);
      const beforeIou = polygonIoU(det.corners, cardGt);
      const isSleeveTagged =
        (f.tags || []).includes('synthetic-sleeve') ||
        (f.tags || []).includes('sleeved') ||
        (card.tags || []).includes('sleeved');
      const refined = refineCardEdges(image, det.corners, {
        mode,
        useLayout: true,
        // Only refine when fixture is tagged sleeved/synthetic-sleeve.
        // Demonstrates recovery when sleeve prior exists; avoids unsleeved shrinks.
        requireSleeveTag: true,
        hasSleeveTag: isSleeveTagged,
      });
      const afterIou = polygonIoU(refined.corners, cardGt);
      const row = {
        id: f.id,
        suite: s,
        mode,
        beforeIou,
        afterIou,
        delta: afterIou - beforeIou,
        offsets: refined.offsets,
        sleeveLike: refined.sleeveLike,
        applied: refined.applied,
        nestedInnerPreferred: det.diagnostics?.nestedInnerPreferred,
      };
      rows.push(row);
      if (s === 'sleeve' && sleeveGt) {
        diags.push({
          id: f.id,
          mode,
          edges: buildEdgeDiagnostics(image, det.corners, cardGt, sleeveGt, { mode }),
          beforeIou,
          afterIou,
          offsets: refined.offsets,
        });
      }
    }
    allByMode[mode].bySuite[s] = summarize(rows);
    allByMode[mode].rows.push(...rows);
    allByMode[mode].diagnostics.push(...diags);

    const sum = allByMode[mode].bySuite[s];
    console.log(
      `  [${mode}] before medIoU=${sum.before.median?.toFixed(3)} → after ${sum.after.median?.toFixed(3)}  Δ=${sum.meanDelta?.toFixed(4)}  ≥.90 ${formatPct(sum.after.iou90)} (was ${formatPct(sum.before.iou90)})  ≥.95 ${formatPct(sum.after.iou95)} (was ${formatPct(sum.before.iou95)})  applied=${sum.applied}/${sum.n} sleeveLike=${sum.sleeveLike} improved=${sum.improved} worsened=${sum.worsened}`,
    );
  }
}

console.log('\n' + '═'.repeat(56));
for (const mode of modes) {
  const overall = summarize(allByMode[mode].rows);
  console.log(`\nOVERALL mode=${mode}`);
  console.log(
    `  before: med=${overall.before.median?.toFixed(3)} p10=${overall.before.p10?.toFixed(3)} ≥.90=${formatPct(overall.before.iou90)} ≥.95=${formatPct(overall.before.iou95)} ≥.98=${formatPct(overall.before.iou98)}`,
  );
  console.log(
    `  after:  med=${overall.after.median?.toFixed(3)} p10=${overall.after.p10?.toFixed(3)} ≥.90=${formatPct(overall.after.iou90)} ≥.95=${formatPct(overall.after.iou95)} ≥.98=${formatPct(overall.after.iou98)}`,
  );
  console.log(
    `  meanΔ=${overall.meanDelta?.toFixed(4)} improved=${overall.improved} worsened=${overall.worsened}`,
  );
  allByMode[mode].overall = overall;

  // Secondary signal visibility on sleeve: is card GT near a secondary peak?
  if (allByMode[mode].diagnostics.length) {
    let sidesWithCardNearPeak = 0;
    let sideTotal = 0;
    let cardPeakStrongerThanCand = 0;
    for (const d of allByMode[mode].diagnostics) {
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const e = d.edges[side];
        if (e.cardGtOffset == null) continue;
        sideTotal += 1;
        const near = e.peaks.some(p => Math.abs(p.offset - e.cardGtOffset) <= 3);
        if (near) sidesWithCardNearPeak += 1;
        const atCard = e.aggregate.find(
          a => Math.abs(a.offset - Math.round(e.cardGtOffset)) <= 1,
        );
        const at0 = e.aggregate.find(a => a.offset === 0);
        if (atCard && at0 && atCard.meanAbsGrad > at0.meanAbsGrad * 0.5) {
          cardPeakStrongerThanCand += 1;
        }
      }
    }
    console.log(
      `  SLEEVE edge diagnostics (${mode}): card-GT near a coherent peak on ${sidesWithCardNearPeak}/${sideTotal} sides (${formatPct(sidesWithCardNearPeak / sideTotal)}); card-offset grad ≥50% of cand-edge on ${cardPeakStrongerThanCand}/${sideTotal} (${formatPct(cardPeakStrongerThanCand / sideTotal)})`,
    );
    allByMode[mode].sleeveSignal = {
      sidesWithCardNearPeak,
      sideTotal,
      cardPeakStrongerThanCand,
    };
  }
}

if (modes.includes('y') && modes.includes('rgb')) {
  const y = allByMode.y.overall;
  const r = allByMode.rgb.overall;
  console.log('\nY vs RGB (offline chroma experiment — not production)');
  console.log(
    `  median after: Y=${y.after.median?.toFixed(3)} RGB=${r.after.median?.toFixed(3)}`,
  );
  console.log(
    `  meanΔ: Y=${y.meanDelta?.toFixed(4)} RGB=${r.meanDelta?.toFixed(4)}`,
  );
  console.log(
    `  ≥.95 after: Y=${formatPct(y.after.iou95)} RGB=${formatPct(r.after.iou95)}`,
  );
}

await mkdir(SYNTHETIC_ROOT, { recursive: true });
const outPath = join(SYNTHETIC_ROOT, `refine-${suite}-${modes.join('+')}.json`);
await writeFile(
  outPath,
  `${JSON.stringify(
    {
      kind: 'edge-refine-experiment',
      note: 'HOST ONLY. Does not change DetectCard production.',
      generatedAt: new Date().toISOString(),
      suite,
      suites,
      modes,
      nativeInput,
      results: allByMode,
    },
    null,
    2,
  )}\n`,
);

// Compact HTML for sleeve profiles (first 6)
const sleeveDiags = allByMode[modes[0]]?.diagnostics?.slice(0, 8) || [];
if (sleeveDiags.length) {
  const html = `<!doctype html><meta charset=utf-8><title>Edge profiles · sleeve</title>
<style>body{font:12px monospace;background:#12141a;color:#e8eaef;margin:16px}svg{background:#1b1e27;margin:8px 0;border:1px solid #2e3340} .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}</style>
<h1>Sleeve edge profiles (${modes[0]})</h1>
<p>x=offset px (0=candidate edge, +inward). Blue=|grad|. Orange=card GT. Purple=sleeve GT.</p>
${sleeveDiags
  .map(d => {
    const panels = ['top', 'right', 'bottom', 'left']
      .map(side => {
        const e = d.edges[side];
        const maxG = Math.max(...e.aggregate.map(a => a.meanAbsGrad), 1e-6);
        const w = 280;
        const h = 80;
        const x0 = 20;
        const y0 = 10;
        const minO = e.aggregate[0].offset;
        const maxO = e.aggregate[e.aggregate.length - 1].offset;
        const x = o => x0 + ((o - minO) / (maxO - minO)) * (w - 40);
        const y = g => y0 + (1 - g / maxG) * (h - 20);
        const poly = e.aggregate
          .map((a, i) => `${i ? 'L' : 'M'}${x(a.offset).toFixed(1)},${y(a.meanAbsGrad).toFixed(1)}`)
          .join(' ');
        const cardLine =
          e.cardGtOffset != null
            ? `<line x1="${x(e.cardGtOffset)}" y1="${y0}" x2="${x(e.cardGtOffset)}" y2="${h}" stroke="#f5a524" stroke-width="2"/>`
            : '';
        const sleeveLine =
          e.sleeveGtOffset != null
            ? `<line x1="${x(e.sleeveGtOffset)}" y1="${y0}" x2="${x(e.sleeveGtOffset)}" y2="${h}" stroke="#c084fc" stroke-width="2" stroke-dasharray="4 3"/>`
            : '';
        const candLine = `<line x1="${x(0)}" y1="${y0}" x2="${x(0)}" y2="${h}" stroke="#6cb2ff" stroke-width="1.5"/>`;
        return `<div><b>${side}</b><svg width="${w}" height="${h}"><path d="${poly}" fill="none" stroke="#3dd68c" stroke-width="1.5"/>${candLine}${cardLine}${sleeveLine}</svg></div>`;
      })
      .join('');
    return `<h2>${d.id} before=${d.beforeIou.toFixed(3)} after=${d.afterIou.toFixed(3)}</h2><div class="row">${panels}</div>`;
  })
  .join('')}
`;
  await writeFile(join(SYNTHETIC_ROOT, `refine-sleeve-profiles.html`), html);
  console.log(`\nProfile HTML: .geometry-corpus/synthetic/refine-sleeve-profiles.html`);
}

console.log(`Wrote ${outPath}`);
console.log('Production unchanged.');
