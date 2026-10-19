/**
 * Score color inbox JPEGs with the frozen host stack.
 * Same-FOV outline, upright warp, art crop +3%, quantized CLIP, linear adapter,
 * clean/prototype agreement at 0.05. No OCR recovery. Does not train.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

import { scaleCanonicalArt } from '../embedding/art-margin.mjs';
import { detectFrameRegions } from '../../geometry/lib/frame-regions/detect.mjs';
import { loadEncoder } from '../../recognition/encoders.mjs';
import { rootDir } from '../lib/paths.mjs';

const exec = promisify(execFile);
const session = join(rootDir, '.scan-inbox/sessions');
const galleryDir = join(rootDir, '.scan-fixtures/vnext-galleries');
const DIMS = 512;
const MARGIN = 0.05;

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-score-'));
const bundle = join(bundleDir, 'scan.mjs');
await esbuild.build({
  alias: { '@': join(rootDir, 'src') },
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export { warpQuadToCard, cornersToQuad } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
      export { extractArtCropFromCard } from '${join(rootDir, 'src/lib/scan/regions.ts')}';
    `,
    resolveDir: rootDir,
    sourcefile: 'score-entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

const readF32 = path => {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

const refs = JSON.parse(readFileSync(join(galleryDir, 'refs.json'), 'utf8'));
const clean = readF32(join(galleryDir, 'clean.f32'));
const prototype = readF32(join(galleryDir, 'prototype.f32'));
const adapterW = readF32(join(galleryDir, 'adapter-w.f32'));
const adapterB = readF32(join(galleryDir, 'adapter-b.f32'));

const applyLinear = query => {
  const out = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    const xi = query[i];
    if (xi === 0) continue;
    const row = i * DIMS;
    for (let j = 0; j < DIMS; j++) out[j] += xi * adapterW[row + j];
  }
  for (let j = 0; j < DIMS; j++) out[j] += adapterB[j];
  let sum = 0;
  for (const value of out) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  for (let j = 0; j < DIMS; j++) out[j] /= norm;
  return out;
};

const dualTop = (query, gallery) => {
  const best = new Map();
  const count = refs.oracleIds.length;
  for (let i = 0; i < count; i++) {
    let score = 0;
    const off = i * DIMS;
    for (let d = 0; d < DIMS; d++) score += query[d] * gallery[off + d];
    const id = refs.oracleIds[i];
    const prev = best.get(id);
    if (!prev || score > prev.score) best.set(id, { oracleId: id, name: refs.names[i], score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5);
};

const artCrop = card => {
  const detected = detectFrameRegions(card);
  const art = detected.regions?.artBox ?? null;
  if (art?.quad) {
    const padded = scaleCanonicalArt(art.quad, 0.03, card.width, card.height);
    const quad = ['tl', 'tr', 'br', 'bl'].map(key => ({ x: padded[key][0], y: padded[key][1] }));
    return scan.warpQuadToCard(card, quad, 625, 436);
  }
  return scan.extractArtCropFromCard(card).crop;
};

const pngBytes = image => {
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  return PNG.sync.write(png);
};

const { runtime } = await loadEncoder('CLIP_VIT_B32');
for (const id of ['001', '002', '003', '004', '005', '006', '007']) {
  const dir = join(session, `normal-scan-session-20261009-143056--card-${id}`);
  const quad = JSON.parse(await readFile(join(dir, 'recognition-quad/recognition-quad.json'), 'utf8'));
  const pngPath = join(bundleDir, `${id}.png`);
  await exec('sips', ['-s', 'format', 'png', join(dir, 'source/source.jpg'), '--out', pngPath]);
  const png = PNG.sync.read(await readFile(pngPath));
  const source = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  const detector = quad.detector;
  const map = point => ({
    x: (point.x / detector.width) * source.width,
    y: (point.y / detector.height) * source.height,
  });
  const corners = quad.corners;
  const warped = scan.warpQuadToCard(source, scan.cornersToQuad({
    topLeft: map(corners.topLeft),
    topRight: map(corners.topRight),
    bottomRight: map(corners.bottomRight),
    bottomLeft: map(corners.bottomLeft),
  }));
  const crop = artCrop(warped);
  const cropPath = join(bundleDir, `${id}-art.png`);
  await writeFile(cropPath, pngBytes(crop));
  const embedding = applyLinear(await runtime.embedPath(cropPath));
  const cleanTop = dualTop(embedding, clean);
  const prototypeTop = dualTop(embedding, prototype);
  const margin = prototypeTop[1] ? prototypeTop[0].score - prototypeTop[1].score : null;
  const agree =
    Boolean(cleanTop[0]?.oracleId) &&
    cleanTop[0].oracleId === prototypeTop[0]?.oracleId &&
    margin != null &&
    margin >= MARGIN;
  console.log(JSON.stringify({
    card: id,
    publish: agree,
    name: agree ? prototypeTop[0].name : null,
    closest: prototypeTop[0]?.name ?? null,
    margin: margin == null ? null : Number(margin.toFixed(4)),
    clean: cleanTop[0]?.name ?? null,
  }));
}
