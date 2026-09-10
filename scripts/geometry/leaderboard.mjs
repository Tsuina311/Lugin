#!/usr/bin/env node
/** yarn geometry:leaderboard [--engine=js|native] */

import { existsSync } from 'node:fs';

import { baselinePathForEngine, listRuns, loadBaselineForEngine } from './lib/baseline.mjs';
import { formatNum, formatPct } from './lib/metrics.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const engineArg = (arg('engine') || 'js').toLowerCase();
const engineId =
  engineArg === 'native' || engineArg === 'android-native' ? 'android-native' : 'shared-js';

const runs = await listRuns({ engine: engineId });
const baseline = await loadBaselineForEngine(engineId);

const rows = [];
if (baseline && baseline.detectorEngine === engineId) {
  rows.push({ label: `baseline-${engineArg}`, ...baseline });
}
for (const r of runs) {
  const label = r.timestamp?.slice(0, 19) ?? 'run';
  if (baseline && r.timestamp === baseline.timestamp) continue;
  rows.push({ label, ...r });
}

if (!rows.length) {
  console.log(`No geometry benchmark snapshots for engine=${engineId}.`);
  console.log(`Run: yarn geometry:benchmark --engine=${engineArg === 'android-native' ? 'native' : engineArg}`);
  process.exit(0);
}

console.log(`GEOMETRY LEADERBOARD · ${engineId}`);
console.log('─'.repeat(88));
console.log('(Engines are separate series — do not mix js and native.)');
console.log(
  `${'version'.padEnd(22)} ${'recall'.padStart(8)} ${'IoU>=.90'.padStart(9)} ${'medIoU'.padStart(8)} ${'p95corn'.padStart(8)} ${'p50ms'.padStart(7)}  n`,
);
for (const r of rows) {
  const o = r.overall ?? {};
  console.log(
    `${String(r.label).padEnd(22)} ${formatPct(o.recall).padStart(8)} ${formatPct(o.bands?.['iou>=0.90']).padStart(9)} ${formatNum(o.medianIoU).padStart(8)} ${formatNum(o.p95CornerError, 1).padStart(8)} ${formatNum(o.runtime?.medianMs, 1).padStart(7)}  ${r.fixtureCount ?? '—'}`,
  );
}
console.log('');
console.log(`Baseline: ${existsSync(baselinePathForEngine(engineId)) ? baselinePathForEngine(engineId) : '(none)'}`);
console.log('Runtime columns are HOST only (NOT device latency).');
