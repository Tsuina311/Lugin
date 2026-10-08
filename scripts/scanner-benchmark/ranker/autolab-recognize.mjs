#!/usr/bin/env node
/**
 * Frozen recognition check for one already-frozen geometry challenger.
 * Does not train. Holdout requires --final-holdout and a recorded dev recognition.
 *
 *   node scripts/scanner-benchmark/ranker/autolab-recognize.mjs --dev --challenger=<id>
 *   node scripts/scanner-benchmark/ranker/autolab-recognize.mjs --final-holdout --challenger=<id>
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

import { loadEncoder } from '../../recognition/encoders.mjs';
import { identityMatches } from '../../recognition/scoring.mjs';
import { rootDir } from '../lib/paths.mjs';
import { quadInImageSpace } from '../../geometry/lib/source-space.mjs';
import { detectFrameRegions } from '../../geometry/lib/frame-regions/detect.mjs';
import { scaleCanonicalArt } from '../embedding/art-margin.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';
import { PUBLISH_MARGIN, sameIdentity } from '../identity/agreement.mjs';
import { applyArtifact, loadChallenger, prepare } from './autolab.mjs';

const DIMS = 512;
const ART_W = 625;
const ART_H = 436;
const labDir = join(rootDir, 'scanner-benchmark/ranker-registry/autolab');
const currentPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');
const challengerId = process.argv.find(arg => arg.startsWith('--challenger='))?.slice('--challenger='.length);
const finalHoldout = process.argv.includes('--final-holdout');
const log = message => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

if (!challengerId) throw new Error('pass --challenger=<id>');
if (finalHoldout && process.argv.includes('--dev')) throw new Error('one split per run');

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const asPoints = quad => ['tl', 'tr', 'br', 'bl'].map(key => ({ x: quad[key][0], y: quad[key][1] }));
const fromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-autolab-rec-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { warpQuadToCard } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export { extractArtCropFromCard } from '${join(rootDir, 'src/lib/scan/regions.ts')}';
        export { scanImageToPngBytes } from '${join(rootDir, 'mobile/src/scan/debug/scanImagePng.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'autolab-rec-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const artCrop = (scan, warp) => {
  const detected = detectFrameRegions(warp);
  const art = detected.regions?.artBox ?? null;
  if (art?.quad) {
    const padded = scaleCanonicalArt(art.quad, 0.03, warp.width, warp.height);
    const inside = ['tl', 'tr', 'br', 'bl'].every(key => padded[key][0] >= -2 && padded[key][1] >= -2 && padded[key][0] <= warp.width + 1 && padded[key][1] <= warp.height + 1);
    if (inside) return scan.warpQuadToCard(warp, asPoints(padded), ART_W, ART_H);
  }
  return scan.extractArtCropFromCard(warp).crop;
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
  let top = null;
  let second = null;
  let better = 0;
  let expectedHit = null;
  for (const hit of best.values()) {
    if (!top || hit.score > top.score) { second = top; top = hit; }
    else if (!second || hit.score > second.score) second = hit;
    if (identityMatches(expected, hit)) expectedHit = !expectedHit || hit.score > expectedHit.score ? hit : expectedHit;
  }
  if (expectedHit) for (const hit of best.values()) if (hit.score > expectedHit.score) better += 1;
  return {
    top1Name: top?.name ?? null,
    top1OracleId: top?.oracleId ?? null,
    margin: top && second ? top.score - second.score : null,
    rank: expectedHit ? better + 1 : null,
    correct: better === 0 && Boolean(expectedHit),
  };
};

const artifact = loadChallenger(challengerId);
if (finalHoldout && !artifact.devRecognition) throw new Error('refusing holdout recognition before dev recognition is recorded');
if (artifact.devStatus === 'rejected-geometry' && !finalHoldout) throw new Error('this challenger was rejected on dev geometry');
const pool = prepare();
const splitFrames = finalHoldout ? pool.holdout : pool.dev;
const crops = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity/crops.json'), 'utf8'));
const cropById = new Map(crops.map(row => [row.frameId, row]));
const geometryRows = readFileSync(join(rootDir, 'scanner-benchmark/reports/frozen-recognition-v1/geometry.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const geometryById = new Map(geometryRows.map(row => [row.frameId, row]));

log('loading scan, CLIP, galleries');
const scan = await loadScan();
const encoder = (await loadEncoder('CLIP_VIT_B32')).runtime;
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const adapter = loadModel(JSON.parse(readFileSync(currentPath, 'utf8')));
const views = ['blur', 'motion', 'perspective'].map(id => floatsFrom(join(viewDir, `${id}.bin`)));
const adapted = [raw, ...views].map(view => applyGallery(adapter, view, refs.length, DIMS));
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

const embedPath = async path => {
  const emb = path.replace(/\.png$/, '.f32');
  if (existsSync(emb) && readFileSync(emb).byteLength === DIMS * 4) return floatsFrom(emb);
  const vector = Float32Array.from(await encoder.embedPath(path));
  await writeFile(emb, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  return vector;
};

const scoreVector = (vector, frame) => {
  const query = forward(adapter, vector).y;
  const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
  const clean = rankQuery(adapted[0], refs, query, expected);
  const proto = rankQuery(prototype, refs, query, expected);
  const publish = proto.margin >= PUBLISH_MARGIN && sameIdentity({ oracleId: clean.top1OracleId }, { oracleId: proto.top1OracleId });
  return { cleanTop1: clean.correct, prototypeTop1: proto.correct, publish, correctPublish: publish && proto.correct, wrongPublish: publish && !proto.correct, cleanName: clean.top1Name, protoName: proto.top1Name, margin: proto.margin };
};

const summarize = rows => ({
  n: rows.length,
  cleanTop1: rows.filter(row => row.cleanTop1).length,
  prototypeTop1: rows.filter(row => row.prototypeTop1).length,
  correctPublished: rows.filter(row => row.correctPublish).length,
  wrongPublished: rows.filter(row => row.wrongPublish).length,
  withheldCorrect: rows.filter(row => row.prototypeTop1 && !row.publish).length,
});

const cache = new Map();
const quadForIndex = (decoded, det, index) => {
  const candidate = det.debug?.candidates?.[index];
  if (!candidate?.corners || candidate.rejectedBecause?.length) return null;
  return fromCorners(candidate.corners);
};

const rows = [];
for (const frame of splitFrames) {
  const identity = cropById.get(frame.id);
  const geometry = geometryById.get(frame.id);
  if (!identity?.oraclePath) continue;
  const selected = applyArtifact(frame, artifact);
  const systems = {
    current: { index: frame.current?.index ?? null, path: identity.productionPath },
    learned: { index: frame.learned?.index ?? null, path: geometry?.paths?.learned || identity.productionPath },
    challenger: { index: selected?.index ?? null, path: null },
  };
  if (systems.challenger.index === systems.current.index) systems.challenger.path = identity.productionPath;
  else if (systems.challenger.index === systems.learned.index) systems.challenger.path = systems.learned.path;
  else if (selected) {
    const abs = join(rootDir, identity.image);
    let decoded = cache.get(abs);
    if (!decoded) {
      const png = PNG.sync.read(readFileSync(abs));
      decoded = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
      decoded.det = scan.detectCardQuad(decoded);
      cache.set(abs, decoded);
    }
    const quad = quadForIndex(decoded, decoded.det, selected.index);
    if (!quad) {
      systems.challenger.path = identity.productionPath;
    } else {
      const dir = join(labDir, 'crops', createHash('sha256').update(`${frame.id}:${selected.index}`).digest('hex').slice(0, 16));
      mkdirSync(dir, { recursive: true });
      const warp = scan.warpQuadToCard(decoded, asPoints(quad));
      const crop = artCrop(scan, warp);
      const path = join(dir, 'crop.png');
      if (!existsSync(path)) await writeFile(path, Buffer.from(scan.scanImageToPngBytes(crop)));
      systems.challenger.path = path;
    }
  }
  const scored = {};
  for (const [name, system] of Object.entries(systems)) {
    if (!system.path || !existsSync(system.path)) continue;
    scored[name] = await scoreVector(await embedPath(system.path), identity);
  }
  rows.push({ id: frame.id, cardName: identity.cardName, ...scored });
  log(`${identity.cardName} ${scored.challenger?.protoName ?? '—'} ${scored.challenger?.publish ? 'pub' : 'hold'}`);
}

const report = {
  challengerId,
  split: finalHoldout ? 'holdout' : 'dev',
  current: summarize(rows.map(row => row.current).filter(Boolean)),
  learned: summarize(rows.map(row => row.learned).filter(Boolean)),
  challenger: summarize(rows.map(row => row.challenger).filter(Boolean)),
  frames: rows,
};
const currentWrong = report.current.wrongPublished;
const learnedWrong = report.learned.wrongPublished;
const challengerWrong = report.challenger.wrongPublished;
report.wrongPublicationsIncreased = challengerWrong > currentWrong || challengerWrong > learnedWrong;
artifact[finalHoldout ? 'holdoutRecognition' : 'devRecognition'] = report;
if (!finalHoldout && report.wrongPublicationsIncreased) artifact.devStatus = 'rejected-recognition';
await writeFile(join(labDir, 'challengers', `${artifact.id}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
await writeFile(join(labDir, `${report.split}-recognition-${artifact.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
log(JSON.stringify({ current: report.current, learned: report.learned, challenger: report.challenger, rejected: report.wrongPublicationsIncreased }));
