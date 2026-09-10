#!/usr/bin/env node
/**
 * yarn geometry:synthetic:compare
 *
 * Run a synthetic suite through js / native-rgba / native-y and summarize divergence.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluateDetections } from './lib/evaluate.mjs';
import { runHostDetector } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { loadSyntheticFixtures, SYNTHETIC_ROOT } from './lib/synthetic/generate.mjs';
import { existsSync } from 'node:fs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const suite = arg('suite') || 'dark';

const fixtures = await loadSyntheticFixtures({ suite });
if (!fixtures.length) {
  console.error(`No synthetic fixtures. yarn geometry:synthetic --suite=${suite}`);
  process.exit(1);
}

console.log(`SYNTHETIC ENGINE COMPARE · suite=${suite} n=${fixtures.length}`);
console.log('SYNTHETIC ONLY — not real-device accuracy.\n');

const collectJs = async () => {
  const map = new Map();
  for (const f of fixtures) {
    const abs = join(rootDir, f.image);
    if (!existsSync(abs)) continue;
    const d = await runHostDetector(abs);
    map.set(f.id, { detected: d.detected, corners: d.corners, score: d.score, runtimeMs: d.runtimeMs });
  }
  return map;
};

const jsMap = await collectJs();
const rgbaMap = await runNativeDetectorBatch(fixtures, {
  inputMode: 'rgba',
  batchDir: join(CORPUS_ROOT, `native-batch-syn-cmp-${suite}-rgba`),
});
const yMap = await runNativeDetectorBatch(fixtures, {
  inputMode: 'y-from-rgba',
  batchDir: join(CORPUS_ROOT, `native-batch-syn-cmp-${suite}-y`),
});

const summarize = async (label, map) => {
  const { overall, perFixture } = await evaluateDetections(fixtures, map);
  return {
    label,
    recall: overall.recall,
    medianIoU: overall.medianIoU,
    iou90: overall.bands['iou>=0.90'],
    p50ms: overall.runtime.medianMs,
    misses: perFixture.filter(p => !p.detected).length,
  };
};

const reports = [
  await summarize('shared-js', jsMap),
  await summarize('native-rgba', rgbaMap),
  await summarize('native-y-from-rgba', yMap),
];

console.log(`${'engine'.padEnd(22)} ${'recall'.padStart(8)} ${'medIoU'.padStart(8)} ${'IoU>=.9'.padStart(8)} ${'miss'.padStart(5)} ${'p50ms'.padStart(7)}`);
for (const r of reports) {
  console.log(
    `${r.label.padEnd(22)} ${formatPct(r.recall).padStart(8)} ${(r.medianIoU?.toFixed(3) ?? '—').padStart(8)} ${formatPct(r.iou90).padStart(8)} ${String(r.misses).padStart(5)} ${(r.p50ms?.toFixed(1) ?? '—').padStart(7)}`,
  );
}

const out = join(SYNTHETIC_ROOT, `compare-${suite}.json`);
await writeFile(
  out,
  `${JSON.stringify({ suite, generatedAt: new Date().toISOString(), reports, runtimeNote: 'HOST_ONLY_NOT_DEVICE' }, null, 2)}\n`,
);
console.log(`\nWrote ${out}`);
console.log('Runtime is HOST only — NOT device latency.');
