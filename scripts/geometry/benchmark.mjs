#!/usr/bin/env node
/**
 * yarn geometry:benchmark
 *
 *   yarn geometry:benchmark --engine=js|native|both
 *   yarn geometry:benchmark --corpus=real|synthetic --suite=dark
 *
 * Flags:
 *   --trusted-only   real corpus: only trusted (default for real)
 *   --all-usable     real corpus: bootstrap smoke ONLY
 *   --corpus=real|synthetic
 *   --suite=<name>   synthetic suite filter
 *   --split=train|validation|test|hard
 *   --native-input=rgba|y-from-rgba
 *   --save-baseline
 *   --no-save-run
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildSnapshot,
  loadBaselineForEngine,
  printComparison,
  saveBaselineForEngine,
  saveRun,
} from './lib/baseline.mjs';
import { listFixtures } from './lib/corpus.mjs';
import { HOST_LIMITATION, loadDetectScan, runHostDetector } from './lib/detect-host.mjs';
import { NATIVE_INPUT_CONTRACT, runNativeDetectorBatch } from './lib/detect-native.mjs';
import { evaluateDetections } from './lib/evaluate.mjs';
import { formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { fixtureTrustedEval, fixtureUsableForGeometry, gtQuadToCorners } from './lib/schema.mjs';
import { loadSyntheticFixtures } from './lib/synthetic/generate.mjs';

const flag = name => process.argv.includes(`--${name}`);
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const engineArg = (arg('engine') || 'js').toLowerCase();
const engines =
  engineArg === 'both' ? ['js', 'native'] : engineArg === 'native' ? ['native'] : ['js'];
const splitArg = arg('split');
const nativeInput = (arg('native-input') || 'rgba').toLowerCase();
const corpus = (arg('corpus') || 'real').toLowerCase();
const suiteArg = arg('suite') || null;
const trustedOnly = !flag('all-usable');

let fixtures;
let annotationKind;

if (corpus === 'synthetic') {
  fixtures = await loadSyntheticFixtures({ suite: suiteArg });
  annotationKind = 'synthetic';
  if (!fixtures.length) {
    console.error(
      `No synthetic fixtures${suiteArg ? ` for suite=${suiteArg}` : ''}. Run yarn geometry:synthetic --suite=${suiteArg || 'dark'}`,
    );
    process.exit(1);
  }
} else {
  const all = await listFixtures();
  fixtures = all.filter(f => {
    const use = fixtureUsableForGeometry(f);
    if (!use.ok && !f.negative) return false;
    if (f.tags?.includes('frozen-quad-series')) return false;
    if (f.tags?.includes('synthetic') || f.synthetic) return false;
    if (trustedOnly) return fixtureTrustedEval(f) || (f.trusted && f.negative);
    return true;
  });
  annotationKind = trustedOnly ? 'trusted-real' : 'real-bootstrap-smoke';
}

if (splitArg && corpus !== 'synthetic') {
  fixtures = fixtures.filter(f => f.split === splitArg || (splitArg === 'hard' && f.hardRegression));
}

if (!fixtures.length) {
  console.log('GEOMETRY BENCHMARK');
  console.log('─'.repeat(48));
  console.log('No fixtures matched the selection.');
  process.exit(0);
}

const collectJs = async list => {
  const map = new Map();
  for (const fixture of list) {
    const abs = join(rootDir, fixture.image);
    if (!existsSync(abs)) {
      console.warn(`missing image: ${fixture.image}`);
      continue;
    }
    const det = await runHostDetector(abs);
    map.set(fixture.id, {
      detected: det.detected,
      corners: det.corners,
      score: det.score,
      runtimeMs: det.runtimeMs,
      method: det.method,
      engine: 'shared-js',
      runtimeNote: 'HOST_JS_NOT_DEVICE_LATENCY',
    });
  }
  return map;
};

const printReport = (label, snapshot, baseline) => {
  const { overall, byTag, hardRegression, selection } = snapshot;
  const kindLabel =
    selection.annotationKind === 'trusted-real'
      ? 'REAL TRUSTED (quality)'
      : selection.annotationKind === 'synthetic'
        ? 'SYNTHETIC (stress only — NOT real-device accuracy)'
        : 'REAL BOOTSTRAP (smoke only — NOT accuracy)';
  console.log(`\nGEOMETRY BENCHMARK · ${label}`);
  console.log('─'.repeat(48));
  console.log(`Corpus:       ${selection.corpus}`);
  console.log(`Engine:       ${snapshot.detectorEngine}`);
  console.log(`Annotations:  ${kindLabel}`);
  console.log(
    `Selection:    ${selection.trustedOnly ? 'trusted-only' : 'all-usable'}${selection.suite ? ` suite=${selection.suite}` : ''}${selection.split ? ` split=${selection.split}` : ''}`,
  );
  console.log(`Fixtures:     ${snapshot.fixtureCount}`);
  console.log(`Recall:       ${formatPct(overall.recall)}`);
  console.log(`Precision:    ${formatPct(overall.precision)}`);
  console.log(`IoU>=0.95:    ${formatPct(overall.bands['iou>=0.95'])}`);
  console.log(`IoU>=0.90:    ${formatPct(overall.bands['iou>=0.90'])}`);
  console.log(`IoU>=0.80:    ${formatPct(overall.bands['iou>=0.80'])}`);
  console.log(`median IoU:   ${overall.medianIoU?.toFixed(3) ?? '—'}`);
  console.log(`p10 IoU:      ${overall.p10IoU?.toFixed(3) ?? '—'}`);
  console.log(`mean corner:  ${overall.meanCornerError?.toFixed(1) ?? '—'} px`);
  console.log(`p95 corner:   ${overall.p95CornerError?.toFixed(1) ?? '—'} px`);
  console.log(
    `p50 runtime:  ${overall.runtime.medianMs?.toFixed(1) ?? '—'} ms  (${snapshot.runtimeNote})`,
  );

  if (selection.corpus === 'synthetic') {
    const multi = snapshot.perFixture?.filter(p => p.gtCards > 1) ?? [];
    if (multi.length) {
      const best = multi.map(p => p.bestIoUAnyGt ?? 0);
      const med = [...best].sort((a, b) => a - b)[Math.floor(best.length / 2)];
      console.log(
        `\nMulti-card scenes (single-card detector): n=${multi.length}  median bestIoU-vs-any-GT=${med?.toFixed(3) ?? '—'}`,
      );
      console.log('  (Detector returns ≤1 quad; recall vs N GT cards is not multi-card AP.)');
    }
  }

  if (Object.keys(byTag).length) {
    console.log('\nBy tag (categories with data only):');
    for (const [tag, m] of Object.entries(byTag)) {
      console.log(
        `  ${tag.padEnd(20)} n=${String(m.fixtures).padStart(3)}  recall=${formatPct(m.recall)}  IoU>=.90=${formatPct(m.bands['iou>=0.90'])}  medIoU=${m.medianIoU?.toFixed(3) ?? '—'}`,
      );
    }
  }

  if (hardRegression?.count) {
    console.log('\nHARD REGRESSION');
    console.log(`  fixtures: ${hardRegression.count}  recall: ${formatPct(hardRegression.recall)}`);
    if (hardRegression.misses?.length) console.log(`  misses: ${hardRegression.misses.join(', ')}`);
  }

  if (baseline && selection.corpus === 'real' && selection.annotationKind === 'trusted-real') {
    printComparison(snapshot, baseline);
  } else if (selection.corpus === 'synthetic') {
    console.log('\n(No baseline compare for synthetic — separate from real trusted series.)');
  } else {
    console.log('\nNo baseline compare (bootstrap/synthetic).');
  }
};

const runOne = async engine => {
  const engineId = engine === 'native' ? 'android-native' : 'shared-js';
  console.log(`\nRunning engine=${engine} (${engineId}) on ${fixtures.length} fixtures…`);

  let detections;
  let engineNote;
  let runtimeNote;
  let detectorVersion;

  if (engine === 'js') {
    detections = await collectJs(fixtures);
    engineNote = `${HOST_LIMITATION.hostEngine}. ${HOST_LIMITATION.reason}`;
    runtimeNote = 'HOST_JS_NOT_DEVICE_LATENCY';
    detectorVersion = 'shared-js@detectCard.ts';
  } else {
    detections = await runNativeDetectorBatch(fixtures, {
      inputMode: nativeInput,
      batchDir: join(
        CORPUS_ROOT,
        `native-batch-${corpus}${suiteArg ? `-${suiteArg}` : ''}-${nativeInput}`,
      ),
    });
    engineNote = [
      'Production DetectCard.kt via host JVM batch (same sources as APK).',
      NATIVE_INPUT_CONTRACT.limitation,
      `inputMode=${nativeInput}`,
    ].join(' ');
    runtimeNote = 'HOST_JVM_NOT_DEVICE_LATENCY';
    detectorVersion = `DetectCard.kt@${nativeInput}`;
  }

  const { rows, perFixture, overall, byTag } = await evaluateDetections(fixtures, detections);

  let sleeveAnalysis = null;
  if (corpus === 'synthetic') {
    const { scan } = await loadDetectScan();
    const sleeveCases = [];
    for (const f of fixtures) {
      const scenePath = join(rootDir, String(f.image).replace(/scene\.png$/, 'scene.json'));
      if (!existsSync(scenePath)) continue;
      const scene = JSON.parse(await readFile(scenePath, 'utf8'));
      const card0 = scene.cards?.[0];
      if (!card0?.sleeveQuad || !card0?.quad) continue;
      const det = detections.get(f.id);
      if (!det?.corners) {
        sleeveCases.push({ id: f.id, choice: 'miss' });
        continue;
      }
      const cardCorners = gtQuadToCorners(card0.quad);
      const sleeveCorners = gtQuadToCorners(card0.sleeveQuad);
      const iouCard = scan.polygonIoU(det.corners, cardCorners);
      const iouSleeve = scan.polygonIoU(det.corners, sleeveCorners);
      sleeveCases.push({
        id: f.id,
        choice: iouCard >= iouSleeve ? 'card' : 'sleeve',
        iouCard,
        iouSleeve,
      });
    }
    if (sleeveCases.length) {
      sleeveAnalysis = {
        n: sleeveCases.length,
        choseCard: sleeveCases.filter(c => c.choice === 'card').length,
        choseSleeve: sleeveCases.filter(c => c.choice === 'sleeve').length,
        miss: sleeveCases.filter(c => c.choice === 'miss').length,
      };
    }
  }

  const hardIds = new Set(fixtures.filter(f => f.hardRegression).map(f => f.id));
  const hardRows = rows.filter(r => hardIds.has(r.fixtureId || r.id.split('#')[0]));
  const hardRegression = hardRows.length
    ? {
        count: hardRows.length,
        recall: (await import('./lib/metrics.mjs')).aggregateMetrics(hardRows).recall,
        misses: hardRows.filter(r => r.band === 'miss').map(r => r.id),
        note: 'Structure only — soft while corpus is small.',
      }
    : { count: 0, note: 'No hardRegression fixtures in this run.' };

  const snapshot = buildSnapshot({
    overall,
    byTag,
    fixtures: fixtures.map(f => ({ ...f, trustedEval: fixtureTrustedEval(f) })),
    engineNote,
    hardRegression,
    detectorEngine: engineId,
    detectorVersion,
    runtimeNote,
  });
  snapshot.selection = {
    trustedOnly: corpus === 'synthetic' ? false : trustedOnly,
    annotationKind,
    corpus,
    suite: suiteArg,
    split: splitArg ?? null,
    engine,
    nativeInput: engine === 'native' ? nativeInput : null,
    fixtureIds: fixtures.map(f => f.id),
  };
  snapshot.perFixture = perFixture;
  snapshot.sleeveAnalysis = sleeveAnalysis;
  snapshot.inputContract =
    engine === 'native' ? NATIVE_INPUT_CONTRACT : { hostEngine: HOST_LIMITATION.hostEngine };

  printReport(engineId, snapshot, await loadBaselineForEngine(engineId));
  if (sleeveAnalysis) {
    console.log('\nSLEEVE STRESS (synthetic)');
    console.log(
      `  n=${sleeveAnalysis.n}  chose card=${sleeveAnalysis.choseCard}  chose sleeve=${sleeveAnalysis.choseSleeve}  miss=${sleeveAnalysis.miss}`,
    );
  }

  if (!flag('no-save-run')) {
    const p = await saveRun(snapshot);
    console.log(`Saved run: ${p}`);
  }
  if (flag('save-baseline') && corpus === 'real' && annotationKind === 'trusted-real') {
    const p = await saveBaselineForEngine(engineId, snapshot);
    console.log(`Saved baseline: ${p}`);
  }
  return snapshot;
};

console.log(`CORPUS=${corpus.toUpperCase()}`);
if (corpus === 'synthetic') {
  console.log(
    'SYNTHETIC stress fixtures — exact GT from transforms. Do NOT treat as real-device accuracy.',
  );
} else {
  console.log('NATIVE INPUT CONTRACT (summary)');
  console.log('─'.repeat(48));
  console.log(`Production live: ${NATIVE_INPUT_CONTRACT.productionLive.path}`);
  console.log(`Host native:     ${NATIVE_INPUT_CONTRACT.hostBenchmarkRgba.path}`);
  console.log(NATIVE_INPUT_CONTRACT.limitation);
}

const snapshots = [];
for (const e of engines) {
  snapshots.push(await runOne(e));
}

if (engines.length === 2) {
  console.log('\nTip: yarn geometry:parity  # JS ↔ Native disagreement report');
}
