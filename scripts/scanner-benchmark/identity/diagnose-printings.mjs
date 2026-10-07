#!/usr/bin/env node
/**
 * Diagnosis only. Does not train, and does not change the adapter or the gallery.
 *
 * The saved linear challenger already scores a card by its best gallery art.
 * This pass asks whether another printing of the same card is close, or whether
 * every printing stays far.
 *
 * A miss is WRONG_PRINTING_REFERENCE only when the best same-oracle art is a
 * near match (oracle rank <= 10, or within 0.02 of the top1 score) and that art
 * is a different printing from the training reference, at least 0.02 closer.
 * Foil, glare, partial, or hard-regression tags otherwise become GLARE_OR_CAPTURE.
 * A best-art rank of 10 or better is VISUALLY_SIMILAR. Anything farther is
 * EMBEDDING_FAILURE.
 *
 * Far misses are holdout frames whose best same-oracle art ranks worse than 10.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { rootDir, reportsDir } from '../lib/paths.mjs';
import { applyGallery, forward, loadModel } from '../embedding/math.mjs';
import { RAW_GALLERY_DIR } from '../embedding/b1-gallery.mjs';

const DIMS = 512;
const NEAR_RANK = 10;
const SCORE_GAP = 0.02;
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const outDir = join(reportsDir, 'identity-printing-v1');
const artDir = join(rootDir, '.scan-fixtures/visual-embed/art-crops');

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

const panel = (path, width, height) => {
  if (!path || !existsSync(path)) return fit({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(48) }, width, height);
  return fit(readImage(path), width, height);
};

const writeStrip = async (file, paths) => {
  const width = 220;
  const height = 300;
  const png = new PNG({ width: width * paths.length, height });
  paths.forEach((path, index) => {
    const pixels = panel(path, width, height);
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
  const near = row.bestOracleRank <= NEAR_RANK || row.top1Score - row.bestScore <= SCORE_GAP;
  const otherPrinting = row.bestScryfallId !== row.referenceScryfallId && row.bestScore > row.referenceScore + SCORE_GAP;
  if (near && otherPrinting) return 'WRONG_PRINTING_REFERENCE';
  if (row.glareOrCapture) return 'GLARE_OR_CAPTURE';
  if (row.bestOracleRank <= NEAR_RANK) return 'VISUALLY_SIMILAR';
  if (row.bestOracleRank > NEAR_RANK) return 'EMBEDDING_FAILURE';
  return 'UNKNOWN';
};

const verdictOf = rows => {
  const wrong = rows.filter(row => row.class === 'WRONG_PRINTING_REFERENCE').length;
  const rest = rows.length - wrong;
  if (wrong >= 2 && wrong >= rest) return 'MULTI_PRINTING_POSITIVES_NEEDED';
  if (wrong === 0) return 'REPRESENTATION_LIMIT_REACHED';
  return 'MIXED';
};

const raw = floatsFrom(join(RAW_GALLERY_DIR, 'embeddings.bin'));
const refs = JSON.parse(readFileSync(join(RAW_GALLERY_DIR, 'refs.json'), 'utf8'));
const saved = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json'), 'utf8'));
const model = loadModel(saved);
const adapted = applyGallery(model, raw, refs.length, DIMS);
const referenceRow = new Map();
const artsOf = new Map();
refs.forEach((ref, row) => {
  if (!referenceRow.has(ref.oracleId)) referenceRow.set(ref.oracleId, row);
  if (!artsOf.has(ref.oracleId)) artsOf.set(ref.oracleId, []);
  artsOf.get(ref.oracleId).push(row);
});

const frames = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8')).filter(frame => frame.split === 'holdout' && frame.oraclePath);
const scored = [];
for (const frame of frames) {
  const vector = floatsFrom(frame.oraclePath.replace(/\.png$/, '.f32'));
  const query = forward(model, vector).y;
  const bestByOracle = new Map();
  for (let row = 0; row < refs.length; row++) {
    const score = dot(query, adapted.subarray(row * DIMS, (row + 1) * DIMS));
    const ref = refs[row];
    const prev = bestByOracle.get(ref.oracleId);
    if (!prev || score > prev.score) bestByOracle.set(ref.oracleId, { score, row, name: ref.canonicalName, oracleId: ref.oracleId });
  }
  const ranked = [...bestByOracle.values()].sort((a, b) => b.score - a.score);
  const oracleRank = ranked.findIndex(hit => hit.oracleId === frame.oracleId) + 1;
  const top = ranked[0];
  const arts = artsOf.get(frame.oracleId) ?? [];
  const artScores = arts.map(row => ({
    row,
    score: dot(query, adapted.subarray(row * DIMS, (row + 1) * DIMS)),
    ref: refs[row],
  })).sort((a, b) => b.score - a.score);
  const best = artScores[0];
  const reference = artScores.find(art => art.row === referenceRow.get(frame.oracleId));
  const artRank = (art, score) => {
    let ahead = 0;
    for (let row = 0; row < refs.length; row++) {
      if (row === art.row) continue;
      const other = dot(query, adapted.subarray(row * DIMS, (row + 1) * DIMS));
      if (other > score) ahead += 1;
    }
    return ahead + 1;
  };
  const tags = new Set(frame.tags ?? []);
  const row = {
    frameId: frame.frameId,
    label: frame.label,
    cardName: frame.cardName,
    oracleId: frame.oracleId,
    top1Name: top.name,
    top1Score: top.score,
    top1ScryfallId: refs[top.row].scryfallId,
    top1Set: refs[top.row].setCode,
    expectedRank: oracleRank,
    artCount: arts.length,
    bestOracleRank: oracleRank,
    bestScore: best?.score ?? null,
    bestScryfallId: best?.ref.scryfallId ?? null,
    bestSet: best?.ref.setCode ?? null,
    bestArtRank: best ? artRank(best, best.score) : null,
    referenceScore: reference?.score ?? null,
    referenceScryfallId: reference?.ref.scryfallId ?? null,
    referenceSet: reference?.ref.setCode ?? null,
    referenceArtRank: reference ? artRank(reference, reference.score) : null,
    scoreGap: best && reference ? best.score - reference.score : null,
    glareOrCapture: tags.has('foil') || tags.has('glare') || tags.has('partial') || frame.hardRegression,
    phonePath: frame.oraclePath,
    bestPath: best ? join(artDir, `${best.ref.scryfallId}.jpg`) : null,
    referencePath: reference ? join(artDir, `${reference.ref.scryfallId}.jpg`) : null,
    topPath: join(artDir, `${refs[top.row].scryfallId}.jpg`),
  };
  row.class = classify(row);
  scored.push(row);
}

const far = scored.filter(row => row.expectedRank > NEAR_RANK).sort((a, b) => b.expectedRank - a.expectedRank);
const verdict = verdictOf(far);
mkdirSync(outDir, { recursive: true });
for (const row of far) {
  const slug = createHash('sha256').update(row.frameId).digest('hex').slice(0, 12);
  const file = join(outDir, `${slug}.png`);
  await writeStrip(file, [row.phonePath, row.referencePath, row.bestPath, row.topPath]);
  row.strip = `identity-printing-v1/${slug}.png`;
}
const counts = {};
for (const row of far) counts[row.class] = (counts[row.class] ?? 0) + 1;
const report = {
  verdict,
  rule: 'Best same-oracle art is a wrong-printing fix only when its oracle rank is <= 10 or its score is within 0.02 of top1, and it beats the training reference by more than 0.02.',
  farCount: far.length,
  counts,
  rows: far.map(row => ({
    cardName: row.cardName,
    label: row.label,
    oracleId: row.oracleId,
    top1Name: row.top1Name,
    expectedRank: row.expectedRank,
    artCount: row.artCount,
    bestSet: row.bestSet,
    bestScryfallId: row.bestScryfallId,
    bestScore: Number(row.bestScore.toFixed(4)),
    bestArtRank: row.bestArtRank,
    referenceSet: row.referenceSet,
    referenceScryfallId: row.referenceScryfallId,
    referenceScore: Number(row.referenceScore.toFixed(4)),
    referenceArtRank: row.referenceArtRank,
    scoreGap: Number(row.scoreGap.toFixed(4)),
    class: row.class,
    strip: row.strip,
  })),
};
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = [];
lines.push('# SAME-ORACLE PRINTING DIAGNOSIS');
lines.push('');
lines.push('Diagnosis only. The linear adapter was not retrained.');
lines.push('');
lines.push(`Verdict: **${verdict}**`);
lines.push('');
lines.push('The holdout rank already uses the closest gallery art of the correct card. The training reference is the first gallery row of that oracle id.');
lines.push('');
lines.push('Panels, left to right: phone crop, training reference, closest same-oracle art, top wrong match.');
lines.push('');
lines.push('| Card | Frame | Top1 | Expected rank | Arts | Best printing | Best score | Best art rank | Reference score | Reference art rank | Gap | Class |');
lines.push('| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |');
for (const row of report.rows) {
  lines.push(`| ${row.cardName} | ${row.label} | ${row.top1Name} | ${row.expectedRank} | ${row.artCount} | ${row.bestSet} \`${row.bestScryfallId.slice(0, 8)}\` | ${row.bestScore.toFixed(3)} | ${row.bestArtRank} | ${row.referenceScore.toFixed(3)} | ${row.referenceArtRank} | ${row.scoreGap.toFixed(3)} | ${row.class} |`);
}
lines.push('');
lines.push('## COUNTS');
lines.push('');
for (const [key, count] of Object.entries(counts)) lines.push(`- ${key}: ${count}`);
lines.push('');
await writeFile(join(reportsDir, 'identity-printing-v1.md'), `${lines.join('\n')}\n`);
console.log(verdict);
for (const row of report.rows) console.log(row.class, row.expectedRank, row.cardName, row.label, 'gap', row.scoreGap.toFixed(3), 'best', row.bestSet, 'ref', row.referenceSet);
