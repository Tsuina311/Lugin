#!/usr/bin/env node
/**
 * yarn geometry:synthetic:curves
 *
 * Difficulty curves for a synthetic suite (cliff detection).
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateDetections } from './lib/evaluate.mjs';
import { runHostDetector } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { loadSyntheticFixtures, SYNTHETIC_ROOT } from './lib/synthetic/generate.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const suite = arg('suite') || 'dark';
const engine = (arg('engine') || 'native').toLowerCase();
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();

let fixtures = await loadSyntheticFixtures({ suite });
if (!fixtures.length) {
  console.error(`No synthetic fixtures for suite=${suite}. Run yarn geometry:synthetic --suite=${suite}`);
  process.exit(1);
}

console.log(`SYNTHETIC DIFFICULTY CURVES · suite=${suite} engine=${engine} input=${nativeInput}`);
console.log('─'.repeat(64));
console.log('SYNTHETIC ONLY — not real-device accuracy.\n');

const detections = new Map();
if (engine === 'js') {
  for (const f of fixtures) {
    const abs = join(rootDir, f.image);
    if (!existsSync(abs)) continue;
    const det = await runHostDetector(abs);
    detections.set(f.id, {
      detected: det.detected,
      corners: det.corners,
      score: det.score,
      runtimeMs: det.runtimeMs,
    });
  }
} else {
  const map = await runNativeDetectorBatch(fixtures, {
    inputMode: nativeInput,
    batchDir: join(CORPUS_ROOT, `native-batch-syn-${suite}`),
  });
  for (const [k, v] of map) detections.set(k, v);
}

const { rows, perFixture, overall } = await evaluateDetections(fixtures, detections);

// Group by curveKey/curveValue from provenance
const buckets = new Map();
for (const f of fixtures) {
  const key = f.provenance?.curveKey || f.suite || 'all';
  const val = f.provenance?.curveValue;
  const label = val == null ? f.label || f.id : `${key}=${val}`;
  if (!buckets.has(label)) buckets.set(label, { fixtures: [], key, val });
  buckets.get(label).fixtures.push(f);
}

console.log('OVERALL');
console.log(`  n=${fixtures.length}  recall=${formatPct(overall.recall)}  medIoU=${overall.medianIoU?.toFixed(3) ?? '—'}  IoU>=.90=${formatPct(overall.bands['iou>=0.90'])}`);

console.log('\nCURVE');
console.log(`${'level'.padEnd(28)} ${'n'.padStart(4)} ${'recall'.padStart(8)} ${'medIoU'.padStart(8)} ${'IoU>=.8'.padStart(8)} ${'meanScore'.padStart(9)}`);

const curveRows = [];
for (const [label, bucket] of [...buckets.entries()].sort((a, b) => {
  const av = a[1].val;
  const bv = b[1].val;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(a[0]).localeCompare(String(b[0]));
})) {
  const ids = new Set(bucket.fixtures.map(f => f.id));
  const subRows = rows.filter(r => ids.has(r.fixtureId || r.id.split('#')[0]));
  const subFix = perFixture.filter(p => ids.has(p.id));
  const n = bucket.fixtures.length;
  const detected = subRows.filter(r => r.matched).length;
  const recall = n ? detected / Math.max(1, subRows.length) : null;
  // For multi-card, prefer best IoU per fixture
  const bestIous = subFix.map(p => {
    const pr = rows.filter(r => (r.fixtureId || r.id.split('#')[0]) === p.id && r.matched);
    return pr.length ? Math.max(...pr.map(r => r.iou)) : 0;
  });
  const med = [...bestIous].sort((a, b) => a - b)[Math.floor(bestIous.length / 2)] ?? null;
  const ge80 = bestIous.filter(x => x >= 0.8).length / Math.max(1, bestIous.length);
  const meanScore = subFix.reduce((s, p) => s + (p.score || 0), 0) / Math.max(1, subFix.length);
  console.log(
    `${label.padEnd(28)} ${String(n).padStart(4)} ${formatPct(recall).padStart(8)} ${(med?.toFixed(3) ?? '—').padStart(8)} ${formatPct(ge80).padStart(8)} ${meanScore.toFixed(3).padStart(9)}`,
  );
  curveRows.push({ label, n, recall, medianBestIoU: med, iouGe80: ge80, meanScore, curveKey: bucket.key, curveValue: bucket.val });
}

const failures = perFixture
  .filter(p => !p.detected || (p.pairs?.[0]?.iou ?? 0) < 0.5)
  .slice(0, 40)
  .map(p => ({
    id: p.id,
    score: p.score,
    iou: p.pairs?.[0]?.iou ?? 0,
    reason: !p.detected ? 'miss' : 'low-iou',
  }));

await mkdir(SYNTHETIC_ROOT, { recursive: true });
const out = join(SYNTHETIC_ROOT, `curves-${suite}-${engine}.json`);
await writeFile(
  out,
  `${JSON.stringify(
    {
      suite,
      engine,
      nativeInput: engine === 'native' ? nativeInput : null,
      generatedAt: new Date().toISOString(),
      overall,
      curve: curveRows,
      failures,
      runtimeNote: engine === 'native' ? 'HOST_JVM_NOT_DEVICE_LATENCY' : 'HOST_JS_NOT_DEVICE_LATENCY',
    },
    null,
    2,
  )}\n`,
);

// HTML contact sheet of failures (links to scene ids)
const html = `<!doctype html><meta charset=utf-8><title>Synthetic failures · ${suite}</title>
<style>body{font:14px system-ui;background:#111;color:#eee;padding:16px} img{max-width:220px;background:#000} .grid{display:flex;flex-wrap:wrap;gap:12px} .card{border:1px solid #333;padding:8px;width:240px}</style>
<h1>Synthetic failures · ${suite} · ${engine}</h1>
<p>SYNTHETIC ONLY. Replay: yarn geometry:synthetic:replay &lt;id&gt;</p>
<div class="grid">${failures
  .map(
    f =>
      `<div class="card"><div>${f.id}</div><div>${f.reason} iou=${f.iou.toFixed(2)} score=${Number(f.score).toFixed(2)}</div><img src="scenes/${f.id}/scene.png" loading="lazy"/></div>`,
  )
  .join('')}</div>`;
await writeFile(join(SYNTHETIC_ROOT, `failures-${suite}.html`), html);

console.log(`\nWrote ${out}`);
console.log(`Failure explorer: .geometry-corpus/synthetic/failures-${suite}.html`);
