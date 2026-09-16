#!/usr/bin/env node
/**
 * Pack CLIP model + F16 index + compact oracle map into the Expo module assets.
 *
 *   node scripts/recognition/pack-visual-assets.mjs
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(
  root,
  'mobile/modules/lugin-visual-recognizer/android/src/main/assets/lugin-visual',
);
mkdirSync(outDir, { recursive: true });

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

const modelSrc = join(
  root,
  '.scan-fixtures/transformers-cache/Xenova/clip-vit-base-patch32/onnx/vision_model_quantized.onnx',
);
const embSrc = join(
  root,
  '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32_F16/full/embeddings.f16.bin',
);
const refsSrc = join(root, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32/full/refs.json');

for (const p of [modelSrc, embSrc, refsSrc]) {
  if (!existsSync(p)) {
    console.error(`missing ${p}`);
    process.exit(1);
  }
}

const modelDest = join(outDir, 'clip-vit-b32-quant.onnx');
const embDest = join(outDir, 'embeddings.f16.bin');
const mapDest = join(outDir, 'oracle-map.json');

copyFileSync(modelSrc, modelDest);
copyFileSync(embSrc, embDest);

const refs = JSON.parse(readFileSync(refsSrc, 'utf8'));
// Compact: parallel arrays keep parse lighter on device.
const map = {
  version: 1,
  count: refs.length,
  dims: 512,
  dtype: 'f16',
  names: refs.map(r => r.canonicalName),
  oracleIds: refs.map(r => r.oracleId),
  artIds: refs.map(r => r.artId),
};
writeFileSync(mapDest, JSON.stringify(map));

const manifest = {
  version: 1,
  encoderId: 'CLIP_VIT_B32',
  configId: 'CLIP_VIT_B32_F16',
  hfId: 'Xenova/clip-vit-base-patch32',
  dims: 512,
  artCount: refs.length,
  oracleCount: new Set(refs.map(r => r.oracleId)).size,
  files: {
    model: {
      path: 'clip-vit-b32-quant.onnx',
      bytes: statSync(modelDest).size,
      sha256: sha256(modelDest),
    },
    embeddings: {
      path: 'embeddings.f16.bin',
      bytes: statSync(embDest).size,
      sha256: sha256(embDest),
    },
    oracleMap: {
      path: 'oracle-map.json',
      bytes: statSync(mapDest).size,
      sha256: sha256(mapDest),
    },
  },
  artCrop: { h: 0.42, w: 0.84, x: 0.08, y: 0.12, version: 1 },
  generated: new Date().toISOString(),
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
// Also copy to JS-readable path for integrity checks before native init.
const jsManifestDir = join(root, 'mobile/assets/lugin-visual');
mkdirSync(jsManifestDir, { recursive: true });
writeFileSync(join(jsManifestDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('packed visual assets →', outDir);
console.log(
  `  model ${(manifest.files.model.bytes / 1e6).toFixed(1)}MB  emb ${(manifest.files.embeddings.bytes / 1e6).toFixed(1)}MB  map ${(manifest.files.oracleMap.bytes / 1e6).toFixed(1)}MB`,
);
console.log(`  arts=${manifest.artCount} oracles=${manifest.oracleCount}`);
console.log(`  model sha ${manifest.files.model.sha256.slice(0, 16)}…`);
