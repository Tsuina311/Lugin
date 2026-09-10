#!/usr/bin/env node
/**
 * yarn geometry:parity
 *
 * Compare shared-js vs production DetectCard.kt on the same fixtures.
 * Writes .geometry-corpus/js-native-parity.json for the priority queue.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listFixtures } from './lib/corpus.mjs';
import { runHostDetector, loadDetectScan } from './lib/detect-host.mjs';
import { NATIVE_INPUT_CONTRACT, runNativeDetectorBatch } from './lib/detect-native.mjs';
import { cornerErrors, formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { fixtureTrustedEval, fixtureUsableForGeometry } from './lib/schema.mjs';

export const PARITY_REPORT_PATH = join(CORPUS_ROOT, 'js-native-parity.json');

const flag = name => process.argv.includes(`--${name}`);
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const trustedOnly = !flag('all-usable');
const nativeInput = (arg('native-input') || 'rgba').toLowerCase();
const disagreeIoU = Number(arg('disagree-iou') || 0.85);

const all = await listFixtures();
let fixtures = all.filter(f => {
  const use = fixtureUsableForGeometry(f);
  if (!use.ok && !f.negative) return false;
  if (f.tags?.includes('frozen-quad-series')) return false;
  if (trustedOnly) return fixtureTrustedEval(f) || (f.trusted && f.negative);
  return true;
});

if (!fixtures.length) {
  console.error('No fixtures. Use --all-usable or annotate trusted fixtures.');
  process.exit(1);
}

console.log(`GEOMETRY PARITY · js ↔ native (${fixtures.length} fixtures, input=${nativeInput})`);
console.log('─'.repeat(64));
console.log(NATIVE_INPUT_CONTRACT.limitation);
console.log(`Annotations: ${trustedOnly ? 'trusted (quality)' : 'bootstrap-smoke (NOT accuracy)'}`);

const { scan } = await loadDetectScan();
const jsMap = new Map();
for (const f of fixtures) {
  const abs = join(rootDir, f.image);
  if (!existsSync(abs)) continue;
  const det = await runHostDetector(abs);
  jsMap.set(f.id, det);
}

console.log('Running native batch…');
const nativeMap = await runNativeDetectorBatch(fixtures, { inputMode: nativeInput });

const rows = [];
for (const f of fixtures) {
  const js = jsMap.get(f.id);
  const nat = nativeMap.get(f.id);
  if (!js || !nat) continue;
  const jsDet = Boolean(js.detected && js.corners);
  const natDet = Boolean(nat.detected && nat.corners);
  let iou = null;
  let meanCorner = null;
  let maxCorner = null;
  if (jsDet && natDet) {
    iou = scan.polygonIoU(js.corners, nat.corners);
    const ce = cornerErrors(js.corners, nat.corners);
    meanCorner = ce.mean;
    maxCorner = ce.max;
  }
  let agreement = 'neither';
  if (jsDet && natDet) agreement = 'both';
  else if (jsDet && !natDet) agreement = 'js-only';
  else if (!jsDet && natDet) agreement = 'native-only';

  const substantial =
    agreement === 'js-only' ||
    agreement === 'native-only' ||
    (iou != null && iou < disagreeIoU) ||
    (maxCorner != null && maxCorner > 40);

  rows.push({
    id: f.id,
    source: f.source,
    captureGroup: f.captureGroup || f.seriesId || f.id,
    tags: f.tags ?? [],
    trusted: fixtureTrustedEval(f),
    agreement,
    jsDetected: jsDet,
    nativeDetected: natDet,
    jsScore: js.score,
    nativeScore: nat.score,
    scoreDelta: (js.score ?? 0) - (nat.score ?? 0),
    iouJsNative: iou,
    meanCornerDiffPx: meanCorner,
    maxCornerDiffPx: maxCorner,
    jsRuntimeMs: js.runtimeMs,
    nativeRuntimeMs: nat.runtimeMs,
    substantialDisagreement: substantial,
  });
}

const both = rows.filter(r => r.agreement === 'both');
const jsOnly = rows.filter(r => r.agreement === 'js-only');
const nativeOnly = rows.filter(r => r.agreement === 'native-only');
const neither = rows.filter(r => r.agreement === 'neither');
const ious = both.map(r => r.iouJsNative).filter(x => x != null).sort((a, b) => a - b);
const pctile = (xs, p) => {
  if (!xs.length) return null;
  const i = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1));
  return xs[i];
};

const byTag = {};
for (const r of rows.filter(r => r.substantialDisagreement)) {
  for (const t of r.tags) {
    byTag[t] = byTag[t] || { disagreements: 0, jsOnly: 0, nativeOnly: 0, lowIoU: 0 };
    byTag[t].disagreements += 1;
    if (r.agreement === 'js-only') byTag[t].jsOnly += 1;
    if (r.agreement === 'native-only') byTag[t].nativeOnly += 1;
    if (r.iouJsNative != null && r.iouJsNative < disagreeIoU) byTag[t].lowIoU += 1;
  }
}

const worst = [...rows]
  .filter(r => r.substantialDisagreement)
  .sort((a, b) => {
    const sa = a.iouJsNative ?? (a.agreement === 'both' ? 1 : 0);
    const sb = b.iouJsNative ?? (b.agreement === 'both' ? 1 : 0);
    if (a.agreement !== 'both' && b.agreement === 'both') return -1;
    if (b.agreement !== 'both' && a.agreement === 'both') return 1;
    return sa - sb;
  })
  .slice(0, 10);

const report = {
  generatedAt: new Date().toISOString(),
  nativeInput,
  disagreeIoUThreshold: disagreeIoU,
  annotationKind: trustedOnly ? 'trusted' : 'bootstrap-smoke',
  inputContract: NATIVE_INPUT_CONTRACT,
  runtimeNote: {
    js: 'HOST_JS_NOT_DEVICE_LATENCY',
    native: 'HOST_JVM_NOT_DEVICE_LATENCY',
  },
  summary: {
    n: rows.length,
    both: both.length,
    jsOnly: jsOnly.length,
    nativeOnly: nativeOnly.length,
    neither: neither.length,
    bothDetectRate: rows.length ? both.length / rows.length : null,
    iouP50: pctile(ious, 50),
    iouP10: pctile(ious, 10),
    iouMin: ious[0] ?? null,
    substantialDisagreements: rows.filter(r => r.substantialDisagreement).length,
  },
  byTag,
  worstDisagreements: worst,
  rows,
};

await writeFile(PARITY_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log('\nAGREEMENT');
console.log(`  both detect:     ${both.length}`);
console.log(`  JS only:         ${jsOnly.length}`);
console.log(`  Native only:     ${nativeOnly.length}`);
console.log(`  neither:         ${neither.length}`);
console.log(`  IoU p50/p10/min: ${report.summary.iouP50?.toFixed(3) ?? '—'} / ${report.summary.iouP10?.toFixed(3) ?? '—'} / ${report.summary.iouMin?.toFixed(3) ?? '—'}`);
console.log(`  substantial:     ${report.summary.substantialDisagreements}`);

if (Object.keys(byTag).length) {
  console.log('\nDISAGREEMENTS BY TAG');
  for (const [t, s] of Object.entries(byTag).sort((a, b) => b[1].disagreements - a[1].disagreements)) {
    console.log(
      `  ${t.padEnd(20)} n=${s.disagreements}  jsOnly=${s.jsOnly}  nativeOnly=${s.nativeOnly}  lowIoU=${s.lowIoU}`,
    );
  }
}

console.log('\nWORST DISAGREEMENTS (top 10)');
for (const [i, r] of worst.entries()) {
  console.log(
    `  ${String(i + 1).padStart(2)}. ${r.id.slice(0, 48)}  ${r.agreement}  iou=${r.iouJsNative?.toFixed(2) ?? '—'}  maxCorner=${r.maxCornerDiffPx?.toFixed(0) ?? '—'}`,
  );
}

console.log(`\nWrote ${PARITY_REPORT_PATH}`);
console.log('Re-run yarn geometry:queue to prioritize native-js-disagreement.');
void formatPct;
