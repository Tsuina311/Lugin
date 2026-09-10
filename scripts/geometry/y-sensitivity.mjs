#!/usr/bin/env node
/**
 * yarn geometry:y-sensitivity
 *
 * Algorithm/input sensitivity: Native RGBA vs Native Y-from-RGBA
 * on the same fixtures. NOT ground-truth accuracy unless trusted.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listFixtures } from './lib/corpus.mjs';
import { loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { cornerErrors, formatPct } from './lib/metrics.mjs';
import { CORPUS_ROOT } from './lib/paths.mjs';
import { fixtureTrustedEval, fixtureUsableForGeometry } from './lib/schema.mjs';

const flag = name => process.argv.includes(`--${name}`);
const trustedOnly = !flag('all-usable');

const all = await listFixtures();
const fixtures = all.filter(f => {
  const use = fixtureUsableForGeometry(f);
  if (!use.ok && !f.negative) return false;
  if (f.tags?.includes('frozen-quad-series')) return false;
  if (trustedOnly) return fixtureTrustedEval(f) || (f.trusted && f.negative);
  return true;
});

if (!fixtures.length) {
  console.error('No fixtures. Pass --all-usable or annotate trusted.');
  process.exit(1);
}

console.log('NATIVE Y-LIKE INPUT SENSITIVITY');
console.log('─'.repeat(56));
console.log(`Fixtures: ${fixtures.length} (${trustedOnly ? 'trusted' : 'bootstrap-smoke — NOT GT accuracy'})`);
console.log('Comparing DetectCard.detectFromRgba vs detectFromYPlane(Y←RGBA).');

const { scan } = await loadDetectScan();
console.log('Running RGBA batch…');
const rgbaMap = await runNativeDetectorBatch(fixtures, {
  inputMode: 'rgba',
  batchDir: join(CORPUS_ROOT, 'native-batch-rgba-sens'),
});
console.log('Running Y-from-RGBA batch…');
const yMap = await runNativeDetectorBatch(fixtures, {
  inputMode: 'y-from-rgba',
  batchDir: join(CORPUS_ROOT, 'native-batch-y-sens'),
});

const rows = [];
for (const f of fixtures) {
  const a = rgbaMap.get(f.id);
  const b = yMap.get(f.id);
  if (!a || !b) continue;
  const aDet = Boolean(a.detected && a.corners);
  const bDet = Boolean(b.detected && b.corners);
  let agreement = 'neither';
  if (aDet && bDet) agreement = 'both';
  else if (aDet && !bDet) agreement = 'rgba-only';
  else if (!aDet && bDet) agreement = 'y-only';

  let iou = null;
  let meanCorner = null;
  let maxCorner = null;
  if (aDet && bDet) {
    iou = scan.polygonIoU(a.corners, b.corners);
    const ce = cornerErrors(a.corners, b.corners);
    meanCorner = ce.mean;
    maxCorner = ce.max;
  }
  rows.push({
    id: f.id,
    tags: f.tags ?? [],
    agreement,
    rgbaDetected: aDet,
    yDetected: bDet,
    rgbaScore: a.score,
    yScore: b.score,
    scoreDelta: (a.score ?? 0) - (b.score ?? 0),
    iouRgbaY: iou,
    meanCornerDiffPx: meanCorner,
    maxCornerDiffPx: maxCorner,
  });
}

const both = rows.filter(r => r.agreement === 'both');
const rgbaOnly = rows.filter(r => r.agreement === 'rgba-only');
const yOnly = rows.filter(r => r.agreement === 'y-only');
const neither = rows.filter(r => r.agreement === 'neither');
const ious = both.map(r => r.iouRgbaY).filter(x => x != null).sort((a, b) => a - b);
const pctile = (xs, p) => {
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
};

const byTag = {};
for (const r of rows) {
  for (const t of r.tags) {
    byTag[t] = byTag[t] || { n: 0, both: 0, rgbaOnly: 0, yOnly: 0, neither: 0, iouSum: 0, iouN: 0 };
    const s = byTag[t];
    s.n += 1;
    s[r.agreement === 'rgba-only' ? 'rgbaOnly' : r.agreement === 'y-only' ? 'yOnly' : r.agreement] += 1;
    if (r.iouRgbaY != null) {
      s.iouSum += r.iouRgbaY;
      s.iouN += 1;
    }
  }
}

const report = {
  kind: 'algorithm-input-sensitivity',
  note: 'NOT ground-truth accuracy unless fixtures are trusted. Measures RGBA vs Y-from-RGBA path divergence.',
  generatedAt: new Date().toISOString(),
  annotationKind: trustedOnly ? 'trusted' : 'bootstrap-smoke',
  summary: {
    n: rows.length,
    both: both.length,
    rgbaOnly: rgbaOnly.length,
    yOnly: yOnly.length,
    neither: neither.length,
    iouP50: pctile(ious, 50),
    iouP10: pctile(ious, 10),
    iouMin: ious[0] ?? null,
    meanAbsScoreDelta:
      rows.reduce((s, r) => s + Math.abs(r.scoreDelta), 0) / Math.max(1, rows.length),
  },
  byTag: Object.fromEntries(
    Object.entries(byTag).map(([t, s]) => [
      t,
      {
        ...s,
        meanIoU: s.iouN ? s.iouSum / s.iouN : null,
      },
    ]),
  ),
  rows,
};

const out = join(CORPUS_ROOT, 'y-sensitivity.json');
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);

console.log('\nAGREEMENT');
console.log(`  both detect:   ${both.length}`);
console.log(`  RGBA only:     ${rgbaOnly.length}`);
console.log(`  Y only:        ${yOnly.length}`);
console.log(`  neither:       ${neither.length}`);
console.log(
  `  IoU p50/p10/min: ${report.summary.iouP50?.toFixed(3) ?? '—'} / ${report.summary.iouP10?.toFixed(3) ?? '—'} / ${report.summary.iouMin?.toFixed(3) ?? '—'}`,
);
console.log(`  mean |Δscore|: ${report.summary.meanAbsScoreDelta.toFixed(3)}`);

console.log('\nBY TAG');
for (const [t, s] of Object.entries(report.byTag).sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `  ${t.padEnd(22)} n=${String(s.n).padStart(3)}  both=${s.both}  rgbaOnly=${s.rgbaOnly}  yOnly=${s.yOnly}  medIoU≈${s.meanIoU?.toFixed(3) ?? '—'}`,
  );
}

const worst = [...both].sort((a, b) => (a.iouRgbaY ?? 1) - (b.iouRgbaY ?? 1)).slice(0, 8);
console.log('\nLOWEST RGBA↔Y IoU (both detect)');
for (const r of worst) {
  console.log(`  ${r.id.slice(0, 52)}  iou=${r.iouRgbaY.toFixed(3)}  Δscore=${r.scoreDelta.toFixed(3)}`);
}
console.log(`\nWrote ${out}`);
void formatPct;
