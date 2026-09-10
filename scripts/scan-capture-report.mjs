#!/usr/bin/env node
// Summarize capture-quality A/B inbox bundles + historical good/bad captures.
// Does not run recognition regression.

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
  const dir = await mkdtemp(join(tmpdir(), 'lugin-cq-'));
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
        export { sharpnessScore, glareRatio } from '${join(rootDir, 'src/lib/scan/quality.ts')}';
        export { localContrast } from '${join(rootDir, 'src/lib/scan/captureQuality/metrics.ts')}';
        export { summarizeCapturePairs } from '${join(rootDir, 'src/lib/scan/captureQuality/summarize.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'cq-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const listAbBundles = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory() || !trace.name.startsWith('cq-')) continue;
      const metaPath = join(sessionDir, trace.name, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      out.push(JSON.parse(readFileSync(metaPath, 'utf8')));
    }
  }
  return out;
};

console.log('CAPTURE QUALITY REPORT');
console.log('Recognition corpus is separate (yarn scan:regression).');
console.log(
  'Sleeve truth: all 2026-09-08 cards sleeved except Island/Île (unsleeved). Dataset is not balanced.',
);
console.log('');

const scan = await loadScan();
const pairs = listAbBundles();
if (!pairs.length) {
  console.log('No A/B bundles yet. Phone: aim on the live preview → Capture A/B → label after.');
} else {
  console.log(scan.summarizeCapturePairs(pairs));
}

console.log('');
console.log('HISTORICAL CAPTURE-QUALITY FIXTURES');
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
    `  title ${img.width}×${img.height}  sharpness=${scan.sharpnessScore(img).toFixed(1)}  contrast=${scan.localContrast(img).toFixed(1)}  glare=${scan.glareRatio(img).toFixed(3)}`,
  );
}
