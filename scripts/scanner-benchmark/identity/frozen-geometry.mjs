#!/usr/bin/env node
/**
 * Geometry measurements for the frozen identity photos.
 * Does not retrain the ranker or change the detector.
 *
 *   node scripts/scanner-benchmark/identity/frozen-geometry.mjs
 *
 * Current selection is detectCardQuad's returned quad (the production crop).
 * Learned selection is argmax utility of the frozen gbm-iou challenger
 * over the same accepted candidates. Nested features match the export.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

import { rootDir, reportsDir } from '../lib/paths.mjs';
import { quadInImageSpace } from '../../geometry/lib/source-space.mjs';
import { detectFrameRegions } from '../../geometry/lib/frame-regions/detect.mjs';
import { quadArea, quadCoverage, quadIoU } from '../../geometry/lib/frame-regions/report.mjs';
import { scaleCanonicalArt } from '../embedding/art-margin.mjs';
import { buildFeatureRows, structureFeatures } from '../ranker/features.mjs';
import { hydrateModel } from '../ranker/models.mjs';
import { vectorOf, FRAME_WARP_WIDTH } from '../ranker/schema.mjs';

const CARD_ASPECT = 63 / 88;
const PEAK = 0.35;
const WARP_HEIGHT = Math.round(FRAME_WARP_WIDTH / CARD_ASPECT);
const ART_W = 625;
const ART_H = 436;
const dataDir = join(rootDir, 'scanner-benchmark/identity');
const outDir = join(reportsDir, 'frozen-recognition-v1');
const rankerPath = join(rootDir, 'scanner-benchmark/ranker-registry/challengers/gbm-iou-all-2dd2ec36b833.json');
const KEY_FRAMES = new Set([
  'scan-inbox_sessions_geometry-test-20261006-150559_geom-009-source_geom-009-source',
  'scan-inbox_sessions_geometry-test-20260910-165339_geom-006-source_geom-006-source',
]);

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const asPoints = quad => ['tl', 'tr', 'br', 'bl'].map(key => ({ x: quad[key][0], y: quad[key][1] }));
const fromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});
const meanMaxCorner = (a, b) => {
  if (!a || !b) return { mean: null, max: null };
  const gaps = ['tl', 'tr', 'br', 'bl'].map(key => Math.hypot(a[key][0] - b[key][0], a[key][1] - b[key][1]));
  return {
    mean: gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
    max: Math.max(...gaps),
  };
};
const inside = (quad, width, height) => ['tl', 'tr', 'br', 'bl'].every(key => {
  const [x, y] = quad[key];
  return x >= -2 && y >= -2 && x <= width + 1 && y <= height + 1;
});
const round = (value, digits = 4) => (value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits)));

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-frozen-geom-'));
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
        export { containsCandidate, selectPrimaryAmongDebugCandidates } from '${join(rootDir, 'src/lib/scan/detection/multi.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'frozen-geom-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const peakedArea = frameFrac => {
  if (frameFrac <= PEAK) return Math.min(1, Math.max(0, frameFrac / PEAK));
  if (frameFrac <= 0.7) return Math.min(1, Math.max(0, 1 - (frameFrac - PEAK) / PEAK));
  return 0;
};

const termsOf = (quad, imageW, imageH) => {
  const [tl, tr, br, bl] = asPoints(quad);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 8 || bottom < 8 || left < 8 || right < 8) return null;
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspectRatio = width / height;
  const aspectScore = 1 - Math.min(1, Math.abs(aspectRatio - CARD_ASPECT) / CARD_ASPECT);
  const parallelRaw = (Math.abs(top - bottom) / width + Math.abs(left - right) / height) / 2;
  const parallelScore = 1 - Math.min(1, parallelRaw);
  const area = Math.abs(tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y - (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x)) / 2;
  const frameFraction = area / (imageW * imageH);
  const areaScore = Math.min(1, frameFraction / PEAK);
  const centerX = (tl.x + tr.x + br.x + bl.x) / 4 / imageW;
  const centerY = (tl.y + tr.y + br.y + bl.y) / 4 / imageH;
  const centerDist = Math.hypot(centerX * imageW - imageW / 2, centerY * imageH - imageH / 2);
  const centerScore = 1 - Math.min(1, centerDist / (Math.hypot(imageW, imageH) / 2));
  const detectorScore = aspectScore * 0.4 + parallelScore * 0.25 + areaScore * 0.25 + centerScore * 0.1;
  return { aspectRatio, aspectScore, parallelRaw, parallelScore, frameFraction, areaScore, centerX, centerY, centerScore, detectorScore };
};

const nestedOf = (scan, candidates, rows, width, height) => {
  const scored = candidates.map((candidate, index) => {
    const row = rows.find(item => item.index === index);
    return row ? { ...candidate, score: row.detectorScore } : candidate;
  });
  const official = scan.selectPrimaryAmongDebugCandidates(scored, width, height);
  const accepted = [];
  scored.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause?.length) return;
    const row = rows.find(item => item.index === index);
    if (!row) return;
    accepted.push({ index, score: candidate.score, corners: candidate.corners, areaRatio: row.frameFraction });
  });
  if (!accepted.length) return { selected: official.selectedIndex, relations: [], inner: null, outer: null };
  const ranked = [...accepted].sort((a, b) => b.score - a.score).slice(0, 8);
  const relations = [];
  for (const outer of ranked) {
    for (const inner of ranked) {
      if (outer.index === inner.index || outer.areaRatio <= inner.areaRatio) continue;
      const rel = scan.containsCandidate(outer.corners, inner.corners);
      if (!rel.ok) continue;
      relations.push({ outer: outer.index, inner: inner.index, innerScore: inner.score });
    }
  }
  let inner = null;
  let outer = null;
  if (relations.length) {
    let pair = relations[0];
    for (const next of relations) if (next.innerScore > pair.innerScore) pair = next;
    inner = pair.inner;
    outer = pair.outer;
  }
  return { selected: official.selectedIndex, relations, inner, outer };
};

const selectLearned = (model, featureRows) => {
  let best = null;
  let second = null;
  for (const candidate of featureRows) {
    const utility = model.utility(vectorOf(candidate.features, model.featureNames));
    const row = { utility, index: candidate.index, iou: candidate.iou, detectorScore: candidate.detectorScore };
    if (!best || utility > best.utility + 1e-12 || (Math.abs(utility - best.utility) <= 1e-12 && candidate.detectorScore > best.detectorScore)) {
      second = best;
      best = row;
    } else if (!second || utility > second.utility) second = row;
  }
  return best ? { ...best, secondUtility: second?.utility ?? null, secondIndex: second?.index ?? null } : null;
};

const artOnWarp = (scan, warp) => {
  const detected = detectFrameRegions(warp);
  const art = detected.regions?.artBox ?? null;
  const edge = id => detected.debug?.boundaries?.find(row => row.id === id) ?? null;
  const edges = Object.fromEntries(['titleArt', 'artType', 'typeText', 'innerLeft', 'innerRight'].map(id => {
    const row = edge(id);
    return [id, row ? { detected: row.detected, confidence: round(row.confidence, 3), reason: row.reason ?? null } : null];
  }));
  if (!art?.quad) return { emitted: false, confidence: null, edges, padded: null, anchor: 'canonical-window' };
  const padded = scaleCanonicalArt(art.quad, 0.03, warp.width, warp.height);
  const ys = ['tl', 'tr', 'br', 'bl'].map(key => padded[key][1]);
  const xs = ['tl', 'tr', 'br', 'bl'].map(key => padded[key][0]);
  return {
    emitted: true,
    confidence: round(art.confidence, 3),
    edges,
    padded,
    anchor: 'frame-art+3',
    top: round(Math.min(...ys) / warp.height, 3),
    bottom: round(Math.max(...ys) / warp.height, 3),
    left: round(Math.min(...xs) / warp.width, 3),
    right: round(Math.max(...xs) / warp.width, 3),
  };
};

const cropArt = (scan, warp, art) => {
  if (art?.padded && inside(art.padded, warp.width, warp.height)) {
    return {
      crop: scan.warpQuadToCard(warp, asPoints(art.padded), ART_W, ART_H),
      anchor: art.anchor,
      valid: true,
    };
  }
  return { crop: scan.extractArtCropFromCard(warp).crop, anchor: 'canonical-window', valid: !art?.emitted ? false : false };
};

const cardMetrics = (human, quad, width, height) => {
  if (!human || !quad) return null;
  const diagonal = Math.hypot(width, height);
  const corners = meanMaxCorner(human, quad);
  return {
    iou: round(quadIoU(human, quad), 3),
    meanCornerPx: round(corners.mean, 1),
    maxCornerPx: round(corners.max, 1),
    meanCornerOverDiagonal: round(corners.mean / diagonal, 4),
    areaRatio: round(quadArea(quad) / quadArea(human), 3),
    humanInside: round(quadCoverage(human, quad), 3),
    outside: round(1 - quadCoverage(quad, human), 3),
  };
};

const drawLine = (png, x0, y0, x1, y1, color) => {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const dx = Math.abs(Math.round(x1) - x);
  const dy = Math.abs(Math.round(y1) - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;
  const paint = (px, py) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
    const i = (py * png.width + px) * 4;
    png.data[i] = color[0];
    png.data[i + 1] = color[1];
    png.data[i + 2] = color[2];
    png.data[i + 3] = 255;
  };
  for (;;) {
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) paint(x + ox, y + oy);
    if (x === Math.round(x1) && y === Math.round(y1)) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
};

const fit = (image, width, height) => {
  const png = new PNG({ width, height });
  png.data.fill(16);
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
      png.data[dst] = image.data[src];
      png.data[dst + 1] = image.data[src + 1];
      png.data[dst + 2] = image.data[src + 2];
      png.data[dst + 3] = 255;
    }
  }
  return { png, scale, ox, oy, dw, dh };
};

const panelFromPngBytes = async (scan, image) => PNG.sync.read(Buffer.from(scan.scanImageToPngBytes(image)));

const writeStrip = async (file, panels) => {
  const width = 180;
  const height = 250;
  const png = new PNG({ width: width * panels.length, height });
  panels.forEach((panel, index) => {
    const fitted = fit(panel, width, height);
    for (let i = 0; i < fitted.png.data.length; i++) png.data[i + index * width * 4 + Math.floor(i / (width * 4)) * (png.width - width) * 4] = fitted.png.data[i];
  });
  await writeFile(file, PNG.sync.write(png));
};

const blit = (dst, src, index, panelW) => {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = (y * dst.width + index * panelW + x) * 4;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
};

const scan = await loadScan();
const packedRanker = JSON.parse(readFileSync(rankerPath, 'utf8'));
const ranker = hydrateModel(packedRanker.model);
ranker.featureNames = packedRanker.featureNames;
const frames = JSON.parse(readFileSync(join(dataDir, 'crops.json'), 'utf8')).filter(frame => frame.oraclePath);
mkdirSync(outDir, { recursive: true });
const lines = [];
let done = 0;
for (const frame of frames) {
  done += 1;
  const fixturePath = join(rootDir, '.geometry-corpus/fixtures', `${frame.frameId}.json`);
  if (!existsSync(fixturePath)) {
    lines.push(JSON.stringify({ frameId: frame.frameId, split: frame.split, error: 'missing fixture' }));
    continue;
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const metaRel = fixture.provenance?.metadataPaths?.[0];
  const metadata = metaRel && existsSync(join(rootDir, metaRel)) ? JSON.parse(readFileSync(join(rootDir, metaRel), 'utf8')) : null;
  const abs = join(rootDir, frame.image);
  if (!existsSync(abs)) {
    lines.push(JSON.stringify({ frameId: frame.frameId, split: frame.split, error: 'missing image' }));
    continue;
  }
  const decoded = PNG.sync.read(readFileSync(abs));
  const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
  const card = fixture.cards.find(row => row.groundTruthQuad?.tl);
  let human = null;
  let humanError = null;
  try {
    human = quadInImageSpace({
      quad: card.groundTruthQuad,
      imageWidth: decoded.width,
      imageHeight: decoded.height,
      captureWidth: metadata?.photo?.decodedWidth ?? null,
      captureHeight: metadata?.photo?.decodedHeight ?? null,
      label: frame.frameId,
    }).quad;
  } catch (error) {
    humanError = error.message;
  }
  const det = scan.detectCardQuad(source);
  const measured = [];
  if (det?.debug?.candidates && human) {
    for (let index = 0; index < det.debug.candidates.length; index++) {
      const candidate = det.debug.candidates[index];
      if (!candidate.corners || candidate.rejectedBecause?.length) continue;
      const quad = fromCorners(candidate.corners);
      const terms = termsOf(quad, decoded.width, decoded.height);
      if (!terms) continue;
      let structure = null;
      try {
        const warped = scan.warpQuadToCard(source, asPoints(quad), FRAME_WARP_WIDTH, WARP_HEIGHT);
        structure = structureFeatures(detectFrameRegions(warped));
      } catch {
        structure = null;
      }
      measured.push({ index, method: candidate.method, quad, iou: quadIoU(quad, human), structure, ...terms });
    }
  }
  const nested = measured.length ? nestedOf(scan, det.debug.candidates, measured, decoded.width, decoded.height) : null;
  const featureRows = measured.length ? buildFeatureRows({
    rows: measured,
    width: decoded.width,
    height: decoded.height,
    nested: nested ?? { relations: [], inner: null, outer: null, selected: -1 },
  }) : [];
  const learned = featureRows.length ? selectLearned(ranker, featureRows) : null;
  const currentQuad = det?.corners ? fromCorners(det.corners) : null;
  const learnedRow = learned ? measured.find(row => row.index === learned.index) : null;
  const oracle = measured.reduce((best, row) => (!best || row.iou > best.iou + 1e-12 || (Math.abs(row.iou - best.iou) <= 1e-12 && row.index < best.index) ? row : best), null);
  const dir = join(outDir, 'crops', createHash('sha256').update(frame.frameId).digest('hex').slice(0, 16));
  mkdirSync(dir, { recursive: true });
  const saveCrop = async (name, warp, art) => {
    if (!warp) return null;
    const produced = cropArt(scan, warp, art);
    const path = join(dir, `${name}.png`);
    await writeFile(path, Buffer.from(scan.scanImageToPngBytes(produced.crop)));
    return { path, anchor: produced.anchor, artEmitted: Boolean(art?.emitted) };
  };
  let humanWarp = null;
  let currentWarp = null;
  let learnedWarp = null;
  let humanArt = null;
  let currentArt = null;
  let learnedArt = null;
  if (human) {
    humanWarp = scan.warpQuadToCard(source, asPoints(human));
    humanArt = artOnWarp(scan, humanWarp);
  }
  if (currentQuad) {
    currentWarp = scan.warpQuadToCard(source, asPoints(currentQuad));
    currentArt = artOnWarp(scan, currentWarp);
  }
  if (learnedRow) {
    learnedWarp = scan.warpQuadToCard(source, asPoints(learnedRow.quad));
    learnedArt = artOnWarp(scan, learnedWarp);
  }
  const learnedSame = learnedRow && currentQuad && quadIoU(learnedRow.quad, currentQuad) > 0.999;
  const learnedCrop = learnedSame ? { path: frame.productionPath, anchor: currentArt?.anchor ?? frame.productionAnchor, artEmitted: Boolean(currentArt?.emitted), reused: 'production' } : await saveCrop('learned', learnedWarp, learnedArt);
  let counterfactual = { C: null, D: null };
  if (frame.split === 'holdout' && humanWarp && currentWarp) {
    if (currentArt?.padded && inside(currentArt.padded, humanWarp.width, humanWarp.height)) {
      const crop = scan.warpQuadToCard(humanWarp, asPoints(currentArt.padded), ART_W, ART_H);
      const path = join(dir, 'C.png');
      await writeFile(path, Buffer.from(scan.scanImageToPngBytes(crop)));
      counterfactual.C = { path, valid: true };
    }
    if (humanArt?.padded && inside(humanArt.padded, currentWarp.width, currentWarp.height)) {
      const crop = scan.warpQuadToCard(currentWarp, asPoints(humanArt.padded), ART_W, ART_H);
      const path = join(dir, 'D.png');
      await writeFile(path, Buffer.from(scan.scanImageToPngBytes(crop)));
      counterfactual.D = { path, valid: true };
    }
  }
  if (KEY_FRAMES.has(frame.frameId) && human && currentQuad) {
    const preview = fit(decoded, 180, 250);
    const scaleX = preview.dw / decoded.width;
    const scaleY = preview.dh / decoded.height;
    const stroke = (quad, color) => {
      const pts = asPoints(quad).map(point => ({ x: preview.ox + point.x * scaleX, y: preview.oy + point.y * scaleY }));
      for (let i = 0; i < pts.length; i++) drawLine(preview.png, pts[i].x, pts[i].y, pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y, color);
    };
    stroke(human, [40, 210, 90]);
    stroke(currentQuad, [230, 50, 50]);
    const panels = [preview.png];
    if (humanWarp) panels.push(fit(await panelFromPngBytes(scan, humanWarp), 180, 250).png);
    if (currentWarp) panels.push(fit(await panelFromPngBytes(scan, currentWarp), 180, 250).png);
    const humanCrop = cropArt(scan, humanWarp, humanArt);
    const currentCrop = cropArt(scan, currentWarp, currentArt);
    panels.push(fit(await panelFromPngBytes(scan, humanCrop.crop), 180, 250).png);
    panels.push(fit(await panelFromPngBytes(scan, currentCrop.crop), 180, 250).png);
    const strip = new PNG({ width: 180 * panels.length, height: 250 });
    panels.forEach((panel, index) => blit(strip, panel, index, 180));
    const stripPath = join(outDir, `strip-${frame.cardName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
    await writeFile(stripPath, PNG.sync.write(strip));
  }
  const artShift = humanArt?.padded && currentArt?.padded ? meanMaxCorner(humanArt.padded, currentArt.padded) : null;
  const row = {
    frameId: frame.frameId,
    label: frame.label,
    cardName: frame.cardName,
    oracleId: frame.oracleId,
    split: frame.split,
    humanError,
    candidateCount: measured.length,
    oracleBestIou: round(oracle?.iou ?? null, 3),
    oracleIndex: oracle?.index ?? null,
    hasGoodCandidate: (oracle?.iou ?? 0) >= 0.8,
    hasUsableCandidate: (oracle?.iou ?? 0) >= 0.7,
    current: currentQuad ? {
      index: measured.reduce((best, row) => (!best || quadIoU(row.quad, currentQuad) > quadIoU(best.quad, currentQuad) ? row : best), null)?.index ?? null,
      method: null,
      detectorScore: det?.debug?.candidates?.find(candidate => candidate.corners && !candidate.rejectedBecause?.length)?.score ?? null,
      iou: cardMetrics(human, currentQuad, decoded.width, decoded.height)?.iou ?? null,
      metrics: cardMetrics(human, currentQuad, decoded.width, decoded.height),
      art: currentArt ? { emitted: currentArt.emitted, confidence: currentArt.confidence, anchor: currentArt.anchor, top: currentArt.top ?? null, bottom: currentArt.bottom ?? null, edges: currentArt.edges } : null,
    } : null,
    learned: learned && learnedRow ? {
      index: learned.index,
      utility: round(learned.utility, 4),
      secondUtility: round(learned.secondUtility, 4),
      secondIndex: learned.secondIndex,
      detectorScore: round(learned.detectorScore, 4),
      iou: round(learned.iou, 3),
      metrics: cardMetrics(human, learnedRow.quad, decoded.width, decoded.height),
      art: learnedArt ? { emitted: learnedArt.emitted, confidence: learnedArt.confidence, anchor: learnedArt.anchor, top: learnedArt.top ?? null, bottom: learnedArt.bottom ?? null } : null,
      sameAsCurrent: Boolean(learnedSame),
    } : null,
    humanArt: humanArt ? { emitted: humanArt.emitted, confidence: humanArt.confidence, anchor: humanArt.anchor, top: humanArt.top ?? null, bottom: humanArt.bottom ?? null, edges: humanArt.edges } : null,
    artMeanCorner: artShift ? round(artShift.mean, 1) : null,
    artMaxCorner: artShift ? round(artShift.max, 1) : null,
    paths: {
      human: frame.oraclePath,
      detector: frame.productionPath,
      learned: learnedCrop?.path ?? null,
      C: counterfactual.C?.path ?? null,
      D: counterfactual.D?.path ?? null,
    },
    candidates: measured.map(row => ({
      index: row.index,
      method: row.method,
      iou: round(row.iou, 3),
      detectorScore: round(row.detectorScore, 4),
      utility: round(ranker.utility(vectorOf(featureRows.find(item => item.index === row.index).features, ranker.featureNames)), 4),
    })).sort((a, b) => b.utility - a.utility || b.detectorScore - a.detectorScore),
  };
  if (row.current) {
    const match = row.candidates.find(candidate => candidate.index === row.current.index);
    row.current.method = match?.method ?? null;
    row.current.detectorScore = match?.detectorScore ?? row.current.detectorScore;
    row.current.utility = match?.utility ?? null;
  }
  lines.push(JSON.stringify(row));
  if (done % 10 === 0 || KEY_FRAMES.has(frame.frameId)) log(`${done}/${frames.length} ${frame.cardName} cands ${measured.length}`);
}
await writeFile(join(outDir, 'geometry.jsonl'), `${lines.join('\n')}\n`);
log(`wrote ${lines.length} frames`);
