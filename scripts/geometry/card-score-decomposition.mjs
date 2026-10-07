#!/usr/bin/env node
/**
 * Decompose detectCardQuad scores on the five loose-card frames.
 * Does not change weights, nested rules, or which quad is returned.
 *
 *   node scripts/geometry/card-score-decomposition.mjs
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir, reportsDir, resolveSafeMedia } from '../scanner-benchmark/lib/paths.mjs';
import { FIXTURES_DIR } from './lib/paths.mjs';
import { isCompleteQuad } from './lib/schema.mjs';
import { quadArea, quadCoverage, quadIoU } from './lib/frame-regions/report.mjs';
import { assertImageSpace, quadInImageSpace } from './lib/source-space.mjs';
import { isManualArtBox } from '../scanner-benchmark/embedding/crop-ceiling.mjs';

const CARD_ASPECT = 63 / 88;
const WEIGHTS = { aspect: 0.4, parallel: 0.25, area: 0.25, center: 0.1 };
const GOOD_IOU = 0.8;

const TARGETS = [
  { slug: 'island-cq', card: 'Island cq-120629', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png' },
  { slug: 'wand', card: 'Wand cq-120751', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png' },
  { slug: 'livaan', card: 'Livaan cq-120813', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png' },
  { slug: 'bulk-up', card: 'Bulk Up', imageId: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png' },
  { slug: 'mudbutton', card: 'Mudbutton Torchrunner', imageId: '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png' },
];

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const KEYS = ['tl', 'tr', 'br', 'bl'];

/**
 * Locked before this run.
 * Ranking failures are frames whose max-score quad is not the best-IoU card.
 * Nested damage is a max-score card at IoU ≥ 0.80 replaced by a quad at least 0.05 worse.
 * If both happen, the verdict is SELECTION_MIXED.
 * Otherwise the score term with the largest weighted advantage on the most ranking failures wins.
 */
const chooseVerdict = ({ rankingDeltas, nestedDamaged }) => {
  const names = { aspect: 'ASPECT_SCORE_PRIMARY', parallel: 'PARALLEL_SCORE_PRIMARY', area: 'AREA_SCORE_PRIMARY', center: 'CENTER_SCORE_PRIMARY' };
  const wins = {};
  for (const delta of rankingDeltas) {
    const top = Object.keys(WEIGHTS).reduce((best, key) => (delta[key] > delta[best] ? key : best));
    wins[top] = (wins[top] ?? 0) + 1;
  }
  const ranked = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  const [topKey, topCount] = ranked[0] ?? [null, 0];
  if (rankingDeltas.length >= 3 && nestedDamaged >= 1) {
    return { verdict: 'SELECTION_MIXED', wins, topKey, topCount };
  }
  if (topKey && topCount >= 3 && topCount >= (ranked[1]?.[1] ?? 0) * 2) return { verdict: names[topKey], wins, topKey, topCount };
  if (rankingDeltas.length === 0 && nestedDamaged >= 3) return { verdict: 'NESTED_RULE_PRIMARY', wins, topKey, topCount };
  return { verdict: 'SCORING_MIXED', wins, topKey, topCount };
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-score-decomp-'));
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
        export { containsCandidate, selectPrimaryAmongDebugCandidates } from '${join(rootDir, 'src/lib/scan/detection/multi.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'score-decomp-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const loadManuals = async () => {
  const map = new Map();
  for (const name of await readdir(FIXTURES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8'));
    const region = (fixture.cards ?? []).map(card => card.regions?.artBox).find(isManualArtBox);
    if (!region || !fixture.image) continue;
    const card = (fixture.cards ?? []).find(row => row.regions?.artBox === region);
    if (!isCompleteQuad(card?.groundTruthQuad)) continue;
    let metadata = null;
    const metaPath = fixture.provenance?.metadataPaths?.[0];
    if (metaPath) {
      try {
        metadata = JSON.parse(await readFile(join(rootDir, metaPath), 'utf8'));
      } catch {
        metadata = null;
      }
    }
    map.set(fixture.image, {
      cardQuad: card.groundTruthQuad,
      imageWidth: fixture.imageWidth ?? null,
      imageHeight: fixture.imageHeight ?? null,
      metadata,
    });
  }
  return map;
};

const fromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const toCorners = quad => ({
  topLeft: { x: quad.tl[0], y: quad.tl[1] },
  topRight: { x: quad.tr[0], y: quad.tr[1] },
  bottomRight: { x: quad.br[0], y: quad.br[1] },
  bottomLeft: { x: quad.bl[0], y: quad.bl[1] },
});

const pointInQuad = (quad, x, y) => {
  const pts = KEYS.map(key => quad[key]);
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-3) continue;
    const next = Math.sign(cross);
    if (sign && next !== sign) return false;
    sign = next;
  }
  return true;
};

/** Exact terms inside scoreCardQuad. Edge extras are not part of this sum. */
const breakdown = (quad, imageW, imageH) => {
  const tl = { x: quad.tl[0], y: quad.tl[1] };
  const tr = { x: quad.tr[0], y: quad.tr[1] };
  const br = { x: quad.br[0], y: quad.br[1] };
  const bl = { x: quad.bl[0], y: quad.bl[1] };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspect = width / height;
  const aspectScore = 1 - Math.min(1, Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT);
  const parallelRaw = (Math.abs(top - bottom) / width + Math.abs(left - right) / height) / 2;
  const parallel = 1 - Math.min(1, parallelRaw);
  const area = Math.abs(
    tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y - (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
  ) / 2;
  const areaDenom = imageW * imageH * 0.35;
  const areaRaw = area / areaDenom;
  const areaScore = Math.min(1, areaRaw);
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const centerDist = Math.hypot(cx - imageW / 2, cy - imageH / 2);
  const centerDenom = Math.hypot(imageW, imageH) / 2;
  const centerScore = 1 - Math.min(1, centerDist / centerDenom);
  const weighted = {
    aspect: aspectScore * WEIGHTS.aspect,
    parallel: parallel * WEIGHTS.parallel,
    area: areaScore * WEIGHTS.area,
    center: centerScore * WEIGHTS.center,
  };
  const total = weighted.aspect + weighted.parallel + weighted.area + weighted.center;
  return {
    aspect,
    aspectScore,
    parallelRaw,
    parallel,
    area,
    areaRaw,
    areaScore,
    areaSaturated: areaRaw >= 1,
    centerDist,
    centerScore,
    frameFraction: area / (imageW * imageH),
    weighted,
    total,
  };
};

const traceNested = (candidates, width, height, containsCandidate) => {
  const accepted = [];
  candidates.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause.length) return;
    const quad = fromCorners(candidate.corners);
    const frameArea = Math.max(1, width * height);
    accepted.push({
      index,
      score: candidate.score,
      corners: candidate.corners,
      areaRatio: quadArea(quad) / frameArea,
    });
  });
  const ranked = accepted
    .map((row, local) => ({ row, local }))
    .sort((a, b) => b.row.score - a.row.score)
    .slice(0, 8);
  const nested = [];
  for (let a = 0; a < ranked.length; a++) {
    for (let b = 0; b < ranked.length; b++) {
      if (a === b) continue;
      if (ranked[a].row.areaRatio <= ranked[b].row.areaRatio) continue;
      const rel = containsCandidate(ranked[a].row.corners, ranked[b].row.corners);
      if (!rel.ok) continue;
      nested.push({
        outer: ranked[a].row.index,
        inner: ranked[b].row.index,
        outerScore: ranked[a].row.score,
        innerScore: ranked[b].row.score,
        areaFraction: rel.areaFraction,
        centerDistNorm: rel.centerDistNorm,
      });
    }
  }
  let max = accepted[0] ?? null;
  for (const row of accepted) if (row.score > max.score) max = row;
  if (!nested.length) {
    return { max, nested: [], chosen: max, changed: false, reason: 'no nested pair; keep max score', pair: null };
  }
  let pair = nested[0];
  for (const next of nested) if (next.innerScore > pair.innerScore) pair = next;
  const innerGate = pair.innerScore >= 0.28;
  const ratioGate = pair.innerScore >= pair.outerScore * 0.75;
  if (innerGate || ratioGate) {
    const chosen = accepted.find(row => row.index === pair.inner);
    return {
      max,
      nested,
      chosen,
      changed: chosen.index !== max.index,
      reason: innerGate ? 'inner.score >= 0.28' : 'inner.score >= 0.75 * outer.score',
      pair,
      innerGate,
      ratioGate,
    };
  }
  const chosen = accepted.find(row => row.index === pair.outer);
  return {
    max,
    nested,
    chosen,
    changed: chosen.index !== max.index,
    reason: 'inner below both gates; keep outer',
    pair,
    innerGate,
    ratioGate,
  };
};

const scaleImage = (image, maxW) => {
  const scale = Math.min(1, maxW / image.width);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(image.height - 1, Math.round((y / Math.max(1, h - 1)) * (image.height - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.round((x / Math.max(1, w - 1)) * (image.width - 1)));
      const si = (sy * image.width + sx) * 4;
      const di = (y * w + x) * 4;
      png.data[di] = image.data[si];
      png.data[di + 1] = image.data[si + 1];
      png.data[di + 2] = image.data[si + 2];
      png.data[di + 3] = 255;
    }
  }
  return { png, scale: w / image.width };
};

const poly = quad => KEYS.map(key => quad[key].map(value => value.toFixed(1)).join(',')).join(' ');
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const markdownTable = rows => {
  const head = rows[0];
  return [head, head.map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');
};

const main = async () => {
  const manuals = await loadManuals();
  const scan = await loadScan();
  const outDir = join(reportsDir, 'card-score-decomposition-v1');
  mkdirSync(outDir, { recursive: true });
  const frames = [];

  for (const target of TARGETS) {
    const manual = manuals.get(target.imageId);
    if (!manual) throw new Error(`missing card outline for ${target.card}`);
    const decoded = PNG.sync.read(readFileSync(resolveSafeMedia(target.imageId)));
    if (manual.imageWidth != null || manual.imageHeight != null) {
      if (decoded.width !== manual.imageWidth || decoded.height !== manual.imageHeight) {
        throw new Error(`${target.card} PNG does not match the fixture image size`);
      }
    }
    const photo = manual.metadata?.photo ?? null;
    const fitted = quadInImageSpace({
      quad: manual.cardQuad,
      imageWidth: decoded.width,
      imageHeight: decoded.height,
      captureWidth: photo?.decodedWidth ?? null,
      captureHeight: photo?.decodedHeight ?? null,
      label: target.card,
    });
    assertImageSpace(fitted.quad, decoded.width, decoded.height, target.card);
    const human = fitted.quad;
    const humanArea = quadArea(human);
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const det = scan.detectCardQuad(source);
    const official = scan.selectPrimaryAmongDebugCandidates(det.debug.candidates, decoded.width, decoded.height);
    if (official.selectedIndex !== det.debug.selectedIndex) {
      throw new Error(`${target.card} nested helper drifted from detectCardQuad`);
    }
    const traced = traceNested(det.debug.candidates, decoded.width, decoded.height, scan.containsCandidate);
    if (traced.chosen?.index !== det.debug.selectedIndex) {
      throw new Error(`${target.card} nested trace selected ${traced.chosen?.index} but detector selected ${det.debug.selectedIndex}`);
    }
    const accepted = det.debug.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(row => row.candidate.corners && row.candidate.rejectedBecause.length === 0)
      .map(row => {
        const quad = fromCorners(row.candidate.corners);
        const parts = breakdown(quad, decoded.width, decoded.height);
        if (Math.abs(parts.total - row.candidate.score) > 1e-6) {
          throw new Error(`${target.card} score ${row.candidate.score} != reconstructed ${parts.total} (${row.candidate.method})`);
        }
        const cx = KEYS.reduce((sum, key) => sum + human[key][0], 0) / 4;
        const cy = KEYS.reduce((sum, key) => sum + human[key][1], 0) / 4;
        return {
          index: row.index,
          method: row.candidate.method,
          score: row.candidate.score,
          iou: quadIoU(quad, human),
          areaRatio: quadArea(quad) / humanArea,
          containsHuman: pointInQuad(quad, cx, cy) && quadCoverage(human, quad) > 0.98,
          humanContains: quadCoverage(quad, human) > 0.98,
          storedEdge: row.candidate.components.edge ?? null,
          quad,
          ...parts,
        };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index);
    accepted.forEach((row, rank) => {
      row.rank = rank + 1;
    });
    const nestedOuter = new Set(traced.nested.map(pair => pair.outer));
    const nestedInner = new Set(traced.nested.map(pair => pair.inner));
    const largestArea = Math.max(...accepted.map(row => row.area));
    for (const row of accepted) {
      row.nestedOuter = nestedOuter.has(row.index);
      row.nestedInner = nestedInner.has(row.index);
      row.areaVsLargest = row.area / largestArea;
    }
    const best = [...accepted].sort((a, b) => b.iou - a.iou || b.score - a.score)[0];
    const maxScore = accepted.find(row => row.index === traced.max.index);
    const final = accepted.find(row => row.index === det.debug.selectedIndex);
    const preview = scaleImage(source, 480);
    await writeFile(join(outDir, `${target.slug}.png`), PNG.sync.write(preview.png));
    const nestedClass = !traced.changed
      ? 'NEUTRAL'
      : final.iou > maxScore.iou + 0.01
        ? 'IMPROVED'
        : final.iou < maxScore.iou - 0.01
          ? 'DEGRADED'
          : 'NEUTRAL';
    frames.push({
      ...target,
      outlineScale: fitted.scale,
      outlineSpace: fitted.space,
      width: decoded.width,
      height: decoded.height,
      previewScale: preview.scale,
      human,
      accepted,
      best,
      maxScore,
      final,
      traced,
      nestedClass,
      maxOnlyIou: maxScore.iou,
      currentIou: final.iou,
    });
    log(`${target.card} max ${fmt(maxScore.iou)} final ${fmt(final.iou)} ${nestedClass} ${traced.reason}`);
  }

  const rankingDeltas = frames
    .filter(frame => frame.maxScore.index !== frame.best.index)
    .map(frame => {
      const delta = {};
      for (const key of Object.keys(WEIGHTS)) delta[key] = frame.maxScore.weighted[key] - frame.best.weighted[key];
      return delta;
    });
  const nestedDamaged = frames.filter(frame => frame.nestedClass === 'DEGRADED' && frame.maxScore.iou >= GOOD_IOU).length;
  const decision = chooseVerdict({ rankingDeltas, nestedDamaged });
  await writeFile(join(outDir, 'summary.json'), JSON.stringify({ decision, weights: WEIGHTS, frames: frames.map(frame => ({ ...frame, human: undefined, accepted: frame.accepted.map(({ quad, ...row }) => row) })) }, null, 2));
  await writeFile(join(reportsDir, 'card-score-decomposition-v1.md'), renderMarkdown(frames, decision));
  await writeFile(join(outDir, 'index.html'), renderHtml(frames, decision));
  log(`${decision.verdict}`);
};

const componentCells = row => [
  fmt(row.iou),
  fmt(row.areaRatio, 2),
  fmt(row.aspect),
  fmt(row.areaScore),
  fmt(row.centerScore),
  fmt(row.parallel),
  fmt(row.aspectScore),
  fmt(row.total),
];

const renderMarkdown = (frames, decision) => {
  const lines = [];
  lines.push('# CARD SCORE DECOMPOSITION V1');
  lines.push('');
  lines.push('Weights and the nested rule are unchanged. Human card area is a ruler for the area ratio. It is not a selection feature.');
  lines.push('');
  lines.push('## FORMULA');
  lines.push('');
  lines.push('`scoreCardQuad` is the detector total. Stored `components.edge` is not added.');
  lines.push('');
  lines.push('```');
  lines.push('aspectScore = 1 - min(1, |width/height - 63/88| / (63/88))');
  lines.push('parallel    = 1 - min(1, (|top-bottom|/width + |left-right|/height) / 2)');
  lines.push('areaScore   = min(1, polygonArea / (imageWidth * imageHeight * 0.35))');
  lines.push('centerScore = 1 - min(1, distance(center, imageCenter) / (imageDiagonal / 2))');
  lines.push('total       = 0.40*aspectScore + 0.25*parallel + 0.25*areaScore + 0.10*centerScore');
  lines.push('```');
  lines.push('');
  lines.push('Every accepted candidate in this run reconstructs that total to 1e-6.');
  lines.push('');
  lines.push('## CARD VERSUS MAX-SCORE');
  lines.push('');
  lines.push('The second row is the highest score before nested selection. A third row appears when nested selection picks someone else.');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Candidate', 'IoU', 'Area/card', 'Aspect', 'Area score', 'Center', 'Parallel', 'Aspect score', 'Total'],
    ...frames.flatMap(frame => {
      const rows = [
        [frame.card, 'best IoU', ...componentCells(frame.best)],
        [frame.card, 'max score', ...componentCells(frame.maxScore)],
      ];
      if (frame.final.index !== frame.maxScore.index) rows.push([frame.card, 'after nested', ...componentCells(frame.final)]);
      return rows;
    }),
  ]));
  lines.push('');
  lines.push('Weighted advantage of the max-score quad over the best-IoU card. Positive means the max-score quad gains that many points of the total.');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Δ aspect ×0.40', 'Δ parallel ×0.25', 'Δ area ×0.25', 'Δ center ×0.10', 'Δ total', 'Largest term'],
    ...frames.map(frame => {
      if (frame.maxScore.index === frame.best.index) {
        return [frame.card, '0', '0', '0', '0', '0', 'same candidate'];
      }
      const delta = {};
      for (const key of Object.keys(WEIGHTS)) delta[key] = frame.maxScore.weighted[key] - frame.best.weighted[key];
      const largest = Object.keys(delta).reduce((best, key) => (delta[key] > delta[best] ? key : best));
      return [frame.card, fmt(delta.aspect), fmt(delta.parallel), fmt(delta.area), fmt(delta.center), fmt(frame.maxScore.total - frame.best.total), largest];
    }),
  ]));
  lines.push('');
  lines.push('Raw measurements for those two candidates. Area raw is polygon area divided by 35% of the frame, before the cap at 1. Center raw is pixels from the image center.');
  lines.push('');
  for (const frame of frames) {
    lines.push(`### ${frame.card}`);
    lines.push('');
    lines.push(markdownTable([
      ['Candidate', 'Aspect ratio', 'Aspect score', 'Parallel raw', 'Parallel', 'Area px', 'Area raw', 'Area score', 'Center px', 'Center score', 'Total'],
      ...[frame.best, frame.maxScore, ...(frame.final.index === frame.maxScore.index ? [] : [frame.final])]
        .filter((row, index, all) => all.findIndex(other => other.index === row.index) === index)
        .map(row => [
        row.index === frame.best.index && row.index === frame.maxScore.index
          ? 'best IoU = max score'
          : row.index === frame.best.index
            ? 'best IoU'
            : row.index === frame.maxScore.index
              ? 'max score'
              : 'after nested',
        fmt(row.aspect),
        fmt(row.aspectScore),
        fmt(row.parallelRaw),
        fmt(row.parallel),
        fmt(row.area, 0),
        fmt(row.areaRaw),
        fmt(row.areaScore),
        fmt(row.centerDist, 1),
        fmt(row.centerScore),
        fmt(row.total),
      ]),
    ]));
    lines.push('');
  }
  lines.push('Removing one weighted term from both totals, then asking whether the best-IoU card would outrank the max-score quad. This is not a new weight.');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Gap', 'Card wins without aspect', 'without parallel', 'without area', 'without center'],
    ...frames.filter(frame => frame.maxScore.index !== frame.best.index).map(frame => {
      const wins = key => frame.best.total - frame.best.weighted[key] > frame.maxScore.total - frame.maxScore.weighted[key];
      return [
        frame.card,
        fmt(frame.maxScore.total - frame.best.total),
        wins('aspect') ? 'yes' : 'no',
        wins('parallel') ? 'yes' : 'no',
        wins('area') ? 'yes' : 'no',
        wins('center') ? 'yes' : 'no',
      ];
    }),
  ]));
  lines.push('');
  lines.push('## NESTED SELECTION');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Max-score IoU', 'Max-score rank', 'Nested changed?', 'Final IoU', 'Better/worse', 'Reason'],
    ...frames.map(frame => [
      frame.card,
      fmt(frame.maxScore.iou),
      String(frame.maxScore.rank),
      frame.traced.changed ? 'yes' : 'no',
      fmt(frame.final.iou),
      frame.nestedClass,
      frame.traced.reason,
    ]),
  ]));
  lines.push('');
  for (const frame of frames) {
    const pair = frame.traced.pair;
    if (!pair) {
      lines.push(`- ${frame.card}: no nested pair among the top 8 by score.`);
      continue;
    }
    lines.push(`- ${frame.card}: outer index ${pair.outer} score ${fmt(pair.outerScore)}, inner index ${pair.inner} score ${fmt(pair.innerScore)}, area fraction ${fmt(pair.areaFraction)}, center distance ${fmt(pair.centerDistNorm)}. Gates: inner≥0.28 ${frame.traced.innerGate ? 'yes' : 'no'}, inner≥0.75×outer ${frame.traced.ratioGate ? 'yes' : 'no'}.`);
  }
  lines.push('');
  lines.push('## POLICIES');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'MAX_SCORE_ONLY IoU', 'CURRENT IoU', 'Best available IoU'],
    ...frames.map(frame => [frame.card, fmt(frame.maxOnlyIou), fmt(frame.currentIou), fmt(frame.best.iou)]),
  ]));
  lines.push('');
  lines.push('## CANDIDATES');
  lines.push('');
  for (const frame of frames) {
    lines.push(`### ${frame.card}`);
    lines.push('');
    lines.push(`Outline ${frame.outlineSpace} ×${fmt(frame.outlineScale, 4)}.`);
    lines.push('');
    lines.push(markdownTable([
      ['Rank', 'Method', 'Total', 'IoU', 'Area/card', 'Frame fraction', 'Vs largest', 'Aspect', 'Aspect×0.40', 'Parallel×0.25', 'Area×0.25', 'Center×0.10', 'Contains card', 'Inside card', 'Nested', 'Role'],
      ...frame.accepted.map(row => [
        String(row.rank),
        row.method,
        fmt(row.total),
        fmt(row.iou),
        fmt(row.areaRatio, 2),
        fmt(row.frameFraction),
        fmt(row.areaVsLargest),
        fmt(row.aspect),
        fmt(row.weighted.aspect),
        fmt(row.weighted.parallel),
        fmt(row.weighted.area),
        fmt(row.weighted.center),
        row.containsHuman ? 'yes' : 'no',
        row.humanContains ? 'yes' : 'no',
        row.nestedOuter && row.nestedInner ? 'outer+inner' : row.nestedOuter ? 'outer' : row.nestedInner ? 'inner' : '',
        row.index === frame.final.index ? 'final' : row.index === frame.maxScore.index ? 'max score' : row.index === frame.best.index ? 'best IoU' : '',
      ]),
    ]));
    lines.push('');
  }
  lines.push('## SIZE');
  lines.push('');
  lines.push('Area/card uses the human outline as a ruler only. Frame fraction and area versus the largest accepted candidate are available without that outline.');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Best IoU area/card', 'Best frame fraction', 'Max-score area/card', 'Max-score frame fraction', 'Final area/card', 'Final vs largest'],
    ...frames.map(frame => [
      frame.card,
      fmt(frame.best.areaRatio, 2),
      fmt(frame.best.frameFraction),
      fmt(frame.maxScore.areaRatio, 2),
      fmt(frame.maxScore.frameFraction),
      fmt(frame.final.areaRatio, 2),
      fmt(frame.final.areaVsLargest),
    ]),
  ]));
  lines.push('');
  lines.push('## VERDICT');
  lines.push('');
  lines.push(`**${decision.verdict}**`);
  lines.push('');
  lines.push(`Component wins on ranking-failure frames: ${Object.entries(decision.wins).map(([key, count]) => `${key} ${count}`).join(', ') || 'none'}. Nested damage to a GOOD max-score card: ${frames.filter(frame => frame.nestedClass === 'DEGRADED' && frame.maxScore.iou >= GOOD_IOU).length}.`);
  lines.push('');
  return lines.join('\n');
};

const renderHtml = (frames, decision) => {
  const sections = frames.map(frame => {
    const marks = [
      { row: frame.best, color: '#4da3ff', name: 'best IoU' },
      { row: frame.maxScore, color: '#ffb020', name: 'max score' },
      { row: frame.final, color: '#ff4d4d', name: 'final' },
    ].filter((mark, index, all) => all.findIndex(other => other.row.index === mark.row.index) === index);
    const shapes = marks
      .map(mark => `<polygon points="${poly(mark.row.quad)}" fill="none" stroke="${mark.color}" stroke-width="4"/><text x="${mark.row.quad.tl[0]}" y="${Math.max(18, mark.row.quad.tl[1] - 8)}" fill="${mark.color}" font-size="28" font-family="sans-serif">${esc(mark.name)} ${fmt(mark.row.total)} IoU ${fmt(mark.row.iou)} area ${fmt(mark.row.frameFraction)}</text>`)
      .join('');
    const rows = [frame.best, frame.maxScore, frame.final]
      .filter((row, index, all) => all.findIndex(other => other.index === row.index) === index)
      .map(row => `<tr><td>${row.index === frame.best.index ? 'best IoU' : ''}${row.index === frame.maxScore.index ? ' max score' : ''}${row.index === frame.final.index ? ' final' : ''}</td><td>${fmt(row.total)}</td><td>${fmt(row.weighted.aspect)}</td><td>${fmt(row.weighted.parallel)}</td><td>${fmt(row.weighted.area)}</td><td>${fmt(row.weighted.center)}</td><td>${fmt(row.frameFraction)}</td><td>${fmt(row.iou)}</td></tr>`)
      .join('');
    return `<section><h2>${esc(frame.card)}</h2><p>${esc(frame.nestedClass)}. ${esc(frame.traced.reason)}.</p><div class="frame" style="width:${Math.round(frame.width * frame.previewScale)}px"><img src="${frame.slug}.png" alt=""><svg viewBox="0 0 ${frame.width} ${frame.height}">${shapes}<polygon points="${poly(frame.human)}" fill="none" stroke="#3dd68c" stroke-width="4"/><text x="12" y="36" fill="#3dd68c" font-size="28" font-family="sans-serif">human</text></svg></div><table><tr><th></th><th>Total</th><th>Aspect×0.40</th><th>Parallel×0.25</th><th>Area×0.25</th><th>Center×0.10</th><th>Frame fraction</th><th>IoU</th></tr>${rows}</table></section>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Card score decomposition</title><style>body{font:14px/1.4 sans-serif;background:#111;color:#eee;margin:24px}.frame{position:relative;display:inline-block}.frame img,.frame svg{width:100%;height:auto;display:block}.frame svg{position:absolute;inset:0}text{paint-order:stroke;stroke:#000;stroke-width:6px}td,th{border:1px solid #333;padding:4px 6px}table{border-collapse:collapse;margin:12px 0 28px}</style><h1>${esc(decision.verdict)}</h1><p>Green human. Blue best IoU. Orange max score before nested selection. Red final after nested selection. Numbers in the table are weighted contributions, so they sum to the total.</p>${sections}`;
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
