#!/usr/bin/env node
/**
 * yarn geometry:temporal
 *
 * SYNTHETIC TEMPORAL STRESS — binder page camera sweep + multi-card tracker.
 * Host-only. Does NOT modify production detector/tracker/capture.
 *
 *   yarn geometry:temporal --generate
 *   yarn geometry:temporal --run
 *   yarn geometry:temporal --generate --run --frames=15
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decodeImageFile, loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { refineCardEdges } from './lib/edge-refine.mjs';
import { formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { gtQuadToCorners, isCompleteQuad } from './lib/schema.mjs';
import {
  aggregateTemporalReports,
  runTemporalAnalysis,
} from './lib/temporal/analyze.mjs';
import {
  generateTemporalMatrix,
  TEMPORAL_ROOT,
} from './lib/temporal/sequences.mjs';

const flag = name => process.argv.includes(`--${name}`);
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const doGenerate =
  flag('generate') || flag('all') || !existsSync(join(TEMPORAL_ROOT, 'index.json'));
const frames = Number(arg('frames') || 15);
const fps = Number(arg('fps') || 15);
const seed = Number(arg('seed') || 42);
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const runNow = !flag('generate-only');

console.log('SYNTHETIC TEMPORAL STRESS — binder sweep');
console.log('─'.repeat(56));
console.log('Host-only. Production detector/tracker unchanged.');
console.log(`frames=${frames} fps=${fps} (presentation only) seed=${seed}`);
console.log('');

let index;
if (doGenerate) {
  console.log('Generating temporal matrix…');
  index = await generateTemporalMatrix({ seed, frames, fps, writeImages: true });
  console.log(`Wrote ${index.sequences.length} sequences → .geometry-corpus/synthetic/temporal/`);
} else {
  index = JSON.parse(await readFile(join(TEMPORAL_ROOT, 'index.json'), 'utf8'));
  console.log(`Using existing matrix (${index.sequences.length} sequences)`);
}

if (!runNow) {
  console.log('Done (generate only).');
  process.exit(0);
}

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;

const loadSequence = async seqMeta => {
  const seqPath = join(rootDir, seqMeta.path);
  const manifest = JSON.parse(await readFile(seqPath, 'utf8'));
  const fixtures = [];
  for (const fm of manifest.frameManifests) {
    const fp = join(rootDir, fm.fixturePath);
    fixtures.push(JSON.parse(await readFile(fp, 'utf8')));
  }
  return { manifest, fixtures };
};

const reportsRaw = [];
const reportsShort = [];
const byCondition = {};

for (const seqMeta of index.sequences) {
  const { manifest, fixtures } = await loadSequence(seqMeta);
  const key = `${manifest.motion}/${manifest.glare}`;
  console.log(`\n▸ ${manifest.sequenceId} (${key}) n=${fixtures.length}`);

  const detections = await runNativeDetectorBatch(fixtures, {
    inputMode: nativeInput,
    batchDir: join(CORPUS_ROOT, `native-batch-temporal-${manifest.sequenceId}`),
    exportPipeline: true,
  });

  const raw = runTemporalAnalysis({
    fixtures,
    detectionsByFrameId: detections,
    polygonIoU,
    candidateSource: 'raw',
    fps: manifest.fps || fps,
  });
  const short = runTemporalAnalysis({
    fixtures,
    detectionsByFrameId: detections,
    polygonIoU,
    candidateSource: 'shortlist',
    fps: manifest.fps || fps,
  });

  // Offline sleeve refine on best frames (evaluation only — no sleeve GT as classifier;
  // here we skip unless explicitly measuring; binder warps are unsleeved typically)
  let refineDelta = null;
  {
    const deltas = [];
    for (const t of raw.tracks) {
      if (!t.bestCorners || t.bestFrame == null) continue;
      const fix = fixtures.find(f => f.frameIndex === t.bestFrame);
      if (!fix) continue;
      const abs = join(rootDir, fix.image);
      if (!existsSync(abs)) continue;
      const image = await decodeImageFile(abs);
      // Offline experiment: try refine without sleeve tag (measure harm/help)
      const refined = refineCardEdges(image, t.bestCorners, {
        mode: 'y',
        requireSleeveTag: false,
        hasSleeveTag: false,
      });
      // Match to GT on that frame
      let before = 0;
      let after = 0;
      for (const c of fix.cards || []) {
        if (!isCompleteQuad(c.groundTruthQuad)) continue;
        const gt = gtQuadToCorners(c.groundTruthQuad);
        before = Math.max(before, polygonIoU(t.bestCorners, gt));
        after = Math.max(after, polygonIoU(refined.corners, gt));
      }
      if (before > 0.5) deltas.push(after - before);
    }
    refineDelta = deltas.length
      ? {
          n: deltas.length,
          meanDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
          note: 'Offline Y refine without sleeve prior on binder warps (expect ~0 / slight harm).',
        }
      : null;
  }

  console.log(
    `  raw: first=${formatPct(raw.firstFrameRecall)} bestFrame=${formatPct(raw.bestSingleFrameRecall)} eventual=${formatPct(raw.eventualRecall)} (${raw.eventualAcquired}/9) complete@f=${raw.completionFrame ?? '—'}`,
  );
  console.log(
    `  shortlist: first=${formatPct(short.firstFrameRecall)} bestFrame=${formatPct(short.bestSingleFrameRecall)} eventual=${formatPct(short.eventualRecall)} (${short.eventualAcquired}/9)`,
  );
  console.log(
    `  tracker: tracks=${raw.tracking.trackCount} fragSlots=${raw.tracking.fragmentedSlots} false=${raw.tracking.falseTracks} neverSeen=${raw.neverSeen.length}`,
  );

  const row = {
    sequenceId: manifest.sequenceId,
    motion: manifest.motion,
    glare: manifest.glare,
    raw,
    shortlist: short,
    refineDelta,
  };
  reportsRaw.push(raw);
  reportsShort.push(short);
  byCondition[key] = row;

  // Visualizer for MEDIUM/moving (primary product thesis)
  if (manifest.motion === 'MEDIUM' && manifest.glare === 'moving') {
    await writeVisualizer({ manifest, fixtures, analysis: raw, detections });
  }
}

const aggRaw = aggregateTemporalReports(reportsRaw, fps);
const aggShort = aggregateTemporalReports(reportsShort, fps);

console.log('\n' + '═'.repeat(56));
console.log('AGGREGATE (all sequences)');
console.log('RAW candidates:');
console.log(
  `  mean first-frame ${formatPct(aggRaw.meanFirstFrame)}  best-single-frame ${formatPct(aggRaw.meanBestSingleFrame)}  eventual ${formatPct(aggRaw.meanEventual)}`,
);
console.log(
  `  page complete p50=${aggRaw.p50CompletionSec ?? '—'}s p90=${aggRaw.p90CompletionSec ?? '—'}s  (${aggRaw.completedPages}/${aggRaw.n} pages)`,
);
console.log('SHORTLIST:');
console.log(
  `  mean first-frame ${formatPct(aggShort.meanFirstFrame)}  best-single-frame ${formatPct(aggShort.meanBestSingleFrame)}  eventual ${formatPct(aggShort.meanEventual)}`,
);

console.log('\nBY CONDITION (raw eventual):');
for (const [k, row] of Object.entries(byCondition)) {
  console.log(
    `  ${k.padEnd(18)} first=${formatPct(row.raw.firstFrameRecall)} best=${formatPct(row.raw.bestSingleFrameRecall)} eventual=${formatPct(row.raw.eventualRecall)} never=${row.raw.neverSeen.length}`,
  );
}

// Best-frame quality improvement
const deltas = [];
for (const r of reportsRaw) {
  for (const tq of r.trackQuality) {
    if (tq.firstIou >= 0.5 && tq.bestStoredIou >= 0.5) {
      deltas.push(tq.deltaBestMinusFirst);
    }
  }
}
deltas.sort((a, b) => a - b);
const meanD = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
console.log('\nBEST FRAME vs FIRST OBS (tracks matched ≥0.5 IoU):');
console.log(`  n=${deltas.length} mean ΔIoU=${meanD?.toFixed(4) ?? '—'} median=${deltas.length ? deltas[Math.floor(deltas.length / 2)].toFixed(4) : '—'}`);

const neverReasons = {};
for (const r of reportsRaw) {
  for (const n of r.neverSeen) {
    neverReasons[n.reason] = (neverReasons[n.reason] || 0) + 1;
  }
}
console.log('\nNEVER-SEEN reasons:');
for (const [k, v] of Object.entries(neverReasons)) console.log(`  ${k}: ${v}`);

await mkdir(TEMPORAL_ROOT, { recursive: true });
const outPath = join(TEMPORAL_ROOT, 'temporal-report.json');
await writeFile(
  outPath,
  `${JSON.stringify(
    {
      kind: 'temporal-binder-report',
      note: 'SYNTHETIC TEMPORAL STRESS. Host-only. Production unchanged.',
      generatedAt: new Date().toISOString(),
      nativeInput,
      frames,
      fps,
      aggregateRaw: aggRaw,
      aggregateShortlist: aggShort,
      byCondition,
      bestFrameDelta: { n: deltas.length, mean: meanD },
      neverReasons,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nWrote ${outPath}`);
console.log('Production unchanged.');

async function writeVisualizer({ manifest, fixtures, analysis }) {
  const rows = analysis.curve
    .map(c => {
      const cells = [];
      // per-slot state at this frame from ever-acquired is coarse; show acquired count
      return `<tr><td>${c.frameIndex}</td><td>${c.timeSec.toFixed(2)}s</td><td>${c.acquired}/9</td><td>${formatPct(c.recall)}</td><td>${c.frameSingleHit}/9</td><td>${c.activeTracks}</td></tr>`;
    })
    .join('');
  const trackRows = analysis.tracks
    .map(t => {
      const tq = analysis.trackQuality.find(q => q.trackId === t.id);
      return `<tr><td>${t.id}</td><td>${t.state}</td><td>${t.hits}</td><td>${t.bestFrame ?? '—'}</td><td>${tq?.matchedSlot ?? '—'}</td><td>${tq?.firstIou?.toFixed?.(3) ?? '—'}</td><td>${tq?.bestStoredIou?.toFixed?.(3) ?? '—'}</td></tr>`;
    })
    .join('');
  const html = `<!doctype html>
<meta charset=utf-8>
<title>Temporal binder · ${manifest.sequenceId}</title>
<style>
body{font:13px/1.4 ui-sans-serif,system-ui;background:#12141a;color:#e8eaef;margin:16px}
table{border-collapse:collapse;margin:12px 0} td,th{border:1px solid #2e3340;padding:4px 8px}
th{background:#1b1e27} .ok{color:#3dd68c} h1{font-size:18px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:480px}
.slot{background:#1b1e27;border:1px solid #2e3340;padding:16px;text-align:center;border-radius:8px}
.slot.seen{border-color:#3dd68c} .slot.miss{border-color:#ff6b6b;opacity:.5}
</style>
<h1>SYNTHETIC TEMPORAL STRESS · ${manifest.sequenceId}</h1>
<p>motion=${manifest.motion} glare=${manifest.glare} · eventual <span class="ok">${analysis.eventualAcquired}/9 (${formatPct(analysis.eventualRecall)})</span></p>
<p>first-frame ${formatPct(analysis.firstFrameRecall)} · best-single-frame ${formatPct(analysis.bestSingleFrameRecall)} · temporal ${formatPct(analysis.eventualRecall)}</p>
<h2>Page acquisition (end)</h2>
<div class="grid">
${[0, 1, 2, 3, 4, 5, 6, 7, 8]
  .map(s => {
    const seen = !analysis.neverSeen.some(n => n.slot === s);
    return `<div class="slot ${seen ? 'seen' : 'miss'}">slot ${s}<br>${seen ? 'acquired' : 'never'}</div>`;
  })
  .join('')}
</div>
<h2>Coverage curve</h2>
<table><tr><th>frame</th><th>time</th><th>acquired</th><th>recall</th><th>this-frame raw</th><th>active tracks</th></tr>${rows}</table>
<h2>Tracks</h2>
<table><tr><th>id</th><th>state</th><th>hits</th><th>bestFrame</th><th>GT slot</th><th>first IoU</th><th>best IoU</th></tr>${trackRows}</table>
<p class="muted">Developer-only visualizer. Not real-device accuracy.</p>`;
  const out = join(TEMPORAL_ROOT, manifest.sequenceId, 'visualizer.html');
  await writeFile(out, html);
  console.log(`  visualizer → ${out}`);
}
