#!/usr/bin/env node
/**
 * Host scanner benchmark. Recorded OCR is not a fresh ML Kit read.
 * Host timings are not Samsung timings.
 *
 *   yarn scanner:bench
 *   yarn scanner:bench --experiment baseline
 *   yarn scanner:bench --promote baseline
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { hashDataset, loadAnnotations } from './lib/annotations.mjs';
import { classifyFailure, confirmedIdentities, geometryDecision, geometryDelta, percentile, verdictFromGains } from './lib/metrics.mjs';
import { experimentsDir, manifestsDir, reportsDir, resolveSafeMedia, rootDir } from './lib/paths.mjs';
import { decisionMarkdown, galleryHtml, summarizeRows, summaryMarkdown } from './lib/report.mjs';
import { identityMatches, resolveExpected } from '../recognition/scoring.mjs';
import { loadEncoder } from '../recognition/encoders.mjs';
import { loadGalleryIndex, searchGallery } from '../recognition/gallery.mjs';

const opt = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = name => process.argv.includes(`--${name}`);

const experimentArg = opt('experiment');
const promote = flag('promote');
const promoteId = promote ? experimentArg : null;

const now = () => performance.now();
const clamp01 = n => Math.max(0, Math.min(1, n));

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-bench-'));
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
        export * from '${join(rootDir, 'src/lib/scan/titleDecode.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/matchName.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/ranking/fuse.ts')}';
        export { scanImageToPngBytes } from '${join(rootDir, 'mobile/src/scan/debug/scanImagePng.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'bench-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

const stroke = (image, a, b, rgb) => {
  const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(a.x + ((b.x - a.x) * i) / n);
    const y = Math.round(a.y + ((b.y - a.y) * i) / n);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
    const o = (y * image.width + x) * 4;
    image.data[o] = rgb[0];
    image.data[o + 1] = rgb[1];
    image.data[o + 2] = rgb[2];
    image.data[o + 3] = 255;
  }
};

const paintQuad = (image, corners, rgb) => {
  if (!corners) return;
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  for (let i = 0; i < 4; i++) stroke(image, pts[i], pts[(i + 1) % 4], rgb);
};

const copyImage = image => ({
  width: image.width,
  height: image.height,
  data: new Uint8ClampedArray(image.data),
});

const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const recordedOcrFor = async imagePath => {
  const dir = dirname(resolveSafeMedia(imagePath));
  const replay = join(dir, 'replay.json');
  if (!existsSync(replay)) return [];
  const json = JSON.parse(await readFile(replay, 'utf8'));
  return Array.isArray(json.recordedOcr) ? json.recordedOcr : [];
};

const cornerById = corners => {
  const map = new Map();
  for (const row of corners ?? []) {
    if (row.status === 'CONFIRMED' && row.corners) map.set(row.imageId, row.corners);
  }
  return map;
};

const runVariant = async (ctx, item, mode) => {
  const t0 = now();
  const abs = resolveSafeMedia(item.path);
  const png = new Uint8Array(await readFile(abs));
  const tDecode = now();
  const decoded = PNG.sync.read(Buffer.from(png));
  const source = {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
  const tDecoded = now();
  let quad = null;
  let detected = false;
  const tDet0 = now();
  if (mode === 'current-detector') {
    const det = ctx.scan.detectCardQuad(source);
    quad = det.recognitionCorners ?? det.corners;
    detected = Boolean(quad);
  } else {
    quad = ctx.manual.get(item.imageId) ?? null;
    detected = Boolean(quad);
  }
  const tDet1 = now();
  if (!quad) {
    return {
      imageId: item.imageId,
      sessionId: item.sessionId,
      cardName: item.cardName,
      detected: false,
      visualAttempted: false,
      failure: 'DETECTOR_MISS',
      timing: { decode: tDecoded - tDecode, detector: tDet1 - tDet0, total: now() - t0 },
    };
  }

  const tWarp0 = now();
  let warp = null;
  let warpOk = true;
  try {
    warp = ctx.scan.warpQuadToCard(source, ctx.scan.cornersToQuad(quad));
  } catch {
    warpOk = false;
  }
  const tWarp1 = now();
  if (!warpOk || !warp) {
    return {
      imageId: item.imageId,
      sessionId: item.sessionId,
      cardName: item.cardName,
      detected: true,
      warpOk: false,
      visualAttempted: false,
      failure: 'WARP_FAILURE',
      timing: { decode: tDecoded - tDecode, detector: tDet1 - tDet0, warp: tWarp1 - tWarp0, total: now() - t0 },
    };
  }

  const tCrop0 = now();
  const art = ctx.scan.extractArtCropFromCard(warp);
  const tCrop1 = now();
  const slug = item.imageId.replace(/[^\w.-]+/g, '_').slice(-80);
  const artDir = join(ctx.artRoot, slug);
  await mkdir(artDir, { recursive: true });
  const tag = mode === 'current-detector' ? 'current' : 'oracle';
  const artPath = join(artDir, `${tag}-art.png`);
  const warpPath = join(artDir, `${tag}-warp.png`);
  const overlay = copyImage(source);
  paintQuad(overlay, quad, [80, 220, 120]);
  const manual = ctx.manual.get(item.imageId);
  await writeFile(artPath, ctx.scan.scanImageToPngBytes(art.crop, art.crop.width));
  await writeFile(warpPath, ctx.scan.scanImageToPngBytes(warp, Math.min(warp.width, 480)));
  await writeFile(join(artDir, `${tag}-overlay.png`), ctx.scan.scanImageToPngBytes(overlay, 480));

  let hits = [];
  let encodeMs = null;
  let searchMs = null;
  if (ctx.encoder && ctx.gallery) {
    const tE = now();
    const embedding = await ctx.encoder.embedPath(artPath);
    encodeMs = now() - tE;
    const searched = searchGallery(ctx.gallery, embedding, 10);
    searchMs = searched.searchMs;
    hits = searched.hits;
  }

  const expected = resolveExpected(rootDir, { expectedName: item.cardName, oracleId: item.oracleId });
  const matches = hit => identityMatches(expected, hit);
  const flags = hits.length
    ? {
        visualTop1: matches(hits[0]),
        visualTop3: hits.slice(0, 3).some(matches),
        visualTop5: hits.slice(0, 5).some(matches),
        visualTop10: hits.slice(0, 10).some(matches),
      }
    : { visualTop1: null, visualTop3: null, visualTop5: null, visualTop10: null };

  const geometry =
    manual && mode === 'current-detector'
      ? geometryDelta(quad, manual, source.width, source.height)
      : null;

  return {
    imageId: item.imageId,
    sessionId: item.sessionId,
    cardName: expected.resolvedName || item.cardName,
    oracleId: expected.oracleId,
    detected: true,
    warpOk: true,
    cropOk: true,
    visualAttempted: Boolean(ctx.encoder),
    predicted: hits[0]?.name ?? null,
    visualHits: hits.slice(0, 10).map(h => ({ name: h.name, oracleId: h.oracleId, score: h.score })),
    expectedRank: (() => {
      const idx = hits.findIndex(matches);
      return idx >= 0 ? idx + 1 : null;
    })(),
    top1Score: hits[0]?.score ?? null,
    top2Score: hits[1]?.score ?? null,
    margin: hits[0] && hits[1] ? hits[0].score - hits[1].score : null,
    identityCorrect: flags.visualTop1,
    ...flags,
    geometry,
    artifacts: [
      { label: 'source', href: `../../../${item.path}` },
      { label: 'overlay', href: `artifacts/${slug}/${tag}-overlay.png` },
      { label: 'warp', href: `artifacts/${slug}/${tag}-warp.png` },
      { label: 'art', href: `artifacts/${slug}/${tag}-art.png` },
    ],
    sourceHref: `../../../${item.path}`,
    timing: {
      decode: tDecoded - tDecode,
      detector: tDet1 - tDet0,
      warp: tWarp1 - tWarp0,
      crop: tCrop1 - tCrop0,
      encoder: encodeMs,
      search: searchMs,
      total: now() - t0,
    },
    artPath,
  };
};

const attachOcrAndFusion = (scan, index, row, recorded, visualHits) => {
  const t0 = now();
  if (!recorded?.length) {
    row.ocrStatus = null;
    row.timing.ocr = 0;
    row.timing.fusion = 0;
    return row;
  }
  const decode = scan.decodeRecordedTitleVariants(recorded, index);
  const accepted = decode.decision === 'exact-title' || decode.decision === 'strong-fuzzy';
  const expected = resolveExpected(rootDir, { expectedName: row.cardName, oracleId: row.oracleId });
  const ocrName = accepted ? decode.matchName : null;
  const ocrOk = Boolean(ocrName && identityMatches(expected, { name: ocrName }));
  row.ocrStatus = decode.decision;
  row.ocrText = decode.ocrText;
  row.ocrNameMatch = ocrOk;
  row.ocrWrongAccepted = Boolean(accepted && !ocrOk);
  row.timing.ocr = now() - t0;

  const byId = new Map();
  for (const hit of visualHits ?? []) {
    byId.set(hit.oracleId, {
      name: hit.name,
      oracleId: hit.oracleId,
      possiblePrintingIds: [],
      visualScore: clamp01(hit.score),
    });
  }
  const variant = decode.variants?.find(v => v.topName) ?? decode.variants?.[0];
  if (variant?.topName && variant.topScore != null) {
    const resolved = resolveExpected(rootDir, variant.topName);
    if (resolved.oracleId) {
      const prev = byId.get(resolved.oracleId) ?? {
        name: resolved.resolvedName,
        oracleId: resolved.oracleId,
        possiblePrintingIds: [],
      };
      prev.titleScore = clamp01(variant.topScore);
      byId.set(resolved.oracleId, prev);
    }
  }
  const tF = now();
  const fused = scan.fuseEvidence([...byId.values()], {
    allowTitleOnly: true,
    artworkOnly: ![...byId.values()].some(r => r.titleScore != null),
  });
  row.timing.fusion = now() - tF;
  const fusedName =
    fused.status === 'identified' || fused.status === 'printing-ambiguous' ? fused.card?.name ?? null : null;
  const fusedOk = Boolean(fusedName && identityMatches(expected, { name: fusedName }));
  row.fusedOk = fusedOk;
  row.fusedName = fusedName;
  row.fusionStatus = fused.status;
  const visualOk = row.visualTop1 === true;
  row.fusionClass = fusionClassOf(visualOk, ocrOk, fusedOk);
  row.fusionBreaksCorrect = (visualOk || ocrOk) && !fusedOk;
  row.predicted = row.predicted ?? fusedName;
  return row;
};

const fusionClassOf = (visualOk, ocrOk, fusedOk) => {
  if (visualOk && ocrOk && fusedOk) return 'BOTH_AGREE';
  if (!visualOk && ocrOk && fusedOk) return 'OCR_FIXES_VISUAL';
  if (visualOk && !ocrOk && fusedOk) return 'VISUAL_FIXES_OCR';
  if (!visualOk && !ocrOk && fusedOk) return 'FUSION_FIXES_BOTH';
  if (visualOk && !fusedOk) return 'FUSION_BREAKS_VISUAL';
  if (ocrOk && !fusedOk) return 'FUSION_BREAKS_OCR';
  return 'BOTH_FAIL';
};

const CSV_HEADER =
  'date,git,datasetHash,nConfirmed,nCorners,currentTop1,oracleTop1,top1Delta,currentTop3,oracleTop3,top3Delta,medianIou,p95CornerPx,verdict,notes\n';

const appendCsv = async (summary) => {
  const path = join(experimentsDir, 'results.csv');
  const counts = (block, key) => {
    if (!block) return '';
    const n = block.visual[key].n;
    return `${Math.round((block.visual[key].frame ?? 0) * n)}/${n}`;
  };
  const a = summary.variants?.baseline;
  const b = summary.variants?.['oracle-card'];
  const line = [
    summary.date,
    summary.git,
    summary.datasetHash,
    summary.confirmedIdentities ?? '',
    summary.confirmedCorners ?? '',
    counts(a, 'top1'),
    counts(b, 'top1'),
    summary.top1Delta ?? '',
    counts(a, 'top3'),
    counts(b, 'top3'),
    summary.top3Delta ?? '',
    summary.geometryAggregate?.medianIou ?? '',
    summary.geometryAggregate?.p95CornerPx ?? '',
    summary.preliminary ? `PRELIMINARY ${summary.verdict}` : summary.verdict,
    JSON.stringify(summary.verdictWhy ?? ''),
  ].join(',');
  const prior = existsSync(path) ? await readFile(path, 'utf8') : '';
  const body = prior.includes('currentTop1')
    ? prior.trimEnd()
    : CSV_HEADER.trimEnd() +
      (prior.trim()
        ? `\n${prior
            .trim()
            .split('\n')
            .slice(1)
            .map(row => {
              const cells = row.split(',');
              return [cells[1], cells[2], cells[4], cells[5], '', cells[6], '', '', cells[7], '', '', cells[10], '', cells[13] ?? '', ''].join(',');
            })
            .join('\n')}`
        : '');
  await writeFile(path, `${body.trimEnd()}\n${line}\n`);
};

const stillsPath = join(manifestsDir, 'stills-v1.json');
if (!existsSync(stillsPath)) {
  console.error('Missing stills-v1.json. Run yarn scanner:inventory first.');
  process.exit(1);
}

const stills = await readJson(stillsPath);
const annotations = await loadAnnotations();
const confirmed = new Map(confirmedIdentities(annotations.identities).map(row => [row.imageId, row]));
const items = stills.items
  .filter(item => confirmed.has(item.imageId))
  .map(item => ({
    ...item,
    cardName: confirmed.get(item.imageId).cardName,
    oracleId: confirmed.get(item.imageId).oracleId ?? null,
  }));
const manual = cornerById(annotations.corners);
const cornerNotes = new Map((annotations.corners ?? []).map(row => [row.imageId, row]));
const previousDatasetHash = stills.datasetHash ?? null;
const freshHash = hashDataset(stills, annotations);
if (freshHash !== stills.datasetHash) {
  stills.previousDatasetHash = stills.datasetHash ?? null;
  stills.datasetHash = freshHash;
  stills.cornersUpdatedAt = new Date().toISOString();
  stills.counts = { ...(stills.counts ?? {}), confirmedCorners: manual.size };
  await writeFile(stillsPath, `${JSON.stringify(stills, null, 2)}\n`);
  console.log(`Dataset hash ${previousDatasetHash?.slice(0, 12) ?? 'none'} → ${freshHash.slice(0, 12)}`);
}
const want = experimentArg ? [experimentArg] : ['baseline', 'oracle-card', 'oracle-art'];

const outDir = join(reportsDir, 'latest');
await mkdir(outDir, { recursive: true });
await mkdir(experimentsDir, { recursive: true });

const oracleWanted = want.some(id => id !== 'baseline');
if (oracleWanted && manual.size === 0 && want.every(id => id !== 'baseline')) {
  const summary = {
    experimentId: want.join('+'),
    datasetVersion: stills.datasetVersion,
    datasetHash: stills.datasetHash,
    date: new Date().toISOString(),
    git: gitCommit(),
    verdict: 'INSUFFICIENT_GROUND_TRUTH',
    verdictWhy: `Annotate corners for ${stills.counts?.needsCornerAnnotation ?? stills.items.length} frames. No CONFIRMED corners exist, so oracle geometry was not scored.`,
    note: 'Recorded detector quads were not used as truth.',
    variants: {},
    rows: [],
    gains: { aToB: null, bToC: null },
  };
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir, 'summary.md'), summaryMarkdown(summary));
  await writeFile(join(outDir, 'index.html'), galleryHtml(summary));
  console.log(summary.verdictWhy);
  process.exit(0);
}

console.log(`Scoring ${items.length} confirmed identities. Confirmed corners: ${manual.size}.`);
const scan = await loadScan();
const names = JSON.parse(await readFile(join(rootDir, '.scan-fixtures/card-names.json'), 'utf8'));
const index = scan.buildNameIndex(names);

let encoder = null;
let gallery = null;
if (!flag('skip-visual')) {
  console.log('Loading CLIP ViT-B/32 and the full gallery…');
  const loaded = await loadEncoder('CLIP_VIT_B32');
  encoder = loaded.runtime;
  gallery = loadGalleryIndex('CLIP_VIT_B32', 'full');
  if (!gallery) throw new Error('Missing CLIP full gallery. It lives under .scan-fixtures/visual-embed/indexes/CLIP_VIT_B32/full');
  console.log(`Gallery ${gallery.count} refs`);
}

const ctx = {
  scan,
  encoder,
  gallery,
  manual,
  artRoot: join(outDir, 'artifacts'),
};

const cache = new Map();
const runCached = async (item, mode) => {
  const key = `${item.imageId}:${mode}`;
  if (cache.has(key)) return structuredClone(cache.get(key));
  const row = await runVariant(ctx, item, mode);
  cache.set(key, row);
  return structuredClone(row);
};

const variants = {};
const configs = {};
const allRows = [];
for (const id of want) {
  try {
    configs[id] = JSON.parse(await readFile(join(experimentsDir, `${id}.json`), 'utf8'));
  } catch {
    configs[id] = { id };
  }
  const mode = id === 'baseline' ? 'current-detector' : 'manual-corners';
  if (mode === 'manual-corners' && manual.size === 0) {
    variants[id] = null;
    continue;
  }
  const rows = [];
  for (const item of items) {
    if (mode === 'manual-corners' && !manual.has(item.imageId)) continue;
    const row = await runCached(item, mode);
    const recorded = await recordedOcrFor(item.path);
    attachOcrAndFusion(scan, index, row, recorded, row.visualHits);
    if (!row.failure) row.failure = classifyFailure(row);
    row.variant = id;
    rows.push(row);
    allRows.push(row);
    console.log(`${id} ${row.cardName ?? row.imageId} visual=${row.predicted ?? 'none'} top1=${row.visualTop1}`);
  }
  variants[id] = rows.length ? summarizeRows(rows) : null;
}

const rate = id => variants[id]?.visual.top1.frame ?? null;
const legacy = verdictFromGains({
  a: rate('baseline'),
  b: rate('oracle-card'),
  c: rate('oracle-art'),
  structuralSameCrop: true,
  fusionGain: null,
});
const a = rate('baseline');
const b = rate('oracle-card');
const baselineRows = allRows.filter(row => row.variant === 'baseline');
const oracleRows = new Map(allRows.filter(row => row.variant === 'oracle-card').map(row => [row.imageId, row]));
const comparisons = baselineRows
  .filter(row => oracleRows.has(row.imageId))
  .map(row => {
    const oracle = oracleRows.get(row.imageId);
    const deltaClass =
      row.visualTop1 && oracle.visualTop1
        ? 'UNCHANGED_CORRECT'
        : !row.visualTop1 && oracle.visualTop1
          ? 'GEOMETRY_FIX'
          : row.visualTop1 && !oracle.visualTop1
            ? 'GEOMETRY_BREAK'
            : 'STILL_WRONG';
    return {
      imageId: row.imageId,
      cardName: row.cardName,
      uncertain: Boolean(cornerNotes.get(row.imageId)?.uncertain),
      deltaClass,
      sourceHref: row.sourceHref,
      geometry: row.geometry,
      current: row,
      oracle,
    };
  });
const hitCount = (block, key) =>
  block ? Math.round((block.visual[key].frame ?? 0) * block.visual[key].n) : null;
const currentTop1Count = hitCount(variants.baseline, 'top1');
const oracleTop1Count = hitCount(variants['oracle-card'], 'top1');
const recovered = comparisons.filter(row => row.deltaClass === 'GEOMETRY_FIX').map(row => row.cardName);
const broken = comparisons.filter(row => row.deltaClass === 'GEOMETRY_BREAK').map(row => row.cardName);
const stillWrong = comparisons.filter(row => row.deltaClass === 'STILL_WRONG').map(row => row.cardName);
const paired = comparisons.length;
const counted = geometryDecision({
  n: paired,
  currentTop1: currentTop1Count,
  oracleTop1: oracleTop1Count,
  recovered: recovered.length,
  broken: broken.length,
  stillWrong: stillWrong.length,
});
const decision = paired >= 5 ? counted : legacy;
const geos = comparisons.map(row => row.geometry).filter(Boolean);
const geometryAggregate = geos.length
  ? {
      medianIou: percentile(geos.map(g => g.iou), 0.5),
      p95Iou: percentile(geos.map(g => g.iou), 0.95),
      worstIou: Math.min(...geos.map(g => g.iou)),
      medianCornerPx: percentile(geos.map(g => g.cornerPx), 0.5),
      p95CornerPx: percentile(geos.map(g => g.cornerPx), 0.95),
      worstCornerPx: Math.max(...geos.map(g => g.cornerPx)),
      medianCornerNorm: percentile(geos.map(g => g.cornerNorm), 0.5),
      medianCenterNorm: percentile(geos.map(g => g.centerNorm), 0.5),
      medianAreaRatio: percentile(geos.map(g => g.areaRatio), 0.5),
    }
  : null;
const missReviews = comparisons
  .filter(row => row.current.visualTop1 === false)
  .map(row => {
    const before = row.current.expectedRank;
    const after = row.oracle.expectedRank;
    let outcome = 'NO_MEANINGFUL_DIFFERENCE';
    if (row.oracle.visualTop1) outcome = 'RECOVERED_TOP1';
    else if (after != null && (before == null || after < before)) outcome = 'RANK_IMPROVED';
    else if (before != null && (after == null || after > before)) outcome = 'WORSE';
    return {
      cardName: row.cardName,
      outcome,
      currentRank: before,
      oracleRank: after,
      currentMargin: row.current.margin,
      oracleMargin: row.oracle.margin,
      iou: row.geometry?.iou ?? null,
    };
  });
let nextExperiment = 'Finish corners on the confirmed frames before choosing a model experiment.';
if (decision.verdict === 'GEOMETRY_DOMINANT' || decision.verdict === 'GEOMETRY_MAJOR') {
  nextExperiment =
    'FOUR-CORNER / KEYPOINT MODEL BAKEOFF. Compare keypoint regression, segmentation plus a corner fit, and an object detector with a corner head on these phone frames. Do not train in this pass.';
} else if (decision.verdict === 'RECOGNITION_DOMINANT') {
  nextExperiment =
    'MTG-SPECIFIC METRIC LEARNING / EMBEDDING BAKEOFF. Train toward a rough phone-card crop matching a canonical card embedding, with synthetic crop error, perspective, blur, motion blur, glare, sleeves, lighting, and background. Do not train in this pass.';
} else if (decision.verdict === 'MIXED') {
  nextExperiment =
    recovered.length >= stillWrong.length
      ? 'FOUR-CORNER / KEYPOINT MODEL BAKEOFF. Oracle corners fixed more labeled misses than they left behind, so a card-corner model is the higher-payoff next measurement.'
      : 'MTG-SPECIFIC METRIC LEARNING / EMBEDDING BAKEOFF. Oracle corners left more misses than they fixed, so a card embedding is the higher-payoff next measurement.';
}
const summary = {
  experimentId: want.join('+'),
  datasetVersion: stills.datasetVersion,
  datasetHash: stills.datasetHash,
  date: new Date().toISOString(),
  git: gitCommit(),
  timingLabel: 'HOST BENCHMARK TIMING',
  note: 'Variant C is NOT INDEPENDENT / SAME CROP LOGIC. It calls the same extractArtCropFromCard as oracle card. The decision uses visual Top1 only. Fusion was not tuned. OCR is recorded, not fresh ML Kit.',
  previousDatasetHash,
  preliminary: Boolean(decision.preliminary),
  verdict: decision.verdict,
  verdictWhy: decision.why,
  nextExperiment,
  pairedFrames: paired,
  top1Delta: currentTop1Count != null && oracleTop1Count != null ? oracleTop1Count - currentTop1Count : null,
  top3Delta:
    hitCount(variants.baseline, 'top3') != null && hitCount(variants['oracle-card'], 'top3') != null
      ? hitCount(variants['oracle-card'], 'top3') - hitCount(variants.baseline, 'top3')
      : null,
  recovered,
  stillWrong,
  broken,
  geometryAggregate,
  missReviews,
  comparisons,
  gains: {
    aToB: a != null && b != null ? b - a : null,
    bToC: null,
  },
  variants,
  configs,
  rows: allRows,
  wrongConfident: allRows.filter(r => {
    if (r.visualTop1 !== false) return false;
    const top = r.visualHits?.[0]?.score;
    const second = r.visualHits?.[1]?.score ?? 0;
    return top != null && top - second >= 0.05;
  }).length,
  misses: allRows.filter(r => r.visualTop1 === false).length,
  confirmedIdentities: items.length,
  confirmedCorners: manual.size,
};

await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(join(outDir, 'summary.md'), `${summaryMarkdown(summary)}\n${decisionMarkdown(summary)}`);
await writeFile(join(outDir, 'index.html'), galleryHtml(summary));
const decisionName = summary.preliminary ? 'oracle-geometry-decision-preliminary.md' : 'oracle-geometry-decision.md';
if (paired > 0) {
  await writeFile(join(reportsDir, decisionName), decisionMarkdown(summary));
}
await appendCsv(summary);

if (promoteId) {
  await writeFile(
    join(experimentsDir, 'CURRENT_BEST.json'),
    `${JSON.stringify({ experimentId: promoteId, promotedAt: summary.date, datasetHash: summary.datasetHash, summary: 'scanner-benchmark/reports/latest/summary.json' }, null, 2)}\n`,
  );
  console.log(`Promoted ${promoteId}`);
}

console.log(decision.verdict);
console.log(decision.why);
console.log(`Report ${join('scanner-benchmark/reports/latest', 'index.html')}`);
