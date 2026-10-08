#!/usr/bin/env node
/**
 * Recognition search on frozen GBM geometry.
 * TRAIN/CV only unless --validate-dev or --final-holdout is passed.
 *
 *   yarn scanner:recognition-autolab
 *   node scripts/scanner-benchmark/identity/recognition-autolab.mjs --validate-dev <id>
 *   node scripts/scanner-benchmark/identity/recognition-autolab.mjs --final-holdout <id>
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PUBLISH_MARGIN } from './agreement.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { rootDir } from '../lib/paths.mjs';

const DIMS = 512;
const VIEWS = ['clean', 'blur', 'motion', 'perspective'];
const labDir = join(rootDir, 'scanner-benchmark/recognition-registry/autolab');
const modelDir = join(labDir, 'challengers');
const adaptedDir = join(labDir, 'adapted');
const adapterPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');
const geometryPath = join(rootDir, 'scanner-benchmark/reports/frozen-recognition-v1/geometry.jsonl');
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');

const log = message => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
const argValue = name => {
  const eq = process.argv.find(arg => arg.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
};
const finalHoldout = process.argv.includes('--final-holdout');
const devId = argValue('validate-dev');
const holdoutId = finalHoldout ? argValue('final-holdout') : null;

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};
const writeFloats = (path, array) => writeFileSync(path, Buffer.from(array.buffer, array.byteOffset, array.byteLength));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const round = (value, digits = 4) => (value == null || Number.isNaN(value) ? null : Number(value.toFixed(digits)));

const simplex = steps => {
  const out = [];
  const unit = 1 / steps;
  for (let a = 0; a <= steps; a++) {
    for (let b = 0; b <= steps - a; b++) {
      for (let c = 0; c <= steps - a - b; c++) {
        const d = steps - a - b - c;
        out.push([a * unit, b * unit, c * unit, d * unit]);
      }
    }
  }
  return out;
};

const weightKey = weights => weights.map(value => value.toFixed(3)).join(',');

const neighbors = weights => {
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (i === j || weights[i] < 0.05) continue;
      const next = weights.slice();
      next[i] = Math.round((next[i] - 0.05) * 1000) / 1000;
      next[j] = Math.round((next[j] + 0.05) * 1000) / 1000;
      if (next.every(value => value >= -1e-9)) out.push(next.map(value => Math.max(0, value)));
    }
  }
  return out;
};

const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
};

const metricsOf = rows => {
  const ranks = rows.map(row => row.rank).filter(rank => rank != null);
  const published = rows.filter(row => row.publish);
  const correctPublished = published.filter(row => row.correctTop1).length;
  const wrongPublished = published.filter(row => !row.correctTop1).length;
  return {
    n: rows.length,
    top1: rows.filter(row => row.correctTop1).length,
    top3: rows.filter(row => row.rank != null && row.rank <= 3).length,
    top5: rows.filter(row => row.rank != null && row.rank <= 5).length,
    top10: rows.filter(row => row.rank != null && row.rank <= 10).length,
    correctPublished,
    wrongPublished,
    withheldCorrect: rows.filter(row => row.correctTop1 && !row.publish).length,
    wrongWithheld: rows.filter(row => !row.correctTop1 && !row.publish).length,
    precision: published.length ? correctPublished / published.length : null,
    recall: rows.length ? correctPublished / rows.length : null,
    safeHit: rows.length ? correctPublished / rows.length : null,
    meanRank: ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null,
    medianRank: quantile(ranks, 0.5),
  };
};

const lexBetter = (a, b) => {
  const keys = [
    ['wrongPublished', -1],
    ['correctPublished', 1],
    ['top1', 1],
    ['top3', 1],
    ['top5', 1],
    ['medianRank', -1],
    ['meanRank', -1],
  ];
  for (const [key, direction] of keys) {
    const delta = (a[key] ?? 0) - (b[key] ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    return delta * direction > 0;
  }
  return false;
};

const assignFolds = frames => {
  const groups = new Map();
  for (const frame of frames) {
    const list = groups.get(frame.oracleId) ?? [];
    list.push(frame);
    groups.set(frame.oracleId, list);
  }
  const ids = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length || a.localeCompare(b));
  const load = [0, 0, 0, 0, 0];
  const foldOf = new Map();
  for (const id of ids) {
    let best = 0;
    for (let fold = 1; fold < 5; fold++) if (load[fold] < load[best]) best = fold;
    foldOf.set(id, best);
    load[best] += groups.get(id).length;
  }
  for (const frame of frames) frame.fold = foldOf.get(frame.oracleId);
  return load;
};

const loadChallenger = id => {
  const path = join(modelDir, `${id}.json`);
  if (!existsSync(path)) throw new Error(`refusing eval: no frozen challenger ${id}`);
  return JSON.parse(readFileSync(path, 'utf8'));
};

const guard = () => {
  if (finalHoldout && devId) throw new Error('choose either --validate-dev or --final-holdout');
  if (finalHoldout) {
    if (!holdoutId) throw new Error('pass --final-holdout <challenger-id>');
    const artifact = loadChallenger(holdoutId);
    if (!artifact.dev) throw new Error('refusing --final-holdout before dev validation is recorded');
    if (String(artifact.devStatus).startsWith('rejected')) throw new Error(`refusing --final-holdout for ${artifact.devStatus}`);
    return artifact;
  }
  if (devId) return loadChallenger(devId);
  return null;
};

const geometryRows = split => readFileSync(geometryPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.split === split && row.oracleId && row.paths?.learned);

const queryVector = path => {
  const rawPath = path.replace(/\.png$/, '.f32');
  if (!existsSync(rawPath)) throw new Error(`missing cached CLIP vector ${rawPath}`);
  return floatsFrom(rawPath);
};

const ensureAdapted = adapter => {
  mkdirSync(adaptedDir, { recursive: true });
  const adapterSha = sha256(adapterPath);
  const manifestPath = join(adaptedDir, 'manifest.json');
  const ready = VIEWS.every(view => existsSync(join(adaptedDir, `${view}.f32`)));
  if (ready && existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).adapterSha256 === adapterSha) {
    log('adapted galleries cached');
    return VIEWS.map(view => floatsFrom(join(adaptedDir, `${view}.f32`)));
  }
  const sources = [
    join(RAW_GALLERY_DIR, 'embeddings.bin'),
    join(viewDir, 'blur.bin'),
    join(viewDir, 'motion.bin'),
    join(viewDir, 'perspective.bin'),
  ];
  const out = [];
  for (let view = 0; view < VIEWS.length; view++) {
    log(`adapting ${VIEWS[view]}`);
    const adapted = applyGallery(adapter, floatsFrom(sources[view]), 49968, DIMS);
    writeFloats(join(adaptedDir, `${VIEWS[view]}.f32`), adapted);
    out.push(adapted);
  }
  writeFileSync(manifestPath, JSON.stringify({ adapterSha256: adapterSha, views: VIEWS, count: 49968, dims: DIMS }, null, 2));
  return out;
};

const packGram = views => {
  const count = views[0].length / DIMS;
  const gram = new Float32Array(count * 16);
  for (let art = 0; art < count; art++) {
    const base = art * 16;
    const offset = art * DIMS;
    for (let i = 0; i < 4; i++) {
      for (let j = i; j < 4; j++) {
        let score = 0;
        const left = views[i];
        const right = views[j];
        for (let d = 0; d < DIMS; d++) score += left[offset + d] * right[offset + d];
        gram[base + i * 4 + j] = score;
        gram[base + j * 4 + i] = score;
      }
    }
  }
  return gram;
};

const invNorms = (gram, weights) => {
  const count = gram.length / 16;
  const out = new Float32Array(count);
  const [w0, w1, w2, w3] = weights;
  for (let art = 0; art < count; art++) {
    const base = art * 16;
    let norm2 = w0 * w0 * gram[base] + w1 * w1 * gram[base + 5] + w2 * w2 * gram[base + 10] + w3 * w3 * gram[base + 15];
    norm2 += 2 * w0 * w1 * gram[base + 1] + 2 * w0 * w2 * gram[base + 2] + 2 * w0 * w3 * gram[base + 3];
    norm2 += 2 * w1 * w2 * gram[base + 6] + 2 * w1 * w3 * gram[base + 7] + 2 * w2 * w3 * gram[base + 11];
    out[art] = norm2 > 1e-12 ? 1 / Math.sqrt(norm2) : 0;
  }
  return out;
};

const rankViews = (dots, inv, weights, mode, oracleOf, expected, epoch, bestScore, artCount) => {
  const nArt = oracleOf.length;
  const nOracle = bestScore.length;
  const stamp = epoch[nOracle] + 1;
  epoch[nOracle] = stamp;
  const [w0, w1, w2, w3] = weights;
  const d0 = dots[0];
  const d1 = dots[1];
  const d2 = dots[2];
  const d3 = dots[3];
  let positiveArt = -1;
  let positiveScore = -2;
  for (let art = 0; art < nArt; art++) {
    const clean = d0[art];
    const blur = d1[art];
    const motion = d2[art];
    const perspective = d3[art];
    let score;
    if (mode === 1) score = Math.max(clean, blur, motion, perspective);
    else if (mode === 2) score = Math.max(clean, (w0 * clean + w1 * blur + w2 * motion + w3 * perspective) * inv[art]);
    else score = (w0 * clean + w1 * blur + w2 * motion + w3 * perspective) * inv[art];
    const oracle = oracleOf[art];
    if (epoch[oracle] !== stamp || score > bestScore[oracle]) {
      epoch[oracle] = stamp;
      bestScore[oracle] = score;
    }
    if (oracle === expected && score > positiveScore) {
      positiveScore = score;
      positiveArt = art;
    }
  }
  let top1 = -1;
  let top1Score = -2;
  let top2Score = -2;
  let expectedScore = -2;
  const top5 = [-1, -1, -1, -1, -1];
  const top5Score = [-3, -3, -3, -3, -3];
  for (let oracle = 0; oracle < nOracle; oracle++) {
    if (epoch[oracle] !== stamp) continue;
    const score = bestScore[oracle];
    if (oracle === expected) expectedScore = score;
    if (score > top1Score) {
      top2Score = top1Score;
      top1Score = score;
      top1 = oracle;
    } else if (score > top2Score) top2Score = score;
    let slot = 5;
    for (let place = 0; place < 5; place++) if (score > top5Score[place]) { slot = place; break; }
    if (slot < 5) {
      for (let place = 4; place > slot; place--) {
        top5[place] = top5[place - 1];
        top5Score[place] = top5Score[place - 1];
      }
      top5[slot] = oracle;
      top5Score[slot] = score;
    }
  }
  let better = 0;
  for (let oracle = 0; oracle < nOracle; oracle++) {
    if (epoch[oracle] === stamp && bestScore[oracle] > expectedScore + 1e-12) better += 1;
  }
  return {
    top1,
    top1Score,
    margin: top1Score - top2Score,
    rank: expectedScore <= -1.5 ? null : better + 1,
    correctTop1: top1 === expected,
    positiveArt,
    top5,
    artCount,
  };
};

const topOracleList = (dots, inv, weights, mode, oracleOf, epoch, bestScore, limit) => {
  const ranked = rankViews(dots, inv, weights, mode, oracleOf, -1, epoch, bestScore, oracleOf.length);
  const stamp = epoch[bestScore.length];
  const hits = [];
  for (let oracle = 0; oracle < bestScore.length; oracle++) {
    if (epoch[oracle] !== stamp) continue;
    hits.push([oracle, bestScore[oracle]]);
  }
  hits.sort((a, b) => b[1] - a[1]);
  return { ...ranked, top: hits.slice(0, limit) };
};

const dotQuery = (matrix, query, out) => {
  const count = out.length;
  for (let art = 0; art < count; art++) {
    let score = 0;
    const offset = art * DIMS;
    for (let d = 0; d < DIMS; d++) score += matrix[offset + d] * query[d];
    out[art] = score;
  }
};

const prepareContext = async split => {
  const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
  const oracleIds = [];
  const oracleIndex = new Map();
  const names = [];
  const oracleOf = new Int32Array(refs.length);
  for (let art = 0; art < refs.length; art++) {
    const id = refs[art].oracleId;
    let index = oracleIndex.get(id);
    if (index == null) {
      index = oracleIds.length;
      oracleIndex.set(id, index);
      oracleIds.push(id);
      names.push(refs[art].canonicalName);
    }
    oracleOf[art] = index;
  }
  const crops = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity/crops.json'), 'utf8'));
  const cropById = new Map(crops.map(row => [row.frameId, row]));
  const adapter = loadModel(JSON.parse(readFileSync(adapterPath, 'utf8')));
  const galleries = ensureAdapted(adapter);
  const gramPath = join(labDir, 'gram.f32');
  let gram;
  if (existsSync(gramPath) && existsSync(join(adaptedDir, 'manifest.json'))) gram = floatsFrom(gramPath);
  else {
    log('packing view gram');
    gram = packGram(galleries);
    writeFloats(gramPath, gram);
  }
  const rows = geometryRows(split);
  const frames = [];
  for (const row of rows) {
    const crop = cropById.get(row.frameId);
    const raw = queryVector(row.paths.learned);
    const query = forward(adapter, raw).y;
    frames.push({
      frameId: row.frameId,
      cardName: row.cardName,
      oracleId: row.oracleId,
      expected: oracleIndex.get(row.oracleId),
      query,
      learnedIou: row.learned?.iou ?? null,
      artEmitted: Boolean(row.learned?.art?.emitted),
      artConfidence: row.learned?.art?.confidence ?? 0,
      utility: row.learned?.utility ?? 0,
      secondUtility: row.learned?.secondUtility ?? 0,
      tags: crop?.tags ?? [],
      nonEnglish: Boolean(crop?.nonEnglish),
      image: crop?.image ?? null,
      learnedIndex: row.learned?.index ?? null,
      learnedPath: row.paths.learned,
    });
  }
  if (split !== 'holdout') assignFolds(frames);
  const nArt = refs.length;
  const dots = frames.map(() => [new Float32Array(nArt), new Float32Array(nArt), new Float32Array(nArt), new Float32Array(nArt)]);
  log(`dot ${frames.length} ${split} queries × 4 views`);
  for (let frame = 0; frame < frames.length; frame++) {
    for (let view = 0; view < 4; view++) dotQuery(galleries[view], frames[frame].query, dots[frame][view]);
    if ((frame + 1) % 10 === 0) log(`dots ${frame + 1}/${frames.length}`);
  }
  const epoch = new Int32Array(oracleIds.length + 1);
  const bestScore = new Float32Array(oracleIds.length);
  return { refs, oracleIds, names, oracleOf, galleries, gram, frames, dots, epoch, bestScore, adapter };
};

const configsFromWeights = (family, weights, mode) => weights.map(weight => ({ family, weights: weight, mode, key: `${family}:${weightKey(weight)}` }));

const scoreConfig = (ctx, config) => {
  const inv = config.mode === 1 ? null : invNorms(ctx.gram, config.weights);
  return ctx.frames.map((frame, index) => {
    const ranked = rankViews(ctx.dots[index], inv, config.weights, config.mode, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
    return {
      frameId: frame.frameId,
      fold: frame.fold,
      expected: frame.expected,
      top1: ranked.top1,
      margin: ranked.margin,
      rank: ranked.rank,
      correctTop1: ranked.correctTop1,
      top1Score: ranked.top1Score,
    };
  });
};

const attachPublish = (rows, cleanRows) => rows.map((row, index) => {
  const clean = cleanRows[index];
  const publish = row.margin >= PUBLISH_MARGIN && row.top1 === clean.top1 && row.top1 >= 0;
  return { ...row, publish, cleanTop1: clean.top1, cleanMargin: clean.margin, cleanScore: clean.top1Score, agreement: row.top1 === clean.top1 };
});

const oofSelect = scored => {
  const chosen = [];
  const oofRows = [];
  for (let fold = 0; fold < 5; fold++) {
    let bestKey = null;
    let bestMetrics = null;
    for (const [key, rows] of scored) {
      const metrics = metricsOf(rows.filter(row => row.fold !== fold));
      const closer = key.includes('0.250,0.250,0.250,0.250');
      if (!bestMetrics || lexBetter(metrics, bestMetrics) || (!lexBetter(bestMetrics, metrics) && closer && !String(bestKey).includes('0.250,0.250,0.250,0.250'))) {
        bestMetrics = metrics;
        bestKey = key;
      }
    }
    chosen.push(bestKey);
    for (const row of scored.get(bestKey)) if (row.fold === fold) oofRows.push(row);
  }
  return { chosen, metrics: metricsOf(oofRows), rows: oofRows };
};

const fitLogistic = (rows, labels, weights) => {
  const width = rows[0].length;
  const mean = Array(width).fill(0);
  const scale = Array(width).fill(0);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < width; j++) mean[j] += weights[i] * rows[i][j];
  for (let j = 0; j < width; j++) mean[j] /= total;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < width; j++) {
    const delta = rows[i][j] - mean[j];
    scale[j] += weights[i] * delta * delta;
  }
  for (let j = 0; j < width; j++) scale[j] = Math.sqrt(scale[j] / total) || 1;
  const coeff = Array(width + 1).fill(0);
  for (let epoch = 0; epoch < 320; epoch++) {
    const grad = Array(width + 1).fill(0);
    for (let i = 0; i < rows.length; i++) {
      let z = coeff[width];
      const scaled = [];
      for (let j = 0; j < width; j++) {
        scaled[j] = (rows[i][j] - mean[j]) / scale[j];
        z += coeff[j] * scaled[j];
      }
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const err = weights[i] * (p - labels[i]) / total;
      for (let j = 0; j < width; j++) grad[j] += err * scaled[j];
      grad[width] += err;
    }
    for (let j = 0; j < width; j++) coeff[j] -= 0.25 * (grad[j] + 0.02 * coeff[j]);
    coeff[width] -= 0.25 * grad[width];
  }
  return { mean, scale, coeff };
};

const logisticProb = (model, row) => {
  let z = model.coeff[model.coeff.length - 1];
  for (let j = 0; j < row.length; j++) z += model.coeff[j] * ((row[j] - model.mean[j]) / model.scale[j]);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
};

const candidateFeatures = (cleanTop, protoTop, cleanMargin, protoMargin) => {
  const map = new Map();
  cleanTop.forEach((hit, rank) => map.set(hit[0], { clean: hit[1], cleanRank: rank + 1, proto: 0, protoRank: 99 }));
  protoTop.forEach((hit, rank) => {
    const prev = map.get(hit[0]) ?? { clean: 0, cleanRank: 99, proto: 0, protoRank: 99 };
    prev.proto = hit[1];
    prev.protoRank = rank + 1;
    map.set(hit[0], prev);
  });
  return [...map.entries()].map(([oracle, hit]) => ({
    oracle,
    row: [hit.clean, hit.proto, Math.max(hit.clean, hit.proto), (hit.clean + hit.proto) / 2, hit.proto - hit.clean, hit.cleanRank, hit.protoRank, hit.clean > 0 && hit.proto > 0 ? 1 : 0, cleanMargin, protoMargin, (cleanTop[0]?.[1] ?? 0) - hit.clean, (protoTop[0]?.[1] ?? 0) - hit.proto],
  }));
};

const runVisual = async () => {
  const ctx = await prepareContext('train');
  const diagonal = [];
  for (let art = 0; art < 200; art++) diagonal.push(ctx.gram[art * 16]);
  const meanDiag = diagonal.reduce((sum, value) => sum + value, 0) / diagonal.length;
  if (meanDiag < 0.95 || meanDiag > 1.05) throw new Error(`adapted clean vectors are not unit norm (${meanDiag})`);
  const mix = configsFromWeights('vector-mean', simplex(4), 0);
  const sums = configsFromWeights('score-sum', simplex(4), 0).map(config => ({ ...config, family: 'score-sum', mode: 0, invOne: true, key: `score-sum:${weightKey(config.weights)}` }));
  const degraded = simplex(2).filter(weight => weight[0] === 0 && weight[1] + weight[2] + weight[3] > 0).map(weight => {
    const scale = weight[1] + weight[2] + weight[3];
    return [0, weight[1] / scale, weight[2] / scale, weight[3] / scale];
  });
  const configs = [
    ...mix,
    ...sums,
    { family: 'max-view', weights: [1, 1, 1, 1], mode: 1, key: 'max-view' },
    ...configsFromWeights('two-proto', degraded, 2),
  ];
  const unique = [];
  const seen = new Set();
  for (const config of configs) {
    if (seen.has(config.key)) continue;
    seen.add(config.key);
    unique.push(config);
  }
  log(`scoring ${unique.length} gallery configs on ${ctx.frames.length} train frames`);
  const scored = new Map();
  for (let index = 0; index < unique.length; index++) {
    const config = unique[index];
    const inv = config.mode === 1 || config.invOne ? new Float32Array(ctx.oracleOf.length).fill(1) : invNorms(ctx.gram, config.weights);
    const rows = [];
    for (let frame = 0; frame < ctx.frames.length; frame++) {
      const ranked = rankViews(ctx.dots[frame], inv, config.weights, config.mode, ctx.oracleOf, ctx.frames[frame].expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
      rows.push({
        frameId: ctx.frames[frame].frameId,
        fold: ctx.frames[frame].fold,
        expected: ctx.frames[frame].expected,
        top1: ranked.top1,
        margin: ranked.margin,
        rank: ranked.rank,
        correctTop1: ranked.correctTop1,
        top1Score: ranked.top1Score,
        top5: ranked.top5,
      });
    }
    scored.set(config.key, rows);
    if ((index + 1) % 10 === 0) log(`configs ${index + 1}/${unique.length}`);
  }
  const cleanKey = 'vector-mean:1.000,0.000,0.000,0.000';
  const baseKey = 'vector-mean:0.250,0.250,0.250,0.250';
  const clean = scored.get(cleanKey);
  for (const [key, rows] of scored) scored.set(key, attachPublish(rows, clean));
  const baseline = metricsOf(scored.get(baseKey));
  const oof = oofSelect(scored);
  const full = [];
  for (const [key, rows] of scored) {
    const metrics = metricsOf(rows);
    full.push({ key, metrics });
  }
  full.sort((a, b) => (lexBetter(a.metrics, b.metrics) ? -1 : lexBetter(b.metrics, a.metrics) ? 1 : a.key.localeCompare(b.key)));
  const winnerKey = full[0].key;
  const winner = unique.find(config => config.key === winnerKey);
  const refinedWeights = winner.family === 'vector-mean' || winner.family === 'score-sum' ? neighbors(winner.weights) : [];
  for (const weight of refinedWeights) {
    const key = `${winner.family}:${weightKey(weight)}`;
    if (scored.has(key)) continue;
    const config = { ...winner, weights: weight, key };
    const inv = config.invOne ? new Float32Array(ctx.oracleOf.length).fill(1) : invNorms(ctx.gram, weight);
    const rows = ctx.frames.map((frame, index) => {
      const ranked = rankViews(ctx.dots[index], inv, weight, config.mode, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
      return { frameId: frame.frameId, fold: frame.fold, expected: frame.expected, top1: ranked.top1, margin: ranked.margin, rank: ranked.rank, correctTop1: ranked.correctTop1, top1Score: ranked.top1Score, top5: ranked.top5 };
    });
    scored.set(key, attachPublish(rows, clean));
    unique.push(config);
  }
  const oofRefit = oofSelect(scored);
  const frozenKey = [...scored.keys()].sort((a, b) => (lexBetter(metricsOf(scored.get(a)), metricsOf(scored.get(b))) ? -1 : 1))[0];
  const equalDistance = key => {
    const weights = key.split(':')[1]?.split(',').map(Number) ?? [0.25, 0.25, 0.25, 0.25];
    if (weights.length !== 4) return 1;
    return weights.reduce((sum, value) => sum + (value - 0.25) ** 2, 0);
  };
  let frozen = baseKey;
  for (const key of scored.keys()) {
    const metrics = metricsOf(scored.get(key));
    const current = metricsOf(scored.get(frozen));
    if (lexBetter(metrics, current) || (!lexBetter(current, metrics) && equalDistance(key) < equalDistance(frozen))) frozen = key;
  }
  log(`baseline correct ${baseline.correctPublished} wrong ${baseline.wrongPublished} top1 ${baseline.top1}/${baseline.n}`);
  log(`oof ${oofRefit.metrics.correctPublished} correct ${oofRefit.metrics.wrongPublished} wrong frozen ${frozen}`);
  mkdirSync(labDir, { recursive: true });
  const summary = {
    n: ctx.frames.length,
    configs: unique.length + refinedWeights.length,
    baseline,
    oof: oofRefit,
    frozenKey: frozen,
    foldChoices: oofRefit.chosen,
    top: [...scored.entries()].map(([key, rows]) => ({ key, metrics: metricsOf(rows) })).sort((a, b) => (lexBetter(a.metrics, b.metrics) ? -1 : 1)).slice(0, 12),
  };
  writeFileSync(join(labDir, 'visual-cv.json'), JSON.stringify(summary, null, 2));
  const perFrame = {};
  for (const [key, rows] of scored) perFrame[key] = rows;
  writeFileSync(join(labDir, 'visual-rows.json'), JSON.stringify({ cleanKey, baseKey, frozen, rows: { [baseKey]: scored.get(baseKey), [frozen]: scored.get(frozen), [cleanKey]: scored.get(cleanKey) } }));
  return { ctx, scored, cleanKey, baseKey, frozen, unique, baseline, oof: oofRefit };
};

const foldStd = rows => {
  const rates = [];
  for (let fold = 0; fold < 5; fold++) {
    const part = rows.filter(row => row.fold === fold);
    if (!part.length) continue;
    rates.push(part.filter(row => row.publish && row.correctTop1).length / part.length);
  }
  const mean = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  const variance = rates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rates.length;
  return { foldRates: rates.map(value => round(value, 3)), stdev: round(Math.sqrt(variance), 3) };
};

const search = async () => {
  const visual = await runVisual();
  const { ctx, scored, baseKey, frozen } = visual;
  const procedureBeats = lexBetter(visual.oof.metrics, metricsOf(scored.get(baseKey)));
  const useKey = procedureBeats ? frozen : baseKey;
  const visualRows = scored.get(useKey);
  const spec = visual.unique.find(config => config.key === useKey) ?? {
    family: useKey.split(':')[0],
    weights: useKey.split(':')[1]?.split(',').map(Number) ?? [0.25, 0.25, 0.25, 0.25],
    mode: useKey.startsWith('max') ? 1 : useKey.startsWith('two') ? 2 : 0,
    key: useKey,
    invOne: useKey.startsWith('score-sum'),
  };
  log(`visual frozen ${useKey}`);
  const ocrPath = join(labDir, 'ocr-train.json');
  let ocr = existsSync(ocrPath) ? JSON.parse(readFileSync(ocrPath, 'utf8')) : null;
  if (!ocr) {
    ocr = await runOcr(ctx.frames, 'train');
    writeFileSync(ocrPath, JSON.stringify(ocr));
  }
  const ocrById = new Map(ocr.map(row => [row.frameId, row]));
  const policies = ['visual', 'confirm-top1', 'recover-top1', 'recover-top5', 'tie-break'];
  const policyRows = policyId => visualRows.map(row => applyPolicy(policyId, row, ocrById.get(row.frameId)));
  const policyScored = new Map(policies.map(policy => [policy, policyRows(policy)]));
  const policyOof = oofSelect(policyScored);
  let policyFrozen = 'visual';
  if (lexBetter(policyOof.metrics, metricsOf(policyScored.get('visual')))) {
    for (const policy of policies) {
      if (lexBetter(metricsOf(policyScored.get(policy)), metricsOf(policyScored.get(policyFrozen)))) policyFrozen = policy;
    }
  }
  log(`ocr policy ${policyFrozen} oof correct ${policyOof.metrics.correctPublished} wrong ${policyOof.metrics.wrongPublished}`);
  const confidence = confidenceSearch(ctx, visualRows, ocrById, policyScored.get(policyFrozen));
  const systems = [
    { id: 'baseline-agreement', rows: scored.get(baseKey), spec: { family: 'vector-mean', weights: [0.25, 0.25, 0.25, 0.25], mode: 0, policy: 'visual' } },
    { id: `visual-${useKey}`, rows: visualRows, spec: { ...spec, policy: 'visual' } },
    { id: `policy-${policyFrozen}`, rows: policyScored.get(policyFrozen), spec: { ...spec, policy: policyFrozen } },
    { id: `confidence-${confidence.threshold}`, rows: confidence.rows, spec: { ...spec, policy: policyFrozen, confidence: confidence.model, threshold: confidence.threshold } },
  ];
  let best = systems[0];
  for (const system of systems) if (lexBetter(metricsOf(system.rows), metricsOf(best.rows))) best = system;
  const failures = classifyFailures(ctx.frames, visualRows, ocrById);
  const adapterGate = failures.filter(row => row.className === 'PHONE_DOMAIN_DAMAGE').length >= 8 && !lexBetter(metricsOf(best.rows), metricsOf(systems[0].rows));
  let adapter = null;
  if (adapterGate) {
    log('adapter gate open');
    adapter = await trainAdapter(ctx, visualRows);
    if (adapter && lexBetter(adapter.metrics, metricsOf(best.rows))) {
      best = { id: 'adapter-lowrank', rows: adapter.rows, spec: { ...spec, policy: 'visual', adapter: adapter.model } };
    }
  } else log('adapter not justified');
  mkdirSync(modelDir, { recursive: true });
  const id = `rec-${createHash('sha256').update(JSON.stringify(best.spec)).digest('hex').slice(0, 12)}`;
  const artifact = {
    id,
    family: best.id,
    spec: best.spec,
    cv: metricsOf(best.rows),
    cvVariance: foldStd(best.rows),
    baselineCv: metricsOf(systems[0].rows),
    visualKey: useKey,
    policy: best.spec.policy,
    status: best.id === 'baseline-agreement' ? 'baseline-best' : 'eligible',
    createdAt: new Date().toISOString(),
    seed: 'deterministic-no-rng',
    datasetHash: sha256(join(rootDir, 'scanner-benchmark/identity/crops.json')),
    adapterHash: sha256(adapterPath),
    git: gitState(),
    failures: failureSummary(failures),
  };
  if (artifact.status === 'eligible') writeFileSync(join(modelDir, `${id}.json`), JSON.stringify(artifact, null, 2));
  writeFileSync(join(labDir, 'cv-summary.json'), JSON.stringify({ artifact, systems: systems.map(system => ({ id: system.id, metrics: metricsOf(system.rows), variance: foldStd(system.rows) })), adapterGate, ocr: ocrSummary(ocr) }, null, 2));
  writeFileSync(join(labDir, 'failures.json'), JSON.stringify(failures, null, 2));
  log(`cv winner ${best.id} status ${artifact.status} correct ${artifact.cv.correctPublished} wrong ${artifact.cv.wrongPublished}`);
  return artifact;
};

const applyPolicy = (policy, row, ocr) => {
  const exact = ocr?.exactOracle ?? null;
  const unique = Boolean(ocr?.exactUnique);
  const inTop5 = Array.isArray(row.top5) && ocr?.exactOracle != null && row.top5.includes(ocr.exactOracle);
  let publish = row.publish;
  let top1 = row.top1;
  let correctTop1 = row.correctTop1;
  if (policy === 'confirm-top1') publish = row.publish && unique && exact === row.top1;
  if (policy === 'recover-top1') publish = row.publish || (!row.publish && unique && exact === row.top1 && row.agreement);
  if (policy === 'recover-top5') {
    if (!row.publish && unique && exact != null && inTop5) {
      top1 = exact;
      correctTop1 = exact === row.expected;
      publish = true;
    }
  }
  if (policy === 'tie-break') {
    if (!row.agreement && unique && (exact === row.top1 || exact === row.cleanTop1) && row.margin >= PUBLISH_MARGIN) {
      top1 = exact;
      correctTop1 = exact === row.expected;
      publish = true;
    }
  }
  return { ...row, top1, correctTop1, publish };
};

const confidenceSearch = (ctx, visualRows, ocrById, policyRows) => {
  const rows = [];
  const labels = [];
  const sampleWeights = [];
  for (let index = 0; index < ctx.frames.length; index++) {
    const frame = ctx.frames[index];
    const visual = visualRows[index];
    const policy = policyRows[index];
    const ocr = ocrById.get(frame.frameId);
    rows.push([
      visual.margin, visual.cleanMargin, visual.top1Score, visual.cleanScore, visual.agreement ? 1 : 0,
      ocr?.exactUnique && ocr.exactOracle === visual.top1 ? 1 : 0,
      ocr?.exactUnique && ocr.exactOracle != null && ocr.exactOracle !== visual.top1 ? 1 : 0,
      ocr?.fuzzyScore ?? 0, frame.artConfidence, frame.utility - frame.secondUtility, policy.publish ? 1 : 0,
    ]);
    labels.push(visual.correctTop1 ? 1 : 0);
    sampleWeights.push(1);
  }
  const oofProb = Array(rows.length).fill(0);
  for (let fold = 0; fold < 5; fold++) {
    const trainX = [];
    const trainY = [];
    const trainW = [];
    const val = [];
    for (let index = 0; index < rows.length; index++) {
      if (ctx.frames[index].fold === fold) val.push(index);
      else {
        trainX.push(rows[index]);
        trainY.push(labels[index]);
        trainW.push(sampleWeights[index]);
      }
    }
    if (!trainX.length || !val.length) continue;
    const model = fitLogistic(trainX, trainY, trainW);
    for (const index of val) oofProb[index] = logisticProb(model, rows[index]);
  }
  let best = { threshold: null, metrics: metricsOf(policyRows), rows: policyRows };
  for (let step = 1; step <= 19; step++) {
    const threshold = step / 20;
    const decided = policyRows.map((row, index) => ({ ...row, publish: oofProb[index] >= threshold && row.correctTop1 !== undefined ? oofProb[index] >= threshold : false }));
    const metrics = metricsOf(decided);
    if (lexBetter(metrics, best.metrics)) best = { threshold, metrics, rows: decided };
  }
  const model = fitLogistic(rows, labels, sampleWeights);
  return { ...best, model, oofProb };
};

const classifyFailures = (frames, rows, ocrById) => frames.map((frame, index) => {
  const row = rows[index];
  const ocr = ocrById.get(frame.frameId);
  let className = 'OK';
  if (!row.correctTop1) {
    const foil = frame.tags.some(tag => /foil|glare/i.test(tag));
    if (frame.learnedIou != null && frame.learnedIou < 0.7) className = 'ART_CROP_FAILURE';
    else if (!frame.artEmitted) className = 'ART_CROP_FAILURE';
    else if (foil) className = 'GLARE_OR_FOIL';
    else if (ocr?.falseExact) className = 'OCR_FAILURE';
    else if (row.rank != null && row.rank <= 10) className = 'VISUALLY_SIMILAR';
    else if (row.rank != null && row.rank > 100) className = 'PHONE_DOMAIN_DAMAGE';
    else if (row.rank != null && row.rank > 10) className = 'REPRESENTATION_FAILURE';
    else className = 'UNKNOWN';
  }
  return { frameId: frame.frameId, cardName: frame.cardName, rank: row.rank, publish: row.publish, correctTop1: row.correctTop1, className, learnedPath: frame.learnedPath };
});

const failureSummary = rows => {
  const counts = {};
  for (const row of rows) counts[row.className] = (counts[row.className] ?? 0) + 1;
  return counts;
};

const ocrSummary = rows => ({
  n: rows.length,
  exact: rows.filter(row => row.exactUnique).length,
  exactCorrect: rows.filter(row => row.exactUnique && row.exactHit).length,
  falseExact: rows.filter(row => row.falseExact).length,
  fuzzy: rows.filter(row => row.fuzzyScore >= 0.94).length,
  empty: rows.filter(row => !row.raw).length,
});

const gitState = () => {
  try {
    return { rev: execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim(), dirty: Boolean(execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim()) };
  } catch {
    return { rev: null, dirty: null };
  }
};

const runOcr = async (frames, split) => {
  const { createWorker, PSM } = await import('tesseract.js');
  const { PNG } = await import('pngjs');
  const esbuild = await import('esbuild');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const { detectFrameRegions } = await import('../../geometry/lib/frame-regions/detect.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'lugin-rec-ocr-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export { warpQuadToCard } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export { extractTitleCrop } from '${join(rootDir, 'src/lib/scan/ocrInput.ts')}';
        export { enhanceForOcrFast } from '${join(rootDir, 'src/lib/scan/preprocess.ts')}';
        export { buildNameIndex, matchName } from '${join(rootDir, 'src/lib/scan/matchName.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'recognition-ocr.ts',
    },
  });
  const scan = await import(pathToFileURL(bundle).href);
  const nameIndex = scan.buildNameIndex(JSON.parse(readFileSync(join(rootDir, '.scan-fixtures/card-names.json'), 'utf8')));
  const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
  const nameToOracles = new Map();
  const foldName = name => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  for (const ref of refs) {
    const key = foldName(ref.canonicalName);
    const set = nameToOracles.get(key) ?? new Set();
    set.add(ref.oracleId);
    nameToOracles.set(key, set);
  }
  const worker = await createWorker('eng', 1, {
    langPath: join(rootDir, '.scan-fixtures/tessdata'),
    cachePath: join(rootDir, '.scan-fixtures/tessdata'),
    gzip: false,
  });
  await worker.setParameters({ tessedit_pageseg_mode: String(PSM.SINGLE_LINE) });
  const asPoints = quad => [quad.tl, quad.tr, quad.br, quad.bl].map(point => ({ x: point[0], y: point[1] }));
  const fromCorners = corners => ({
    tl: [corners.topLeft.x, corners.topLeft.y],
    tr: [corners.topRight.x, corners.topRight.y],
    br: [corners.bottomRight.x, corners.bottomRight.y],
    bl: [corners.bottomLeft.x, corners.bottomLeft.y],
  });
  const readCrop = async image => {
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const result = await worker.recognize(PNG.sync.write(png));
    return { text: (result.data.text ?? '').replace(/\s+/g, ' ').trim(), confidence: (result.data.confidence ?? 0) / 100 };
  };
  const rows = [];
  for (const frame of frames) {
    const record = { frameId: frame.frameId, split, raw: '', confidence: 0, source: 'none', exactUnique: false, exactOracle: null, exactHit: false, falseExact: false, fuzzyScore: 0, fuzzyName: null, inProtoTop5: false };
    try {
      if (!frame.image) throw new Error('no image');
      const abs = join(rootDir, frame.image);
      const decodedPng = PNG.sync.read(readFileSync(abs));
      const source = { width: decodedPng.width, height: decodedPng.height, data: new Uint8ClampedArray(decodedPng.data) };
      const detected = scan.detectCardQuad(source);
      const candidate = detected?.debug?.candidates?.[frame.learnedIndex];
      if (!candidate?.corners) throw new Error('missing learned quad');
      const warp = scan.warpQuadToCard(source, asPoints(fromCorners(candidate.corners)));
      const canonical = scan.enhanceForOcrFast(scan.extractTitleCrop(warp).image);
      let reading = await readCrop(canonical);
      record.source = 'canonical';
      const regions = detectFrameRegions(warp);
      const band = regions.regions?.titleBand;
      if (band?.quad && reading.text.length < 3) {
        const top = Math.min(...['tl', 'tr', 'br', 'bl'].map(key => band.quad[key][1]));
        const bottom = Math.max(...['tl', 'tr', 'br', 'bl'].map(key => band.quad[key][1]));
        const y0 = Math.max(0, Math.floor(top));
        const y1 = Math.min(warp.height, Math.ceil(bottom));
        if (y1 - y0 > 8) {
          const height = y1 - y0;
          const data = new Uint8ClampedArray(warp.width * height * 4);
          for (let y = 0; y < height; y++) data.set(warp.data.subarray(((y0 + y) * warp.width) * 4, ((y0 + y + 1) * warp.width) * 4), y * warp.width * 4);
          const bandReading = await readCrop(scan.enhanceForOcrFast({ width: warp.width, height, data }));
          if (bandReading.text.length > reading.text.length) {
            reading = bandReading;
            record.source = 'title-band';
          }
        }
      }
      record.raw = reading.text;
      record.confidence = reading.confidence;
      const oracleIndex = new Map();
      refs.forEach(ref => { if (!oracleIndex.has(ref.oracleId)) oracleIndex.set(ref.oracleId, oracleIndex.size); });
      const assignExact = oracleId => {
        record.exactUnique = true;
        record.exactOracle = oracleIndex.get(oracleId) ?? null;
        record.exactHit = oracleId === frame.oracleId;
        record.falseExact = !record.exactHit;
      };
      const oracles = nameToOracles.get(foldName(reading.text));
      if (oracles?.size === 1) assignExact([...oracles][0]);
      const matches = scan.matchName(reading.text, nameIndex, { limit: 4, minScore: 0.45 });
      if (!record.exactUnique && matches[0]?.score >= 0.999) {
        const viaName = nameToOracles.get(foldName(matches[0].name));
        if (viaName?.size === 1) assignExact([...viaName][0]);
      }
      if (matches[0]) {
        record.fuzzyScore = matches[0].score;
        record.fuzzyName = matches[0].name;
      }
    } catch (error) {
      record.error = error.message;
    }
    rows.push(record);
    log(`ocr ${frame.cardName} ${record.raw || record.error || 'empty'}`);
  }
  await worker.terminate();
  return rows;
};

const trainAdapter = async () => null;

const scoreSplit = async (split, artifact) => {
  const ctx = await prepareContext(split);
  const weights = artifact.spec.weights ?? [0.25, 0.25, 0.25, 0.25];
  const mode = artifact.spec.mode ?? 0;
  const inv = mode === 1 || artifact.spec.invOne ? new Float32Array(ctx.oracleOf.length).fill(1) : invNorms(ctx.gram, weights);
  const cleanInv = invNorms(ctx.gram, [1, 0, 0, 0]);
  const baseInv = invNorms(ctx.gram, [0.25, 0.25, 0.25, 0.25]);
  const rows = [];
  const baseline = [];
  for (let index = 0; index < ctx.frames.length; index++) {
    const frame = ctx.frames[index];
    const clean = rankViews(ctx.dots[index], cleanInv, [1, 0, 0, 0], 0, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
    const fused = rankViews(ctx.dots[index], inv, weights, mode, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
    const equal = rankViews(ctx.dots[index], baseInv, [0.25, 0.25, 0.25, 0.25], 0, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
    const visual = {
      frameId: frame.frameId,
      fold: frame.fold ?? 0,
      expected: frame.expected,
      top1: fused.top1,
      margin: fused.margin,
      rank: fused.rank,
      correctTop1: fused.correctTop1,
      top1Score: fused.top1Score,
      top5: fused.top5,
      publish: fused.margin >= PUBLISH_MARGIN && fused.top1 === clean.top1,
      cleanTop1: clean.top1,
      cleanMargin: clean.margin,
      cleanScore: clean.top1Score,
      agreement: fused.top1 === clean.top1,
    };
    rows.push(visual);
    baseline.push({
      ...visual,
      top1: equal.top1,
      margin: equal.margin,
      rank: equal.rank,
      correctTop1: equal.correctTop1,
      top1Score: equal.top1Score,
      publish: equal.margin >= PUBLISH_MARGIN && equal.top1 === clean.top1,
      agreement: equal.top1 === clean.top1,
    });
  }
  let ocrById = new Map();
  if (artifact.spec.policy && artifact.spec.policy !== 'visual') {
    const ocr = await runOcr(ctx.frames, split);
    ocrById = new Map(ocr.map(row => [row.frameId, row]));
  }
  const policyRows = rows.map(row => applyPolicy(artifact.spec.policy ?? 'visual', row, ocrById.get(row.frameId)));
  let finalRows = policyRows;
  if (artifact.spec.confidence && artifact.spec.threshold != null) {
    finalRows = policyRows.map((row, index) => {
      const frame = ctx.frames[index];
      const ocr = ocrById.get(frame.frameId);
      const features = [
        rows[index].margin, rows[index].cleanMargin, rows[index].top1Score, rows[index].cleanScore, rows[index].agreement ? 1 : 0,
        ocr?.exactUnique && ocr.exactOracle === row.top1 ? 1 : 0,
        ocr?.exactUnique && ocr.exactOracle != null && ocr.exactOracle !== row.top1 ? 1 : 0,
        ocr?.fuzzyScore ?? 0, frame.artConfidence, frame.utility - frame.secondUtility, row.publish ? 1 : 0,
      ];
      return { ...row, publish: logisticProb(artifact.spec.confidence, features) >= artifact.spec.threshold };
    });
  }
  let human = null;
  if (split === 'holdout') {
    const humanRows = [];
    for (let index = 0; index < ctx.frames.length; index++) {
      const frame = ctx.frames[index];
      const geometry = geometryRows(split).find(row => row.frameId === frame.frameId);
      const humanPath = geometry?.paths?.human;
      if (!humanPath) continue;
      const raw = queryVector(humanPath);
      const query = forward(ctx.adapter, raw).y;
      const dots = [0, 1, 2, 3].map(() => new Float32Array(ctx.oracleOf.length));
      for (let view = 0; view < 4; view++) dotQuery(ctx.galleries[view], query, dots[view]);
      const clean = rankViews(dots, cleanInv, [1, 0, 0, 0], 0, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
      const equal = rankViews(dots, baseInv, [0.25, 0.25, 0.25, 0.25], 0, ctx.oracleOf, frame.expected, ctx.epoch, ctx.bestScore, ctx.oracleOf.length);
      humanRows.push({
        rank: equal.rank,
        correctTop1: equal.correctTop1,
        publish: equal.margin >= PUBLISH_MARGIN && equal.top1 === clean.top1,
        margin: equal.margin,
      });
    }
    human = metricsOf(humanRows);
  }
  return { challenger: metricsOf(finalRows), baseline: metricsOf(baseline), human, frames: finalRows.map((row, index) => ({ frameId: ctx.frames[index].frameId, cardName: ctx.frames[index].cardName, challenger: row, baseline: baseline[index] })) };
};

const main = async () => {
  const existing = guard();
  mkdirSync(labDir, { recursive: true });
  if (!finalHoldout && !devId) {
    await search();
    return;
  }
  const artifact = existing;
  const split = finalHoldout ? 'holdout' : 'dev';
  log(`${split} ${artifact.id}`);
  const scored = await scoreSplit(split, artifact);
  artifact[split] = scored.challenger;
  artifact[`${split}Baseline`] = scored.baseline;
  if (!finalHoldout) {
    const worseWrong = scored.challenger.wrongPublished > scored.baseline.wrongPublished;
    const worseRecall = scored.challenger.correctPublished < scored.baseline.correctPublished && scored.challenger.top1 <= scored.baseline.top1;
    artifact.devStatus = worseWrong || worseRecall ? 'rejected-dev' : 'dev-pass';
  }
  writeFileSync(join(modelDir, `${artifact.id}.json`), JSON.stringify(artifact, null, 2));
  writeFileSync(join(labDir, `${split}-${artifact.id}.json`), JSON.stringify(scored, null, 2));
  log(`${split} challenger correct ${scored.challenger.correctPublished} wrong ${scored.challenger.wrongPublished} top1 ${scored.challenger.top1} baseline correct ${scored.baseline.correctPublished} wrong ${scored.baseline.wrongPublished}`);
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

export { metricsOf, lexBetter, applyPolicy };
