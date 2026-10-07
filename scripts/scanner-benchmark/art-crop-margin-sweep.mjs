#!/usr/bin/env node
/**
 * Recognition-crop margin sweep around the human art box.
 * Same encoder, adapter, gallery, warp, and ranking as the art-crop ceiling.
 * Only the crop margin changes. These 46 frames are not training data.
 *
 *   yarn scanner:art-crop-margin
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { hashDataset, loadAnnotations } from './lib/annotations.mjs';
import { confirmedIdentities } from './lib/metrics.mjs';
import { manifestsDir, reportsDir, resolveSafeMedia, rootDir } from './lib/paths.mjs';
import { loadEncoder } from '../recognition/encoders.mjs';
import { identityMatches, resolveExpected } from '../recognition/scoring.mjs';
import { canonicalQuadToSource, regionOrientation } from '../geometry/lib/frame-regions/project.mjs';
import { detectFrameRegions } from '../geometry/lib/frame-regions/detect.mjs';
import { FIXTURES_DIR } from '../geometry/lib/paths.mjs';
import { isCompleteQuad } from '../geometry/lib/schema.mjs';
import { forward, loadModel } from './embedding/math.mjs';
import { B1_ADAPTER_PATH, B1_GALLERY_DIR, buildB1Gallery } from './embedding/b1-gallery.mjs';
import {
  ART_MARGINS,
  artQuadAtMargin,
  bestMargin,
  chooseMarginPolicy,
  conditionLabels,
  marginId,
} from './embedding/art-margin.mjs';
import {
  assertNoEvalLeak,
  autoRowsForSummary,
  buildCropVariants,
  emptyMiss,
  encodeArtCrop,
  isManualArtBox,
  namedQuadToPoints,
  pairedTransitions,
  rankInGallery,
  summarizeCrop,
} from './embedding/crop-ceiling.mjs';

const FROZEN_PREFIX = 'c9470c26eebd';
const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const GROUP_A = new Set([
  '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png',
  '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png',
  '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png',
  '.scan-inbox/sessions/geometry-test-20260911-085827/geom-001-source/geom-001-source.png',
  '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png',
  '.scan-inbox/sessions/phone-20260908/swap-test-20260908-171149/swap-03-source.png',
]);
const GROUP_B = new Set([
  '.scan-fixtures/replay/livaan-cultist-of-tiamat-foil-20260908T111916/source-highres.png',
  '.scan-fixtures/replay/maddening-hex-alt-art-20260908T082448/source-highres.png',
  '.scan-fixtures/replay/p-e-d-tre-et-de-foyer-french-goo-20260908T082303/source-highres.png',
  '.scan-fixtures/real-photos/maddening-hex-afc-showcase-glare.png',
  '.scan-inbox/sessions/normal-scan-session-20260911-113049--card-006/source-highres/source-highres.png',
]);

const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-margin-'));
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
      sourcefile: 'margin-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const cornersNamed = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const manualByImage = async () => {
  const map = new Map();
  let names = [];
  try {
    names = await readdir(FIXTURES_DIR);
  } catch {
    return map;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8'));
    const region = (fixture.cards ?? []).map(card => card.regions?.artBox).find(isManualArtBox);
    if (!region || !fixture.image) continue;
    const card = (fixture.cards ?? []).find(row => row.regions?.artBox === region);
    map.set(fixture.image, {
      quad: region.quad,
      source: region.source,
      cardQuad: isCompleteQuad(card?.groundTruthQuad) ? card.groundTruthQuad : null,
      frameFamily: card?.frameFamily ?? 'unknown',
      tags: [...(fixture.tags ?? []), ...(card?.tags ?? [])],
    });
  }
  return map;
};

const scoreVector = (gallery, vector, expected) =>
  rankInGallery(gallery.embeddings, gallery.refs, gallery.dims, vector, hit => identityMatches(expected, hit));

const fmt = (summary, key) => (summary ? `${summary[key]}/${summary.n}` : '—');

const CROP_ORDER = ['current', 'auto_anchor', ...ART_MARGINS.map(marginId)];

const rankText = score => (score?.available === false ? 'none' : (score?.rank ?? '—'));

const rankSeries = scores => ART_MARGINS.map(margin => {
  const id = marginId(margin);
  const rank = scores?.[id]?.rank;
  return `${marginId(margin).replace('manual_', '')}% ${rank ?? '—'}`;
}).join(', ');

const markdown = report => {
  const lines = [];
  lines.push('# ART CROP MARGIN SWEEP V1');
  lines.push('');
  lines.push(`Frozen eval stills-v1 \`${report.evalHash}\`. Git \`${report.git}\`.`);
  lines.push('');
  lines.push('The first published run of this sweep is superseded. It warped manual polygons in stored click order. Four art boxes were about 90° from the parent card, and the showcase-glare box was mirrored top-to-bottom, so those recognition crops were not upright. This run orders every art box into the parent card\'s canonical TL → TR → BR → BL before scaling and warping. The corner coordinates are the same points. Stored fixture files were not rewritten; ordering happens when a crop is built, and again when Geometry Lab saves.');
  lines.push('');
  lines.push('The human art box is the geometric artwork window. These crops expand or shrink that window in canonical card coordinates, then warp with the same bilinear `warpQuadToCard` used by the ceiling. Nothing was trained on these 46 frames.');
  lines.push('');
  lines.push('## ORIENTATION');
  lines.push('');
  lines.push(`Already canonical: ${report.orientation.canonical}. Reordered: ${report.orientation.reordered}.`);
  lines.push('');
  lines.push('| Stored order | Count |');
  lines.push('| --- | ---: |');
  for (const bucket of [0, 90, 180, 270]) {
    lines.push(`| ${bucket}° | ${report.orientation.buckets[bucket] ?? 0} |`);
  }
  lines.push(`| mirrored | ${report.orientation.mirrored} |`);
  lines.push('');
  if (!report.orientation.reorderedFrames.length) lines.push('No polygon needed a new corner order.');
  for (const frame of report.orientation.reorderedFrames) {
    const label = frame.kind === 'mirror' ? 'mirrored' : `${frame.snapped}°`;
    lines.push(`- ${frame.cardName} [${frame.imageId}]: ${label} (stored TL→TR ${frame.angle.toFixed(1)}° in card space)`);
  }
  lines.push('');
  lines.push('Auto-anchor art boxes are built by `boundaryQuad` on the already-upright card warp: TL is the card-space top-left, then TR, BR, BL. `canonicalQuadToSource` carries those labels into the photo. Click order never enters that path.');
  lines.push('');
  lines.push('## TURNED POLYGONS, BEFORE → AFTER');
  lines.push('');
  lines.push('Before is the superseded click-order run. After is this card-oriented run. Ranks are the expected card.');
  lines.push('');
  for (const frame of report.turnedComparison) {
    lines.push(`- ${frame.cardName} [${frame.imageId}]`);
    lines.push(`  - before: ${frame.before}`);
    lines.push(`  - after: ${frame.after}`);
  }
  lines.push('');
  lines.push('## OTHER PREVIOUS REGRESSIONS');
  lines.push('');
  for (const frame of report.otherComparison) {
    lines.push(`- ${frame.cardName} [${frame.imageId}]`);
    lines.push(`  - before: ${frame.before}`);
    lines.push(`  - after: ${frame.after}`);
  }
  lines.push('');
  lines.push('## VERSIONS');
  lines.push('');
  lines.push(`- CLIP: \`${report.clip}\``);
  lines.push(`- Adapter: \`${report.adapter.sha256}\``);
  lines.push(`- B1 gallery: \`${report.gallery.id}\` \`${report.gallery.sha256}\` (${report.gallery.count} arts)`);
  lines.push(`- Eval: stills-v1 \`${report.evalHash}\``);
  lines.push('');
  lines.push('## CROPS');
  lines.push('');
  lines.push('| Crop | Top1 | Top3 | Top5 | Top10 | Wrong-confident |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.table) {
    lines.push(`| ${row.label} | ${row.top1} | ${row.top3} | ${row.top5} | ${row.top10} | ${row.wrongConfident} |`);
  }
  lines.push('');
  lines.push('## PAIRED VERSUS CURRENT');
  lines.push('');
  for (const row of report.transitions) {
    lines.push(`- ${row.id}: wrong→correct ${row.wrongToCorrect}, correct→wrong ${row.correctToWrong}, unchanged correct ${row.unchangedCorrect}, unchanged wrong ${row.unchangedWrong}`);
  }
  lines.push('');
  lines.push('## BEST MARGIN PER FRAME');
  lines.push('');
  lines.push('Each frame\'s best margin is a Top1 hit, then the lowest expected-card rank, then the highest expected-card similarity.');
  lines.push('');
  lines.push(`- tighter than the art box: ${report.optimal.tighter}`);
  lines.push(`- exact art box: ${report.optimal.exact}`);
  lines.push(`- padded beyond the art box: ${report.optimal.padded}`);
  lines.push('');
  lines.push(`Histogram: ${report.optimal.histogram}`);
  lines.push('');
  lines.push('## GROUP A — EXACT ART FIXED THE CURRENT MISS');
  lines.push('');
  for (const frame of report.groupA) lines.push(`- ${frame.line}`);
  lines.push('');
  lines.push('## GROUP B — FRAMES THAT LOST A CURRENT HIT UNDER CLICK-ORDER EXACT ART');
  lines.push('');
  for (const frame of report.groupB) lines.push(`- ${frame.line}`);
  lines.push('');
  lines.push('## CONDITIONS');
  lines.push('');
  lines.push('A frame can appear in more than one row. Labels come from the fixture family, existing tags, and the confirmed card name. Unknown family is not called modern.');
  lines.push('');
  if (!report.conditions.length) lines.push('No labeled conditions.');
  for (const group of report.conditions) {
    lines.push(`- ${group.label} (n=${group.n}): best ${group.bestId} at ${group.bestTop1}/${group.n}. ${group.detail}`);
  }
  lines.push('');
  lines.push('## VERDICT');
  lines.push('');
  lines.push(`**${report.verdict}**`);
  lines.push('');
  lines.push(report.verdictWhy);
  lines.push('');
  lines.push(report.autoNote);
  lines.push('');
  lines.push('## PRODUCTION');
  lines.push('');
  lines.push('CLIP, the B1 adapter, the gallery, the 46-frame eval set, OCR, fusion, the detector, and Android were not changed.');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

const html = report => {
  const table = report.table
    .map(row => `<tr><td>${row.label}</td><td>${row.top1}</td><td>${row.top3}</td><td>${row.top5}</td><td>${row.top10}</td><td>${row.wrongConfident}</td></tr>`)
    .join('');
  const frameBlock = (title, frames) =>
    `<h2>${title}</h2>${frames
      .map(frame => `<section><h3>${frame.cardName}</h3><p>${frame.line}</p></section>`)
      .join('')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Art crop margin sweep</title>
<style>body{font:14px sans-serif;margin:24px;background:#111;color:#eee}td,th{padding:4px 8px;border-bottom:1px solid #333}</style>
</head><body><h1>${report.verdict}</h1><p>${report.verdictWhy}</p>
<table><tr><th>Crop</th><th>Top1</th><th>Top3</th><th>Top5</th><th>Top10</th><th>Wrong-confident</th></tr>${table}</table>
${frameBlock('Group A', report.groupA)}${frameBlock('Group B', report.groupB)}</body></html>`;
};

const main = async () => {
  const galleryMeta = buildB1Gallery({ log });
  const galleryBuf = readFileSync(join(B1_GALLERY_DIR, 'embeddings.bin'));
  const galleryCopy = new ArrayBuffer(galleryBuf.byteLength);
  new Uint8Array(galleryCopy).set(galleryBuf);
  const gallery = {
    embeddings: new Float32Array(galleryCopy),
    refs: JSON.parse(readFileSync(join(B1_GALLERY_DIR, 'refs.json'), 'utf8')),
    dims: galleryMeta.dims,
    count: galleryMeta.count,
  };
  const model = loadModel(JSON.parse(readFileSync(B1_ADAPTER_PATH, 'utf8')));
  const stills = JSON.parse(await readFile(join(manifestsDir, 'stills-v1.json'), 'utf8'));
  const annotations = await loadAnnotations();
  const evalHash = hashDataset(stills, annotations);
  if (!evalHash.startsWith(FROZEN_PREFIX) || evalHash !== stills.datasetHash) {
    throw new Error(`eval set moved: stored ${stills.datasetHash} fresh ${evalHash}`);
  }
  const confirmed = new Map(confirmedIdentities(annotations.identities).map(row => [row.imageId, row]));
  const items = stills.items
    .filter(item => confirmed.has(item.imageId))
    .map(item => ({
      ...item,
      cardName: confirmed.get(item.imageId).cardName,
      oracleId: confirmed.get(item.imageId).oracleId ?? null,
    }));
  assertNoEvalLeak(items.map(item => item.path), ['.scan-fixtures/visual-embed/art-crops', '.scan-fixtures/embedding-bakeoff/full-cards']);
  if (!existsSync(B1_ADAPTER_PATH)) throw new Error('missing frozen B1 adapter');

  log('loading CLIP');
  const { runtime: encoder } = await loadEncoder('CLIP_VIT_B32');
  const scan = await loadScan();
  const manuals = await manualByImage();
  const outDir = join(reportsDir, 'art-crop-margin-sweep-v1');
  await mkdir(outDir, { recursive: true });
  const contaminatedPath = join(outDir, 'summary-contaminated.json');
  const liveSummary = join(outDir, 'summary.json');
  if (!existsSync(contaminatedPath) && existsSync(liveSummary)) copyFileSync(liveSummary, contaminatedPath);
  const contaminated = existsSync(contaminatedPath) ? JSON.parse(readFileSync(contaminatedPath, 'utf8')) : null;
  const beforeByImage = new Map((contaminated?.frames ?? []).map(frame => [frame.imageId, frame]));

  const frames = [];
  for (const item of items) {
    const expected = resolveExpected(rootDir, { expectedName: item.cardName, oracleId: item.oracleId });
    const abs = resolveSafeMedia(item.path);
    const decoded = PNG.sync.read(readFileSync(abs));
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const manual = manuals.get(item.path) ?? null;
    const det = scan.detectCardQuad(source);
    const corners = det.recognitionCorners ?? det.corners;
    const scores = {};
    const slug = item.imageId.replace(/[^\w.-]+/g, '_').slice(-80);
    const dir = join(outDir, 'artifacts', slug);
    mkdirSync(dir, { recursive: true });
    const embed = async (image, name) => {
      const png = encodeArtCrop(scan.scanImageToPngBytes, image);
      const path = join(dir, `${name}.png`);
      await writeFile(path, png);
      const raw = Float32Array.from(await encoder.embedPath(path));
      return forward(model, raw).y;
    };
    const cardQuad = manual?.cardQuad ?? (corners ? cornersNamed(corners) : null);
    const pose = manual?.quad && cardQuad
      ? regionOrientation({ regionQuadSource: manual.quad, cardQuadSource: cardQuad })
      : null;
    if (!corners) {
      scores.current = emptyMiss('no card quad');
      scores.auto_anchor = emptyMiss('no card quad');
      for (const margin of ART_MARGINS) scores[marginId(margin)] = emptyMiss('no card quad');
    } else {
      const warp = scan.warpQuadToCard(source, scan.cornersToQuad(corners));
      const current = scan.extractArtCropFromCard(warp).crop;
      const detected = detectFrameRegions(warp);
      let autoQuad = null;
      if (detected.regions?.artBox?.quad) {
        autoQuad = namedQuadToPoints(
          canonicalQuadToSource(detected.regions.artBox.quad, cornersNamed(corners), warp.width, warp.height),
        );
      }
      const variants = buildCropVariants({
        warpQuadToCard: scan.warpQuadToCard,
        currentCrop: current,
        source,
        autoQuad,
        manualQuad: pose ? namedQuadToPoints(pose.ordered) : null,
      });
      scores.current = { available: true, failed: false, ...(await scoreVector(gallery, await embed(variants.current, 'current'), expected)) };
      scores.auto_anchor = variants.auto_anchor
        ? { available: true, failed: false, ...(await scoreVector(gallery, await embed(variants.auto_anchor, 'auto'), expected)) }
        : emptyMiss('no art box');
      for (const margin of ART_MARGINS) {
        const id = marginId(margin);
        if (!manual) {
          scores[id] = emptyMiss('not annotated');
          continue;
        }
        const quad = artQuadAtMargin(pose.ordered, cardQuad, margin);
        const crop = scan.warpQuadToCard(source, namedQuadToPoints(quad), current.width, current.height);
        scores[id] = { available: true, failed: false, ...(await scoreVector(gallery, await embed(crop, id.replace(/[^\w.-]+/g, '_')), expected)) };
      }
    }
    // cropMargin is set after the score spread. rankInGallery also returns `margin`
    // (Top1 minus Top2). Letting that field overwrite the crop scale counted every
    // frame as padded.
    const marginRows = ART_MARGINS.map(margin => ({
      ...scores[marginId(margin)],
      id: marginId(margin),
      cropMargin: margin,
    }));
    const best = bestMargin(marginRows.filter(row => row.available !== false));
    const tags = [...(item.autoTags ?? []), ...(manual?.tags ?? [])];
    const group = GROUP_A.has(item.path) ? 'A' : GROUP_B.has(item.path) ? 'B' : null;
    frames.push({
      imageId: item.path,
      cardName: item.cardName,
      frameFamily: manual?.frameFamily ?? 'unknown',
      tags,
      conditions: conditionLabels({ cardName: item.cardName, frameFamily: manual?.frameFamily ?? 'unknown', tags }),
      group,
      bestId: best?.id ?? null,
      bestMargin: best?.cropMargin ?? null,
      orientation: pose
        ? { snapped: pose.snapped, angle: pose.angle, kind: pose.kind, changed: pose.changed }
        : null,
      scores,
    });
    log(`${item.cardName} current ${scores.current.top1 ? 'hit' : scores.current.rank ?? 'miss'} manual0 ${scores.manual_0?.rank ?? '—'} best ${best?.id ?? '—'}`);
  }

  const currentRows = frames.map(frame => frame.scores.current);
  const summaries = {};
  for (const id of CROP_ORDER) {
    const rows = id === 'auto_anchor' ? autoRowsForSummary(frames.map(frame => ({ auto_anchor: frame.scores.auto_anchor }))) : frames.map(frame => frame.scores[id]);
    summaries[id] = summarizeCrop(rows);
  }
  const labels = {
    current: 'current',
    auto_anchor: 'auto_anchor',
    manual_0: 'manual 0%',
    'manual_-10': 'manual -10%',
    'manual_-5': 'manual -5%',
    'manual_+3': 'manual +3%',
    'manual_+5': 'manual +5%',
    'manual_+8': 'manual +8%',
    'manual_+12': 'manual +12%',
  };
  const transitions = CROP_ORDER.filter(id => id !== 'current').map(id => {
    const rows = id === 'auto_anchor'
      ? autoRowsForSummary(frames.map(frame => ({ auto_anchor: frame.scores.auto_anchor })))
      : frames.map(frame => frame.scores[id]);
    return { id, ...pairedTransitions(currentRows, rows) };
  });
  const transitionById = new Map(transitions.map(row => [row.id, row]));
  const table = CROP_ORDER.map(id => ({
    id,
    label: labels[id] ?? id,
    top1: summaries[id].top1,
    top3: summaries[id].top3,
    top5: summaries[id].top5,
    top10: summaries[id].top10,
    wrongToCorrect: transitionById.get(id)?.wrongToCorrect ?? null,
    correctToWrong: transitionById.get(id)?.correctToWrong ?? null,
    top1Text: fmt(summaries[id], 'top1'),
    top3Text: fmt(summaries[id], 'top3'),
    top5Text: fmt(summaries[id], 'top5'),
    top10Text: fmt(summaries[id], 'top10'),
    wrongConfident: `${summaries[id].wrongConfident}/${summaries[id].n}`,
  }));
  const displayTable = table.map(row => ({
    ...row,
    top1: row.top1Text,
    top3: row.top3Text,
    top5: row.top5Text,
    top10: row.top10Text,
  }));

  const optimal = { tighter: 0, exact: 0, padded: 0 };
  const bestCounts = {};
  for (const frame of frames) {
    bestCounts[frame.bestId] = (bestCounts[frame.bestId] ?? 0) + 1;
    if (frame.bestMargin == null) continue;
    if (frame.bestMargin < 0) optimal.tighter += 1;
    else if (frame.bestMargin > 0) optimal.padded += 1;
    else optimal.exact += 1;
  }
  optimal.histogram = ART_MARGINS.map(margin => `${marginId(margin)} ${bestCounts[marginId(margin)] ?? 0}`).join(', ');

  const describe = frame => {
    const current = frame.scores.current;
    const exact = frame.scores.manual_0;
    const best = frame.scores[frame.bestId] ?? null;
    return {
      cardName: frame.cardName,
      line: `${frame.cardName} [${frame.imageId}]: current rank ${rankText(current)} (${current.top1Name ?? 'none'}), exact art rank ${rankText(exact)} (${exact?.top1Name ?? 'none'}), best ${frame.bestId} rank ${rankText(best)} (${best?.top1Name ?? 'none'})`,
    };
  };

  const byLabel = new Map();
  for (const frame of frames) {
    for (const label of frame.conditions) {
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(frame);
    }
  }
  const conditions = [...byLabel.entries()].map(([label, group]) => {
    const byId = {};
    for (const id of CROP_ORDER.filter(key => key.startsWith('manual_'))) {
      byId[id] = group.filter(frame => frame.scores[id]?.top1).length;
    }
    const bestId = Object.entries(byId).sort((a, b) => b[1] - a[1])[0][0];
    const detail = CROP_ORDER.filter(id => id.startsWith('manual_'))
      .map(id => `${labels[id]} ${byId[id]}/${group.length}`)
      .join(', ');
    return { label, n: group.length, bestId, bestTop1: byId[bestId], byId, detail };
  });

  const orientation = { canonical: 0, reordered: 0, mirrored: 0, buckets: { 0: 0, 90: 0, 180: 0, 270: 0 }, reorderedFrames: [] };
  for (const frame of frames) {
    if (!frame.orientation) continue;
    if (frame.orientation.kind === 'mirror') orientation.mirrored += 1;
    else if (frame.orientation.kind === 'rotation') {
      orientation.buckets[frame.orientation.snapped] = (orientation.buckets[frame.orientation.snapped] ?? 0) + 1;
    }
    if (frame.orientation.changed) {
      orientation.reordered += 1;
      orientation.reorderedFrames.push({
        cardName: frame.cardName,
        imageId: frame.imageId,
        angle: frame.orientation.angle,
        snapped: frame.orientation.snapped,
        kind: frame.orientation.kind,
      });
    } else orientation.canonical += 1;
  }
  const compare = frame => ({
    cardName: frame.cardName,
    imageId: frame.imageId,
    before: rankSeries(beforeByImage.get(frame.imageId)?.scores),
    after: rankSeries(frame.scores),
  });
  const otherNeedles = [
    'p-e-d-tre-et-de-foyer',
    'maddening-hex-afc-showcase-glare',
    'cq-20260908T120722',
    'focus-series-20260908T132626/t000',
  ];
  const autoTransition = transitionById.get('auto_anchor');
  const decision = chooseMarginPolicy({
    table: table.map(row => ({
      id: row.id,
      top1: summaries[row.id].top1,
      wrongToCorrect: row.wrongToCorrect,
      correctToWrong: row.correctToWrong,
    })),
    categoryTables: conditions,
  });

  const report = {
    date: new Date().toISOString(),
    git: gitCommit(),
    evalHash,
    n: frames.length,
    clip: galleryMeta.baseEncoderVersion,
    adapter: { sha256: galleryMeta.adapterSha256 },
    gallery: { id: galleryMeta.id, sha256: galleryMeta.gallerySha256, count: galleryMeta.count },
    table: displayTable,
    transitions: transitions.map(row => ({ ...row, id: labels[row.id] ?? row.id })),
    optimal,
    groupA: frames.filter(frame => frame.group === 'A').map(describe),
    groupB: frames.filter(frame => frame.group === 'B').map(describe),
    conditions,
    verdict: decision.verdict,
    verdictWhy: decision.why,
    autoNote: `auto_anchor is ${summaries.auto_anchor.top1}/${frames.length} Top1, with ${autoTransition?.wrongToCorrect ?? '—'} wrong→correct and ${autoTransition?.correctToWrong ?? '—'} correct→wrong.`,
    orientation,
    turnedComparison: frames.filter(frame => frame.orientation?.changed).map(compare),
    otherComparison: frames.filter(frame => otherNeedles.some(needle => frame.imageId.includes(needle))).map(compare),
    frames: frames.map(frame => ({
      imageId: frame.imageId,
      cardName: frame.cardName,
      frameFamily: frame.frameFamily,
      conditions: frame.conditions,
      group: frame.group,
      bestId: frame.bestId,
      orientation: frame.orientation,
      scores: Object.fromEntries(CROP_ORDER.map(id => [id, {
        top1: frame.scores[id]?.top1 ?? false,
        rank: frame.scores[id]?.rank ?? null,
        top1Name: frame.scores[id]?.top1Name ?? null,
        top1Score: frame.scores[id]?.top1Score ?? null,
        expectedScore: frame.scores[id]?.expectedScore ?? null,
        margin: frame.scores[id]?.margin ?? null,
        available: frame.scores[id]?.available !== false,
      }])),
    })),
  };
  await writeFile(join(reportsDir, 'art-crop-margin-sweep-v1.md'), markdown(report));
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, 'index.html'), html(report));
  log(`wrote ${join(reportsDir, 'art-crop-margin-sweep-v1.md')}`);
  log(`${decision.verdict}: ${decision.why}`);
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
