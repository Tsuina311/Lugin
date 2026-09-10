#!/usr/bin/env node
// Summarize focus-series inbox bundles. Does not run recognition.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

import { QUALITY_SELECTED } from './scan-capture-quality/corpus.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-fs-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { pngBytesToScanImage } from '${join(rootDir, 'mobile/src/scan/debug/scanImagePng.ts')}';
        export { sharpnessScore } from '${join(rootDir, 'src/lib/scan/quality.ts')}';
        export { localContrast } from '${join(rootDir, 'src/lib/scan/captureQuality/metrics.ts')}';
        export { diagnoseFocusBundle, summarizeFocusSeries } from '${join(rootDir, 'src/lib/scan/focusSeries/summarize.ts')}';
        export { formatCapturePolicyReport } from '${join(rootDir, 'src/lib/scan/focusSeries/report.ts')}';
        export { partitionFocusSeries } from '${join(rootDir, 'src/lib/scan/focusSeries/partition.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'fs-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const listSeries = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory() || !trace.name.startsWith('focus-series-')) continue;
      const metaPath = join(sessionDir, trace.name, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      out.push({ bundle: JSON.parse(readFileSync(metaPath, 'utf8')), dir: join(sessionDir, trace.name) });
    }
  }
  return out;
};

const printCard = (scan, entry) => {
  const bundle = scan.diagnoseFocusBundle(entry.bundle);
  console.log('');
  console.log(`${bundle.label || bundle.fixtureId}`);
  console.log(
    `  track ${bundle.currentTrackId ?? '—'}  focusTrack ${bundle.focusTrackId ?? '—'}  same ${bundle.sameTrackFocus ? 'yes' : 'no'}  attempt ${bundle.focusAttemptId ?? '—'}  quadMode ${bundle.quadMode}`,
  );
  if (bundle.trackChangedDuringSeries) console.log('  WARNING: track id changed during series');
  console.log(
    '  delay   age     iou     card    title   class              OCR                  identity',
  );
  for (const n of [0, 250, 500, 800]) {
    const s = bundle.samples.find(x => x.nominalDelayMs === n);
    if (!s) {
      console.log(`  T${n}  (missing)`);
      continue;
    }
    const ocr = (s.ocr.rawOcrFirst || '(empty)').replace(/\s+/g, ' ').slice(0, 20);
    console.log(
      `  T${String(n).padEnd(5)} ${String(s.quadAgeAtCaptureMs == null ? '—' : Math.round(s.quadAgeAtCaptureMs)).padEnd(7)} ${
        s.geometry ? s.geometry.iouVsT0.toFixed(2) : '—'
      }    ${s.metrics.cardSharpness.toFixed(0).padEnd(7)} ${s.metrics.titleSharpness.toFixed(0).padEnd(7)} ${(s.failureClass ?? '—').padEnd(18)} ${ocr.padEnd(20)} ${s.ocr.matchName ?? s.ocr.status}`,
    );
  }
};

console.log('FOCUS SERIES REPORT');
console.log('Live capture timing is unchanged. This is Lab evidence only.');
console.log('Per-snapshot recognition quads. Do not treat WARP_BAD as autofocus failure.');
console.log(
  'Sleeve truth: Wand, Teferi, Livaan, Lizard Blades sleeved. Island/Île unsleeved. Not a balanced sleeve set.',
);
console.log('');

const scan = await loadScan();
const series = listSeries();
if (!series.length) {
  console.log('No focus-series bundles yet. Phone: live preview → Focus series → label after.');
} else {
  for (const entry of series) printCard(scan, entry);
  const bundles = series.map(s => s.bundle);
  const parts = scan.partitionFocusSeries(bundles.map(scan.diagnoseFocusBundle));
  console.log('');
  console.log('--- ALL SERIES (legacy-frozen + per-snapshot; do not pick a policy from this mix) ---');
  console.log(scan.summarizeFocusSeries(bundles));
  console.log('');
  console.log('--- PER-SNAPSHOT ONLY (policy evaluation) ---');
  if (!parts.perSnapshot.length) {
    console.log('No per-snapshot series yet.');
  } else {
    console.log(scan.summarizeFocusSeries(parts.perSnapshot));
    console.log('');
    console.log('Full expected-identity + policy table: yarn scan:capture-policy-report');
  }
}

console.log('');
console.log('HISTORICAL TEFERI (capture-quality corpus, not this series)');
for (const spec of QUALITY_SELECTED) {
  const dir = join(inboxRoot, spec.inboxSession, spec.inboxTrace);
  const titlePath = join(dir, 'title-crop-current.png');
  console.log(`${spec.kind}  ${spec.inboxTrace}`);
  console.log(`  ${spec.note}`);
  if (!existsSync(titlePath)) {
    console.log('  title crop missing');
    continue;
  }
  const img = scan.pngBytesToScanImage(new Uint8Array(readFileSync(titlePath)));
  console.log(
    `  title ${img.width}×${img.height}  sharpness=${scan.sharpnessScore(img).toFixed(1)}  contrast=${scan.localContrast(img).toFixed(1)}`,
  );
}
