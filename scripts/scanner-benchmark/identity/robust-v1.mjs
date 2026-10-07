#!/usr/bin/env node
/**
 * Phone-domain robustness. Diagnosis and one training run. Nothing is deployed.
 *
 * CLIP stays frozen. The identity split stays frozen. Geometry stays frozen.
 * The three degraded views are the existing stress presets, unchanged:
 *   blur { blur: 2.4 }
 *   motion { motion: 9 }
 *   perspective { perspective: 0.09 }
 * Seeds are `${scryfallId}:domain:${presetId}`, the same keys as the seven-card diagnosis.
 *
 * Experiment A uses the current linear adapter and every gallery art:
 *   A1 max similarity across clean + blur + motion + perspective
 *   A2 one vector per art: mean of those four adapted vectors, then L2-normalized
 * Experiment B starts from the current linear adapter and trains the same linear
 * model. For the same synthetic oracle pool as the previous run (up to two of the
 * existing crop3 / blur-glare / perspective / mixed views, capped at 1200), each
 * oracle also gets blur, motion, and perspective. Those three are 3 of the up-to-5
 * synthetic queries. Clean gallery art stays the positive. Real train-split phone
 * crops and hard-negative mining stay. Dev is scored before the holdout. The
 * holdout is scored once, after that, and is not used to retrain.
 *
 * Verdict, locked before the holdout scores:
 *   A gainer has holdout Top1 above the current adapter on the clean gallery
 *   and zero regressions against that baseline.
 *   If multi-view Top1 exceeds the single prototype by at most 1, the prototype
 *   is the gallery strategy.
 *   COMBINED_WIN only when the new adapter plus that gallery strategy beats both
 *   the gallery strategy and the new adapter alone by at least 1 Top1, with zero
 *   regressions.
 *   Otherwise the safest gainer is ROBUST_GALLERY_WIN or AUGMENTATION_TRAINING_WIN.
 *   No gainer is NO_ROBUST_GAIN.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { open, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { env, pipeline } from '@xenova/transformers';

import { loadEncoder } from '../../recognition/encoders.mjs';
import { identityMatches } from '../../recognition/scoring.mjs';
import { rootDir, reportsDir } from '../lib/paths.mjs';
import { renderView } from '../embedding/augment.mjs';
import {
  adamState,
  adamStep,
  applyGallery,
  backward,
  cloneModel,
  forward,
  infonce,
  loadModel,
  mulberry32,
  saveModel,
  zeroLike,
} from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';

const DIMS = 512;
const TAU = 0.07;
const HARD_K = 8;
const BATCH = 32;
const VIEWS = [
  { id: 'blur', preset: { blur: 2.4 } },
  { id: 'motion', preset: { motion: 9 } },
  { id: 'perspective', preset: { perspective: 0.09 } },
];
const LEGACY = ['crop3', 'blur-glare', 'perspective', 'mixed'];
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');
const artDir = join(rootDir, '.scan-fixtures/visual-embed/art-crops');
const artRoot = join(rootDir, '.scan-fixtures/embedding-bakeoff/emb/art');
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const outDir = join(reportsDir, 'identity-robust-v1');
const challengerPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-robust-aug-v1.json');
const currentPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');

env.cacheDir = join(rootDir, '.scan-fixtures/transformers-cache');
env.allowLocalModels = false;

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const l2 = vector => {
  let s = 0;
  for (let i = 0; i < vector.length; i++) s += vector[i] * vector[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / n;
  return out;
};

const dot = (a, b) => {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
};

const copyRow = (embeddings, row) => embeddings.slice(row * DIMS, (row + 1) * DIMS);

const rankQuery = (embeddings, refs, count, query, expected) => {
  const best = new Map();
  for (let i = 0; i < count; i++) {
    let score = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) score += query[d] * embeddings[offset + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || score > prev.score) best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
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
    margin,
    wrongConfident: Boolean(top1) && rankIdx !== 0 && margin != null && margin >= 0.05,
    expectedScore: rankIdx >= 0 ? ranked[rankIdx].score : null,
  };
};

const summarize = rows => {
  const ranks = rows.map(row => row.rank).filter(rank => rank != null);
  const sorted = ranks.slice().sort((a, b) => a - b);
  const count = key => rows.filter(row => row[key]).length;
  return {
    n: rows.length,
    top1: count('top1'),
    top3: count('top3'),
    top5: count('top5'),
    top10: count('top10'),
    wrongConfident: count('wrongConfident'),
    meanRank: ranks.length ? Number((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length).toFixed(2)) : null,
    medianRank: ranks.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
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

const scoreRows = (frames, embeddings, refs) =>
  frames.map(frame => {
    const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
    return { ...frame, ...rankQuery(embeddings, refs, refs.length, frame.query, expected) };
  });

const meanPrototype = views => {
  const out = new Float32Array(views[0].length);
  for (const view of views) {
    for (let i = 0; i < out.length; i++) out[i] += view[i];
  }
  const count = out.length / DIMS;
  const nViews = views.length;
  for (let i = 0; i < count; i++) {
    const offset = i * DIMS;
    let s = 0;
    for (let d = 0; d < DIMS; d++) {
      out[offset + d] /= nViews;
      s += out[offset + d] * out[offset + d];
    }
    const n = Math.sqrt(s) || 1;
    for (let d = 0; d < DIMS; d++) out[offset + d] /= n;
  }
  return out;
};

const artDots = (embeddings, query) => {
  const count = embeddings.length / DIMS;
  const scores = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let score = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) score += query[d] * embeddings[offset + d];
    scores[i] = score;
  }
  return scores;
};

const maxDots = (views, query) => {
  const scores = artDots(views[0], query);
  for (let v = 1; v < views.length; v++) {
    const next = artDots(views[v], query);
    for (let i = 0; i < scores.length; i++) if (next[i] > scores[i]) scores[i] = next[i];
  }
  return scores;
};

const rankScores = (scores, refs, expected) => {
  const best = new Map();
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || scores[i] > prev.score) best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score: scores[i] });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
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
    margin,
    wrongConfident: Boolean(top1) && rankIdx !== 0 && margin != null && margin >= 0.05,
    expectedScore: rankIdx >= 0 ? ranked[rankIdx].score : null,
  };
};

const scoreMax = (frames, views, refs) =>
  frames.map(frame => {
    const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
    return { ...frame, ...rankScores(maxDots(views, frame.query), refs, expected) };
  });

const topWrong = (embeddings, refs, query, oracleId) => {
  const ranked = [];
  for (let i = 0; i < refs.length; i++) {
    if (refs[i].oracleId === oracleId) continue;
    let score = 0;
    const offset = i * DIMS;
    for (let d = 0; d < DIMS; d++) score += query[d] * embeddings[offset + d];
    if (ranked.length < HARD_K) {
      ranked.push({ row: i, score });
      ranked.sort((a, b) => a.score - b.score);
    } else if (score > ranked[0].score) {
      ranked[0] = { row: i, score };
      ranked.sort((a, b) => a.score - b.score);
    }
  }
  return ranked.sort((a, b) => b.score - a.score).map(hit => hit.row);
};

const trainAdapter = (model, samples, raw, refs, phoneNegatives) => {
  const state = adamState(model);
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
      const rng = mulberry32(3100 + epoch);
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
            const row = rows[k] ?? Math.floor(rng() * refs.length);
            const hv = copyRow(raw, row);
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
        adamStep(model, grads, state, { lr: 1.5e-4, t: step });
        lossSum += loss;
        batches += 1;
      }
      log(`linear epoch ${epoch + 1} loss ${(lossSum / Math.max(1, batches)).toFixed(4)}`);
    }
  };
  runEpochs(3);
  log('remining hard negatives');
  const adapted = applyGallery(model, raw, refs.length, DIMS);
  for (const sample of samples.filter(row => row.kind === 'phone')) {
    hard.set(sample.oracleId, topWrong(adapted, refs, forward(model, sample.q).y, sample.oracleId));
  }
  runEpochs(2);
  return model;
};

const loadRaw = () => floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const loadRefs = () => JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));

const embedBatch = async (extractor, refs, start, view) => {
  const paths = [];
  for (let i = start; i < Math.min(refs.length, start + BATCH); i++) {
    const id = refs[i].scryfallId;
    const source = join(artDir, `${id}.jpg`);
    const jpg = await renderView(source, view.preset, `${id}:domain:${view.id}`);
    const path = join(tmpdir(), `lugin-robust-${view.id}-${i}.jpg`);
    await writeFile(path, jpg);
    paths.push(path);
  }
  const out = await extractor(paths, { pooling: 'mean', normalize: true });
  const data = out.data;
  const vectors = [];
  for (let i = 0; i < paths.length; i++) {
    vectors.push(l2(data.subarray(i * DIMS, (i + 1) * DIMS)));
    await unlink(paths[i]).catch(() => {});
  }
  return vectors;
};

const ensureViews = async (refs, extractor) => {
  mkdirSync(viewDir, { recursive: true });
  const bytes = refs.length * DIMS * 4;
  for (const view of VIEWS) {
    const path = join(viewDir, `${view.id}.bin`);
    const mark = join(viewDir, `${view.id}.progress`);
    let done = existsSync(mark) ? Number(readFileSync(mark, 'utf8')) : 0;
    if (!existsSync(path) || statSync(path).size !== bytes) {
      const created = await open(path, 'w+');
      await created.truncate(bytes);
      await created.close();
      done = 0;
    }
    if (done >= refs.length) {
      log(`${view.id} already complete`);
      continue;
    }
    const handle = await open(path, 'r+');
    const started = Date.now();
    const startedAt = done;
    for (let cursor = done; cursor < refs.length; cursor += BATCH) {
      const vectors = await embedBatch(extractor, refs, cursor, view);
      const chunk = new Float32Array(vectors.length * DIMS);
      vectors.forEach((vector, index) => chunk.set(vector, index * DIMS));
      await handle.write(Buffer.from(chunk.buffer), 0, chunk.byteLength, cursor * DIMS * 4);
      done = cursor + vectors.length;
      await writeFile(mark, String(done));
      if (done % 2048 < BATCH || done === refs.length) {
        const elapsed = (Date.now() - started) / 1000;
        const seen = Math.max(1, done - startedAt);
        const left = ((refs.length - done) * elapsed) / seen / 60;
        log(`${view.id} ${done}/${refs.length} ${left.toFixed(0)} min left`);
      }
    }
    await handle.close();
    log(`${view.id} done`);
  }
};

const readView = id => floatsFrom(join(viewDir, `${id}.bin`));

const legacyPool = (refs, blocked) => {
  const firstRow = new Map();
  refs.forEach((ref, row) => {
    if (!firstRow.has(ref.oracleId)) firstRow.set(ref.oracleId, row);
  });
  const ids = readdirSync(artRoot).filter(id => firstRow.has(id) && !blocked.has(id)).sort();
  const chosen = [];
  let samples = 0;
  for (const id of ids) {
    const legacy = [];
    for (const aug of LEGACY) {
      if (!existsSync(join(artRoot, id, `${aug}.f32`))) continue;
      legacy.push(aug);
      if (legacy.length >= 2) break;
    }
    if (!legacy.length) continue;
    chosen.push({ id, row: firstRow.get(id), legacy });
    samples += legacy.length;
    if (samples >= 1200) break;
  }
  return chosen;
};

const ensureTrainViews = async (chosen, refs, extractor) => {
  const pending = [];
  for (const oracle of chosen) {
    const dir = join(viewDir, 'train', oracle.id);
    for (const view of VIEWS) {
      const path = join(dir, `${view.id}.f32`);
      if (!existsSync(path) || statSync(path).size !== DIMS * 4) pending.push({ oracle, view, path, dir });
    }
  }
  log(`train views to embed ${pending.length}`);
  for (let start = 0; start < pending.length; start += BATCH) {
    const slice = pending.slice(start, start + BATCH);
    const paths = [];
    for (const item of slice) {
      const id = refs[item.oracle.row].scryfallId;
      const jpg = await renderView(join(artDir, `${id}.jpg`), item.view.preset, `${id}:domain:${item.view.id}`);
      const path = join(tmpdir(), `lugin-train-${start}-${paths.length}.jpg`);
      await writeFile(path, jpg);
      paths.push(path);
    }
    const out = await extractor(paths, { pooling: 'mean', normalize: true });
    slice.forEach((item, index) => {
      mkdirSync(item.dir, { recursive: true });
      const vector = l2(out.data.subarray(index * DIMS, (index + 1) * DIMS));
      writeVector(item.path, vector);
    });
    for (const path of paths) await unlink(path).catch(() => {});
    if (start % (BATCH * 20) === 0) log(`train views ${Math.min(pending.length, start + BATCH)}/${pending.length}`);
  }
};

const writeVector = (path, vector) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
};

const buildSamples = (chosen, raw) => {
  const samples = [];
  for (const oracle of chosen) {
    const positive = copyRow(raw, oracle.row);
    for (const aug of oracle.legacy) {
      samples.push({ oracleId: oracle.id, q: floatsFrom(join(artRoot, oracle.id, `${aug}.f32`)), p: positive, kind: 'synthetic' });
    }
    for (const view of VIEWS) {
      samples.push({
        oracleId: oracle.id,
        q: floatsFrom(join(viewDir, 'train', oracle.id, `${view.id}.f32`)),
        p: positive,
        kind: 'synthetic',
      });
    }
  }
  return samples;
};

const falseMatches = (before, after) => {
  let changedTop = 0;
  let newErrors = 0;
  const examples = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i].top1Name === after[i].top1Name) continue;
    changedTop += 1;
    if (!after[i].top1) {
      newErrors += 1;
      examples.push({
        card: before[i].cardName ?? before[i].label,
        from: before[i].top1Name,
        to: after[i].top1Name,
        wasCorrect: before[i].top1,
      });
    }
  }
  return { changedTop, newErrors, examples };
};

const verdictOf = systems => {
  const base = systems.current;
  const gallery = systems.multiview.top1 - systems.prototype.top1 <= 1 ? systems.prototype : systems.multiview;
  const galleryId = gallery === systems.prototype ? 'prototype' : 'multiview';
  const gain = row => row.top1 > base.top1 && row.regressions === 0;
  const candidates = [
    { id: galleryId, row: gallery },
    { id: 'adapter', row: systems.adapter },
  ];
  const gainers = candidates.filter(item => gain(item.row));
  const combinedBeats =
    systems.combined.top1 >= gallery.top1 + 1 &&
    systems.combined.top1 >= systems.adapter.top1 + 1 &&
    systems.combined.regressions === 0;
  if (combinedBeats) return { verdict: 'COMBINED_WIN', galleryId };
  const best = gainers.sort((a, b) => b.row.top1 - a.row.top1 || a.row.regressions - b.row.regressions)[0];
  if (!best) return { verdict: 'NO_ROBUST_GAIN', galleryId };
  if (best.id === 'adapter') return { verdict: 'AUGMENTATION_TRAINING_WIN', galleryId };
  return { verdict: 'ROBUST_GALLERY_WIN', galleryId };
};

const costOf = count => {
  const bytes = count * DIMS * 4;
  return {
    embeddings: count,
    bytes,
    megabytes: Number((bytes / 1e6).toFixed(1)),
    comparisons: count,
  };
};

const attachQueries = (frames, model) =>
  frames.map(frame => ({
    frameId: frame.frameId,
    label: frame.label,
    cardName: frame.cardName,
    oracleId: frame.oracleId,
    split: frame.split,
    query: forward(model, floatsFrom(frame.oraclePath.replace(/\.png$/, '.f32'))).y,
  }));

const main = async () => {
  const refs = loadRefs();
  const raw = loadRaw();
  const current = loadModel(JSON.parse(readFileSync(currentPath, 'utf8')));
  const splits = JSON.parse(readFileSync(join(dataDir, 'splits.json'), 'utf8'));
  const blocked = new Set([...(splits.holdout ?? []), ...(splits.dev ?? [])]);
  const frames = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8')).filter(frame => frame.oraclePath);
  const devFrames = frames.filter(frame => frame.split === 'dev');
  const holdFrames = frames.filter(frame => frame.split === 'holdout');
  const phoneTrain = frames.filter(frame => frame.split === 'train');
  const chosen = legacyPool(refs, blocked);
  log(`synthetic oracles ${chosen.length} phone ${phoneTrain.length} holdout ${holdFrames.length}`);

  log('loading CLIP');
  const encoder = (await loadEncoder('CLIP_VIT_B32')).runtime;
  const extractor = await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { quantized: true });
  const probeId = refs[0].scryfallId;
  const probePath = join(artDir, `${probeId}.jpg`);
  const probeJpg = await renderView(probePath, VIEWS[0].preset, `${probeId}:domain:blur`);
  const probeFile = join(tmpdir(), 'lugin-robust-probe.jpg');
  await writeFile(probeFile, probeJpg);
  const single = l2(Float32Array.from(await encoder.embedPath(probeFile)));
  const batched = (await embedBatch(extractor, [refs[0]], 0, VIEWS[0]))[0];
  const probe = dot(single, batched);
  await unlink(probeFile).catch(() => {});
  if (probe < 0.999) throw new Error(`batch CLIP diverges from embedPath: ${probe}`);
  log(`CLIP batch matches embedPath ${probe.toFixed(6)}`);

  await ensureTrainViews(chosen, refs, extractor);
  let trained;
  if (existsSync(challengerPath)) {
    trained = loadModel(JSON.parse(readFileSync(challengerPath, 'utf8')));
    log('loaded saved augmentation adapter');
  } else {
    const samples = buildSamples(chosen, raw);
    const phoneSamples = phoneTrain.map(frame => ({
      oracleId: frame.oracleId,
      q: floatsFrom(frame.oraclePath.replace(/\.png$/, '.f32')),
      p: copyRow(raw, chosen.find(oracle => oracle.id === frame.oracleId)?.row ?? refs.findIndex(ref => ref.oracleId === frame.oracleId)),
      kind: 'phone',
    }));
    const currentGallery = applyGallery(current, raw, refs.length, DIMS);
    const phoneNegatives = new Map();
    for (const sample of phoneSamples) {
      phoneNegatives.set(sample.oracleId, topWrong(currentGallery, refs, forward(current, sample.q).y, sample.oracleId));
    }
    for (const sample of samples) {
      if (phoneNegatives.has(sample.oracleId)) continue;
      phoneNegatives.set(sample.oracleId, topWrong(currentGallery, refs, forward(current, sample.q).y, sample.oracleId));
      if (phoneNegatives.size >= 240) break;
    }
    log(`training samples synthetic ${samples.length} phone ${phoneSamples.length}`);
    trained = trainAdapter(cloneModel(current), [...samples, ...phoneSamples], raw, refs, phoneNegatives);
    mkdirSync(join(challengerPath, '..'), { recursive: true });
    await writeFile(challengerPath, `${JSON.stringify({
      ...saveModel(trained),
      note: 'Not deployed. Augmentation-trained linear challenger. Champion remains B1.',
    }, null, 2)}\n`);
  }

  const devCurrent = scoreRows(attachQueries(devFrames, current), applyGallery(current, raw, refs.length, DIMS), refs);
  const devTrained = scoreRows(attachQueries(devFrames, trained), applyGallery(trained, raw, refs.length, DIMS), refs);
  const devReport = {
    current: summarize(devCurrent),
    trained: summarize(devTrained),
    pairs: pairs(devCurrent, devTrained),
  };
  mkdirSync(outDir, { recursive: true });
  await writeFile(join(outDir, 'dev.json'), `${JSON.stringify(devReport, null, 2)}\n`);
  log(`dev current ${devReport.current.top1}/${devReport.current.n} trained ${devReport.trained.top1}/${devReport.trained.n} fixes ${devReport.pairs.fixes} regressions ${devReport.pairs.regressions}`);
  log('holdout stays untouched until the gallery views finish');

  await ensureViews(refs, extractor);
  const blur = readView('blur');
  const motion = readView('motion');
  const perspective = readView('perspective');
  log('adapting four gallery views with the current adapter');
  const currentViews = [raw, blur, motion, perspective].map(view => applyGallery(current, view, refs.length, DIMS));
  log('adapting four gallery views with the augmentation adapter');
  const trainedViews = [raw, blur, motion, perspective].map(view => applyGallery(trained, view, refs.length, DIMS));
  const currentProto = meanPrototype(currentViews);
  const trainedProto = meanPrototype(trainedViews);

  const holdCurrent = attachQueries(holdFrames, current);
  const holdTrained = attachQueries(holdFrames, trained);
  const systems = {
    current: scoreRows(holdCurrent, currentViews[0], refs),
    multiview: scoreMax(holdCurrent, currentViews, refs),
    prototype: scoreRows(holdCurrent, currentProto, refs),
    adapter: scoreRows(holdTrained, trainedViews[0], refs),
  };
  const yuriko = systems.current.find(row => row.label === 'geometry-test-20261006-150559 geom-001');
  if (!yuriko || Math.abs(yuriko.expectedScore - 0.3857) > 0.002) {
    throw new Error(`clean gallery scorer drifted: ${yuriko?.expectedScore}`);
  }
  const galleryPick = systems.multiview.filter(row => row.top1).length - systems.prototype.filter(row => row.top1).length <= 1
    ? 'prototype'
    : 'multiview';
  systems.combined = galleryPick === 'prototype'
    ? scoreRows(holdTrained, trainedProto, refs)
    : scoreMax(holdTrained, trainedViews, refs);

  const pack = rowset => {
    const stats = summarize(rowset);
    return stats;
  };
  const base = systems.current;
  const named = {
    current: { ...pack(systems.current), ...pairs(base, systems.current) },
    multiview: { ...pack(systems.multiview), ...pairs(base, systems.multiview) },
    prototype: { ...pack(systems.prototype), ...pairs(base, systems.prototype) },
    adapter: { ...pack(systems.adapter), ...pairs(base, systems.adapter) },
    combined: { ...pack(systems.combined), ...pairs(base, systems.combined) },
  };
  const decision = verdictOf(named);
  const misses = JSON.parse(readFileSync(join(reportsDir, 'identity-printing-v1/summary.json'), 'utf8')).rows;
  const hard = misses.map(miss => {
    const at = rowset => rowset.find(row => row.frameId === frames.find(frame => frame.oracleId === miss.oracleId && (miss.label == null || frame.label === miss.label))?.frameId);
    return {
      cardName: miss.cardName,
      label: miss.label,
      current: at(systems.current)?.rank ?? null,
      multiview: at(systems.multiview)?.rank ?? null,
      prototype: at(systems.prototype)?.rank ?? null,
      adapter: at(systems.adapter)?.rank ?? null,
      combined: at(systems.combined)?.rank ?? null,
      tops: {
        current: at(systems.current)?.top1Name ?? null,
        multiview: at(systems.multiview)?.top1Name ?? null,
        prototype: at(systems.prototype)?.top1Name ?? null,
        adapter: at(systems.adapter)?.top1Name ?? null,
        combined: at(systems.combined)?.top1Name ?? null,
      },
    };
  });
  const costs = {
    clean: costOf(refs.length),
    multiview: costOf(refs.length * 4),
    prototype: costOf(refs.length),
    adapter: costOf(refs.length),
    combined: costOf(galleryPick === 'prototype' ? refs.length : refs.length * 4),
  };
  const falses = {
    multiview: falseMatches(systems.current, systems.multiview),
    prototype: falseMatches(systems.current, systems.prototype),
    adapter: falseMatches(systems.current, systems.adapter),
    combined: falseMatches(systems.current, systems.combined),
  };
  const report = {
    verdict: decision.verdict,
    galleryPick,
    rule: 'A gainer needs holdout Top1 above the current clean gallery and zero regressions. Multi-view must beat the prototype by more than 1 Top1 or the prototype is preferred. Combined wins only when it beats both independent gainers by at least 1 Top1 with zero regressions.',
    dev: devReport,
    systems: named,
    hard,
    costs,
    falses,
    training: {
      oracles: chosen.length,
      dominant: 'blur, motion, perspective plus up to two legacy views',
      init: 'linear-identity-v1',
    },
  };
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  const line = row => `${row.top1}/${row.n} | ${row.top3}/${row.n} | ${row.top5}/${row.n} | ${row.top10}/${row.n} | ${row.wrongConfident}/${row.n} | ${row.fixes} | ${row.regressions} | ${row.meanRank} | ${row.medianRank}`;
  const lines = [
    '# PHONE-DOMAIN ROBUSTNESS',
    '',
    'CLIP stayed frozen. The holdout was scored once.',
    '',
    `Verdict: **${decision.verdict}**`,
    '',
    `Gallery strategy used for the combined system: ${galleryPick}.`,
    '',
    '| System | Top1 | Top3 | Top5 | Top10 | Wrong-confident | Fixes | Regressions | Mean rank | Median rank |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| Current adapter, clean gallery | ${line(named.current)} |`,
    `| Current adapter, multi-view max | ${line(named.multiview)} |`,
    `| Current adapter, mean prototype | ${line(named.prototype)} |`,
    `| Augmentation adapter, clean gallery | ${line(named.adapter)} |`,
    `| Augmentation adapter, ${galleryPick} gallery | ${line(named.combined)} |`,
    '',
  ];
  await writeFile(join(reportsDir, 'identity-robust-v1.md'), `${lines.join('\n')}\n`);
  log(decision.verdict);
  log(JSON.stringify(named, null, 2));
  log(JSON.stringify(hard, null, 2));
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
