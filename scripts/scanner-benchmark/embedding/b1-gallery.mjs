/**
 * Freeze the B1 art-linear gallery beside the raw CLIP gallery.
 * Raw embeddings are read and left in place.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rootDir } from '../lib/paths.mjs';
import { applyGallery, loadModel } from './math.mjs';

export const B1_GALLERY_ID = 'CLIP_VIT_B32_B1_ART';
export const B1_ADAPTER_PATH = join(rootDir, '.scan-fixtures/embedding-bakeoff/models/b1.json');
export const RAW_GALLERY_DIR = join(rootDir, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32/full');
export const B1_GALLERY_DIR = join(rootDir, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32_B1_ART/full');

const sha256File = path => {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
};

export const buildB1Gallery = ({ force = false, log = () => {} } = {}) => {
  if (!existsSync(B1_ADAPTER_PATH)) throw new Error(`missing B1 adapter at ${B1_ADAPTER_PATH}`);
  const adapterSha = sha256File(B1_ADAPTER_PATH);
  const metaPath = join(B1_GALLERY_DIR, 'metadata.json');
  if (!force && existsSync(metaPath)) {
    const prev = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (prev.adapterSha256 === adapterSha && existsSync(join(B1_GALLERY_DIR, 'embeddings.bin'))) {
      log(`B1 gallery already matches adapter ${adapterSha.slice(0, 12)}`);
      return prev;
    }
  }
  const rawMeta = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'metadata.json'), 'utf8'));
  const saved = JSON.parse(readFileSync(B1_ADAPTER_PATH, 'utf8'));
  const model = loadModel(saved);
  if (model.kind !== 'linear') throw new Error(`B1 gallery expects the linear adapter, got ${model.kind}`);
  const rawBuf = readFileSync(join(RAW_GALLERY_DIR, 'embeddings.bin'));
  const rawCopy = new ArrayBuffer(rawBuf.byteLength);
  new Uint8Array(rawCopy).set(rawBuf);
  const raw = new Float32Array(rawCopy);
  const count = rawMeta.count;
  const dims = rawMeta.dims;
  if (raw.length !== count * dims) throw new Error('raw CLIP gallery length does not match metadata');
  log(`adapting ${count} raw CLIP art vectors`);
  const adapted = applyGallery(model, raw, count, dims);
  mkdirSync(B1_GALLERY_DIR, { recursive: true });
  const embPath = join(B1_GALLERY_DIR, 'embeddings.bin');
  writeFileSync(embPath, Buffer.from(adapted.buffer, adapted.byteOffset, adapted.byteLength));
  copyFileSync(join(RAW_GALLERY_DIR, 'refs.json'), join(B1_GALLERY_DIR, 'refs.json'));
  const metadata = {
    id: B1_GALLERY_ID,
    baseGallery: 'CLIP_VIT_B32/full',
    baseEncoderId: rawMeta.encoderId,
    baseEncoderVersion: rawMeta.encoderVersion,
    preprocessVersion: rawMeta.preprocessVersion,
    adapter: 'b1-art-linear',
    adapterKind: model.kind,
    adapterParams: model.spec.params,
    adapterBytes: model.spec.bytes,
    adapterSha256: adapterSha,
    gallerySha256: sha256File(embPath),
    dims,
    count,
    dtype: 'f32',
    builtAt: new Date().toISOString(),
  };
  writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);
  log(`wrote ${B1_GALLERY_DIR} ${metadata.gallerySha256.slice(0, 12)}`);
  return metadata;
};
