#!/usr/bin/env node
/**
 * Diagnosis only. Does not train, and does not change the adapter, CLIP, or the gallery.
 *
 * For each far holdout miss, degrade the closest same-oracle canonical art with the
 * existing scanner-benchmark presets and compare those embeddings to the real phone crop.
 *
 * Views are the stress list and the training list from embedding-bakeoff.mjs.
 * Parameters are not searched and are not fit per card. The seed is the art id plus
 * the preset id, so the phone crop never chooses the transform.
 *
 * Class rule, locked before the scores are read:
 *   gap = topWrong - clean
 *   improvement = bestDegraded - clean
 *   fraction = improvement / gap when gap > 0, else 0
 *   PHONE_DOMAIN_DAMAGE when improvement >= 0.04 and fraction >= 0.50
 *   REPRESENTATION_MISMATCH when improvement < 0.03,
 *     or fraction < 0.25 and bestDegraded + 0.05 < topWrong
 *   MIXED otherwise
 *
 * Recommendation, locked the same way:
 *   TRY_STRONGER_AUGMENTATION when domain >= 4 and domain > mismatch
 *   MOVE_TO_STRONGER_ENCODER when mismatch >= 4 and mismatch > domain
 *   MIXED_NEXT_STEP otherwise
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { loadEncoder } from '../../recognition/encoders.mjs';
import { rootDir, reportsDir } from '../lib/paths.mjs';
import { renderView } from '../embedding/augment.mjs';
import { forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';

const DIMS = 512;
const MOVE = 0.04;
const BARELY = 0.03;
const HALF = 0.5;
const QUARTER = 0.25;
const STILL_BEHIND = 0.05;

const STRESS = [
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

const TRAIN = [
  { id: 'train-crop3', preset: { crop: 0.03 } },
  { id: 'train-crop8', preset: { crop: 0.08 } },
  { id: 'train-crop12', preset: { crop: 0.12, wb: true } },
  { id: 'train-perspective', preset: { crop: 0.04, perspective: 0.08 } },
  { id: 'train-blur-glare', preset: { crop: 0.05, blur: 1.4, glare: 1, sleeve: true } },
  { id: 'train-mixed', preset: { crop: 0.08, perspective: 0.06, motion: 6, glare: 0.7, jpeg: 38, brightness: 0.72, noise: 12, background: 0.1, wb: true } },
];

const VIEWS = [...STRESS, ...TRAIN];
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const outDir = join(reportsDir, 'identity-domain-v1');
const artDir = join(rootDir, '.scan-fixtures/visual-embed/art-crops');
const cacheDir = join(outDir, 'emb');

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const dot = (a, b) => {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
};

const rankAt = (sortedDesc, score) => {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDesc[mid] > score) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
};

const classify = (clean, best, wrong) => {
  const improvement = best - clean;
  const gap = wrong - clean;
  const fraction = gap > 0 ? improvement / gap : 0;
  if (improvement >= MOVE && fraction >= HALF) return 'PHONE_DOMAIN_DAMAGE';
  if (improvement < BARELY || (fraction < QUARTER && best + STILL_BEHIND < wrong)) return 'REPRESENTATION_MISMATCH';
  return 'MIXED';
};

const recommend = counts => {
  const domain = counts.PHONE_DOMAIN_DAMAGE ?? 0;
  const mismatch = counts.REPRESENTATION_MISMATCH ?? 0;
  if (domain >= 4 && domain > mismatch) return 'TRY_STRONGER_AUGMENTATION';
  if (mismatch >= 4 && mismatch > domain) return 'MOVE_TO_STRONGER_ENCODER';
  return 'MIXED_NEXT_STEP';
};

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
const saved = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json'), 'utf8'));
const model = loadModel(saved);
const misses = JSON.parse(readFileSync(join(reportsDir, 'identity-printing-v1/summary.json'), 'utf8')).rows;
const frames = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8')).filter(frame => frame.split === 'holdout' && frame.oraclePath);

const frameOf = miss => {
  const hits = frames.filter(frame => frame.oracleId === miss.oracleId && (miss.label == null || frame.label === miss.label));
  if (hits.length === 1) return hits[0];
  throw new Error(`frame match failed for ${miss.cardName} ${miss.label}: ${hits.length}`);
};

log('adapting gallery');
const { applyGallery } = await import('../embedding/math.mjs');
const adapted = applyGallery(model, raw, refs.length, DIMS);

const phoneOf = frame => forward(model, floatsFrom(frame.oraclePath.replace(/\.png$/, '.f32'))).y;

const galleryScores = query => {
  const scores = new Float32Array(refs.length);
  const byOracle = new Map();
  for (let row = 0; row < refs.length; row++) {
    const score = dot(query, adapted.subarray(row * DIMS, (row + 1) * DIMS));
    scores[row] = score;
    const id = refs[row].oracleId;
    const prev = byOracle.get(id);
    if (prev == null || score > prev) byOracle.set(id, score);
  }
  const sorted = Float32Array.from(scores).sort((a, b) => b - a);
  return { scores, byOracle, sorted };
};

const artRow = scryfallId => refs.findIndex(ref => ref.scryfallId === scryfallId);

log('loading CLIP');
const encoder = (await loadEncoder('CLIP_VIT_B32')).runtime;

const embedView = async (scryfallId, view) => {
  const embPath = join(cacheDir, scryfallId, `${view.id}.f32`);
  if (existsSync(embPath) && statSync(embPath).size === DIMS * 4) return floatsFrom(embPath);
  const source = join(artDir, `${scryfallId}.jpg`);
  if (!existsSync(source)) throw new Error(`missing art ${source}`);
  const jpg = await renderView(source, view.preset, `${scryfallId}:domain:${view.id}`);
  const tmp = `${embPath}.jpg`;
  mkdirSync(dirname(tmp), { recursive: true });
  await writeFile(tmp, jpg);
  const emb = Float32Array.from(await encoder.embedPath(tmp));
  await writeFile(embPath, Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength));
  return emb;
};

const degradedByArt = new Map();
for (const miss of misses) {
  if (degradedByArt.has(miss.bestScryfallId)) continue;
  log(`degrade ${miss.cardName} ${miss.bestSet}`);
  const views = [];
  for (const view of VIEWS) {
    const rawView = await embedView(miss.bestScryfallId, view);
    views.push({ id: view.id, y: forward(model, rawView).y });
  }
  degradedByArt.set(miss.bestScryfallId, views);
}

const rows = [];
for (const miss of misses) {
  const frame = frameOf(miss);
  const query = phoneOf(frame);
  const gallery = galleryScores(query);
  const cleanRow = artRow(miss.bestScryfallId);
  const clean = gallery.scores[cleanRow];
  let wrong = -Infinity;
  for (const score of gallery.byOracle.values()) if (score > wrong) wrong = score;
  let best = clean;
  let bestId = 'clean';
  const viewScores = [];
  for (const view of degradedByArt.get(miss.bestScryfallId)) {
    const score = dot(query, view.y);
    viewScores.push({ id: view.id, score: Number(score.toFixed(4)), artRank: rankAt(gallery.sorted, score) });
    if (score > best) {
      best = score;
      bestId = view.id;
    }
  }
  const improvement = best - clean;
  const gap = wrong - clean;
  const cardScore = Math.max(clean, best);
  let oracleRank = 1;
  for (const [id, score] of gallery.byOracle) {
    if (id !== miss.oracleId && score > cardScore) oracleRank += 1;
  }
  const row = {
    cardName: miss.cardName,
    label: miss.label,
    frameId: frame.frameId,
    oracleId: miss.oracleId,
    printing: `${miss.bestSet} ${miss.bestScryfallId}`,
    clean: Number(clean.toFixed(4)),
    best: Number(best.toFixed(4)),
    bestDegradation: bestId,
    improvement: Number(improvement.toFixed(4)),
    topWrong: Number(wrong.toFixed(4)),
    topWrongName: miss.top1Name,
    gap: Number(gap.toFixed(4)),
    fraction: gap > 0 ? Number((improvement / gap).toFixed(4)) : 0,
    cleanArtRank: rankAt(gallery.sorted, clean),
    bestArtRank: rankAt(gallery.sorted, best),
    oracleRankIfAdded: oracleRank,
    class: classify(clean, best, wrong),
    views: viewScores.sort((a, b) => b.score - a.score),
  };
  rows.push(row);
  log(`${row.class} ${row.cardName} clean ${row.clean.toFixed(3)} best ${row.best.toFixed(3)} ${row.bestDegradation} wrong ${row.topWrong.toFixed(3)}`);
}

const counts = {};
for (const row of rows) counts[row.class] = (counts[row.class] ?? 0) + 1;
const verdict = recommend(counts);
const report = {
  verdict,
  rule: 'PHONE_DOMAIN_DAMAGE when the best existing degradation gains at least 0.04 cosine and closes at least half the gap to the top wrong card. REPRESENTATION_MISMATCH when the gain is under 0.03, or it closes under a quarter of that gap and stays at least 0.05 behind the wrong card. MIXED otherwise.',
  views: VIEWS.map(view => view.id),
  counts,
  rows: rows.map(({ views, ...row }) => row),
  viewScores: rows.map(row => ({ cardName: row.cardName, label: row.label, views: row.views })),
};
mkdirSync(outDir, { recursive: true });
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);

const lines = [];
lines.push('# PHONE DEGRADATION OF THE CORRECT ART');
lines.push('');
lines.push('Diagnosis only. CLIP and the linear adapter were not trained.');
lines.push('');
lines.push(`Verdict: **${verdict}**`);
lines.push('');
lines.push('Each row degrades the closest gallery art of the correct card. The presets are the existing stress list and the existing training list. The phone crop does not choose the parameters.');
lines.push('');
lines.push('| Card | Frame | Clean | Best degraded | Degradation | Gain | Top wrong | Class | Oracle rank if added |');
lines.push('| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: |');
for (const row of rows) {
  lines.push(`| ${row.cardName} | ${row.label ?? row.frameId} | ${row.clean.toFixed(3)} | ${row.best.toFixed(3)} | ${row.bestDegradation} | ${row.improvement.toFixed(3)} | ${row.topWrong.toFixed(3)} | ${row.class} | ${row.oracleRankIfAdded} |`);
}
lines.push('');
lines.push('## COUNTS');
lines.push('');
for (const key of ['PHONE_DOMAIN_DAMAGE', 'REPRESENTATION_MISMATCH', 'MIXED']) {
  lines.push(`- ${key}: ${counts[key] ?? 0}`);
}
lines.push('');
lines.push(`Recommendation: **${verdict}**`);
lines.push('');
await writeFile(join(reportsDir, 'identity-domain-v1.md'), `${lines.join('\n')}\n`);
const slug = createHash('sha256').update('identity-domain-v1').digest('hex').slice(0, 8);
console.log(verdict, slug);
console.log(JSON.stringify(counts));
