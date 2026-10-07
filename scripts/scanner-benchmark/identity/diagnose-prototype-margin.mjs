#!/usr/bin/env node
/**
 * Diagnosis only. Scores the saved robust prototype with the current adapter.
 * Accept/reject uses the existing 0.05 margin and nothing else.
 * A prediction is rejected when top1 − top2 is below 0.05.
 *
 * Publish comparison, locked before the clean-gallery frame list is read:
 *   PROTOTYPE_UNSAFE when the prototype publishes more wrong cards than the clean gallery.
 *   PROTOTYPE_PUBLISH_WIN when it publishes more correct cards and no additional wrong cards.
 *   PROTOTYPE_RAW_WIN_CONFIDENCE_BLOCKED when raw Top1 rises but published correct cards do not.
 */

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { identityMatches } from '../../recognition/scoring.mjs';
import { rootDir, reportsDir } from '../lib/paths.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';

const DIMS = 512;
const MARGIN = 0.05;
const viewDir = join(rootDir, '.scan-fixtures/embedding-bakeoff/gallery-views');
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const currentPath = join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json');

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const meanPrototype = views => {
  const out = new Float32Array(views[0].length);
  for (const view of views) {
    for (let i = 0; i < out.length; i++) out[i] += view[i];
  }
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

const rank = (embeddings, refs, query, expected) => {
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
  const margin = top && second ? top.score - second.score : null;
  return {
    top1Name: top?.name ?? null,
    top1Score: top?.score ?? null,
    top2Name: second?.name ?? null,
    top2Score: second?.score ?? null,
    margin,
    expectedScore: rankIdx >= 0 ? ranked[rankIdx].score : null,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    correct: rankIdx === 0,
    rejectedByMargin: margin != null && margin < MARGIN,
  };
};

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const model = loadModel(JSON.parse(readFileSync(currentPath, 'utf8')));
const split = process.argv.find(arg => arg.startsWith('--split='))?.slice('--split='.length) || 'holdout';
const vector = process.argv.find(arg => arg.startsWith('--vector='))?.slice('--vector='.length) || 'oracle';
const frames = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8')).filter(frame => frame.split === split && frame[`${vector}Path`]);
log('adapting views');
const views = ['blur', 'motion', 'perspective'].map(id => floatsFrom(join(viewDir, `${id}.bin`)));
const adapted = [raw, ...views].map(view => applyGallery(model, view, refs.length, DIMS));
const clean = adapted[0];
const prototype = meanPrototype(adapted);
log(`scoring ${split} ${frames.length}`);
const num = value => (value == null ? null : Number(value.toFixed(4)));
const pack = scored => ({
  cardName: scored.cardName,
  label: scored.label,
  top1Name: scored.top1Name,
  correct: scored.correct,
  top1Score: num(scored.top1Score),
  top2Name: scored.top2Name,
  top2Score: num(scored.top2Score),
  margin: num(scored.margin),
  published: scored.margin != null && scored.margin >= MARGIN,
  rank: scored.rank,
});
const rows = frames.map(frame => {
  const image = frame[`${vector}Path`];
  const query = forward(model, floatsFrom(image.replace(/\.png$/, '.f32'))).y;
  const expected = { canonicalName: frame.cardName, oracleId: frame.oracleId };
  const current = rank(clean, refs, query, expected);
  const next = rank(prototype, refs, query, expected);
  return {
    cardName: frame.cardName,
    label: frame.label,
    clean: pack({ cardName: frame.cardName, label: frame.label, ...current }),
    prototype: pack({ cardName: frame.cardName, label: frame.label, ...next }),
  };
});
const publishOf = key => {
  const list = rows.map(row => row[key]);
  const correct = list.filter(row => row.correct);
  const wrong = list.filter(row => !row.correct);
  const correctPublished = correct.filter(row => row.published).length;
  const wrongPublished = wrong.filter(row => row.published).length;
  const published = correctPublished + wrongPublished;
  return {
    rawTop1: correct.length,
    correctPublished,
    correctWithheld: correct.length - correctPublished,
    wrongPublished,
    wrongWithheld: wrong.length - wrongPublished,
    totalPublished: published,
    precision: published ? correctPublished / published : 0,
    recall: correct.length ? correctPublished / correct.length : 0,
    safeHitRate: correctPublished / list.length,
  };
};
const cleanStats = publishOf('clean');
const prototypeStats = publishOf('prototype');
let verdict = 'PROTOTYPE_UNSAFE';
if (prototypeStats.wrongPublished > cleanStats.wrongPublished) verdict = 'PROTOTYPE_UNSAFE';
else if (prototypeStats.correctPublished > cleanStats.correctPublished) verdict = 'PROTOTYPE_PUBLISH_WIN';
else if (prototypeStats.rawTop1 > cleanStats.rawTop1) verdict = 'PROTOTYPE_RAW_WIN_CONFIDENCE_BLOCKED';
const agreementRows = rows.map(row => {
  const agree = row.clean.top1Name === row.prototype.top1Name;
  const published = row.prototype.published && agree;
  return {
    cardName: row.cardName,
    label: row.label,
    cleanTop: row.clean.top1Name,
    prototypeTop: row.prototype.top1Name,
    cleanCorrect: row.clean.correct,
    prototypeCorrect: row.prototype.correct,
    prototypeMargin: row.prototype.margin,
    cleanPublished: row.clean.published,
    agree,
    published,
  };
});
const agreementCorrect = agreementRows.filter(row => row.prototypeCorrect);
const agreementWrong = agreementRows.filter(row => !row.prototypeCorrect);
const agreementPublished = agreementRows.filter(row => row.published);
const agreementCorrectPublished = agreementPublished.filter(row => row.prototypeCorrect).length;
const agreementWrongPublished = agreementPublished.filter(row => !row.prototypeCorrect).length;
const agreement = {
  rawTop1: prototypeStats.rawTop1,
  totalPublished: agreementPublished.length,
  correctPublished: agreementCorrectPublished,
  wrongPublished: agreementWrongPublished,
  correctWithheld: agreementCorrect.length - agreementCorrectPublished,
  wrongWithheld: agreementWrong.length - agreementWrongPublished,
  precision: agreementPublished.length ? agreementCorrectPublished / agreementPublished.length : 0,
  safeHitRate: agreementCorrectPublished / rows.length,
};
let agreementVerdict = 'AGREEMENT_GATE_UNSAFE';
if (agreement.wrongPublished === 0 && agreement.correctPublished >= cleanStats.correctPublished) agreementVerdict = 'AGREEMENT_GATE_VALIDATED';
const report = {
  split,
  margin: MARGIN,
  rule: 'Publish when top1 − top2 is at least 0.05. Agreement also requires the clean gallery to name the same card. AGREEMENT_GATE_VALIDATED when dev publishes no wrong card and correct publications do not fall. AGREEMENT_GATE_UNSAFE when any wrong card is published.',
  verdict: split === 'dev' ? agreementVerdict : verdict,
  clean: cleanStats,
  prototype: prototypeStats,
  agreement,
  frames: rows,
  agreementFrames: agreementRows,
};
const outName = vector === 'oracle'
  ? (split === 'holdout' ? 'publish.json' : `publish-${split}.json`)
  : `publish-${split}-${vector}.json`;
await writeFile(join(reportsDir, 'identity-robust-v1', outName), `${JSON.stringify(report, null, 2)}\n`);
log(report.verdict);
console.log(JSON.stringify({ clean: cleanStats, prototype: prototypeStats, agreement }, null, 2));
