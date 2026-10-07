#!/usr/bin/env node
/**
 * Phone-card identity recognition.
 * Human card geometry is allowed here so the score is about recognition.
 * The production-like track keeps the current detector crop separate.
 * CLIP stays frozen. Nothing is deployed.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir, reportsDir } from '../lib/paths.mjs';
import { quadInImageSpace } from '../../geometry/lib/source-space.mjs';
import { detectFrameRegions } from '../../geometry/lib/frame-regions/detect.mjs';
import { scaleCanonicalArt } from '../embedding/art-margin.mjs';
import { loadEncoder } from '../../recognition/encoders.mjs';
import { identityMatches } from '../../recognition/scoring.mjs';
import {
  adamState,
  adamStep,
  applyGallery,
  cloneModel,
  createModel,
  forward,
  backward,
  infonce,
  loadModel,
  mulberry32,
  saveModel,
  zeroLike,
} from '../embedding/math.mjs';
import { B1_ADAPTER_PATH, B1_GALLERY_DIR, RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';
import { buildLabels } from './labels.mjs';
import { failureClass, recommend } from './criteria.mjs';

const DIMS = 512;
const TAU = 0.07;
const HARD_K = 8;
const HOLDOUT_COUNT = 18;
const DEV_COUNT = 12;
const ART_W = 625;
const ART_H = 436;
const BASIC = new Set(['Island', 'Mountain', 'Plains', 'Swamp', 'Forest', 'Wastes']);
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const cropDir = join(dataDir, 'crops');
const log = message => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = async (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};
const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const hash32 = value => createHash('sha256').update(value).digest().readUInt32BE(0);

const asQuad = quad => [
  { x: quad.tl[0], y: quad.tl[1] },
  { x: quad.tr[0], y: quad.tr[1] },
  { x: quad.br[0], y: quad.br[1] },
  { x: quad.bl[0], y: quad.bl[1] },
];

const loadMetadata = fixture => {
  const rel = fixture.provenance?.metadataPaths?.[0];
  if (!rel) return null;
  const path = join(rootDir, rel);
  if (!existsSync(path)) return null;
  return readJson(path);
};

const assignSplits = known => {
  const path = join(dataDir, 'splits.json');
  const identities = [...new Set(known.map(frame => frame.oracleId))].sort();
  if (existsSync(path)) {
    const saved = readJson(path);
    const holdout = new Set(saved.holdout);
    const dev = new Set(saved.dev);
    const train = new Set(saved.train);
    for (const id of identities) {
      if (holdout.has(id) || dev.has(id) || train.has(id)) continue;
      train.add(id);
    }
    return { ...saved, holdout: [...holdout], dev: [...dev], train: [...train].sort() };
  }
  const ordered = identities
    .map(id => ({ id, hash: hash32(`identity-v1:${id}`) }))
    .sort((a, b) => a.hash - b.hash || a.id.localeCompare(b.id));
  const holdout = ordered.slice(0, HOLDOUT_COUNT).map(row => row.id);
  const dev = ordered.slice(HOLDOUT_COUNT, HOLDOUT_COUNT + DEV_COUNT).map(row => row.id);
  const train = ordered.slice(HOLDOUT_COUNT + DEV_COUNT).map(row => row.id);
  return {
    version: 'identity-v1',
    seed: 'identity-v1',
    holdoutCount: HOLDOUT_COUNT,
    devCount: DEV_COUNT,
    holdout,
    dev,
    train,
    note: 'New identities join train only. Holdout and dev are not reshuffled.',
  };
};

const splitOf = (splits, oracleId) => {
  if (splits.holdout.includes(oracleId)) return 'holdout';
  if (splits.dev.includes(oracleId)) return 'dev';
  if (splits.train.includes(oracleId)) return 'train';
  return 'train';
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-identity-'));
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
      sourcefile: 'identity-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const artCropFromCard = (scan, card) => {
  const detected = detectFrameRegions(card);
  const art = detected.regions?.artBox ?? null;
  if (art?.quad) {
    const padded = scaleCanonicalArt(art.quad, 0.03, card.width, card.height);
    return { crop: scan.warpQuadToCard(card, asQuad(padded), ART_W, ART_H), anchor: 'frame-art+3' };
  }
  return { crop: scan.extractArtCropFromCard(card).crop, anchor: 'canonical-window' };
};

const buildCrops = async (scan, frames) => {
  mkdirSync(cropDir, { recursive: true });
  const crops = [];
  for (const frame of frames) {
    const fixture = JSON.parse(readFileSync(join(rootDir, '.geometry-corpus/fixtures', `${frame.frameId}.json`), 'utf8'));
    const abs = join(rootDir, frame.image);
    const png = PNG.sync.read(readFileSync(abs));
    const source = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
    const metadata = loadMetadata(fixture);
    const card = fixture.cards.find(row => row.groundTruthQuad?.tl);
    let human;
    try {
      human = quadInImageSpace({
        quad: card.groundTruthQuad,
        imageWidth: png.width,
        imageHeight: png.height,
        captureWidth: metadata?.photo?.decodedWidth ?? null,
        captureHeight: metadata?.photo?.decodedHeight ?? null,
        label: frame.frameId,
      }).quad;
    } catch (error) {
      crops.push({ ...frame, error: error.message });
      continue;
    }
    const dir = join(cropDir, createHash('sha256').update(frame.frameId).digest('hex').slice(0, 16));
    mkdirSync(dir, { recursive: true });
    const upright = scan.warpQuadToCard(source, asQuad(human));
    const oracle = artCropFromCard(scan, upright);
    const oraclePath = join(dir, 'oracle.png');
    await writeFile(oraclePath, Buffer.from(scan.scanImageToPngBytes(oracle.crop)));
    let productionPath = null;
    let productionAnchor = null;
    let productionError = null;
    try {
      const det = scan.detectCardQuad(source);
      const corners = det?.corners;
      if (!corners) throw new Error('detector returned no quad');
      const warped = scan.warpQuadToCard(source, scan.cornersToQuad(corners));
      const produced = artCropFromCard(scan, warped);
      productionPath = join(dir, 'production.png');
      productionAnchor = produced.anchor;
      await writeFile(productionPath, Buffer.from(scan.scanImageToPngBytes(produced.crop)));
    } catch (error) {
      productionError = error instanceof Error ? error.message : String(error);
    }
    crops.push({
      ...frame,
      oraclePath,
      oracleAnchor: oracle.anchor,
      productionPath,
      productionAnchor,
      productionError,
    });
  }
  return crops;
};

const embedCrops = async encoder => {
  const frames = JSON.parse(await readFile(join(dataDir, 'crops.json'), 'utf8'));
  for (const frame of frames) {
    for (const key of ['oracle', 'production']) {
      const image = frame[`${key}Path`];
      if (!image) continue;
      const out = image.replace(/\.png$/, '.f32');
      if (existsSync(out) && readFileSync(out).byteLength === DIMS * 4) continue;
      const emb = Float32Array.from(await encoder.embedPath(image));
      await writeFile(out, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength));
      log(`embed ${key} ${frame.cardName}`);
    }
  }
};

const loadVectors = () => {
  const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
  const b1 = floatsFrom(join(B1_GALLERY_DIR, 'embeddings.bin'));
  const refs = readJson(join(RAW_GALLERY_DIR, 'refs.json'));
  return { raw, b1, refs, count: refs.length };
};

const rankQuery = (embeddings, refs, count, query, expected) => {
  const best = new Map();
  for (let i = 0; i < count; i++) {
    let dot = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += query[d] * embeddings[offset + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || dot > prev.score) best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score: dot, row: i });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const rankIdx = ranked.findIndex(hit => identityMatches(expected, hit));
  const top1 = ranked[0];
  const top2 = ranked[1];
  const margin = top1 && top2 ? top1.score - top2.score : null;
  const expectedRow = rankIdx >= 0 ? ranked[rankIdx] : null;
  return {
    top1: rankIdx === 0,
    top3: rankIdx >= 0 && rankIdx < 3,
    top5: rankIdx >= 0 && rankIdx < 5,
    top10: rankIdx >= 0 && rankIdx < 10,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    top1Name: top1?.name ?? null,
    margin,
    wrongConfident: Boolean(top1) && rankIdx !== 0 && margin != null && margin >= 0.05,
    expectedScore: expectedRow?.score ?? null,
    top1Score: top1?.score ?? null,
    alternateArt: Boolean(expectedRow) && rankIdx !== 0 && top1 && expectedRow.score + 0.05 < top1.score,
    hits: ranked.slice(0, 5).map(hit => hit.name),
  };
};

const summarize = rows => {
  const n = rows.length;
  const count = key => rows.filter(row => row[key]).length;
  const ranks = rows.map(row => row.rank).filter(rank => rank != null);
  const mean = ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
  const median = ranks.length ? ranks.slice().sort((a, b) => a - b)[Math.floor((ranks.length - 1) / 2)] : null;
  return {
    n,
    top1: count('top1'),
    top3: count('top3'),
    top5: count('top5'),
    top10: count('top10'),
    wrongConfident: count('wrongConfident'),
    meanRank: mean,
    medianRank: median,
  };
};

const pairs = (before, after) => {
  let fixes = 0;
  let regressions = 0;
  const fixNames = [];
  const regressionNames = [];
  for (let i = 0; i < before.length; i++) {
    if (!before[i].top1 && after[i].top1) {
      fixes += 1;
      fixNames.push(before[i].cardName);
    } else if (before[i].top1 && !after[i].top1) {
      regressions += 1;
      regressionNames.push(before[i].cardName);
    }
  }
  return { fixes, regressions, fixNames, regressionNames };
};

const scoreFrames = (frames, embeddings, refs, count, vectorOf) =>
  frames.map(frame => {
    const vector = vectorOf(frame);
    const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
    const ranked = vector ? rankQuery(embeddings, refs, count, vector, expected) : {
      top1: false, top3: false, top5: false, top10: false, rank: null, wrongConfident: false, top1Name: null, margin: null, alternateArt: false,
    };
    return { ...frame, ...ranked };
  });

const conditionsOf = frame => {
  const tags = new Set((frame.tags ?? []).map(tag => String(tag).toLowerCase()));
  const labels = [];
  if (tags.has('foil')) labels.push('foil');
  if (tags.has('sleeved')) labels.push('sleeved');
  if (tags.has('unsleeved')) labels.push('unsleeved');
  if (BASIC.has(frame.cardName)) labels.push('basic land');
  if (tags.has('borderless') || tags.has('showcase') || frame.frameFamily === 'borderless') labels.push('borderless/showcase');
  if (frame.nonEnglish || [...tags].some(tag => tag.startsWith('language-'))) labels.push('non-English');
  if (tags.has('glare') || tags.has('dark-background') || tags.has('dark')) labels.push('glare/dark');
  return labels;
};

const breakdown = rows => {
  const keys = ['foil', 'sleeved', 'unsleeved', 'basic land', 'borderless/showcase', 'non-English', 'glare/dark'];
  return keys.map(key => {
    const group = rows.filter(row => conditionsOf(row).includes(key));
    const stats = summarize(group);
    return { key, ...stats };
  }).filter(row => row.n > 0);
};

const topWrong = (embeddings, refs, count, query, oracleId) => {
  const ranked = [];
  for (let i = 0; i < count; i++) {
    if (refs[i].oracleId === oracleId) continue;
    let dot = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += query[d] * embeddings[offset + d];
    if (ranked.length < HARD_K) {
      ranked.push({ row: i, score: dot });
      ranked.sort((a, b) => a.score - b.score);
    } else if (dot > ranked[0].score) {
      ranked[0] = { row: i, score: dot };
      ranked.sort((a, b) => a.score - b.score);
    }
  }
  return ranked.sort((a, b) => b.score - a.score).map(hit => hit.row);
};

const copyRow = (embeddings, row) => embeddings.slice(row * DIMS, (row + 1) * DIMS);

const loadSynthetic = (refs, raw, blocked) => {
  const firstRow = new Map();
  refs.forEach((ref, row) => {
    if (!firstRow.has(ref.oracleId)) firstRow.set(ref.oracleId, row);
  });
  const artRoot = join(rootDir, '.scan-fixtures/embedding-bakeoff/emb/art');
  const samples = [];
  const ids = readdirSync(artRoot).filter(id => firstRow.has(id) && !blocked.has(id)).sort();
  for (const id of ids) {
    let added = 0;
    for (const aug of ['crop3', 'blur-glare', 'perspective', 'mixed']) {
      const path = join(artRoot, id, `${aug}.f32`);
      if (!existsSync(path)) continue;
      samples.push({ oracleId: id, q: floatsFrom(path), p: copyRow(raw, firstRow.get(id)), kind: 'synthetic' });
      added += 1;
      if (added >= 2) break;
    }
    if (samples.length >= 1200) break;
  }
  return samples;
};

const trainAdapter = (kind, samples, gallery, phoneNegatives) => {
  const base = kind === 'linear' ? loadModel(JSON.parse(readFileSync(B1_ADAPTER_PATH, 'utf8'))) : createModel('mlp', 9);
  let model = kind === 'linear' ? cloneModel(base) : base;
  const state = adamState(model);
  const lr = kind === 'linear' ? 1.5e-4 : 2.5e-4;
  const byOracle = new Map();
  for (const sample of samples) {
    if (!byOracle.has(sample.oracleId)) byOracle.set(sample.oracleId, []);
    byOracle.get(sample.oracleId).push(sample);
  }
  const ids = [...byOracle.keys()];
  const hard = new Map(phoneNegatives);
  let step = 0;
  const runEpochs = epochs => {
    for (let epoch = 0; epoch < epochs; epoch++) {
      const rng = mulberry32(2000 + epoch + (kind === 'mlp' ? 50 : 0));
      const order = ids.slice().sort(() => rng() - 0.5);
      let lossSum = 0;
      let batches = 0;
      for (let start = 0; start + 16 <= order.length; start += 32) {
        const batchIds = order.slice(start, start + 32);
        const B = batchIds.length;
        const picked = batchIds.map(id => {
          const list = byOracle.get(id);
          return list[Math.floor(rng() * list.length)];
        });
        const qY = new Float32Array(B * DIMS);
        const pY = new Float32Array(B * DIMS);
        const hY = new Float32Array(B * HARD_K * DIMS);
        const qCache = [];
        const pCache = [];
        const hCache = [];
        for (let i = 0; i < B; i++) {
          const qc = forward(model, picked[i].q);
          const pc = forward(model, picked[i].p);
          qCache.push(qc);
          pCache.push(pc);
          qY.set(qc.y, i * DIMS);
          pY.set(pc.y, i * DIMS);
          const rows = hard.get(picked[i].oracleId) ?? [];
          for (let k = 0; k < HARD_K; k++) {
            const row = rows[k] ?? Math.floor(rng() * gallery.count);
            const hv = copyRow(gallery.raw, row);
            const hc = forward(model, hv);
            hCache.push({ cache: hc, x: hv });
            hY.set(hc.y, (i * HARD_K + k) * DIMS);
          }
        }
        const { loss, dq, dp, dh } = infonce(qY, pY, hY, B, DIMS, HARD_K, TAU);
        const grads = zeroLike(model);
        for (let i = 0; i < B; i++) {
          backwardReady(model, qCache[i], picked[i].q, dq.subarray(i * DIMS, (i + 1) * DIMS), grads);
          backwardReady(model, pCache[i], picked[i].p, dp.subarray(i * DIMS, (i + 1) * DIMS), grads);
          for (let k = 0; k < HARD_K; k++) {
            const slot = hCache[i * HARD_K + k];
            const off = (i * HARD_K + k) * DIMS;
            backwardReady(model, slot.cache, slot.x, dh.subarray(off, off + DIMS), grads);
          }
        }
        step += 1;
        adamStep(model, grads, state, { lr, t: step });
        lossSum += loss;
        batches += 1;
      }
      log(`${kind} epoch ${epoch + 1} loss ${(lossSum / Math.max(1, batches)).toFixed(4)}`);
    }
  };
  runEpochs(3);
  log(`${kind} remines hard negatives`);
  const adapted = applyGallery(model, gallery.raw, gallery.count, DIMS);
  for (const sample of samples.filter(row => row.kind === 'phone')) {
    const { y } = forward(model, sample.q);
    hard.set(sample.oracleId, topWrong(adapted, gallery.refs, gallery.count, y, sample.oracleId));
  }
  runEpochs(2);
  return model;
};

const backwardReady = (model, cache, x, dy, grads) => backward(model, cache, x, dy, grads);

const pct = (hit, n) => (n ? `${hit}/${n}` : '—');
const cells = stats => `${pct(stats.top1, stats.n)} | ${pct(stats.top3, stats.n)} | ${pct(stats.top5, stats.n)} | ${pct(stats.top10, stats.n)} | ${pct(stats.wrongConfident, stats.n)} | ${stats.medianRank ?? '—'}`;

const main = async () => {
  const labels = buildLabels();
  await writeJson(join(dataDir, 'labels-v1.json'), labels);
  const known = labels.filter(frame => frame.status === 'known');
  const splits = assignSplits(known);
  await writeJson(join(dataDir, 'splits.json'), splits);
  const usable = known.map(frame => ({ ...frame, split: splitOf(splits, frame.oracleId) }));
  log(`known ${known.length} identities ${new Set(known.map(frame => frame.oracleId)).size} train ${splits.train.length} dev ${splits.dev.length} holdout ${splits.holdout.length}`);

  if (!existsSync(join(dataDir, 'crops.json')) || process.argv.includes('--crops')) {
    const scan = await loadScan();
    const crops = await buildCrops(scan, usable);
    await writeJson(join(dataDir, 'crops.json'), crops);
    log(`crops ${crops.filter(row => row.oraclePath).length}`);
  }
  const encoder = (await loadEncoder('CLIP_VIT_B32')).runtime;
  await embedCrops(encoder);

  const gallery = loadVectors();
  const byScryfall = new Map();
  gallery.refs.forEach((ref, row) => {
    if (!byScryfall.has(ref.oracleId)) byScryfall.set(ref.oracleId, row);
  });
  const frames = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8')).filter(frame => frame.oraclePath);
  const withVectors = frames.map(frame => ({
    ...frame,
    oracleVector: floatsFrom(frame.oraclePath.replace(/\.png$/, '.f32')),
    productionVector: frame.productionPath && existsSync(frame.productionPath.replace(/\.png$/, '.f32'))
      ? floatsFrom(frame.productionPath.replace(/\.png$/, '.f32'))
      : null,
  }));
  const b1Model = loadModel(JSON.parse(readFileSync(B1_ADAPTER_PATH, 'utf8')));
  const adapt = vector => forward(b1Model, vector).y;
  const oracleB1 = scoreFrames(withVectors, gallery.b1, gallery.refs, gallery.count, frame => adapt(frame.oracleVector));
  const productionB1 = scoreFrames(
    withVectors.filter(frame => frame.productionVector),
    gallery.b1,
    gallery.refs,
    gallery.count,
    frame => adapt(frame.productionVector),
  );

  const blocked = new Set([...splits.holdout, ...splits.dev]);
  const synthetic = loadSynthetic(gallery.refs, gallery.raw, blocked);
  const phoneTrain = withVectors.filter(frame => frame.split === 'train');
  const phoneSamples = phoneTrain.map(frame => ({
    oracleId: frame.oracleId,
    q: frame.oracleVector,
    p: copyRow(gallery.raw, byScryfall.get(frame.oracleId)),
    kind: 'phone',
  }));
  const phoneNegatives = new Map();
  for (const frame of phoneTrain) {
    const query = adapt(frame.oracleVector);
    phoneNegatives.set(frame.oracleId, topWrong(gallery.b1, gallery.refs, gallery.count, query, frame.oracleId));
  }
  for (const sample of synthetic) {
    if (phoneNegatives.has(sample.oracleId)) continue;
    const query = forward(b1Model, sample.q).y;
    phoneNegatives.set(sample.oracleId, topWrong(gallery.b1, gallery.refs, gallery.count, query, sample.oracleId));
    if (phoneNegatives.size >= 240) break;
  }
  log(`synthetic ${synthetic.length} phone ${phoneSamples.length}`);
  const linear = trainAdapter('linear', [...synthetic, ...phoneSamples], gallery, phoneNegatives);
  const mlp = trainAdapter('mlp', [...synthetic, ...phoneSamples], gallery, phoneNegatives);

  const adaptedOf = model => applyGallery(model, gallery.raw, gallery.count, DIMS);
  const scoreModel = (adapted, model, rows, vectorKey) =>
    scoreFrames(rows, adapted, gallery.refs, gallery.count, frame => forward(model, frame[vectorKey]).y);
  const devRows = withVectors.filter(frame => frame.split === 'dev');
  const holdRows = withVectors.filter(frame => frame.split === 'holdout');
  const devB1 = oracleB1.filter(frame => frame.split === 'dev');
  const holdB1 = oracleB1.filter(frame => frame.split === 'holdout');
  const linearGallery = adaptedOf(linear);
  const mlpGallery = adaptedOf(mlp);
  const devLinear = scoreModel(linearGallery, linear, devRows, 'oracleVector');
  const devMlp = scoreModel(mlpGallery, mlp, devRows, 'oracleVector');
  const linearDev = pairs(devB1, devLinear);
  const mlpDev = pairs(devB1, devMlp);
  const linearRate = summarize(devLinear).top1 / Math.max(1, devLinear.length);
  const mlpRate = summarize(devMlp).top1 / Math.max(1, devMlp.length);
  const chooseMlp = mlpRate > linearRate && mlpDev.regressions <= linearDev.regressions;
  const chosen = chooseMlp ? mlp : linear;
  const chosenKind = chooseMlp ? 'mlp' : 'linear';
  log(`dev linear ${linearRate.toFixed(3)} mlp ${mlpRate.toFixed(3)} chose ${chosenKind}`);

  const holdLinear = scoreModel(linearGallery, linear, holdRows, 'oracleVector');
  const holdMlp = scoreModel(mlpGallery, mlp, holdRows, 'oracleVector');
  const holdChosen = chosenKind === 'mlp' ? holdMlp : holdLinear;
  const holdProd = scoreModel(
    chosenKind === 'mlp' ? mlpGallery : linearGallery,
    chosen,
    holdRows.filter(frame => frame.productionVector),
    'productionVector',
  );
  const holdProdB1 = productionB1.filter(frame => frame.split === 'holdout');
  const transition = pairs(holdB1, holdChosen);
  const decision = recommend({
    holdoutTop1: summarize(holdChosen).top1,
    baselineTop1: summarize(holdB1).top1,
    fixes: transition.fixes,
    regressions: transition.regressions,
  });

  const misses = holdChosen.filter(row => !row.top1).map(row => ({
    cardName: row.cardName,
    top1Name: row.top1Name,
    rank: row.rank,
    failure: failureClass({
      ...row,
      inGallery: byScryfall.has(row.oracleId),
      badCapture: row.hardRegression || (row.tags ?? []).includes('partial'),
      glareOrFoil: (row.tags ?? []).some(tag => tag === 'foil' || tag === 'glare'),
    }),
  }));

  const report = {
    decision,
    chosenKind,
    identities: {
      frames: labels.length,
      known: known.length,
      missing: labels.filter(frame => frame.status !== 'known').length,
      unique: new Set(known.map(frame => frame.oracleId)).size,
      train: splits.train.length,
      dev: splits.dev.length,
      holdout: splits.holdout.length,
      holdoutFrames: holdRows.length,
      trainFrames: phoneTrain.length,
    },
    b1All: summarize(oracleB1),
    b1Holdout: summarize(holdB1),
    b1ProductionHoldout: summarize(holdProdB1),
    linearHoldout: summarize(holdLinear),
    mlpHoldout: summarize(holdMlp),
    chosenHoldout: summarize(holdChosen),
    chosenProductionHoldout: summarize(holdProd),
    transition,
    breakdownAll: breakdown(oracleB1),
    misses,
  };
  await writeJson(join(reportsDir, 'identity-v1.json'), report);
  await writeJson(join(rootDir, 'scanner-benchmark/identity-registry/challengers', `${chosenKind}-identity-v1.json`), {
    ...saveModel(chosen),
    decision,
    note: 'Not deployed. Champion remains the frozen B1 adapter.',
  });
  if (!existsSync(join(rootDir, 'scanner-benchmark/identity-registry/champion.json'))) {
    await writeJson(join(rootDir, 'scanner-benchmark/identity-registry/champion.json'), {
      id: 'b1-art-linear',
      note: 'Approved recognition adapter until a human promotes a challenger.',
    });
  }
  await writeFile(join(reportsDir, 'identity-v1.md'), render(report, labels));
  log(`${decision} ${chosenKind}`);
};

const render = (report, labels) => {
  const missing = labels.filter(frame => frame.status !== 'known');
  const lines = [];
  lines.push('# PHONE IDENTITY V1');
  lines.push('');
  lines.push('**PIPELINE / EARLY MODEL.** CLIP is frozen. Android was not changed.');
  lines.push('');
  lines.push(`Recommendation: **${report.decision}**`);
  lines.push('');
  lines.push(`Known frames ${report.identities.known}. Unique identities ${report.identities.unique}. Train ${report.identities.train} identities (${report.identities.trainFrames} photos), dev ${report.identities.dev}, frozen holdout ${report.identities.holdout} identities (${report.identities.holdoutFrames} photos). Unresolved frames ${report.identities.missing}.`);
  lines.push('');
  lines.push('## UNSEEN HOLDOUT, ORACLE GEOMETRY');
  lines.push('');
  lines.push('| Model | Top1 | Top3 | Top5 | Top10 | Wrong-confident | Median rank |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  lines.push(`| B1 | ${cells(report.b1Holdout)} |`);
  lines.push(`| linear | ${cells(report.linearHoldout)} |`);
  lines.push(`| residual MLP | ${cells(report.mlpHoldout)} |`);
  lines.push('');
  lines.push(`Dev chose **${report.chosenKind}**. Holdout transitions versus B1: ${report.transition.fixes} wrong→correct, ${report.transition.regressions} correct→wrong.`);
  if (report.transition.fixNames.length) lines.push(`Fixes: ${report.transition.fixNames.join(', ')}.`);
  if (report.transition.regressionNames.length) lines.push(`Regressions: ${report.transition.regressionNames.join(', ')}.`);
  lines.push('');
  lines.push('## PRODUCTION-LIKE HOLDOUT');
  lines.push('');
  lines.push('| Crop | Top1 | Top3 | Top5 | Top10 | Wrong-confident | Median rank |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  lines.push(`| B1 production | ${cells(report.b1ProductionHoldout)} |`);
  lines.push(`| ${report.chosenKind} production | ${cells(report.chosenProductionHoldout)} |`);
  lines.push(`| ${report.chosenKind} oracle geometry | ${cells(report.chosenHoldout)} |`);
  lines.push('');
  lines.push('## B1 ON EVERY KNOWN FRAME');
  lines.push('');
  lines.push(`Oracle-geometry B1 is ${pct(report.b1All.top1, report.b1All.n)} Top1. This mix includes training identities, so it is not the holdout result.`);
  lines.push('');
  lines.push('| Condition | Top1 | n |');
  lines.push('| --- | --- | --- |');
  for (const row of report.breakdownAll) lines.push(`| ${row.key} | ${pct(row.top1, row.n)} | ${row.n} |`);
  lines.push('');
  lines.push('## HOLDOUT MISSES');
  lines.push('');
  if (!report.misses.length) lines.push('None.');
  for (const miss of report.misses) lines.push(`- ${miss.cardName}: ${miss.failure}, top1 ${miss.top1Name ?? '—'}, rank ${miss.rank ?? '—'}`);
  lines.push('');
  lines.push('## UNRESOLVED FRAMES');
  lines.push('');
  for (const frame of missing) lines.push(`- ${frame.label || frame.frameId}: ${frame.reason}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
};

await main();
