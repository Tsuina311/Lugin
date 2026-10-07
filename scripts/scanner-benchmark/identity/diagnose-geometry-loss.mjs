#!/usr/bin/env node
/**
 * Diagnosis only. Two holdout frames that lost a safe publish on the detector crop.
 * Does not retrain, and does not change the detector, the art margin, or 0.05.
 *
 * A card quad is bad when its IoU with the human quad is below 0.80, its area
 * is outside 0.75–1.25 of the human quad, or more than 20% of its area lies
 * outside the human card. An art box is bad when the detector warp emits none,
 * or the mean corner gap versus the human-warp art box exceeds 40 px on the
 * 744×1039 card.
 *
 * Counterfactuals use the same +3% art pad. C applies the detector art quad to
 * the human warp. D applies the human art quad to the detector warp.
 * ART_BOX_FAILURE when D restores a publish and C does not.
 * CARD_QUAD_FAILURE when C restores a publish and D does not.
 * BOTH when the card is bad and neither swap restores the publish.
 * RECOGNITION_SENSITIVITY when the card and art box are acceptable and the
 * correct card stays Top1 while the margin falls below 0.05.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { loadEncoder } from '../../recognition/encoders.mjs';
import { identityMatches } from '../../recognition/scoring.mjs';
import { rootDir, reportsDir } from '../lib/paths.mjs';
import { quadInImageSpace } from '../../geometry/lib/source-space.mjs';
import { detectFrameRegions } from '../../geometry/lib/frame-regions/detect.mjs';
import { quadArea, quadCoverage, quadIoU } from '../../geometry/lib/frame-regions/report.mjs';
import { scaleCanonicalArt } from '../embedding/art-margin.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';

const DIMS = 512;
const ART_W = 625;
const ART_H = 436;
const MARGIN = 0.05;
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const currentPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');
const outDir = join(reportsDir, 'identity-geometry-loss-v1');

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};
const asQuad = quad => [
  { x: quad.tl[0], y: quad.tl[1] },
  { x: quad.tr[0], y: quad.tr[1] },
  { x: quad.br[0], y: quad.br[1] },
  { x: quad.bl[0], y: quad.bl[1] },
];
const namedFromQuad = quad => ({
  tl: [quad[0].x, quad[0].y],
  tr: [quad[1].x, quad[1].y],
  br: [quad[2].x, quad[2].y],
  bl: [quad[3].x, quad[3].y],
});
const meanCorner = (a, b) => {
  const keys = ['tl', 'tr', 'br', 'bl'];
  const gaps = keys.map(key => Math.hypot(a[key][0] - b[key][0], a[key][1] - b[key][1]));
  return gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
};
const inside = (quad, width, height) => ['tl', 'tr', 'br', 'bl'].every(key => {
  const [x, y] = quad[key];
  return x >= -2 && y >= -2 && x <= width + 1 && y <= height + 1;
});

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-geom-loss-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { warpQuadToCard, cornersToQuad } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export { extractArtCropFromCard } from '${join(rootDir, 'src/lib/scan/regions.ts')}';
        export { scanImageToPngBytes } from '${join(rootDir, 'mobile/src/scan/debug/scanImagePng.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'geometry-loss-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const artOnWarp = (scan, warp) => {
  const detected = detectFrameRegions(warp);
  const art = detected.regions?.artBox ?? null;
  const edges = Object.fromEntries((detected.debug?.boundaries ?? []).map(row => [row.id, {
    detected: row.detected,
    confidence: row.confidence == null ? null : Number(row.confidence.toFixed(3)),
    reason: row.reason ?? null,
  }]));
  if (!art?.quad) return { emitted: false, confidence: null, edges, quad: null, padded: null, anchor: 'canonical-window' };
  const padded = scaleCanonicalArt(art.quad, 0.03, warp.width, warp.height);
  return {
    emitted: true,
    confidence: art.confidence == null ? null : Number(art.confidence.toFixed(3)),
    edges,
    quad: art.quad,
    padded,
    anchor: 'frame-art+3',
    bounds: boundsOf(padded, warp.width, warp.height),
  };
};

const boundsOf = (quad, width, height) => {
  const xs = ['tl', 'tr', 'br', 'bl'].map(key => quad[key][0]);
  const ys = ['tl', 'tr', 'br', 'bl'].map(key => quad[key][1]);
  const top = Math.min(...ys) / height;
  const bottom = Math.max(...ys) / height;
  const left = Math.min(...xs) / width;
  const right = Math.max(...xs) / width;
  return {
    top: Number(top.toFixed(3)),
    bottom: Number(bottom.toFixed(3)),
    left: Number(left.toFixed(3)),
    right: Number(right.toFixed(3)),
    reachesTypeLine: bottom > 0.58,
    reachesRulesText: bottom > 0.70,
    reachesOuterBorder: top < 0.02 || left < 0.01 || right > 0.99,
  };
};

const cropArt = (scan, warp, art) => {
  if (art.padded && inside(art.padded, warp.width, warp.height)) {
    return { crop: scan.warpQuadToCard(warp, asQuad(art.padded), ART_W, ART_H), anchor: art.anchor, valid: true };
  }
  if (!art.emitted) {
    return { crop: scan.extractArtCropFromCard(warp).crop, anchor: 'canonical-window', valid: false };
  }
  return { crop: null, anchor: art.anchor, valid: false };
};

const rankQuery = (embeddings, refs, query, expected) => {
  const best = new Map();
  for (let i = 0; i < refs.length; i++) {
    let score = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) score += query[d] * embeddings[offset + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || score > prev.score) best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const rankIdx = ranked.findIndex(hit => identityMatches(expected, hit));
  const top = ranked[0];
  const second = ranked[1];
  return {
    top1Name: top?.name ?? null,
    top2Name: second?.name ?? null,
    margin: top && second ? Number((top.score - second.score).toFixed(4)) : null,
    prototypeCorrect: rankIdx === 0,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
  };
};

const readImage = path => {
  const buf = readFileSync(path);
  if (path.endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
};
const fit = (image, width, height) => {
  const out = new Uint8Array(width * height * 4);
  out.fill(16);
  const scale = Math.min(width / image.width, height / image.height);
  const dw = Math.max(1, Math.round(image.width * scale));
  const dh = Math.max(1, Math.round(image.height * scale));
  const ox = Math.floor((width - dw) / 2);
  const oy = Math.floor((height - dh) / 2);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y / dh) * image.height));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x / dw) * image.width));
      const src = (sy * image.width + sx) * 4;
      const dst = ((oy + y) * width + (ox + x)) * 4;
      out[dst] = image.data[src];
      out[dst + 1] = image.data[src + 1];
      out[dst + 2] = image.data[src + 2];
      out[dst + 3] = 255;
    }
  }
  return out;
};
const writeStrip = async (file, paths) => {
  const width = 180;
  const height = 250;
  const png = new PNG({ width: width * paths.length, height });
  paths.forEach((path, index) => {
    const pixels = path && existsSync(path) ? fit(readImage(path), width, height) : fit({ width: 8, height: 8, data: new Uint8Array(64).fill(32) }, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = (y * width + x) * 4;
        const dst = (y * png.width + index * width + x) * 4;
        png.data[dst] = pixels[src];
        png.data[dst + 1] = pixels[src + 1];
        png.data[dst + 2] = pixels[src + 2];
        png.data[dst + 3] = 255;
      }
    }
  });
  await writeFile(file, PNG.sync.write(png));
};

const classify = row => {
  const cardBad = row.cardIou < 0.8 || row.areaRatio > 1.25 || row.areaRatio < 0.75 || row.detectorOutside > 0.2;
  const artBad = !row.detectorArtEmitted || (row.artMeanCorner != null && row.artMeanCorner > 40);
  const restores = hit => Boolean(hit && hit.prototypeCorrect && hit.margin >= MARGIN);
  const aOk = restores(row.recognition.A);
  const bOk = restores(row.recognition.B);
  const cOk = restores(row.recognition.C);
  const dOk = restores(row.recognition.D);
  if (!cardBad && !artBad && row.recognition.A.prototypeCorrect && row.recognition.B.prototypeCorrect && aOk && !bOk) {
    return 'RECOGNITION_SENSITIVITY';
  }
  if (!bOk && dOk && !cOk) return 'ART_BOX_FAILURE';
  if (!bOk && cOk && !dOk) return 'CARD_QUAD_FAILURE';
  if (cardBad && !dOk) return 'CARD_QUAD_FAILURE';
  if (cardBad && artBad) return 'BOTH';
  if (cardBad) return 'CARD_QUAD_FAILURE';
  if (artBad) return 'ART_BOX_FAILURE';
  if (aOk && row.recognition.B.prototypeCorrect && !bOk) return 'RECOGNITION_SENSITIVITY';
  return 'RECOGNITION_SENSITIVITY';
};

const finalVerdict = classes => {
  const kinds = new Set(classes);
  if (kinds.size === 1 && kinds.has('RECOGNITION_SENSITIVITY')) return 'NO_GEOMETRY_ACTION_NEEDED';
  if ([...kinds].every(kind => kind === 'CARD_QUAD_FAILURE' || kind === 'RECOGNITION_SENSITIVITY') && kinds.has('CARD_QUAD_FAILURE')) return 'OUTER_GEOMETRY_NEXT';
  if ([...kinds].every(kind => kind === 'ART_BOX_FAILURE' || kind === 'RECOGNITION_SENSITIVITY') && kinds.has('ART_BOX_FAILURE')) return 'ART_CROP_NEXT';
  return 'MIXED_GEOMETRY';
};

const crops = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8'));
const moonsnare = crops.find(frame => frame.label === 'geometry-test-20261006-150559 geom-009');
const swords = crops.filter(frame => frame.split === 'holdout' && frame.cardName === 'Sword of the Animist');
const scan = await loadScan();
log('loading CLIP and galleries');
const encoder = (await loadEncoder('CLIP_VIT_B32')).runtime;
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const model = loadModel(JSON.parse(readFileSync(currentPath, 'utf8')));
const views = ['blur', 'motion', 'perspective'].map(id => floatsFrom(join(viewDir, `${id}.bin`)));
const adapted = [raw, ...views].map(view => applyGallery(model, view, refs.length, DIMS));
const prototype = new Float32Array(adapted[0].length);
for (const view of adapted) for (let i = 0; i < prototype.length; i++) prototype[i] += view[i];
{
  const count = prototype.length / DIMS;
  for (let i = 0; i < count; i++) {
    const offset = i * DIMS;
    let sum = 0;
    for (let d = 0; d < DIMS; d++) {
      prototype[offset + d] /= adapted.length;
      sum += prototype[offset + d] * prototype[offset + d];
    }
    const n = Math.sqrt(sum) || 1;
    for (let d = 0; d < DIMS; d++) prototype[offset + d] /= n;
  }
}
const scorePath = async (frame, imagePath) => {
  const embPath = imagePath.replace(/\.png$/, '.f32');
  const vector = existsSync(embPath) && readFileSync(embPath).byteLength === DIMS * 4
    ? floatsFrom(embPath)
    : Float32Array.from(await encoder.embedPath(imagePath));
  if (!existsSync(embPath)) await writeFile(embPath, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  const query = forward(model, vector).y;
  const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
  return {
    clean: rankQuery(adapted[0], refs, query, expected),
    prototype: rankQuery(prototype, refs, query, expected),
  };
};

const swordScores = [];
for (const frame of swords) {
  const scored = await scorePath(frame, frame.oraclePath);
  swordScores.push({ frame, margin: scored.prototype.margin });
}
const sword = swordScores.sort((a, b) => Math.abs(a.margin - 0.072) - Math.abs(b.margin - 0.072))[0].frame;
log(`sword ${sword.frameId} oracle margin ${swordScores.find(row => row.frame === sword).margin}`);

const targets = [
  { id: 'moonsnare-geom-009', frame: moonsnare },
  { id: 'sword-of-the-animist', frame: sword },
];

const rows = [];
for (const target of targets) {
  const frame = target.frame;
  const fixture = JSON.parse(readFileSync(join(rootDir, '.geometry-corpus/fixtures', `${frame.frameId}.json`), 'utf8'));
  const metaRel = fixture.provenance?.metadataPaths?.[0];
  const metadata = metaRel && existsSync(join(rootDir, metaRel)) ? JSON.parse(readFileSync(join(rootDir, metaRel), 'utf8')) : null;
  const png = PNG.sync.read(readFileSync(join(rootDir, frame.image)));
  const source = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  const card = fixture.cards.find(row => row.groundTruthQuad?.tl);
  const human = quadInImageSpace({
    quad: card.groundTruthQuad,
    imageWidth: png.width,
    imageHeight: png.height,
    captureWidth: metadata?.photo?.decodedWidth ?? null,
    captureHeight: metadata?.photo?.decodedHeight ?? null,
    label: frame.frameId,
  }).quad;
  const det = scan.detectCardQuad(source);
  const detectorCorners = scan.cornersToQuad(det.corners);
  const detector = namedFromQuad(detectorCorners);
  const humanCorners = asQuad(human);
  const cardIou = quadIoU(human, detector);
  const humanArea = quadArea(human);
  const detectorArea = quadArea(detector);
  const diagonal = Math.hypot(png.width, png.height);
  const humanWarp = scan.warpQuadToCard(source, humanCorners);
  const detectorWarp = scan.warpQuadToCard(source, detectorCorners);
  const humanArt = artOnWarp(scan, humanWarp);
  const detectorArt = artOnWarp(scan, detectorWarp);
  const dir = join(outDir, target.id);
  mkdirSync(dir, { recursive: true });
  await writeFile(join(dir, 'human-warp.png'), Buffer.from(scan.scanImageToPngBytes(humanWarp)));
  await writeFile(join(dir, 'detector-warp.png'), Buffer.from(scan.scanImageToPngBytes(detectorWarp)));
  const A = cropArt(scan, humanWarp, humanArt);
  const B = cropArt(scan, detectorWarp, detectorArt);
  const mappedC = detectorArt.padded && inside(detectorArt.padded, humanWarp.width, humanWarp.height)
    ? { crop: scan.warpQuadToCard(humanWarp, asQuad(detectorArt.padded), ART_W, ART_H), anchor: 'detector-art-on-human-warp', valid: true }
    : { crop: null, anchor: 'detector-art-on-human-warp', valid: false };
  const mappedD = humanArt.padded && inside(humanArt.padded, detectorWarp.width, detectorWarp.height)
    ? { crop: scan.warpQuadToCard(detectorWarp, asQuad(humanArt.padded), ART_W, ART_H), anchor: 'human-art-on-detector-warp', valid: true }
    : { crop: null, anchor: 'human-art-on-detector-warp', valid: false };
  const saved = { A: frame.oraclePath, B: frame.productionPath, C: join(dir, 'C.png'), D: join(dir, 'D.png') };
  await writeFile(join(dir, 'A.png'), Buffer.from(scan.scanImageToPngBytes(A.crop)));
  await writeFile(join(dir, 'B.png'), Buffer.from(scan.scanImageToPngBytes(B.crop)));
  if (mappedC.crop) await writeFile(saved.C, Buffer.from(scan.scanImageToPngBytes(mappedC.crop)));
  if (mappedD.crop) await writeFile(saved.D, Buffer.from(scan.scanImageToPngBytes(mappedD.crop)));
  const recognition = {};
  for (const key of ['A', 'B', 'C', 'D']) {
    const crop = key === 'A' ? A : key === 'B' ? B : key === 'C' ? mappedC : mappedD;
    if (!crop.valid && key !== 'B' && key !== 'A') {
      recognition[key] = null;
      continue;
    }
    if (!saved[key] || !existsSync(saved[key])) {
      recognition[key] = null;
      continue;
    }
    const scored = await scorePath(frame, saved[key]);
    recognition[key] = { anchor: crop.anchor, valid: crop.valid !== false, ...scored.prototype, cleanTop1: scored.clean.top1Name };
    log(`${target.id} ${key} ${recognition[key].top1Name} margin ${recognition[key].margin}`);
  }
  const artMeanCorner = humanArt.padded && detectorArt.padded ? meanCorner(humanArt.padded, detectorArt.padded) : null;
  const row = {
    id: target.id,
    cardName: frame.cardName,
    label: frame.label,
    frameId: frame.frameId,
    cardIou: Number(cardIou.toFixed(3)),
    meanCornerPx: Number(meanCorner(human, detector).toFixed(1)),
    meanCornerOverDiagonal: Number((meanCorner(human, detector) / diagonal).toFixed(4)),
    cornersClose: meanCorner(human, detector) / diagonal < 0.02,
    humanInsideDetector: Number(quadCoverage(human, detector).toFixed(3)),
    areaRatio: Number((detectorArea / humanArea).toFixed(3)),
    detectorOutside: Number((1 - quadCoverage(detector, human)).toFixed(3)),
    detectorArtEmitted: detectorArt.emitted,
    detectorArtConfidence: detectorArt.confidence,
    humanArtEmitted: humanArt.emitted,
    humanArtConfidence: humanArt.confidence,
    detectorEdges: detectorArt.edges,
    humanEdges: humanArt.edges,
    artMeanCorner: artMeanCorner == null ? null : Number(artMeanCorner.toFixed(1)),
    humanArtBounds: humanArt.bounds ?? null,
    detectorArtBounds: detectorArt.bounds ?? boundsOf(
      { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] },
      1,
      1,
    ),
    detectorAnchor: frame.productionAnchor,
    humanAnchor: frame.oracleAnchor,
    recognition,
  };
  row.class = classify(row);
  row.strip = `identity-geometry-loss-v1/${target.id}.png`;
  await writeStrip(join(outDir, `${target.id}.png`), [
    join(dir, 'human-warp.png'),
    join(dir, 'detector-warp.png'),
    join(dir, 'A.png'),
    join(dir, 'B.png'),
    mappedC.valid ? saved.C : null,
    mappedD.valid ? saved.D : null,
  ]);
  rows.push(row);
  log(`${target.id} ${row.class} iou ${row.cardIou} art ${row.detectorArtEmitted}`);
}

const verdict = finalVerdict(rows.map(row => row.class));
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify({ verdict, rows }, null, 2)}\n`);
console.log(verdict);
for (const row of rows) console.log(row.id, row.class, 'iou', row.cardIou, 'outside', row.detectorOutside, 'art', row.detectorArtEmitted, row.artMeanCorner);
