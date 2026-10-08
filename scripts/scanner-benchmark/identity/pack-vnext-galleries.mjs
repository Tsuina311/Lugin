/**
 * Copy the frozen float32 galleries and linear adapter into a directory
 * the development phone can adb-push. Does not quantize and does not
 * rebuild the prototype.
 *
 *   node scripts/scanner-benchmark/identity/pack-vnext-galleries.mjs
 *
 * Then, with the dev app installed:
 *   adb push .scan-fixtures/vnext-galleries /sdcard/Android/data/app.lugin.mobile/files/lugin-visual-vnext
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { rootDir } from '../lib/paths.mjs';
import { loadModel } from '../embedding/math.mjs';

const outDir = join(rootDir, '.scan-fixtures/vnext-galleries');
const cleanSrc = join(rootDir, 'scanner-benchmark/recognition-registry/autolab/adapted/clean.f32');
const prototypeSrc = join(rootDir, 'scanner-benchmark/identity-registry/candidates/mean-prototype-v1/embeddings.bin');
const refsSrc = join(rootDir, 'scanner-benchmark/identity-registry/candidates/mean-prototype-v1/refs.json');
const adapterSrc = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

mkdirSync(outDir, { recursive: true });
copyFileSync(cleanSrc, join(outDir, 'clean.f32'));
copyFileSync(prototypeSrc, join(outDir, 'prototype.f32'));

const refs = JSON.parse(readFileSync(refsSrc, 'utf8'));
writeFileSync(
  join(outDir, 'refs.json'),
  JSON.stringify({
    names: refs.map(ref => ref.canonicalName),
    oracleIds: refs.map(ref => ref.oracleId),
    artIds: refs.map(ref => ref.artId),
  }),
);

const model = loadModel(JSON.parse(readFileSync(adapterSrc, 'utf8')));
writeFileSync(join(outDir, 'adapter-w.f32'), Buffer.from(model.W.buffer, model.W.byteOffset, model.W.byteLength));
writeFileSync(join(outDir, 'adapter-b.f32'), Buffer.from(model.b.buffer, model.b.byteOffset, model.b.byteLength));

const manifest = {
  id: 'vnext-float32',
  count: refs.length,
  dims: 512,
  clean: 'clean.f32',
  prototype: 'prototype.f32',
  refs: 'refs.json',
  adapterW: 'adapter-w.f32',
  adapterB: 'adapter-b.f32',
  adapterId: 'linear-identity-v1',
  geometryId: 'gbm-iou-all-2dd2ec36b833',
  cleanSha256: sha256(join(outDir, 'clean.f32')),
  prototypeSha256: sha256(join(outDir, 'prototype.f32')),
  note: 'Development push only. Not an app asset. Do not quantize.',
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`packed ${refs.length} refs → ${outDir}`);
console.log(`clean ${manifest.cleanSha256}`);
console.log(`prototype ${manifest.prototypeSha256}`);
