#!/usr/bin/env node
/**
 * Import Phase A clip-vit-b32 JSON gallery into binary g800 index (no re-embed).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREPROCESS_VERSION, VISUAL_INDEX_VERSION } from './encoders.mjs';
import { galleryDir } from './gallery.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const srcCandidates = [
  join(root, '.scan-fixtures/visual-embed/clip-vit-b32-gallery800.json'),
  join(root, '.scan-fixtures/visual-embed/clip-vit-b32-index.json'),
];
const src = srcCandidates.find(p => existsSync(p));
if (!src) {
  console.error('No Phase A JSON gallery found');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(src, 'utf8'));
const entries = raw.entries ?? [];
const dims = entries[0]?.embedding?.length ?? 512;
const refs = entries.map(e => ({
  artId: e.scryfallId,
  oracleId: e.oracleId,
  canonicalName: e.name,
  scryfallId: e.scryfallId,
  setCode: null,
  collectorNumber: null,
}));
const embeddings = new Float32Array(entries.length * dims);
entries.forEach((e, i) => embeddings.set(Float32Array.from(e.embedding), i * dims));

const outDir = galleryDir('CLIP_VIT_B32', 'g800');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'embeddings.bin'), Buffer.from(embeddings.buffer));
writeFileSync(join(outDir, 'refs.json'), JSON.stringify(refs));
const oracles = new Set(refs.map(r => r.oracleId).filter(Boolean));
const metadata = {
  visualIndexVersion: VISUAL_INDEX_VERSION,
  encoderId: 'CLIP_VIT_B32',
  encoderVersion: 'Xenova/clip-vit-base-patch32@q1',
  preprocessVersion: PREPROCESS_VERSION,
  galleryTag: 'g800',
  dims,
  count: entries.length,
  dtype: 'f32',
  float32Bytes: embeddings.byteLength,
  float16Bytes: embeddings.byteLength / 2,
  oracleIdentities: oracles.size,
  artworkReferences: refs.length,
  generated: new Date().toISOString(),
  collapseBy: 'oracleId',
  importedFrom: src,
};
writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
writeFileSync(
  join(outDir, 'gallery-build-report.json'),
  JSON.stringify(
    {
      generated: metadata.generated,
      encoderId: 'CLIP_VIT_B32',
      galleryTag: 'g800',
      expected: entries.length,
      embedded: entries.length,
      downloaded: 0,
      cachedHits: entries.length,
      skipped: [],
      failureReasons: {},
      note: 'Imported from Phase A JSON; not a fresh full-gallery build',
      oracleIdentities: oracles.size,
      artworkReferences: refs.length,
    },
    null,
    2,
  ),
);
console.log(`imported ${entries.length} → ${outDir}`);
