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
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

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

const hostModelPath = join(
  rootDir,
  '.scan-fixtures/transformers-cache/Xenova/clip-vit-base-patch32/onnx/vision_model_quantized.onnx',
);
const hostModelSha256 = createHash('sha256').update(readFileSync(hostModelPath)).digest('hex');
const transformers = await import('@xenova/transformers');
const {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
} = transformers;
env.cacheDir = join(rootDir, '.scan-fixtures/transformers-cache');
env.allowLocalModels = false;
const processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
const vision = await CLIPVisionModelWithProjection.from_pretrained(
  'Xenova/clip-vit-base-patch32',
  { quantized: true },
);
const image = await RawImage.read(pngPath);
const inputs = await processor(image);
const hostTensor = Float32Array.from(inputs.pixel_values.data);
const hostOutput = await vision(inputs);
const hostRawOnnx = Float32Array.from(hostOutput.image_embeds.data);
const normalize = values => {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  return Float32Array.from(values, value => value / norm);
};
const hostRawEncoder = normalize(hostRawOnnx);
const hostEmbedding = adapt(hostRawEncoder);
const androidEmbedding = Float32Array.from(android.embedding);
const diagnostics = android.stageDiagnostics;
assert.ok(diagnostics, 'Android result does not contain stage diagnostics; install the diagnostic APK');

const decodeF32Le = encoded => {
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.length % 4, 0, 'Float32 artifact byte length must be divisible by four');
  const out = new Float32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return { bytes, values: out };
};
const floatBytesLe = values => {
  const bytes = Buffer.alloc(values.length * 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], true);
  return bytes;
};
const compareVectors = (host, phone) => {
  assert.equal(host.length, phone.length, 'stage vector dimensions differ');
  let dot = 0;
  let hostNorm = 0;
  let phoneNorm = 0;
  let maxAbsoluteDelta = 0;
  let absoluteDeltaSum = 0;
  for (let i = 0; i < host.length; i++) {
    dot += host[i] * phone[i];
    hostNorm += host[i] ** 2;
    phoneNorm += phone[i] ** 2;
    const delta = Math.abs(host[i] - phone[i]);
    maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
    absoluteDeltaSum += delta;
  }
  return {
    dimensions: host.length,
    exact: floatBytesLe(host).equals(floatBytesLe(phone)),
    cosineSimilarity: dot / Math.sqrt(hostNorm * phoneNorm),
    maxAbsoluteDelta,
    meanAbsoluteDelta: absoluteDeltaSum / host.length,
  };
};
const tensorStats = values => {
  const channelSize = values.length / 3;
  let min = Infinity;
  let max = -Infinity;
  const sums = [0, 0, 0];
  for (let i = 0; i < values.length; i++) {
    min = Math.min(min, values[i]);
    max = Math.max(max, values[i]);
    sums[Math.min(2, Math.floor(i / channelSize))] += values[i];
  }
  return {
    min,
    max,
    meanPerChannel: sums.map(sum => sum / channelSize),
    firstValues: Array.from(values.slice(0, 16)),
  };
};

const androidTensor = decodeF32Le(diagnostics.preprocessing.tensorF32LeBase64);
const androidRawOnnx = decodeF32Le(diagnostics.rawOnnxEmbeddingF32LeBase64);
const androidRawEncoder = decodeF32Le(diagnostics.rawEncoderEmbeddingF32LeBase64);
const androidAdapted = decodeF32Le(diagnostics.adaptedEmbeddingF32LeBase64);
const modelEqual = diagnostics.model.sha256 === hostModelSha256;
const preprocessingMetrics = compareVectors(hostTensor, androidTensor.values);
const rawOnnxMetrics = compareVectors(hostRawOnnx, androidRawOnnx.values);
const rawEncoderMetrics = compareVectors(hostRawEncoder, androidRawEncoder.values);
const adapterMetrics = compareVectors(hostEmbedding, androidAdapted.values);
assert.ok(
  compareVectors(androidEmbedding, androidAdapted.values).exact,
  'Android adapted binary and legacy JSON embedding differ',
);
const firstDivergence = !modelEqual
  ? 'A. MODEL FILE MISMATCH'
  : !preprocessingMetrics.exact
    ? 'B. PREPROCESSING MISMATCH'
    : !rawEncoderMetrics.exact
      ? 'C. ONNX RUNTIME / MODEL EXECUTION DRIFT'
      : !adapterMetrics.exact
        ? 'D. ADAPTER IMPLEMENTATION DRIFT'
        : 'E. SOMETHING ELSE';
const cosine = adapterMetrics.cosineSimilarity;
const maxAbsDelta = adapterMetrics.maxAbsoluteDelta;
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
  modelIdentity: {
    androidFilename: diagnostics.model.filename,
    androidSha256: diagnostics.model.sha256,
    hostFilename: basename(hostModelPath),
    hostSha256: hostModelSha256,
    equal: modelEqual,
  },
  fixture: {
    id: fixture.VNEXT_PARITY_FIXTURE_ID,
    rgbaSha256: rgbaSha,
    width: fixture.VNEXT_PARITY_FIXTURE_WIDTH,
    height: fixture.VNEXT_PARITY_FIXTURE_HEIGHT,
    format: 'RGBA8888',
    ocrIncluded: false,
  },
  preprocessing: {
    equal: preprocessingMetrics.exact,
    metrics: preprocessingMetrics,
    android: {
      shape: diagnostics.preprocessing.shape,
      layout: diagnostics.preprocessing.layout,
      channelOrder: diagnostics.preprocessing.channelOrder,
      resized: [
        diagnostics.preprocessing.resizedWidth,
        diagnostics.preprocessing.resizedHeight,
      ],
      crop: [diagnostics.preprocessing.cropLeft, diagnostics.preprocessing.cropTop, 224, 224],
      interpolation: diagnostics.preprocessing.interpolation,
      rescale: diagnostics.preprocessing.rescale,
      mean: diagnostics.preprocessing.mean,
      std: diagnostics.preprocessing.std,
      stats: diagnostics.preprocessing.stats,
      tensorSha256: diagnostics.preprocessing.tensorSha256,
    },
    host: {
      shape: inputs.pixel_values.dims,
      layout: 'NCHW',
      channelOrder: 'RGB',
      resized: [321, 224],
      crop: [48, 0, 224, 224],
      interpolation: 'Transformers.js CLIP processor resample=3 (bicubic)',
      rescale: 'value * 1/255',
      mean: [0.48145466, 0.4578275, 0.40821073],
      std: [0.26862954, 0.26130258, 0.27577711],
      stats: tensorStats(hostTensor),
      tensorSha256: createHash('sha256').update(floatBytesLe(hostTensor)).digest('hex'),
    },
  },
  rawOnnx: rawOnnxMetrics,
  rawEncoder: rawEncoderMetrics,
  adapter: adapterMetrics,
  firstDivergence,
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
