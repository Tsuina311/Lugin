#!/usr/bin/env node
/**
 * Serialize the frozen mean-prototype gallery. Does not replace the champion.
 *
 * prototype = L2-normalized mean of adapted clean, blur, motion, and perspective.
 * Presets are the existing ones: blur 2.4, motion 9, perspective 0.09.
 *
 *   node scripts/scanner-benchmark/identity/freeze-prototype.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rootDir } from '../lib/paths.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';

const DIMS = 512;
const COUNT = 49968;
const BYTES = COUNT * DIMS * 4;
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');
const adapterPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');
const outDir = join(rootDir, 'scanner-benchmark/identity-registry/candidates/mean-prototype-v1');
const VIEWS = [
  { id: 'clean', path: join(RAW_GALLERY_DIR, 'embeddings.bin'), preset: { id: 'clean' } },
  { id: 'blur', path: join(viewDir, 'blur.bin'), preset: { id: 'blur', blur: 2.4 } },
  { id: 'motion', path: join(viewDir, 'motion.bin'), preset: { id: 'motion', motion: 9 } },
  { id: 'perspective', path: join(viewDir, 'perspective.bin'), preset: { id: 'perspective', perspective: 0.09 } },
];

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const floatsFrom = (path, expectedBytes = null) => {
  const buf = readFileSync(path);
  if (expectedBytes != null && buf.byteLength !== expectedBytes) throw new Error(`${path} ${buf.byteLength} != ${expectedBytes}`);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const meanOf = views => {
  const out = new Float32Array(views[0].length);
  for (const view of views) for (let i = 0; i < out.length; i++) out[i] += view[i];
  const count = out.length / DIMS;
  for (let i = 0; i < count; i++) {
    const offset = i * DIMS;
    let sum = 0;
    for (let d = 0; d < DIMS; d++) {
      out[offset + d] /= views.length;
      sum += out[offset + d] * out[offset + d];
    }
    const n = Math.sqrt(sum) || 1;
    for (let d = 0; d < DIMS; d++) out[offset + d] /= n;
  }
  return out;
};

const rawMeta = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'metadata.json'), 'utf8'));
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
if (refs.length !== COUNT) throw new Error(`refs ${refs.length}`);
if (rawMeta.count !== COUNT || rawMeta.dims !== DIMS || rawMeta.dtype !== 'f32') throw new Error('clean metadata mismatch');
const ids = refs.map(ref => ref.scryfallId ?? ref.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate gallery refs');
const missingOracle = refs.filter(ref => !ref.oracleId || !ref.canonicalName).length;
if (missingOracle) throw new Error(`refs missing identity ${missingOracle}`);

const model = loadModel(JSON.parse(readFileSync(adapterPath, 'utf8')));
log('adapting four galleries');
const adapted = [];
for (const view of VIEWS) {
  log(view.id);
  adapted.push(applyGallery(model, floatsFrom(view.path, BYTES), COUNT, DIMS));
}
const first = meanOf(adapted);
const second = meanOf(adapted);
let drift = 0;
for (let i = 0; i < first.length; i++) drift = Math.max(drift, Math.abs(first[i] - second[i]));
if (drift !== 0) throw new Error(`prototype not deterministic ${drift}`);

let badNorm = 0;
const norms = [];
for (let i = 0; i < COUNT; i += 4996) {
  let sum = 0;
  const offset = i * DIMS;
  for (let d = 0; d < DIMS; d++) {
    const value = first[offset + d];
    if (!Number.isFinite(value)) badNorm += 1;
    sum += value * value;
  }
  norms.push(Math.sqrt(sum));
}
if (badNorm) throw new Error('non-finite prototype values');
if (norms.some(value => Math.abs(value - 1) > 1e-4)) throw new Error(`norms ${norms.join(',')}`);

await mkdir(outDir, { recursive: true });
const binPath = join(outDir, 'embeddings.bin');
await writeFile(binPath, Buffer.from(first.buffer, first.byteOffset, first.byteLength));
await copyFile(join(RAW_GALLERY_DIR, 'refs.json'), join(outDir, 'refs.json'));
await copyFile(join(RAW_GALLERY_DIR, 'metadata.json'), join(outDir, 'source-metadata.json'));
const loaded = floatsFrom(binPath, BYTES);
let reloadDrift = 0;
for (let i = 0; i < loaded.length; i++) reloadDrift = Math.max(reloadDrift, Math.abs(loaded[i] - first[i]));
if (reloadDrift !== 0) throw new Error(`reload drift ${reloadDrift}`);

const queryPath = join(rootDir, 'scanner-benchmark/identity/crops/6af4d62be4fcd81f/oracle.f32');
const query = forward(model, floatsFrom(queryPath, DIMS * 4)).y;
const topOf = embeddings => {
  let best = -Infinity;
  let index = -1;
  for (let i = 0; i < COUNT; i++) {
    let score = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) score += query[d] * embeddings[offset + d];
    if (score > best) {
      best = score;
      index = i;
    }
  }
  return { index, score: best, oracleId: refs[index].oracleId, name: refs[index].canonicalName };
};
const memoryTop = topOf(first);
const fileTop = topOf(loaded);
if (memoryTop.index !== fileTop.index || memoryTop.score !== fileTop.score) throw new Error('nearest neighbor reload mismatch');

const code = await readFile(new URL(import.meta.url), 'utf8');
const manifest = {
  role: 'candidate',
  id: 'mean-prototype-v1',
  promoted: false,
  encoderId: rawMeta.encoderId,
  encoderVersion: rawMeta.encoderVersion,
  dims: DIMS,
  count: COUNT,
  dtype: 'f32',
  bytes: statSync(binPath).size,
  prototypeHash: sha256(binPath),
  sourceGalleryHash: sha256(VIEWS[0].path),
  viewHashes: Object.fromEntries(VIEWS.map(view => [view.id, sha256(view.path)])),
  refsHash: sha256(join(outDir, 'refs.json')),
  adapterPath: 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json',
  adapterHash: sha256(adapterPath),
  presets: VIEWS.map(view => view.preset),
  codeHash: createHash('sha256').update(code).digest('hex'),
  collapse: 'per-vector L2-normalized mean of four adapted unit vectors',
  indexAlignment: 'refs.json copied from the clean gallery; row i is the same artwork',
  duplicateRefs: 0,
  missingIdentityFields: 0,
  deterministicReplayDrift: drift,
  reloadDrift,
  sampleNorms: norms,
  nearestNeighborCheck: { ...memoryTop, matchesFile: true },
  ramBytesIfLoaded: BYTES,
  createdAt: new Date().toISOString(),
  sourceGenerated: rawMeta.generated,
};
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
log(`hash ${manifest.prototypeHash.slice(0, 16)} bytes ${manifest.bytes} nn ${memoryTop.name}`);
