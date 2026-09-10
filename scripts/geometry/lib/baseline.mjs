import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import {
  BASELINE_PATH,
  BENCHMARKS_ROOT,
  DETECTOR_ENGINE,
  DETECTOR_VERSION,
  RUNS_DIR,
  SCHEMA_VERSION,
} from './paths.mjs';
import { formatDelta, formatNum, formatPct } from './metrics.mjs';

export const ensureBenchmarkDirs = async () => {
  await mkdir(RUNS_DIR, { recursive: true });
  await mkdir(BENCHMARKS_ROOT, { recursive: true });
};

export const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

export const baselinePathForEngine = engine => {
  if (engine === 'android-native' || engine === 'native') {
    return join(BENCHMARKS_ROOT, 'baseline-native-v1.json');
  }
  if (engine === 'shared-js' || engine === 'js') {
    return join(BENCHMARKS_ROOT, 'baseline-js-v1.json');
  }
  return BASELINE_PATH;
};

export const buildSnapshot = ({
  overall,
  byTag,
  fixtures,
  engineNote,
  hardRegression,
  detectorEngine = DETECTOR_ENGINE,
  detectorVersion = DETECTOR_VERSION,
  runtimeNote = 'HOST_NOT_DEVICE_LATENCY',
}) => ({
  schemaVersion: SCHEMA_VERSION,
  timestamp: new Date().toISOString(),
  gitCommit: gitCommit(),
  detectorEngine,
  detectorVersion,
  runtimeNote,
  fixtureSetVersion: `fixtures@${fixtures.length}`,
  fixtureCount: fixtures.length,
  trustedCount: fixtures.filter(f => f.trustedEval || f.trusted).length,
  engineNote,
  overall,
  byTag,
  hardRegression: hardRegression ?? null,
});

export const saveRun = async snapshot => {
  await ensureBenchmarkDirs();
  const eng = (snapshot.detectorEngine || 'shared-js').replace(/[^\w.-]+/g, '_');
  const name = `run-${eng}-${snapshot.timestamp.replace(/[:.]/g, '-')}.json`;
  const p = join(RUNS_DIR, name);
  await writeFile(p, `${JSON.stringify(snapshot, null, 2)}\n`);
  return p;
};

/** @deprecated prefer saveBaselineForEngine */
export const saveBaseline = async snapshot => saveBaselineForEngine(snapshot.detectorEngine, snapshot);

export const saveBaselineForEngine = async (engine, snapshot) => {
  await ensureBenchmarkDirs();
  const p = baselinePathForEngine(engine);
  await writeFile(p, `${JSON.stringify(snapshot, null, 2)}\n`);
  // Keep legacy path updated for js so old tooling still finds something.
  if (engine === 'shared-js' || engine === 'js') {
    await writeFile(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  return p;
};

export const loadBaseline = async () => loadBaselineForEngine('shared-js');

export const loadBaselineForEngine = async engine => {
  const p = baselinePathForEngine(engine);
  if (existsSync(p)) return JSON.parse(await readFile(p, 'utf8'));
  if ((engine === 'shared-js' || engine === 'js') && existsSync(BASELINE_PATH)) {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  }
  return null;
};

export const listRuns = async ({ engine = null } = {}) => {
  if (!existsSync(RUNS_DIR)) return [];
  const names = (await readdir(RUNS_DIR)).filter(n => n.endsWith('.json')).sort();
  const out = [];
  for (const n of names) {
    const snap = JSON.parse(await readFile(join(RUNS_DIR, n), 'utf8'));
    if (engine) {
      const want =
        engine === 'native' || engine === 'android-native'
          ? 'android-native'
          : engine === 'js' || engine === 'shared-js'
            ? 'shared-js'
            : engine;
      if (snap.detectorEngine !== want) continue;
    }
    out.push(snap);
  }
  return out;
};

export const printComparison = (current, baseline) => {
  if (baseline && baseline.detectorEngine && current.detectorEngine !== baseline.detectorEngine) {
    console.log(
      `\n(skip baseline compare — engine mismatch current=${current.detectorEngine} baseline=${baseline.detectorEngine})`,
    );
    return;
  }
  const rows = [
    ['Recall', current.overall?.recall, baseline?.overall?.recall, true],
    ['Precision', current.overall?.precision, baseline?.overall?.precision, true],
    ['IoU >= .95', current.overall?.bands?.['iou>=0.95'], baseline?.overall?.bands?.['iou>=0.95'], true],
    ['IoU >= .90', current.overall?.bands?.['iou>=0.90'], baseline?.overall?.bands?.['iou>=0.90'], true],
    ['IoU >= .80', current.overall?.bands?.['iou>=0.80'], baseline?.overall?.bands?.['iou>=0.80'], true],
    ['median IoU', current.overall?.medianIoU, baseline?.overall?.medianIoU, false],
    ['mean IoU', current.overall?.meanIoU, baseline?.overall?.meanIoU, false],
    ['p10 IoU', current.overall?.p10IoU, baseline?.overall?.p10IoU, false],
    ['mean corner', current.overall?.meanCornerError, baseline?.overall?.meanCornerError, false],
    ['p95 corner', current.overall?.p95CornerError, baseline?.overall?.p95CornerError, false],
    ['p50 runtime', current.overall?.runtime?.medianMs, baseline?.overall?.runtime?.medianMs, false],
  ];
  console.log('\nCURRENT vs BASELINE');
  console.log('─'.repeat(56));
  for (const [label, cur, base, pct] of rows) {
    const curS = pct ? formatPct(cur) : formatNum(cur, label.includes('runtime') ? 1 : 3);
    const d = baseline ? `  ${formatDelta(cur, base, pct)}` : '';
    console.log(`${label.padEnd(14)} ${curS.padStart(8)}${d}`);
  }
};
