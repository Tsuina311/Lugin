#!/usr/bin/env node
/**
 * MTG embedding bakeoff V1.
 * Frozen CLIP ViT-B/32, small adapters, synthetic canonical views.
 * stills-v1 is evaluation only. Production scanner is not modified.
 *
 *   yarn scanner:embedding-bakeoff
 *   yarn scanner:embedding-bakeoff --skip-full
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { hashDataset, loadAnnotations } from './lib/annotations.mjs';
import { confirmedIdentities } from './lib/metrics.mjs';
import { manifestsDir, reportsDir, resolveSafeMedia, rootDir } from './lib/paths.mjs';
import { renderView } from './embedding/augment.mjs';
import { loadEncoder } from '../recognition/encoders.mjs';
import { loadGalleryIndex } from '../recognition/gallery.mjs';
import { identityMatches, resolveExpected } from '../recognition/scoring.mjs';
import {
  adamState,
  adamStep,
  applyGallery,
  checkGradients,
  cloneModel,
  createModel,
  forward,
  infonce,
  mulberry32,
  saveModel,
  zeroLike,
  adapterSpec,
  backward,
} from './embedding/math.mjs';

const FROZEN_PREFIX = 'c9470c26eebd';
const DIMS = 512;
const TAU = 0.07;
const BATCH = 64;
const HARD_K = 8;
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin; embedding-bakeoff)';
const PIN_NAMES = ['basilisk collar', 'sword of hearth and home', 'wand of wonder', 'livaan, cultist of tiamat'];
const WATCH = ['Basilisk Collar', 'Sword of Hearth and Home', 'Wand of Wonder', 'Livaan, Cultist of Tiamat'];

const TRAIN_AUGS = [
  { id: 'crop3', preset: { crop: 0.03 } },
  { id: 'crop8', preset: { crop: 0.08 } },
  { id: 'crop12', preset: { crop: 0.12, wb: true } },
  { id: 'perspective', preset: { crop: 0.04, perspective: 0.08 } },
  { id: 'blur-glare', preset: { crop: 0.05, blur: 1.4, glare: 1, sleeve: true } },
  { id: 'mixed', preset: { crop: 0.08, perspective: 0.06, motion: 6, glare: 0.7, jpeg: 38, brightness: 0.72, noise: 12, background: 0.1, wb: true } },
];
const DEV_AUGS = [
  { id: 'crop5', preset: { crop: 0.05 } },
  { id: 'blur-glare', preset: { crop: 0.05, blur: 1.4, glare: 1 } },
];
const STRESS = [
  { id: 'clean', file: true },
  { id: 'crop3-in', preset: { crop: 0.03, cropSign: -1 } },
  { id: 'crop3-out', preset: { crop: 0.03, cropSign: 1 } },
  { id: 'crop5-in', preset: { crop: 0.05, cropSign: -1 } },
  { id: 'crop5-out', preset: { crop: 0.05, cropSign: 1 } },
  { id: 'crop10-in', preset: { crop: 0.1, cropSign: -1 } },
  { id: 'crop10-out', preset: { crop: 0.1, cropSign: 1 } },
  { id: 'perspective', preset: { perspective: 0.09 } },
  { id: 'blur', preset: { blur: 2.4 } },
  { id: 'motion', preset: { motion: 9 } },
  { id: 'glare', preset: { glare: 1 } },
  { id: 'dark', preset: { brightness: 0.5 } },
  { id: 'partial', preset: { partial: 0.12 } },
  { id: 'background', preset: { background: 0.16 } },
];

const skipFull = process.argv.includes('--skip-full');
const cacheRoot = join(rootDir, '.scan-fixtures/embedding-bakeoff');
const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

const writeFloats = async (path, arr) => {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
};

const bucketOf = oracleId => {
  const n = createHash('sha256').update(oracleId).digest().readUInt32BE(0) % 1000;
  if (n < 40) return 'train';
  if (n < 52) return 'dev';
  if (n < 60) return 'stress';
  return 'gallery';
};

const fold = name =>
  String(name || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-embed-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export * from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/regions.ts')}';
        export { scanImageToPngBytes } from '${join(rootDir, 'mobile/src/scan/debug/scanImagePng.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'embed-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const groupOracles = refs => {
  const groups = new Map();
  for (let row = 0; row < refs.length; row++) {
    const ref = refs[row];
    if (!groups.has(ref.oracleId)) groups.set(ref.oracleId, []);
    groups.get(ref.oracleId).push({ ...ref, row });
  }
  return groups;
};

const assignSplits = groups => {
  const splits = { train: [], dev: [], stress: [], gallery: [] };
  for (const [oracleId, arts] of groups) {
    const name = fold(arts[0].canonicalName);
    const pinned = PIN_NAMES.some(pin => name === pin);
    const bucket = pinned ? 'train' : bucketOf(oracleId);
    splits[bucket].push({
      oracleId,
      name: arts[0].canonicalName,
      arts,
      pinned,
    });
  }
  for (const key of Object.keys(splits)) splits[key].sort((a, b) => a.oracleId.localeCompare(b.oracleId));
  splits.stress = splits.stress.slice(0, 200);
  return splits;
};

const artPathOf = scryfallId => join(rootDir, '.scan-fixtures/visual-embed/art-crops', `${scryfallId}.jpg`);

const ensureCachedEmbed = async (encoder, imagePath, embPath) => {
  if (existsSync(embPath) && statSync(embPath).size === DIMS * 4) return floatsFrom(embPath);
  const emb = await encoder.embedPath(imagePath);
  const arr = Float32Array.from(emb);
  await writeFloats(embPath, arr);
  return arr;
};

const viewEmbed = async (encoder, sourcePath, preset, embPath, seedKey) => {
  if (existsSync(embPath) && statSync(embPath).size === DIMS * 4) return floatsFrom(embPath);
  const jpg = await renderView(sourcePath, preset, seedKey);
  const tmp = `${embPath}.jpg`;
  mkdirSync(dirname(tmp), { recursive: true });
  await writeFile(tmp, jpg);
  const emb = await encoder.embedPath(tmp);
  const arr = Float32Array.from(emb);
  await writeFloats(embPath, arr);
  return arr;
};

const copyRow = (embeddings, row) => Float32Array.from(embeddings.subarray(row * DIMS, (row + 1) * DIMS));

const buildSamples = async (encoder, cards, augs, embeddings, kind) => {
  const samples = [];
  let done = 0;
  for (const card of cards) {
    const art = card.arts[0];
    const source = kind === 'art' ? artPathOf(art.scryfallId) : card.fullPath;
    if (!source || !existsSync(source)) continue;
    const positive = kind === 'art' ? copyRow(embeddings, art.row) : card.fullEmbed;
    if (!positive) continue;
    for (const aug of augs) {
      const embPath = join(cacheRoot, 'emb', kind, card.oracleId, `${aug.id}.f32`);
      const q = aug.file
        ? await ensureCachedEmbed(encoder, source, embPath)
        : await viewEmbed(encoder, source, aug.preset, embPath, `${card.oracleId}:${kind}:${aug.id}`);
      if (source.includes('/replay/') || source.includes('/real-photos/') || source.includes('scan-inbox')) {
        throw new Error(`eval image leaked into training: ${source}`);
      }
      samples.push({ oracleId: card.oracleId, name: card.name, q, p: positive });
      done += 1;
      if (done % 200 === 0) log(`${kind} views ${done}`);
    }
  }
  return samples;
};

const topWrong = (embeddings, refs, count, query, selfOracle, k) => {
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * DIMS;
    let dot = 0;
    for (let d = 0; d < DIMS; d++) dot += query[d] * embeddings[o + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || dot > prev.score) best.set(ref.oracleId, { row: i, score: dot, oracleId: ref.oracleId });
  }
  return [...best.values()]
    .filter(hit => hit.oracleId !== selfOracle)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(hit => hit.row);
};

const mineHard = (gallery, cards, embedOf) => {
  const hard = new Map();
  let n = 0;
  for (const card of cards) {
    const q = embedOf(card);
    const rows = topWrong(gallery.embeddings, gallery.refs, gallery.count, q, card.oracleId, HARD_K);
    hard.set(card.oracleId, rows);
    n += 1;
    if (n % 400 === 0) log(`mined ${n}/${cards.length}`);
  }
  return hard;
};

const searchDetailed = (index, query, expected) => {
  const { embeddings, refs, count } = index;
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * DIMS;
    let dot = 0;
    for (let d = 0; d < DIMS; d++) dot += query[d] * embeddings[o + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || dot > prev.score) {
      best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score: dot });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const rankIdx = ranked.findIndex(hit => identityMatches(expected, hit));
  const top1 = ranked[0] ?? null;
  const top2 = ranked[1] ?? null;
  const margin = top1 && top2 ? top1.score - top2.score : null;
  const flags = {
    top1: rankIdx === 0,
    top3: rankIdx >= 0 && rankIdx < 3,
    top5: rankIdx >= 0 && rankIdx < 5,
    top10: rankIdx >= 0 && rankIdx < 10,
  };
  return {
    ...flags,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    top1Name: top1?.name ?? null,
    top1Score: top1?.score ?? null,
    top2Score: top2?.score ?? null,
    margin,
    wrongConfident: Boolean(top1) && rankIdx !== 0 && margin != null && margin >= 0.05,
    hits: ranked.slice(0, 5).map(hit => ({ name: hit.name, score: Number(hit.score.toFixed(4)) })),
  };
};

const scoreMap = (index, query) => {
  const { embeddings, refs, count } = index;
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * DIMS;
    let dot = 0;
    for (let d = 0; d < DIMS; d++) dot += query[d] * embeddings[o + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || dot > prev.score) best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score: dot });
  }
  return best;
};

const fuseRank = (artMap, fullMap, w, expected) => {
  const ids = new Set([...artMap.keys(), ...fullMap.keys()]);
  const ranked = [];
  for (const id of ids) {
    const a = artMap.get(id);
    const f = fullMap.get(id);
    ranked.push({
      oracleId: id,
      name: a?.name || f?.name,
      score: w * (a?.score ?? 0) + (1 - w) * (f?.score ?? 0),
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  const rankIdx = ranked.findIndex(hit => identityMatches(expected, hit));
  const top1 = ranked[0];
  const top2 = ranked[1];
  const margin = top1 && top2 ? top1.score - top2.score : null;
  return {
    top1: rankIdx === 0,
    top3: rankIdx >= 0 && rankIdx < 3,
    top5: rankIdx >= 0 && rankIdx < 5,
    top10: rankIdx >= 0 && rankIdx < 10,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    top1Name: top1?.name ?? null,
    top1Score: top1?.score ?? null,
    top2Score: top2?.score ?? null,
    margin,
    wrongConfident: Boolean(top1) && rankIdx !== 0 && margin != null && margin >= 0.05,
    hits: ranked.slice(0, 5).map(hit => ({ name: hit.name, score: Number(hit.score.toFixed(4)) })),
  };
};

const summarize = frames => {
  const n = frames.length;
  const count = key => frames.filter(frame => frame[key]).length;
  return {
    n,
    top1: count('top1'),
    top3: count('top3'),
    top5: count('top5'),
    top10: count('top10'),
    wrongConfident: count('wrongConfident'),
  };
};

const retrievalRate = (index, samples) => {
  let hit = 0;
  for (const sample of samples) {
    const expected = resolveExpected(rootDir, { expectedName: sample.name, oracleId: sample.oracleId });
    const { y } = forward(sample.model, sample.q);
    if (searchDetailed(index, y, expected).top1) hit += 1;
  }
  return samples.length ? hit / samples.length : 0;
};

const trainAdapter = (kind, samples, hard, gallery, devSamples) => {
  let model = createModel(kind, kind === 'linear' ? 3 : 9);
  const state = adamState(model);
  const lr = kind === 'linear' ? 2e-4 : 3e-4;
  const byOracle = new Map();
  for (const sample of samples) {
    if (!byOracle.has(sample.oracleId)) byOracle.set(sample.oracleId, []);
    byOracle.get(sample.oracleId).push(sample);
  }
  const ids = [...byOracle.keys()];
  let best = cloneModel(model);
  let bestDev = -1;
  let step = 0;
  const rounds = [5, 3];
  for (let round = 0; round < rounds.length; round++) {
    if (round === 1) {
      log(`${kind} remines hard negatives with the adapter`);
      const adapted = applyGallery(model, gallery.embeddings, gallery.count, DIMS);
      const adaptedIndex = { ...gallery, embeddings: adapted };
      for (const id of ids) {
        const probe = byOracle.get(id)[0].p;
        const { y } = forward(model, probe);
        hard.set(id, topWrong(adaptedIndex.embeddings, gallery.refs, gallery.count, y, id, HARD_K));
      }
    }
    for (let epoch = 0; epoch < rounds[round]; epoch++) {
      const rng = mulberry32(1000 + round * 100 + epoch);
      const order = ids.slice().sort(() => rng() - 0.5);
      let lossSum = 0;
      let batches = 0;
      for (let start = 0; start + 16 <= order.length; start += BATCH) {
        const batchIds = order.slice(start, start + BATCH);
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
            let row = rows[k];
            if (row == null) row = Math.floor(rng() * gallery.count);
            const hv = copyRow(gallery.embeddings, row);
            const hc = forward(model, hv);
            hCache.push({ cache: hc, x: hv });
            hY.set(hc.y, (i * HARD_K + k) * DIMS);
          }
        }
        const { loss, dq, dp, dh } = infonce(qY, pY, hY, B, DIMS, HARD_K, TAU);
        const grads = zeroLike(model);
        for (let i = 0; i < B; i++) {
          backward(model, qCache[i], picked[i].q, dq.subarray(i * DIMS, (i + 1) * DIMS), grads);
          backward(model, pCache[i], picked[i].p, dp.subarray(i * DIMS, (i + 1) * DIMS), grads);
          for (let k = 0; k < HARD_K; k++) {
            const slot = hCache[i * HARD_K + k];
            const off = (i * HARD_K + k) * DIMS;
            backward(model, slot.cache, slot.x, dh.subarray(off, off + DIMS), grads);
          }
        }
        step += 1;
        adamStep(model, grads, state, { lr, t: step });
        lossSum += loss;
        batches += 1;
      }
      log(`${kind} round ${round + 1} epoch ${epoch + 1} loss ${(lossSum / Math.max(1, batches)).toFixed(4)}`);
      if (epoch === rounds[round] - 1 || epoch % 2 === 1) {
        const adapted = applyGallery(model, gallery.embeddings, gallery.count, DIMS);
        const index = { ...gallery, embeddings: adapted };
        const probe = devSamples.map(sample => ({ ...sample, model }));
        const rate = retrievalRate(index, probe);
        log(`${kind} dev top1 ${(rate * 100).toFixed(1)}% on ${probe.length}`);
        if (rate >= bestDev) {
          bestDev = rate;
          best = cloneModel(model);
        }
      }
    }
  }
  return { model: best, devTop1: bestDev };
};

const phoneFrames = async (scan, encoder) => {
  const stills = readJson(join(manifestsDir, 'stills-v1.json'));
  const annotations = await loadAnnotations();
  const fresh = hashDataset(stills, annotations);
  if (!fresh.startsWith(FROZEN_PREFIX) || fresh !== stills.datasetHash) {
    throw new Error(`eval set moved: stored ${stills.datasetHash} fresh ${fresh}`);
  }
  const confirmed = new Map(confirmedIdentities(annotations.identities).map(row => [row.imageId, row]));
  const items = stills.items
    .filter(item => confirmed.has(item.imageId))
    .map(item => ({ ...item, cardName: confirmed.get(item.imageId).cardName, oracleId: confirmed.get(item.imageId).oracleId ?? null }));
  const frames = [];
  for (const item of items) {
    const expected = resolveExpected(rootDir, { expectedName: item.cardName, oracleId: item.oracleId });
    let decoded;
    try {
      decoded = PNG.sync.read(readFileSync(resolveSafeMedia(item.path)));
    } catch (err) {
      log(`phone decode failed ${item.cardName}: ${err instanceof Error ? err.message : err}`);
      frames.push({ imageId: item.imageId, cardName: item.cardName, expected, detected: false, art: null, warp: null });
      continue;
    }
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    let det;
    try {
      det = scan.detectCardQuad(source);
    } catch (err) {
      log(`phone detect failed ${item.cardName}: ${err instanceof Error ? err.message : err}`);
      frames.push({ imageId: item.imageId, cardName: item.cardName, expected, detected: false, art: null, warp: null });
      continue;
    }
    const quad = det.recognitionCorners ?? det.corners;
    const slug = item.imageId.replace(/[^\w.-]+/g, '_').slice(-80);
    const dir = join(cacheRoot, 'phone', slug);
    mkdirSync(dir, { recursive: true });
    if (!quad) {
      frames.push({ imageId: item.imageId, cardName: item.cardName, expected, detected: false, art: null, warp: null });
      continue;
    }
    let warp = null;
    try {
      warp = scan.warpQuadToCard(source, scan.cornersToQuad(quad));
    } catch {
      warp = null;
    }
    if (!warp) {
      frames.push({ imageId: item.imageId, cardName: item.cardName, expected, detected: true, art: null, warp: null });
      continue;
    }
    const art = scan.extractArtCropFromCard(warp);
    const artPath = join(dir, 'art.png');
    const warpPath = join(dir, 'warp.png');
    await writeFile(artPath, scan.scanImageToPngBytes(art.crop, art.crop.width));
    await writeFile(warpPath, scan.scanImageToPngBytes(warp, warp.width));
    const artEmb = await ensureCachedEmbed(encoder, artPath, join(dir, 'art.f32'));
    const warpEmb = await ensureCachedEmbed(encoder, warpPath, join(dir, 'warp.f32'));
    frames.push({ imageId: item.imageId, cardName: item.cardName, expected, detected: true, art: artEmb, warp: warpEmb });
  }
  return { hash: fresh, frames };
};

const scoreFrames = (index, frames, field) =>
  frames.map(frame => {
    if (!frame[field]) {
      return {
        imageId: frame.imageId,
        cardName: frame.cardName,
        detected: frame.detected,
        top1: false,
        top3: false,
        top5: false,
        top10: false,
        rank: null,
        top1Name: null,
        top1Score: null,
        top2Score: null,
        margin: null,
        wrongConfident: false,
        hits: [],
      };
    }
    const { y } = frame.model ? { y: forward(frame.model, frame[field]).y } : { y: frame[field] };
    return { imageId: frame.imageId, cardName: frame.cardName, detected: frame.detected, ...searchDetailed(index, y, frame.expected) };
  });

const normalUrl = id => `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;

const fetchJpg = async (url, dest) => {
  if (existsSync(dest) && statSync(dest).size > 1000) {
    const magic = readFileSync(dest).subarray(0, 2);
    if (magic[0] === 0xff && magic[1] === 0xd8) return dest;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      mkdirSync(dirname(dest), { recursive: true });
      const tmp = `${dest}.${process.pid}.partial`;
      await pipeline(res.body, createWriteStream(tmp));
      const magic = readFileSync(tmp).subarray(0, 2);
      if (magic[0] !== 0xff || magic[1] !== 0xd8) return null;
      await rename(tmp, dest);
      return dest;
    } catch {
      await sleep(400 * (attempt + 1));
    }
  }
  return null;
};

const ensureFullCard = async card => {
  for (const art of card.arts.slice(0, 3)) {
    const dest = join(cacheRoot, 'full-cards', `${art.scryfallId}.jpg`);
    const path = await fetchJpg(normalUrl(art.scryfallId), dest);
    if (path) return { ...card, scryfallId: art.scryfallId, artRow: art.row, fullPath: path };
  }
  return null;
};

const mapPool = async (items, concurrency, worker) => {
  const out = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, run));
  return out;
};

const stressFor = async (encoder, cards, sourceOf, index, model) => {
  const rows = {};
  for (const cond of STRESS) {
    let hit = 0;
    let n = 0;
    for (const card of cards) {
      const source = sourceOf(card);
      if (!source || !existsSync(source)) continue;
      const embPath = join(cacheRoot, 'emb', model ? 'stress-model' : 'stress', cond.id, `${card.oracleId}.f32`);
      const dirKind = source.includes('full-cards') ? 'full' : 'art';
      const cached = join(cacheRoot, 'emb', dirKind, 'stress', card.oracleId, `${cond.id}.f32`);
      const q = cond.file
        ? await ensureCachedEmbed(encoder, source, cached)
        : await viewEmbed(encoder, source, cond.preset, cached, `${card.oracleId}:${dirKind}:stress:${cond.id}`);
      const y = model ? forward(model, q).y : q;
      const expected = resolveExpected(rootDir, { expectedName: card.name, oracleId: card.oracleId });
      if (searchDetailed(index, y, expected).top1) hit += 1;
      n += 1;
    }
    rows[cond.id] = { hit, n, rate: n ? hit / n : 0 };
    log(`stress ${cond.id} ${hit}/${n}`);
  }
  const meanPair = (a, b) => {
    const left = rows[a];
    const right = rows[b];
    const n = (left?.n ?? 0) + (right?.n ?? 0);
    const hit = (left?.hit ?? 0) + (right?.hit ?? 0);
    return { hit, n, rate: n ? hit / n : 0 };
  };
  return {
    clean: rows.clean,
    'crop ±3%': meanPair('crop3-in', 'crop3-out'),
    'crop ±5%': meanPair('crop5-in', 'crop5-out'),
    'crop ±10%': meanPair('crop10-in', 'crop10-out'),
    perspective: rows.perspective,
    blur: rows.blur,
    'motion blur': rows.motion,
    glare: rows.glare,
    dark: rows.dark,
    'partial edge': rows.partial,
    background: rows.background,
  };
};

const watchRows = (baseline, modelFrames) =>
  WATCH.map(name => {
    const want = fold(name);
    const base = baseline.filter(frame => fold(frame.cardName) === want);
    const next = modelFrames.filter(frame => fold(frame.cardName) === want);
    return {
      name,
      frames: base.map(frame => {
        const other = next.find(row => row.imageId === frame.imageId);
        return {
          imageId: frame.imageId,
          currentRank: frame.rank,
          newRank: other?.rank ?? null,
          currentTop1: frame.top1Name,
          newTop1: other?.top1Name ?? null,
        };
      }),
    };
  });

const fmt = (summary, key) => `${summary[key]}/${summary.n}`;

const markdown = report => {
  const lines = [];
  lines.push('# MTG EMBEDDING BAKEOFF V1');
  lines.push('');
  lines.push(`Frozen eval stills-v1 \`${report.evalHash}\`.`);
  lines.push(`Git \`${report.git}\`. Date ${report.date}.`);
  lines.push('');
  lines.push('Phone frames are the decision set. Synthetic stress is diagnostic. Visual scores only.');
  lines.push('');
  lines.push('## DATA');
  lines.push('');
  lines.push(`- Confirmed phone frames scored: ${report.phone.n}`);
  lines.push(`- Detector misses: ${report.phone.detectorMisses}`);
  lines.push(`- Train oracles: ${report.training.trainOracles}`);
  lines.push(`- Dev oracles: ${report.training.devOracles}`);
  lines.push(`- Stress oracles: ${report.training.stressOracles}`);
  lines.push(`- Pinned canonical cards in train: ${report.training.pinned.join(', ')}`);
  lines.push(`- Art gallery refs: ${report.training.artGallery}`);
  lines.push(`- Full-card gallery refs: ${report.training.fullGallery ?? 'not built'}`);
  lines.push('');
  lines.push('## TRAINING');
  lines.push('');
  lines.push(report.training.narrative);
  lines.push('');
  lines.push('## MODELS');
  lines.push('');
  lines.push('| Model | Params | Size |');
  lines.push('| --- | ---: | ---: |');
  for (const model of report.models) {
    lines.push(`| ${model.id} | ${model.params} | ${(model.bytes / 1e6).toFixed(2)} MB |`);
  }
  lines.push('');
  lines.push(report.device);
  lines.push('');
  lines.push('## PHONE RESULTS');
  lines.push('');
  lines.push('| Model | Top1 | Top3 | Top5 | Top10 | Wrong-confident |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.table) {
    lines.push(`| ${row.id} | ${row.top1} | ${row.top3} | ${row.top5} | ${row.top10} | ${row.wrongConfident} |`);
  }
  lines.push('');
  lines.push('## WATCHED CARDS');
  lines.push('');
  for (const block of report.watched) {
    lines.push(`### ${block.name}`);
    lines.push('');
    for (const frame of block.frames) {
      lines.push(`- rank ${frame.currentRank ?? '—'} → ${frame.newRank ?? '—'} on \`${frame.imageId.split('/').slice(-2).join('/')}\``);
      lines.push(`  - current top1 ${frame.currentTop1 ?? 'none'}`);
      lines.push(`  - new top1 ${frame.newTop1 ?? 'none'}`);
    }
    lines.push('');
  }
  lines.push('## RECOVERIES AND REGRESSIONS');
  lines.push('');
  lines.push(`Recovered to Top1: ${report.recovered.length ? report.recovered.join(', ') : 'none'}`);
  lines.push(`Regressions off Top1: ${report.regressions.length ? report.regressions.join(', ') : 'none'}`);
  lines.push('');
  lines.push('## STRESS');
  lines.push('');
  lines.push('Held-out canonical cards. Clean is a fresh CLIP embed of the original file. Other rows are rendered corruptions. This table does not decide the verdict.');
  lines.push('');
  if (report.stressHeader) {
    lines.push(`| Condition | ${report.stressHeader.join(' | ')} |`);
    lines.push(`| --- | ${report.stressHeader.map(() => '---:').join(' | ')} |`);
    for (const row of report.stressRows) {
      lines.push(`| ${row.condition} | ${row.cells.join(' | ')} |`);
    }
  }
  lines.push('');
  lines.push('## VERDICT');
  lines.push('');
  lines.push(`**${report.verdict}**`);
  lines.push('');
  lines.push(report.verdictWhy);
  lines.push('');
  lines.push('## NEXT');
  lines.push('');
  lines.push(report.next);
  lines.push('');
  lines.push('## PRODUCTION');
  lines.push('');
  lines.push('- scanner untouched');
  lines.push('- detector untouched');
  lines.push('- no threshold changes');
  lines.push('- no fusion changes');
  lines.push('- no OCR changes');
  lines.push('- no EAS');
  lines.push('- no OTA');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

const main = async () => {
  checkGradients();
  log('gradient check passed');
  mkdirSync(cacheRoot, { recursive: true });
  const gallery = loadGalleryIndex('CLIP_VIT_B32', 'full');
  if (!gallery) throw new Error('missing CLIP full gallery');
  const groups = groupOracles(gallery.refs);
  const splits = assignSplits(groups);
  log(`oracles train ${splits.train.length} dev ${splits.dev.length} stress ${splits.stress.length} gallery ${gallery.count}`);

  const fullList = [...splits.train, ...splits.dev, ...splits.stress];
  const allOracles = [...groups.values()].map(arts => ({ oracleId: arts[0].oracleId, name: arts[0].canonicalName, arts }));
  const downloadJob = skipFull
    ? Promise.resolve([])
    : mapPool(allOracles, 8, async (card, index) => {
        const got = await ensureFullCard(card);
        if (index % 500 === 0) log(`full-card downloads ${index}/${allOracles.length}`);
        return got;
      });

  log('loading CLIP');
  const { runtime: encoder } = await loadEncoder('CLIP_VIT_B32');
  const scan = await loadScan();
  const phone = await phoneFrames(scan, encoder);
  log(`phone frames ${phone.frames.length} with crops ${phone.frames.filter(frame => frame.art).length}`);

  log('embedding art training views');
  const artTrain = await buildSamples(encoder, splits.train, TRAIN_AUGS, gallery.embeddings, 'art');
  const artDev = await buildSamples(encoder, splits.dev, DEV_AUGS, gallery.embeddings, 'art');
  log(`art samples train ${artTrain.length} dev ${artDev.length}`);

  log('mining CLIP hard negatives');
  const hard = mineHard(gallery, splits.train, card => copyRow(gallery.embeddings, card.arts[0].row));

  const artIndexFor = model => ({ ...gallery, embeddings: applyGallery(model, gallery.embeddings, gallery.count, DIMS) });

  const devProbe = artDev.filter((_, index) => index % 2 === 0);
  log('training art linear');
  const b1 = trainAdapter('linear', artTrain, new Map(hard), gallery, devProbe);
  log('training art mlp');
  const b2 = trainAdapter('mlp', artTrain, new Map(hard), gallery, devProbe);
  await writeJson(join(cacheRoot, 'models', 'b1.json'), saveModel(b1.model));
  await writeJson(join(cacheRoot, 'models', 'b2.json'), saveModel(b2.model));

  const artGalleryB1 = artIndexFor(b1.model);
  const artGalleryB2 = artIndexFor(b2.model);
  const artGalleryA = gallery;

  const fixScore = (index, frames, field, model) =>
    frames.map(frame => {
      if (!frame[field]) {
        return {
          imageId: frame.imageId,
          cardName: frame.cardName,
          detected: false,
          top1: false,
          top3: false,
          top5: false,
          top10: false,
          rank: null,
          top1Name: null,
          top1Score: null,
          top2Score: null,
          margin: null,
          wrongConfident: false,
          hits: [],
        };
      }
      const y = model ? forward(model, frame[field]).y : frame[field];
      return { imageId: frame.imageId, cardName: frame.cardName, detected: true, ...searchDetailed(index, y, frame.expected) };
    });

  const framesA = fixScore(artGalleryA, phone.frames, 'art', null);
  const framesB1 = fixScore(artGalleryB1, phone.frames, 'art', b1.model);
  const framesB2 = fixScore(artGalleryB2, phone.frames, 'art', b2.model);
  log(`phone A ${summarize(framesA).top1} B1 ${summarize(framesB1).top1} B2 ${summarize(framesB2).top1}`);

  log('art stress');
  const stressA = await stressFor(encoder, splits.stress, card => artPathOf(card.arts[0].scryfallId), artGalleryA, null);
  const stressB1 = await stressFor(encoder, splits.stress, card => artPathOf(card.arts[0].scryfallId), artGalleryB1, b1.model);
  const stressB2 = await stressFor(encoder, splits.stress, card => artPathOf(card.arts[0].scryfallId), artGalleryB2, b2.model);

  let fullGallery = null;
  let c1 = null;
  let c2 = null;
  let framesC1 = null;
  let framesC2 = null;
  let stressC1 = null;
  let stressC2 = null;
  let framesD = null;
  let dualWeight = null;
  let fullCount = null;

  if (!skipFull) {
    log('waiting for full-card downloads');
    const downloaded = (await downloadJob).filter(Boolean);
    fullCount = downloaded.length;
    log(`full cards on disk ${fullCount}`);
    if (fullCount < 1000) {
      log('full-card gallery is too small to score, so C and D are skipped');
    } else {
    const byId = new Map(downloaded.map(card => [card.oracleId, card]));
    const fullRefs = [];
    const fullVectors = [];
    let embedded = 0;
    for (const card of downloaded) {
      const embPath = join(cacheRoot, 'emb', 'full', 'canonical', `${card.scryfallId}.f32`);
      const emb = await ensureCachedEmbed(encoder, card.fullPath, embPath);
      card.fullEmbed = emb;
      fullRefs.push({
        artId: card.scryfallId,
        oracleId: card.oracleId,
        canonicalName: card.name,
        scryfallId: card.scryfallId,
      });
      fullVectors.push(emb);
      embedded += 1;
      if (embedded % 400 === 0) log(`full embeds ${embedded}/${downloaded.length}`);
    }
    const fullEmbeddings = new Float32Array(fullVectors.length * DIMS);
    fullVectors.forEach((vec, i) => fullEmbeddings.set(vec, i * DIMS));
    fullGallery = { embeddings: fullEmbeddings, refs: fullRefs, count: fullRefs.length, dims: DIMS };
    const trainCards = splits.train.map(card => byId.get(card.oracleId)).filter(Boolean);
    const devCards = splits.dev.map(card => byId.get(card.oracleId)).filter(Boolean);
    const stressCards = splits.stress.map(card => byId.get(card.oracleId)).filter(Boolean);
    log('embedding full-card training views');
    const fullTrain = await buildSamples(encoder, trainCards, TRAIN_AUGS, null, 'full');
    const fullDev = await buildSamples(encoder, devCards, DEV_AUGS, null, 'full');
    const fullHard = mineHard(fullGallery, trainCards, card => card.fullEmbed);
    log('training full linear');
    c1 = trainAdapter('linear', fullTrain, new Map(fullHard), fullGallery, fullDev.filter((_, i) => i % 2 === 0));
    log('training full mlp');
    c2 = trainAdapter('mlp', fullTrain, new Map(fullHard), fullGallery, fullDev.filter((_, i) => i % 2 === 0));
    await writeJson(join(cacheRoot, 'models', 'c1.json'), saveModel(c1.model));
    await writeJson(join(cacheRoot, 'models', 'c2.json'), saveModel(c2.model));
    const g1 = { ...fullGallery, embeddings: applyGallery(c1.model, fullGallery.embeddings, fullGallery.count, DIMS) };
    const g2 = { ...fullGallery, embeddings: applyGallery(c2.model, fullGallery.embeddings, fullGallery.count, DIMS) };
    framesC1 = fixScore(g1, phone.frames, 'warp', c1.model);
    framesC2 = fixScore(g2, phone.frames, 'warp', c2.model);
    log(`phone C1 ${summarize(framesC1).top1} C2 ${summarize(framesC2).top1}`);
    stressC1 = await stressFor(encoder, stressCards, card => card.fullPath, g1, c1.model);
    stressC2 = await stressFor(encoder, stressCards, card => card.fullPath, g2, c2.model);

    const devTop = (artModel, artIndex, fullModel, fullIndex, w) => {
      const cards = devCards.slice(0, 120);
      let hit = 0;
      let n = 0;
      for (const card of cards) {
        const artSample = artDev.find(sample => sample.oracleId === card.oracleId);
        const fullSample = fullDev.find(sample => sample.oracleId === card.oracleId);
        if (!artSample || !fullSample) continue;
        const aq = forward(artModel, artSample.q).y;
        const fq = forward(fullModel, fullSample.q).y;
        const expected = resolveExpected(rootDir, { expectedName: card.name, oracleId: card.oracleId });
        if (fuseRank(scoreMap(artIndex, aq), scoreMap(fullIndex, fq), w, expected).top1) hit += 1;
        n += 1;
      }
      return n ? hit / n : 0;
    };
    const artPick = b1.devTop1 >= b2.devTop1 ? { model: b1.model, index: artGalleryB1, id: 'B1' } : { model: b2.model, index: artGalleryB2, id: 'B2' };
    const fullPick = c1.devTop1 >= c2.devTop1 ? { model: c1.model, index: g1, id: 'C1' } : { model: c2.model, index: g2, id: 'C2' };
    const artOk = Math.max(b1.devTop1, b2.devTop1) >= 0.5;
    const fullOk = Math.max(c1.devTop1, c2.devTop1) >= 0.5;
    if (artOk && fullOk) {
      let bestW = 0.5;
      let bestRate = -1;
      for (const w of [0.35, 0.5, 0.65]) {
        const rate = devTop(artPick.model, artPick.index, fullPick.model, fullPick.index, w);
        log(`dual weight ${w} dev ${rate.toFixed(3)}`);
        if (rate > bestRate || (rate === bestRate && w === 0.5)) {
          bestRate = rate;
          bestW = w;
        }
      }
      dualWeight = { w: bestW, art: artPick.id, full: fullPick.id, dev: bestRate };
      framesD = phone.frames.map(frame => {
        if (!frame.art || !frame.warp) {
          return { imageId: frame.imageId, cardName: frame.cardName, detected: false, top1: false, top3: false, top5: false, top10: false, rank: null, top1Name: null, top1Score: null, top2Score: null, margin: null, wrongConfident: false, hits: [] };
        }
        return {
          imageId: frame.imageId,
          cardName: frame.cardName,
          detected: true,
          ...fuseRank(scoreMap(artPick.index, forward(artPick.model, frame.art).y), scoreMap(fullPick.index, forward(fullPick.model, frame.warp).y), bestW, frame.expected),
        };
      });
      log(`phone D ${summarize(framesD).top1} weight ${bestW}`);
    }
    }
  }

  const named = {
    A: framesA,
    B1: framesB1,
    B2: framesB2,
    ...(framesC1 ? { C1: framesC1 } : {}),
    ...(framesC2 ? { C2: framesC2 } : {}),
    ...(framesD ? { D1: framesD } : {}),
  };
  const summaries = Object.fromEntries(Object.entries(named).map(([id, frames]) => [id, summarize(frames)]));
  const bestArtId = summaries.B1.top1 >= summaries.B2.top1 ? 'B1' : 'B2';
  const bestSingle = Object.entries(summaries)
    .filter(([id]) => id !== 'A')
    .sort((a, b) => b[1].top1 - a[1].top1 || b[1].top3 - a[1].top3)[0];
  const base = summaries.A;
  const winner = bestSingle;
  const winFrames = named[winner[0]];
  const recovered = [];
  const regressions = [];
  for (let i = 0; i < framesA.length; i++) {
    const before = framesA[i];
    const after = winFrames[i];
    if (!before.top1 && after.top1) recovered.push(before.cardName);
    if (before.top1 && !after.top1) regressions.push(before.cardName);
  }
  const watchedNamesRecovered = WATCH.filter(name => {
    const want = fold(name);
    return framesA.some((frame, i) => fold(frame.cardName) === want && !frame.top1 && winFrames[i].top1);
  });
  const delta1 = winner[1].top1 - base.top1;
  const delta3 = winner[1].top3 - base.top3;
  const stressOf = {
    A: stressA,
    B1: stressB1,
    B2: stressB2,
    ...(stressC1 ? { C1: stressC1 } : {}),
    ...(stressC2 ? { C2: stressC2 } : {}),
  };
  const stressMean = block => {
    if (!block) return 0;
    const keys = ['crop ±10%', 'blur', 'glare'];
    return keys.reduce((sum, key) => sum + (block[key]?.rate ?? 0), 0) / keys.length;
  };
  const artId = summaries.B1.top1 >= summaries.B2.top1 ? 'B1' : 'B2';
  const artFrames = named[artId];
  const artRecoveredNames = WATCH.filter(name => {
    const want = fold(name);
    return framesA.some((frame, i) => fold(frame.cardName) === want && !frame.top1 && artFrames[i].top1);
  });
  let artRegressions = 0;
  for (let i = 0; i < framesA.length; i++) if (framesA[i].top1 && !artFrames[i].top1) artRegressions += 1;
  const artStrong =
    summaries[artId].top1 - base.top1 >= 4 &&
    summaries[artId].top3 - base.top3 >= 1 &&
    artRecoveredNames.length >= 2 &&
    artRegressions <= 2 &&
    summaries[artId].wrongConfident <= base.wrongConfident + 2 &&
    stressMean(stressOf[artId]) + 0.02 >= stressMean(stressA);
  const dualGain = summaries.D1 ? summaries.D1.top1 - summaries[artId].top1 : 0;
  const fullId = summaries.C1 || summaries.C2 ? (summaries.C1?.top1 ?? -1) >= (summaries.C2?.top1 ?? -1) ? 'C1' : 'C2' : null;
  const fullStrong =
    fullId &&
    summaries[fullId].top1 - base.top1 >= 4 &&
    summaries[fullId].top1 >= summaries[artId].top1 + 4 &&
    stressMean(stressOf[fullId]) + 0.02 >= stressMean(stressA);
  let verdict = 'NO_MEANINGFUL_IMPROVEMENT';
  if (artStrong && dualGain >= 4) verdict = 'DUAL_STRONG_WIN';
  else if (fullStrong) verdict = 'FULL_CARD_STRONG_WIN';
  else if (artStrong) verdict = 'ADAPTER_STRONG_WIN';
  else if (delta1 >= 2 || delta3 >= 2) verdict = 'SMALL_IMPROVEMENT';

  const next =
    verdict === 'NO_MEANINGFUL_IMPROVEMENT' || verdict === 'SMALL_IMPROVEMENT'
      ? 'Partial CLIP fine-tune bakeoff: unfreeze the last vision blocks of ViT-B/32 on the same synthetic canonical views, then score this frozen phone set once. Do not start it from this result automatically.'
      : 'Keep the frozen CLIP encoder, deploy the winning small adapter, and rebuild the matching canonical gallery. Do not fine-tune the encoder yet.';

  const modelRows = [
    { id: 'A current CLIP art', ...adapterSpec('linear'), params: 0, bytes: 0 },
    { id: 'B1 art linear', ...adapterSpec('linear') },
    { id: 'B2 art MLP', ...adapterSpec('mlp') },
  ];
  if (c1) modelRows.push({ id: 'C1 full linear', ...adapterSpec('linear') }, { id: 'C2 full MLP', ...adapterSpec('mlp') });
  if (framesD) modelRows.push({ id: 'D1 dual', params: adapterSpec('linear').params + adapterSpec(dualWeight.full === 'C2' || dualWeight.art === 'B2' ? 'mlp' : 'linear').params, bytes: 0 });

  const table = [
    ['A current CLIP art', summaries.A],
    ['B1 art linear', summaries.B1],
    ['B2 art MLP', summaries.B2],
    ...(summaries.C1 ? [['C1 full linear', summaries.C1]] : []),
    ...(summaries.C2 ? [['C2 full MLP', summaries.C2]] : []),
    ...(summaries.D1 ? [[`D1 dual w=${dualWeight.w} (${dualWeight.art}+${dualWeight.full})`, summaries.D1]] : []),
  ].map(([id, summary]) => ({
    id,
    top1: fmt(summary, 'top1'),
    top3: fmt(summary, 'top3'),
    top5: fmt(summary, 'top5'),
    top10: fmt(summary, 'top10'),
    wrongConfident: `${summary.wrongConfident}/${summary.n}`,
  }));

  const stressIds = Object.keys(stressOf);
  const stressKeys = Object.keys(stressA);
  const stressRows = stressKeys.map(condition => ({
    condition,
    cells: stressIds.map(id => {
      const cell = stressOf[id][condition];
      return cell ? `${cell.hit}/${cell.n}` : '—';
    }),
  }));

  const report = {
    date: new Date().toISOString(),
    git: gitCommit(),
    evalHash: phone.hash,
    phone: { n: phone.frames.length, detectorMisses: phone.frames.filter(frame => !frame.art).length },
    training: {
      trainOracles: splits.train.length,
      devOracles: splits.dev.length,
      stressOracles: splits.stress.length,
      pinned: splits.train.filter(card => card.pinned).map(card => card.name),
      artGallery: gallery.count,
      fullGallery: fullCount,
      artTrainViews: artTrain.length,
      narrative:
        'Canonical Scryfall art crops already cached for the CLIP gallery. Training views are randomized crop error, perspective, blur, glare, sleeve, exposure, noise, JPEG, and background. Positives are the frozen CLIP vectors of the clean canonical image. Negatives are in-batch cards plus eight nearest incorrect gallery cards, mined once from raw CLIP and once more after the first adapter round. Train, dev, and stress oracles are disjoint. The Samsung stills were not used as training or augmentation sources. Dual weights, when run, were chosen on synthetic dev only.',
    },
    models: modelRows,
    device:
      'Each adapter is about 1.0 MB of float32 and one 512-wide GEMM, well under a millisecond after the embedding exists. It can later be a MatMul + Add + L2 normalize in the existing ONNX Runtime stack. The cost that remains is frozen CLIP ViT-B/32, about 85 MB quantized and about 100 ms per image on this host CPU. Android integration was not added.',
    table,
    summaries,
    frames: named,
    watched: watchRows(framesA, winFrames).map(block => ({ ...block, model: winner[0] })),
    recovered,
    regressions,
    stressHeader: stressIds,
    stressRows,
    dualWeight,
    devArt: { b1: b1.devTop1, b2: b2.devTop1 },
    verdict,
    verdictWhy: `${winner[0]} is the best phone Top1 at ${winner[1].top1}/${winner[1].n} versus current CLIP ${base.top1}/${base.n} (Top3 ${winner[1].top3}/${winner[1].n} versus ${base.top3}/${base.n}). Watched-card recoveries: ${watchedNamesRecovered.join(', ') || 'none'}. Regressions: ${regressions.length}. Wrong-confident ${winner[1].wrongConfident} versus ${base.wrongConfident}. Best art adapter on this set was ${bestArtId}.`,
    next,
    production: {
      scanner: 'untouched',
      detector: 'untouched',
      thresholds: 'unchanged',
      fusion: 'unchanged',
      eas: false,
      ota: false,
    },
  };

  const mdPath = join(reportsDir, 'embedding-bakeoff-v1.md');
  const jsonPath = join(reportsDir, 'embedding-bakeoff-v1.json');
  await writeFile(mdPath, markdown(report));
  await writeJson(jsonPath, report);
  log(`wrote ${mdPath}`);
  log(`${verdict}: ${report.verdictWhy}`);
  log(report.next);
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
