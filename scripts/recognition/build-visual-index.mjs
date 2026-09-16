#!/usr/bin/env node
/**
 * Build visual reference gallery index.
 *
 *   yarn recognition:visual-index --gallery 800 --encoder CLIP_VIT_B32
 *   yarn recognition:visual-index --gallery full --encoder CLIP_VIT_B32
 *
 * Snapshots prior 800-gallery JSON if present.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_ENCODER_ID } from './encoders.mjs';
import { buildGalleryIndex, galleryDir } from './gallery.mjs';
import { resolveExpected } from './scoring.mjs';
import { selectTrustedCorpus } from './trusted-corpus.mjs';
import { VISUAL_INDEX_PATH } from './visual-embed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const opt = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const encoderId = (opt('encoder') || DEFAULT_ENCODER_ID).toUpperCase();
const galleryArg = opt('gallery') ?? '800';
const gallery = galleryArg === 'full' ? 'full' : Number(galleryArg);

// Preserve Phase A ~800 JSON snapshot once.
if (existsSync(VISUAL_INDEX_PATH)) {
  const snap = join(root, '.scan-fixtures/visual-embed/clip-vit-b32-gallery800.json');
  if (!existsSync(snap)) {
    copyFileSync(VISUAL_INDEX_PATH, snap);
    console.log(`snapshotted Phase A gallery → ${snap}`);
  }
}

const corpus = selectTrustedCorpus(root, { dataset: 'core44' });
const mustIncludeOracleIds = new Set();
const mustIncludeNames = new Set();
for (const item of corpus) {
  const exp = resolveExpected(root, item);
  if (exp.oracleId) mustIncludeOracleIds.add(exp.oracleId);
  if (exp.fold) mustIncludeNames.add(exp.fold);
}

console.log(`encoder: ${encoderId}`);
console.log(`gallery: ${gallery === 'full' ? 'FULL (production art-index)' : gallery}`);
console.log(`pinned CORE_44 oracles/names: ${mustIncludeOracleIds.size}/${mustIncludeNames.size}`);

const started = Date.now();
const result = await buildGalleryIndex({
  encoderId,
  gallery,
  checkpointEvery: 100,
  mustIncludeOracleIds,
  mustIncludeNames,
  onProgress: ({ i, total, report }) => {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `  ${i}/${total}  embedded=${report.embedded} cache=${report.cachedHits} skip=${report.skipped.length} (${elapsed}s)`,
    );
  },
});

console.log(`\nwrote index → ${result.outDir}`);
console.log(
  `oracles=${result.metadata.oracleIdentities} arts=${result.metadata.artworkReferences} dims=${result.metadata.dims}`,
);
console.log(
  `embedded=${result.report.embedded} skipped=${result.report.skipped.length} reasons=`,
  result.report.failureReasons,
);
console.log(`float32 index: ${(result.metadata.float32Bytes / 1e6).toFixed(1)} MB`);

const summaryPath = join(galleryDir(encoderId, gallery === 'full' ? 'full' : `g${gallery}`), 'BUILD_OK');
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(
  summaryPath,
  JSON.stringify({ ok: true, at: new Date().toISOString(), metadata: result.metadata }, null, 2),
);
