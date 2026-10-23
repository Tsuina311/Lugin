#!/usr/bin/env node
/**
 * Compare Android ONNX and host Xenova CLIP on the exact deterministic
 * 625×436 RGBA fixture. OCR is intentionally excluded on both sides.
 *
 *   yarn scanner:vnext-phone-parity /path/to/android-result.json
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

import { loadEncoder } from '../../recognition/encoders.mjs';
import { rootDir } from '../lib/paths.mjs';

const androidPath = process.argv[2];
if (!androidPath) {
  throw new Error('Usage: yarn scanner:vnext-phone-parity /path/to/android-result.json');
}

const temp = await mkdtemp(join(tmpdir(), 'lugin-vnext-phone-parity-'));
const fixtureBundle = join(temp, 'fixture.mjs');
await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: fixtureBundle,
  platform: 'node',
  stdin: {
    contents: `
      export * from '${join(rootDir, 'src/lib/scan/vnext/parityFixture.ts')}';
    `,
    resolveDir: rootDir,
  },
});
const fixture = await import(pathToFileURL(fixtureBundle).href);
const rgba = fixture.createVNextParityFixtureRgba();
const rgbaSha = createHash('sha256').update(rgba).digest('hex');
const android = JSON.parse(readFileSync(androidPath, 'utf8'));

assert.equal(android.fixture?.id, fixture.VNEXT_PARITY_FIXTURE_ID);
assert.equal(android.fixture?.format, 'RGBA8888');
assert.equal(android.fixture?.width, fixture.VNEXT_PARITY_FIXTURE_WIDTH);
assert.equal(android.fixture?.height, fixture.VNEXT_PARITY_FIXTURE_HEIGHT);
assert.equal(android.preparedRgbaSha256, rgbaSha, 'Android and host fixture bytes differ');
assert.equal(android.ocrIncluded, false, 'Parity fixture must exclude OCR');
assert.equal(android.embedding?.length, 512, 'Android adapted embedding must have 512 values');

const png = new PNG({
  width: fixture.VNEXT_PARITY_FIXTURE_WIDTH,
  height: fixture.VNEXT_PARITY_FIXTURE_HEIGHT,
});
png.data.set(rgba);
const pngPath = join(temp, 'fixture.png');
await writeFile(pngPath, PNG.sync.write(png));

const galleryDir = join(rootDir, '.scan-fixtures/vnext-galleries');
const readF32 = path => {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};
const refs = JSON.parse(readFileSync(join(galleryDir, 'refs.json'), 'utf8'));
const clean = readF32(join(galleryDir, 'clean.f32'));
const prototype = readF32(join(galleryDir, 'prototype.f32'));
const adapterW = readF32(join(galleryDir, 'adapter-w.f32'));
const adapterB = readF32(join(galleryDir, 'adapter-b.f32'));
const dims = 512;

const adapt = raw => {
  const out = new Float32Array(adapterB);
  for (let i = 0; i < dims; i++) {
    const value = raw[i];
    const row = i * dims;
    for (let j = 0; j < dims; j++) out[j] += value * adapterW[row + j];
  }
  let norm2 = 0;
  for (const value of out) norm2 += value * value;
  const norm = Math.sqrt(norm2) || 1;
  for (let i = 0; i < dims; i++) out[i] /= norm;
  return out;
};

const top = (query, gallery, k = 10) => {
  const best = new Map();
  const order = new Map();
  let nextOrder = 0;
  for (let i = 0; i < refs.oracleIds.length; i++) {
    const oracleId = refs.oracleIds[i];
    if (!order.has(oracleId)) order.set(oracleId, nextOrder++);
    let score = 0;
    const offset = i * dims;
    for (let d = 0; d < dims; d++) score += query[d] * gallery[offset + d];
    const previous = best.get(oracleId);
    if (!previous || score > previous.score) {
      best.set(oracleId, { oracleId, name: refs.names[i], score });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || order.get(a.oracleId) - order.get(b.oracleId))
    .slice(0, k);
};

const { runtime } = await loadEncoder('CLIP_VIT_B32');
const hostEmbedding = adapt(await runtime.embedPath(pngPath));
const androidEmbedding = Float32Array.from(android.embedding);
let dot = 0;
let hostNorm = 0;
let androidNorm = 0;
let maxAbsDelta = 0;
for (let i = 0; i < dims; i++) {
  dot += hostEmbedding[i] * androidEmbedding[i];
  hostNorm += hostEmbedding[i] ** 2;
  androidNorm += androidEmbedding[i] ** 2;
  maxAbsDelta = Math.max(maxAbsDelta, Math.abs(hostEmbedding[i] - androidEmbedding[i]));
}
const cosine = dot / Math.sqrt(hostNorm * androidNorm);
const hostClean = top(hostEmbedding, clean);
const hostPrototype = top(hostEmbedding, prototype);
const hostMargin = hostPrototype[0].score - hostPrototype[1].score;
const hostAgreement = hostClean[0].oracleId === hostPrototype[0].oracleId;
const hostPublish = hostAgreement && hostMargin >= 0.05;
const androidClean = android.cleanTop ?? [];
const androidPrototype = android.prototypeTop ?? [];
const hostTop5 = new Set(hostPrototype.slice(0, 5).map(hit => hit.oracleId));
const androidTop5 = new Set(androidPrototype.slice(0, 5).map(hit => hit.oracleId));
const overlap = [...hostTop5].filter(id => androidTop5.has(id));

const report = {
  fixture: {
    id: fixture.VNEXT_PARITY_FIXTURE_ID,
    rgbaSha256: rgbaSha,
    width: fixture.VNEXT_PARITY_FIXTURE_WIDTH,
    height: fixture.VNEXT_PARITY_FIXTURE_HEIGHT,
    format: 'RGBA8888',
    ocrIncluded: false,
  },
  embedding: {
    cosineSimilarity: cosine,
    maxAbsoluteDelta: maxAbsDelta,
  },
  cleanTop1: {
    equal: hostClean[0].oracleId === androidClean[0]?.oracleId,
    host: hostClean[0],
    android: androidClean[0] ?? null,
  },
  prototypeTop1: {
    equal: hostPrototype[0].oracleId === androidPrototype[0]?.oracleId,
    host: hostPrototype[0],
    android: androidPrototype[0] ?? null,
  },
  top5: {
    overlapCount: overlap.length,
    overlapOracleIds: overlap,
    hostOracleIds: [...hostTop5],
    androidOracleIds: [...androidTop5],
  },
  margin: {
    host: hostMargin,
    android: android.prototypeMargin,
    absoluteDifference: Math.abs(hostMargin - android.prototypeMargin),
  },
  decision: {
    equal: hostPublish === android.publish,
    host: hostPublish ? 'VISUAL_AGREEMENT' : 'WITHHELD',
    android: android.decisionSource,
  },
};

console.log(JSON.stringify(report, null, 2));
console.log(
  '\nNo numeric pass threshold is imposed: the report exposes implementation drift; exact Top1/decision equality is shown separately.',
);
