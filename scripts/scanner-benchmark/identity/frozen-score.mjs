#!/usr/bin/env node
/**
 * Score frozen identity crops against the clean gallery and the mean prototype.
 * Geometry comes from frozen-geometry.mjs. Nothing here is trained or tuned.
 *
 *   node scripts/scanner-benchmark/identity/frozen-score.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadEncoder } from '../../recognition/encoders.mjs';
import { identityMatches } from '../../recognition/scoring.mjs';
import { rootDir, reportsDir } from '../lib/paths.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';
import { PUBLISH_MARGIN, sameIdentity } from './agreement.mjs';

const DIMS = 512;
const outDir = join(reportsDir, 'frozen-recognition-v1');
const currentPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');
const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const meanPrototype = views => {
  const out = new Float32Array(views[0].length);
  for (const view of views) for (let i = 0; i < out.length; i++) out[i] += view[i];
  const count = out.length / DIMS;
  for (let i = 0; i < count; i++) {
    const offset = i * DIMS;
    let sum = 0;
    for (let d = 0; d < DIMS; d++) {
      out[offset + d] /= views.length;
      sum += out[offset + d] * out[offset + d];
    }
    const n = Math.sqrt(sum) || 1;
    for (let d = 0; d < DIMS; d++) out[offset + d] /= n;
  }
  return out;
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
    if (!top || hit.score > top.score) {
      second = top;
      top = hit;
    } else if (!second || hit.score > second.score) second = hit;
    if (identityMatches(expected, hit)) expectedHit = !expectedHit || hit.score > expectedHit.score ? hit : expectedHit;
  }
  if (expectedHit) {
    for (const hit of best.values()) if (hit.score > expectedHit.score) better += 1;
  }
  const rank = expectedHit ? better + 1 : null;
  return {
    top1Name: top?.name ?? null,
    top1OracleId: top?.oracleId ?? null,
    top1Score: top?.score ?? null,
    top2Name: second?.name ?? null,
    top2OracleId: second?.oracleId ?? null,
    top2Score: second?.score ?? null,
    margin: top && second ? top.score - second.score : null,
    rank,
    top3: rank != null && rank <= 3,
    top5: rank != null && rank <= 5,
    top10: rank != null && rank <= 10,
    correct: rank === 1,
  };
};

const quant = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
};

const summarize = rows => {
  const ranks = rows.map(row => row.rank).filter(value => value != null);
  const published = rows.filter(row => row.publish);
  const correctPublished = published.filter(row => row.correct).length;
  const wrongPublished = published.filter(row => !row.correct).length;
  const correctWithheld = rows.filter(row => row.correct && !row.publish).length;
  const wrongWithheld = rows.filter(row => !row.correct && !row.publish).length;
  return {
    n: rows.length,
    top1: rows.filter(row => row.correct).length,
    top3: rows.filter(row => row.top3).length,
    top5: rows.filter(row => row.top5).length,
    top10: rows.filter(row => row.top10).length,
    meanRank: ranks.length ? ranks.reduce((sum, value) => sum + value, 0) / ranks.length : null,
    medianRank: quant(ranks, 0.5),
    correctPublished,
    wrongPublished,
    correctWithheld,
    wrongWithheld,
    precision: published.length ? correctPublished / published.length : null,
    safeHit: rows.length ? correctPublished / rows.length : null,
  };
};

const cardBad = metrics => Boolean(metrics && (metrics.iou < 0.8 || metrics.areaRatio > 1.25 || metrics.areaRatio < 0.75 || metrics.outside > 0.2));
const artBad = row => !row.humanArt?.emitted || !row.current?.art?.emitted || (row.artMeanCorner != null && row.artMeanCorner > 40);

const classify = (row, humanPack, detectorPack) => {
  if (!row.current?.metrics || !humanPack || !detectorPack) return 'NOT_MEASURABLE';
  const nameChanged = humanPack.prototype.top1OracleId !== detectorPack.prototype.top1OracleId
    || humanPack.clean.top1OracleId !== detectorPack.clean.top1OracleId;
  const publishChanged = humanPack.publish !== detectorPack.publish;
  const marginDelta = Math.abs((humanPack.prototype.margin ?? 0) - (detectorPack.prototype.margin ?? 0));
  if (!nameChanged && !publishChanged && marginDelta < 0.01) return 'UNCHANGED';
  const badCard = cardBad(row.current.metrics);
  const badArt = artBad(row);
  const restores = pack => pack && pack.prototype.top1OracleId === humanPack.prototype.top1OracleId && pack.publish === humanPack.publish;
  if (badCard && badArt) {
    if (restores(row._D) && !restores(row._C)) return 'ART_CROP_DOMINANT';
    if (restores(row._C) && !restores(row._D)) return 'OUTER_QUAD_DOMINANT';
    if (!row.current.art?.emitted && !restores(row._D)) return 'OUTER_QUAD_DOMINANT';
    return 'MULTIPLE';
  }
  if (badCard) return 'OUTER_QUAD_DOMINANT';
  if (badArt) return 'ART_CROP_DOMINANT';
  return 'RECOGNITION_SENSITIVITY';
};

const task1Class = (row, humanPack, detectorPack) => {
  if (!humanPack || !detectorPack || !row.current?.metrics) return 'NOT_MEASURABLE';
  const badCard = cardBad(row.current.metrics);
  const badArt = artBad(row);
  const aOk = humanPack.prototype.correct && humanPack.publish;
  const bOk = detectorPack.prototype.correct && detectorPack.publish;
  const sameTop = humanPack.prototype.top1OracleId === detectorPack.prototype.top1OracleId;
  if (!badCard && !badArt && sameTop && aOk && !bOk) return 'RECOGNITION_SENSITIVITY';
  const dOk = row._D && row._D.prototype.correct && row._D.publish;
  const cOk = row._C && row._C.prototype.correct && row._C.publish;
  if (!bOk && dOk && !cOk) return 'ART_BOX_FAILURE';
  if (!bOk && cOk && !dOk) return 'CARD_QUAD_FAILURE';
  if (badCard && !dOk) return 'CARD_QUAD_FAILURE';
  if (badCard && badArt) return 'BOTH';
  if (badArt) return 'ART_BOX_FAILURE';
  if (aOk && detectorPack.prototype.correct && !bOk) return 'RECOGNITION_SENSITIVITY';
  return 'RECOGNITION_SENSITIVITY';
};

const geometryRows = readFileSync(join(outDir, 'geometry.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
log('loading CLIP and galleries');
const encoder = (await loadEncoder('CLIP_VIT_B32')).runtime;
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const model = loadModel(JSON.parse(readFileSync(currentPath, 'utf8')));
const viewEmbeddings = ['blur', 'motion', 'perspective'].map(id => floatsFrom(join(viewDir, `${id}.bin`)));
const adapted = [raw, ...viewEmbeddings].map(view => applyGallery(model, view, refs.length, DIMS));
const prototype = meanPrototype(adapted);
const clean = adapted[0];
log('scoring');

const embed = async path => {
  if (!path || !existsSync(path)) return null;
  const embPath = path.replace(/\.png$/, '.f32');
  if (existsSync(embPath) && readFileSync(embPath).byteLength === DIMS * 4) return floatsFrom(embPath);
  const vector = Float32Array.from(await encoder.embedPath(path));
  await writeFile(embPath, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  return vector;
};

const scoreVector = (vector, frame) => {
  if (!vector) return null;
  const query = forward(model, vector).y;
  const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
  return {
    clean: rankQuery(clean, refs, query, expected),
    prototype: rankQuery(prototype, refs, query, expected),
  };
};

const packSide = scored => {
  if (!scored) return null;
  const publish = scored.prototype.margin >= PUBLISH_MARGIN && sameIdentity(
    { oracleId: scored.clean.top1OracleId },
    { oracleId: scored.prototype.top1OracleId },
  );
  const cleanPublish = scored.clean.margin >= PUBLISH_MARGIN;
  const prototypePublish = scored.prototype.margin >= PUBLISH_MARGIN;
  return {
    clean: scored.clean,
    prototype: scored.prototype,
    publish,
    cleanPublish,
    prototypePublish,
  };
};

const scoredRows = [];
for (const row of geometryRows) {
  if (row.error || !row.cardName) {
    scoredRows.push(row);
    continue;
  }
  const human = packSide(scoreVector(await embed(row.paths?.human), row));
  const detector = packSide(scoreVector(await embed(row.paths?.detector), row));
  const learned = packSide(scoreVector(await embed(row.paths?.learned), row));
  const C = row.split === 'holdout' ? packSide(scoreVector(await embed(row.paths?.C), row)) : null;
  const D = row.split === 'holdout' ? packSide(scoreVector(await embed(row.paths?.D), row)) : null;
  row._C = C;
  row._D = D;
  const attribution = row.split === 'holdout' ? classify(row, human, detector) : null;
  const key = row.frameId?.includes('150559_geom-009') || row.frameId?.includes('165339_geom-006');
  scoredRows.push({
    frameId: row.frameId,
    label: row.label,
    cardName: row.cardName,
    oracleId: row.oracleId,
    split: row.split,
    candidateCount: row.candidateCount,
    oracleBestIou: row.oracleBestIou,
    hasGoodCandidate: row.hasGoodCandidate,
    hasUsableCandidate: row.hasUsableCandidate,
    current: row.current,
    learned: row.learned,
    humanArt: row.humanArt,
    artMeanCorner: row.artMeanCorner,
    artMaxCorner: row.artMaxCorner,
    candidates: row.candidates,
    human,
    detector,
    learned: learned ? { ...row.learned, recognition: learned } : null,
    learnedRecognition: learned,
    C,
    D,
    attribution,
    task1: key ? task1Class(row, human, detector) : null,
  });
  log(`${row.split} ${row.cardName} ${attribution ?? ''}`);
}

const systems = ['human', 'detector', 'learnedRecognition'];
const policies = [
  ['cleanRaw', side => side?.clean],
  ['prototypeRaw', side => side?.prototype],
  ['cleanMargin', side => side?.clean && { ...side.clean, publish: side.cleanPublish, correct: side.clean.correct }],
  ['prototypeMargin', side => side?.prototype && { ...side.prototype, publish: side.prototypePublish, correct: side.prototype.correct }],
  ['agreement', side => side?.prototype && { ...side.prototype, publish: side.publish, correct: side.prototype.correct }],
];
const bySplit = {};
for (const split of ['train', 'dev', 'holdout']) {
  const frames = scoredRows.filter(row => row.split === split && row.human);
  bySplit[split] = {};
  for (const system of systems) {
    bySplit[split][system] = {};
    for (const [name, pick] of policies) {
      const picked = frames.map(row => pick(row[system])).filter(Boolean);
      bySplit[split][system][name] = summarize(picked);
    }
  }
}

const holdout = scoredRows.filter(row => row.split === 'holdout' && row.human);
const attributionCounts = {};
for (const row of holdout) attributionCounts[row.attribution] = (attributionCounts[row.attribution] ?? 0) + 1;

const bins = [
  ['lt50', row => (row.current?.metrics?.iou ?? -1) < 0.5],
  ['50to70', row => { const iou = row.current?.metrics?.iou ?? -1; return iou >= 0.5 && iou < 0.7; }],
  ['70to80', row => { const iou = row.current?.metrics?.iou ?? -1; return iou >= 0.7 && iou < 0.8; }],
  ['ge80', row => (row.current?.metrics?.iou ?? -1) >= 0.8],
];
const correlation = bins.map(([id, pred]) => {
  const rows = holdout.filter(pred);
  const top1Loss = rows.filter(row => row.human?.prototype.correct && !row.detector?.prototype.correct).length;
  const marginLoss = rows.filter(row => (row.human?.prototype.margin ?? 0) - (row.detector?.prototype.margin ?? 0) >= 0.02).length;
  const agreementLoss = rows.filter(row => row.human?.publish && !row.detector?.publish).length;
  const safeHitLoss = agreementLoss;
  return { id, n: rows.length, top1Loss, marginLoss, agreementLoss, safeHitLoss };
});

const geometryOf = side => {
  const ious = holdout.map(row => row[side]?.metrics?.iou ?? row[side]?.iou).filter(value => value != null);
  return {
    n: ious.length,
    ge80: ious.filter(value => value >= 0.8).length,
    ge70: ious.filter(value => value >= 0.7).length,
    lt50: ious.filter(value => value < 0.5).length,
    median: quant(ious, 0.5),
    p10: quant(ious, 0.1),
  };
};

const learnedChanges = holdout.filter(row => row.learned && row.current && row.learned.index !== row.current.index).map(row => ({
  frameId: row.frameId,
  label: row.label,
  cardName: row.cardName,
  current: { index: row.current.index, iou: row.current.iou, utility: row.current.utility, detectorScore: row.current.detectorScore, method: row.current.method },
  learned: { index: row.learned.index, iou: row.learned.iou, utility: row.learned.utility, detectorScore: row.learned.detectorScore },
  oracleBestIou: row.oracleBestIou,
  humanPublish: row.human?.publish ?? null,
  detectorPublish: row.detector?.publish ?? null,
  learnedPublish: row.learnedRecognition?.publish ?? null,
  humanProto: row.human?.prototype.top1Name ?? null,
  detectorProto: row.detector?.prototype.top1Name ?? null,
  learnedProto: row.learnedRecognition?.prototype.top1Name ?? null,
  humanClean: row.human?.clean.top1Name ?? null,
  detectorClean: row.detector?.clean.top1Name ?? null,
  learnedClean: row.learnedRecognition?.clean.top1Name ?? null,
}));

const detectorAgreement = bySplit.holdout.detector.agreement;
const learnedAgreement = bySplit.holdout.learnedRecognition.agreement;
let learnedVerdict = 'NOT_ENOUGH_MEASURABLE_DATA';
if (detectorAgreement.n >= 20 && learnedAgreement.n >= 20) {
  if (learnedAgreement.wrongPublished > detectorAgreement.wrongPublished || learnedAgreement.correctPublished < detectorAgreement.correctPublished) {
    learnedVerdict = 'LEARNED_GEOMETRY_REGRESSES_END_TO_END';
  } else if (learnedAgreement.correctPublished > detectorAgreement.correctPublished && learnedAgreement.wrongPublished === 0) {
    learnedVerdict = 'LEARNED_GEOMETRY_IMPROVES_END_TO_END';
  } else {
    learnedVerdict = 'LEARNED_GEOMETRY_NEUTRAL';
  }
}

const failures = holdout.filter(row => {
  const lostSafe = row.human?.publish && row.human?.prototype.correct && !row.detector?.publish;
  const lostTop = row.human?.prototype.correct && !row.detector?.prototype.correct;
  const badIou = (row.current?.metrics?.iou ?? 1) < 0.7;
  const learnedBad = (row.learned?.iou ?? 1) < 0.5;
  return lostSafe || lostTop || badIou || learnedBad;
}).map(row => {
  const currentIou = row.current?.metrics?.iou ?? null;
  let klass = 'NOT_MEASURABLE';
  if (row.oracleBestIou == null || currentIou == null) klass = 'NOT_MEASURABLE';
  else if (currentIou >= 0.8) klass = 'NOT_A_GEOMETRY_MISS';
  else if (row.oracleBestIou >= 0.8) klass = 'SELECTION_FAILURE';
  else if (row.oracleBestIou < 0.7) klass = 'GENERATION_FAILURE';
  else klass = 'BOTH_POSSIBLE';
  return {
    frameId: row.frameId,
    label: row.label,
    cardName: row.cardName,
    class: klass,
    oracleBestIou: row.oracleBestIou,
    currentIou: row.current?.metrics?.iou ?? null,
    learnedIou: row.learned?.iou ?? null,
    lostSafeHit: Boolean(row.human?.publish && !row.detector?.publish),
    lostPrototypeTop1: Boolean(row.human?.prototype.correct && !row.detector?.prototype.correct),
    attribution: row.attribution,
  };
});
const generationRank = failures
  .filter(row => row.class === 'GENERATION_FAILURE' || row.class === 'BOTH_POSSIBLE')
  .sort((a, b) => Number(b.lostSafeHit) - Number(a.lostSafeHit) || Number(b.lostPrototypeTop1) - Number(a.lostPrototypeTop1) || a.oracleBestIou - b.oracleBestIou);

const summary = {
  createdAt: new Date().toISOString(),
  margin: PUBLISH_MARGIN,
  bySplit,
  attributionCounts,
  correlation,
  geometry: { current: geometryOf('current'), learned: geometryOf('learned') },
  learnedVerdict,
  learnedChanges,
  failureClasses: failures.reduce((acc, row) => { acc[row.class] = (acc[row.class] ?? 0) + 1; return acc; }, {}),
  failures,
  generationRank,
  keyFrames: scoredRows.filter(row => row.task1),
};
await writeFile(join(outDir, 'scored.json'), JSON.stringify(summary, null, 2));
await writeFile(join(outDir, 'frames.json'), JSON.stringify(scoredRows, null, 2));
log(learnedVerdict);
log(JSON.stringify(attributionCounts));
log(JSON.stringify(bySplit.holdout));
