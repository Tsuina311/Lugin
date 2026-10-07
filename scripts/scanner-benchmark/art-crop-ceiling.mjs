#!/usr/bin/env node
/**
 * B1 art-crop ceiling. Same encoder, adapter, gallery, and ranking.
 * Only the art polygon changes. Phone frames are not training data.
 *
 *   yarn scanner:b1-gallery
 *   yarn scanner:art-crop-ceiling
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { measureQuads } from '../geometry/lib/frame-regions/report.mjs';
import { canonicalQuadToSource, orderRegionQuadInCardSpace } from '../geometry/lib/frame-regions/project.mjs';
import { detectFrameRegions } from '../geometry/lib/frame-regions/detect.mjs';
import { FIXTURES_DIR } from '../geometry/lib/paths.mjs';
import { forward, loadModel } from './embedding/math.mjs';
import { B1_ADAPTER_PATH, B1_GALLERY_DIR, buildB1Gallery } from './embedding/b1-gallery.mjs';
import {
  assertNoEvalLeak,
  autoRowsForSummary,
  buildCropVariants,
  ceilingHtml,
  autoAnchorVerdict,
  ceilingVerdict,
  emptyMiss,
  encodeArtCrop,
  failureRows,
  iouRecognitionSplit,
  isManualArtBox,
  namedQuadToPoints,
  pairedNames,
  pairedTransitions,
  rankInGallery,
  summarizeArtGeometry,
  summarizeCrop,
} from './embedding/crop-ceiling.mjs';

const FROZEN_PREFIX = 'c9470c26eebd';
const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-ceiling-'));
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
      sourcefile: 'ceiling-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const orientedArtQuad = manual => {
  if (!manual?.quad) return null;
  if (!manual.cardQuad) return manual.quad;
  return orderRegionQuadInCardSpace({ regionQuadSource: manual.quad, cardQuadSource: manual.cardQuad });
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
      cardQuad: card?.groundTruthQuad ?? null,
      tags: fixture.tags ?? [],
    });
  }
  return map;
};

const scoreVector = (gallery, vector, expected) =>
  rankInGallery(gallery.embeddings, gallery.refs, gallery.dims, vector, hit => identityMatches(expected, hit));

const fmt = (summary, key) => (summary ? `${summary[key]}/${summary.n}` : '—');

const transitionLines = (title, rows) => {
  if (!rows) return [`${title}: not computed`];
  return [
    `${title} (n=${rows.n})`,
    `- wrong → correct: ${rows.wrongToCorrect}`,
    `- correct → wrong: ${rows.correctToWrong}`,
    `- unchanged correct: ${rows.unchangedCorrect}`,
    `- unchanged wrong: ${rows.unchangedWrong}`,
  ];
};

const markdown = report => {
  const lines = [];
  lines.push('# ART CROP CEILING V1');
  lines.push('');
  lines.push(`Frozen eval stills-v1 \`${report.evalHash}\`. Git \`${report.git}\`.`);
  lines.push('');
  lines.push('B1 is a frozen CLIP ViT-B/32 art embedding plus the linear adapter. The raw CLIP gallery was not modified.');
  lines.push('');
  lines.push('## VERSIONS');
  lines.push('');
  lines.push(`- CLIP: \`${report.clip}\``);
  lines.push(`- Adapter: \`${report.adapter.sha256}\` (${report.adapter.params} params)`);
  lines.push(`- B1 gallery: \`${report.gallery.id}\` \`${report.gallery.sha256}\` (${report.gallery.count} arts)`);
  lines.push(`- Eval: stills-v1 \`${report.evalHash}\``);
  lines.push('');
  lines.push('## CROPS');
  lines.push('');
  lines.push('Current is the production path: detector quad, `warpQuadToCard`, `extractArtCropFromCard`.');
  lines.push('Auto anchor is `detectFrameRegions` on that same warped card. A missing art box is a failure and stays in the denominator.');
  lines.push('Manual ground truth is a human-reviewed `artBox` (`auto-accepted`, `auto-edited`, or `manual`, with `reviewed: true`) in source pixels. An untouched automatic proposal is not ground truth.');
  lines.push('Every available polygon is rectified with `warpQuadToCard` to the current crop’s width and height, then encoded with `scanImageToPngBytes(image, image.width)` and the same CLIP `embedPath`. No extra sharpen, contrast, or padding.');
  lines.push('');
  lines.push('| Crop source | Top1 | Top3 | Top5 | Top10 | Wrong-confident |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.table) {
    lines.push(`| ${row.id} | ${row.top1} | ${row.top3} | ${row.top5} | ${row.top10} | ${row.wrongConfident} |`);
  }
  lines.push('');
  lines.push(`Manual art boxes annotated: ${report.manualAnnotated}/${report.n}. Auto art-box failures: ${report.autoFailures}/${report.n}.`);
  lines.push('');
  lines.push('## PAIRED TRANSITIONS');
  lines.push('');
  lines.push(...transitionLines('CURRENT → AUTO_ANCHOR', report.transitions.currentToAuto));
  lines.push('');
  lines.push(...transitionLines('CURRENT → MANUAL_GT', report.transitions.currentToManual));
  lines.push('');
  lines.push(...transitionLines('AUTO_ANCHOR → MANUAL_GT', report.transitions.autoToManual));
  lines.push('');
  const nameBlock = (title, names) => {
    if (!names) return [`${title}: not computed`];
    return [
      title,
      `- wrong → correct: ${names.wrongToCorrect.join(', ') || 'none'}`,
      `- correct → wrong: ${names.correctToWrong.join(', ') || 'none'}`,
      `- unchanged correct: ${names.unchangedCorrect.length}`,
      `- unchanged wrong: ${names.unchangedWrong.join(', ') || 'none'}`,
    ];
  };
  lines.push(...nameBlock('CURRENT → MANUAL_GT cards', report.transitionNames?.currentToManual));
  lines.push('');
  lines.push(...nameBlock('AUTO_ANCHOR → MANUAL_GT cards', report.transitionNames?.autoToManual));
  lines.push('');
  lines.push('## AUTO ANCHOR VS HUMAN ART BOX');
  lines.push('');
  const geometry = report.geometry;
  if (!geometry || geometry.reviewed < geometry.n) {
    lines.push(`Not measured. Human-reviewed art boxes: ${geometry?.reviewed ?? 0}/${geometry?.n ?? report.n}.`);
  } else {
    lines.push(`- auto artBox detection coverage: ${geometry.autoDetected}/${geometry.n}`);
    lines.push(`- median IoU: ${geometry.medianIou?.toFixed?.(3) ?? '—'}`);
    lines.push(`- p10 IoU: ${geometry.p10Iou?.toFixed?.(3) ?? '—'}`);
    lines.push(`- p25 IoU: ${geometry.p25Iou?.toFixed?.(3) ?? '—'}`);
    lines.push(`- median canonical corner error: ${geometry.medianCornerError?.toFixed?.(2) ?? '—'} px`);
    lines.push(`- p90 canonical corner error: ${geometry.p90CornerError?.toFixed?.(2) ?? '—'} px`);
    lines.push(`- auto boxes within IoU 0.90 of the human box: ${geometry.unchangedByIou}`);
    lines.push(`- auto boxes missed or below IoU 0.75: ${geometry.materialDiff}`);
    lines.push(`- annotation source auto-accepted / auto-edited / manual: ${geometry.accepted} / ${geometry.edited} / ${geometry.manual}`);
    lines.push(`- auto detection failures: ${geometry.autoMisses.length}`);
    for (const miss of geometry.autoMisses) lines.push(`  - ${miss.cardName} (${miss.imageId})`);
  }
  lines.push('');
  lines.push(`**${report.anchorVerdict || 'AUTO_ANCHOR_UNMEASURED'}**`);
  lines.push('');
  lines.push(report.anchorWhy || '');
  lines.push('');
  lines.push('## FAILURES STILL WRONG UNDER B1 CURRENT CROP');
  lines.push('');
  const counts = {};
  for (const row of report.failures) counts[row.failureClass] = (counts[row.failureClass] ?? 0) + 1;
  if (!report.failures.length) lines.push('None.');
  else {
    lines.push(Object.entries(counts).map(([key, n]) => `- ${key}: ${n}`).join('\n'));
    lines.push('');
    for (const row of report.failures) {
      lines.push(`- ${row.expected} [${row.imageId}]: current rank ${row.expectedRank ?? '—'}, auto rank ${row.autoRank ?? 'none'}, manual rank ${row.manualRank ?? 'none'}, fixed ${row.fixed ? 'yes' : 'no'}, current top1 ${row.top1Prediction ?? 'none'}, manual top1 ${row.manualTop1 ?? 'none'}, class ${row.failureClass}${row.notes ? ` (${row.notes})` : ''}`);
    }
  }
  lines.push('');
  lines.push('## QUESTIONS');
  lines.push('');
  for (const answer of report.answers) lines.push(`- ${answer}`);
  lines.push('');
  lines.push('## VERDICT');
  lines.push('');
  lines.push(`**${report.verdict}**`);
  lines.push('');
  lines.push(report.verdictWhy);
  lines.push('');
  lines.push('The automatic-anchor rating above is separate from this bottleneck verdict.');
  lines.push('');
  lines.push('## NEXT');
  lines.push('');
  lines.push(report.next);
  lines.push('');
  lines.push('## PRODUCTION');
  lines.push('');
  lines.push('Scanner, detector thresholds, OCR, fusion, Android, EAS, and OTA were not changed. CLIP was not fine-tuned. These 46 frames were not used as training data.');
  lines.push('');
  return `${lines.join('\n')}\n`;
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
  const trainingPaths = ['.scan-fixtures/visual-embed/art-crops', '.scan-fixtures/embedding-bakeoff/full-cards'];
  assertNoEvalLeak(items.map(item => item.path), trainingPaths);

  log('loading CLIP');
  const { runtime: encoder } = await loadEncoder('CLIP_VIT_B32');
  const scan = await loadScan();
  const manuals = await manualByImage();
  const artRoot = join(reportsDir, 'art-crop-ceiling-v1', 'artifacts');
  await mkdir(artRoot, { recursive: true });
  const canonicalByOracle = new Map();
  for (const ref of gallery.refs) if (!canonicalByOracle.has(ref.oracleId)) canonicalByOracle.set(ref.oracleId, ref);

  const frames = [];
  for (const item of items) {
    const expected = resolveExpected(rootDir, { expectedName: item.cardName, oracleId: item.oracleId });
    const abs = resolveSafeMedia(item.path);
    const decoded = PNG.sync.read(readFileSync(abs));
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const slug = item.imageId.replace(/[^\w.-]+/g, '_').slice(-80);
    const dir = join(artRoot, slug);
    mkdirSync(dir, { recursive: true });
    const det = scan.detectCardQuad(source);
    const corners = det.recognitionCorners ?? det.corners;
    const manual = manuals.get(item.path) ?? null;
    const notes = [];
    if (!corners) {
      const miss = emptyMiss('no card quad');
      let manualScore = emptyMiss('not annotated');
      let manualImage = null;
      if (manual) {
        const manualCrop = scan.warpQuadToCard(source, namedQuadToPoints(orientedArtQuad(manual)), 625, 436);
        const png = encodeArtCrop(scan.scanImageToPngBytes, manualCrop);
        const path = join(dir, 'manual.png');
        await writeFile(path, png);
        const raw = Float32Array.from(await encoder.embedPath(path));
        manualScore = { available: true, failed: false, ...(await scoreVector(gallery, forward(model, raw).y, expected)) };
        manualImage = `artifacts/${slug}/manual.png`;
      }
      frames.push({
        imageId: item.path,
        cardName: item.cardName,
        detected: false,
        notes: 'detector returned no quad',
        current: miss,
        auto_anchor: miss,
        manual_gt: manualScore,
        artReview: manual ? { source: manual.source } : null,
        artGeometry: null,
        tags: [...(item.autoTags ?? []), ...(manual?.tags ?? [])],
        images: { source: relative(join(reportsDir, 'art-crop-ceiling-v1'), abs), manual_gt: manualImage },
      });
      continue;
    }
    const warp = scan.warpQuadToCard(source, scan.cornersToQuad(corners));
    const current = scan.extractArtCropFromCard(warp).crop;
    const detected = detectFrameRegions(warp);
    const autoRegion = detected.regions?.artBox ?? null;
    let autoQuad = null;
    if (autoRegion?.quad) {
      const sourceQuad = canonicalQuadToSource(autoRegion.quad, cornersNamed(corners), warp.width, warp.height);
      autoQuad = namedQuadToPoints(sourceQuad);
    } else {
      notes.push('auto art box not detected');
    }
    const manualQuad = manual ? namedQuadToPoints(orientedArtQuad(manual)) : null;
    if (!manual) notes.push('manual art box not annotated');
    const variants = buildCropVariants({
      warpQuadToCard: scan.warpQuadToCard,
      currentCrop: current,
      source,
      autoQuad,
      manualQuad,
    });
    const embed = async (image, name) => {
      const png = encodeArtCrop(scan.scanImageToPngBytes, image);
      const path = join(dir, `${name}.png`);
      await writeFile(path, png);
      const raw = Float32Array.from(await encoder.embedPath(path));
      return forward(model, raw).y;
    };
    const currentScore = { available: true, failed: false, ...(await scoreVector(gallery, await embed(variants.current, 'current'), expected)) };
    const autoScore = variants.auto_anchor
      ? { available: true, failed: false, ...(await scoreVector(gallery, await embed(variants.auto_anchor, 'auto'), expected)) }
      : emptyMiss('no art box');
    const manualScore = variants.manual_gt
      ? { available: true, failed: false, ...(await scoreVector(gallery, await embed(variants.manual_gt, 'manual'), expected)) }
      : emptyMiss('not annotated');
    let artGeometry = null;
    if (manual && autoRegion?.quad) {
      const autoNamed = canonicalQuadToSource(autoRegion.quad, cornersNamed(corners), warp.width, warp.height);
      const cardQuad = manual.cardQuad?.tl ? manual.cardQuad : cornersNamed(corners);
      artGeometry = measureQuads(cardQuad, autoNamed, orientedArtQuad(manual));
    }
    const canonical = canonicalByOracle.get(expected.oracleId);
    const canonicalPath = canonical
      ? join(rootDir, '.scan-fixtures/visual-embed/art-crops', `${canonical.scryfallId}.jpg`)
      : null;
    frames.push({
      imageId: item.path,
      cardName: item.cardName,
      detected: true,
      notes: notes.join('; '),
      current: currentScore,
      auto_anchor: autoScore,
      manual_gt: manualScore,
      artReview: manual ? { source: manual.source } : null,
      artGeometry,
      tags: [...(item.autoTags ?? []), ...(manual?.tags ?? [])],
      images: {
        source: relative(join(reportsDir, 'art-crop-ceiling-v1'), abs),
        current: `artifacts/${slug}/current.png`,
        auto_anchor: variants.auto_anchor ? `artifacts/${slug}/auto.png` : null,
        manual_gt: variants.manual_gt ? `artifacts/${slug}/manual.png` : null,
        canonical: canonicalPath && existsSync(canonicalPath) ? relative(join(reportsDir, 'art-crop-ceiling-v1'), canonicalPath) : null,
      },
    });
    log(`${item.cardName} current ${currentScore.top1 ? 'hit' : currentScore.rank ?? 'miss'} auto ${autoScore.available ? autoScore.rank ?? 'miss' : 'fail'}`);
  }

  const currentRows = frames.map(frame => frame.current);
  const autoRows = autoRowsForSummary(frames);
  const manualFrames = frames.filter(frame => frame.manual_gt?.available);
  const currentSummary = summarizeCrop(currentRows);
  const autoSummary = summarizeCrop(autoRows);
  const manualSummary = manualFrames.length ? summarizeCrop(manualFrames.map(frame => frame.manual_gt)) : null;
  const transitions = {
    currentToAuto: pairedTransitions(currentRows, autoRows),
    currentToManual: manualFrames.length
      ? pairedTransitions(manualFrames.map(frame => frame.current), manualFrames.map(frame => frame.manual_gt))
      : null,
    autoToManual: manualFrames.length
      ? pairedTransitions(manualFrames.map(frame => frame.auto_anchor), manualFrames.map(frame => frame.manual_gt))
      : null,
  };
  const geometry = summarizeArtGeometry(frames);
  const anchor = autoAnchorVerdict(geometry);
  const transitionNames = {
    currentToManual: transitions.currentToManual
      ? pairedNames(
          manualFrames.map(frame => frame.current),
          manualFrames.map(frame => frame.manual_gt),
          manualFrames.map(frame => frame.cardName),
        )
      : null,
    autoToManual: transitions.autoToManual
      ? pairedNames(
          manualFrames.map(frame => frame.auto_anchor),
          manualFrames.map(frame => frame.manual_gt),
          manualFrames.map(frame => frame.cardName),
        )
      : null,
  };
  const iouSplit = iouRecognitionSplit(frames);
  const failures = failureRows(frames);
  const decision = ceilingVerdict({
    currentTop1: currentSummary.top1,
    manualTop1: manualSummary?.top1 ?? 0,
    manualN: manualFrames.length,
    n: frames.length,
  });
  const autoFixed = transitions.currentToAuto.wrongToCorrect;
  const next =
    decision.verdict === 'MANUAL_GT_INCOMPLETE'
      ? 'Annotate the final artBox on these 46 frozen frames in Geometry Lab, then rerun yarn scanner:art-crop-ceiling. Do not fine-tune CLIP before that measurement.'
      : decision.verdict === 'GEOMETRY_BOTTLENECK_CONFIRMED'
        ? 'Work on frame-anchor / art-box localization. Do not fine-tune CLIP.'
        : decision.verdict === 'REPRESENTATION_BOTTLENECK_DOMINANT'
          ? 'Frame anchors are not the identity bottleneck. The next measurement is a harder adapter or a different encoder, not a CLIP fine-tune until that measurement says so.'
          : 'Separate the frames manual geometry fixes from the frames it does not, and run one follow-up on the larger of those two groups.';
  const manualWrong = manualFrames.filter(frame => !frame.manual_gt.top1).length;
  const cropFixes = failures.filter(row => row.failureClass === 'BAD_ART_CROP').length;
  const coverage = geometry.n ? geometry.autoDetected / geometry.n : 0;
  const weakness = geometry.reviewed < geometry.n
    ? 'Auto-anchor weakness is not rated until every frame has a human art box.'
    : coverage < 0.9 && (geometry.medianIou ?? 1) < 0.85
      ? 'Auto-anchor is weak on both coverage and boundary accuracy.'
      : coverage < 0.9
        ? 'Auto-anchor’s main weakness is coverage: missed art boxes, more than the boxes it does place.'
        : (geometry.medianIou ?? 1) < 0.85 || (geometry.materialDiff ?? 0) > geometry.n * 0.25
          ? 'Auto-anchor’s main weakness is boundary accuracy: most cards get a box, but many differ from the human polygon.'
          : 'Auto-anchor is close to the human box on both coverage and boundary accuracy.';
  const iouNote = iouSplit.n
    ? `Where auto and manual name the same top1, median IoU is ${iouSplit.medianIouWhenAgree?.toFixed?.(3) ?? '—'}. Where they disagree, median IoU is ${iouSplit.medianIouWhenDisagree?.toFixed?.(3) ?? '—'}. Agreement is ${iouSplit.highAgree}/${iouSplit.highN} at IoU≥0.85 and ${iouSplit.lowAgree}/${iouSplit.lowN} below that.`
    : 'IoU versus recognition is not measured.';
  const answers = [
    manualSummary
      ? `Manual GT changes Top1 from ${currentSummary.top1}/${currentSummary.n} to ${manualSummary.top1}/${manualSummary.n} (${manualSummary.top1 - currentSummary.top1 >= 0 ? '+' : ''}${manualSummary.top1 - currentSummary.top1}).`
      : 'Manual GT Top1 is not measured.',
    manualSummary
      ? `Top3 moves from ${currentSummary.top3}/${currentSummary.n} to ${manualSummary.top3}/${manualSummary.n}. Top5 moves from ${currentSummary.top5}/${currentSummary.n} to ${manualSummary.top5}/${manualSummary.n}.`
      : 'Manual GT Top3 and Top5 are not measured.',
    `Of ${failures.length} current misses, ${cropFixes} become correct under the human art box and are classed BAD_ART_CROP.`,
    manualSummary
      ? `${manualWrong} frames stay wrong with the human art box.`
      : 'Frames that stay wrong under a manual art box cannot be counted until those boxes exist.',
    `Current-correct → manual-wrong: ${transitions.currentToManual ? transitions.currentToManual.correctToWrong : 'not measured'}.`,
    manualSummary
      ? `Auto-anchor Top1 is ${autoSummary.top1}/${autoSummary.n} and manual GT Top1 is ${manualSummary.top1}/${manualSummary.n}. Auto → manual wrong→correct ${transitions.autoToManual?.wrongToCorrect ?? '—'}, correct→wrong ${transitions.autoToManual?.correctToWrong ?? '—'}.`
      : `Auto anchor Top1 is ${autoSummary.top1}/${autoSummary.n}. It turns ${autoFixed} current misses into hits and breaks ${transitions.currentToAuto.correctToWrong}.`,
    weakness,
    iouNote,
    `Remaining current misses that the human box does not fix stay UNKNOWN unless the frame is tagged glare, foil, or a bad capture. That is not evidence for a CLIP fine-tune. UNKNOWN count: ${failures.filter(row => row.failureClass === 'UNKNOWN').length}.`,
  ];
  const report = {
    date: new Date().toISOString(),
    git: gitCommit(),
    evalHash,
    n: frames.length,
    manualAnnotated: manualFrames.length,
    autoFailures: frames.filter(frame => frame.auto_anchor?.available === false).length,
    clip: galleryMeta.baseEncoderVersion,
    adapter: { path: B1_ADAPTER_PATH, sha256: galleryMeta.adapterSha256, params: galleryMeta.adapterParams },
    gallery: { id: galleryMeta.id, sha256: galleryMeta.gallerySha256, count: galleryMeta.count },
    table: [
      ['current', currentSummary],
      ['auto_anchor', autoSummary],
      ['manual_gt', manualSummary],
    ].map(([id, summary]) => ({
      id,
      top1: fmt(summary, 'top1'),
      top3: fmt(summary, 'top3'),
      top5: fmt(summary, 'top5'),
      top10: fmt(summary, 'top10'),
      wrongConfident: summary ? `${summary.wrongConfident}/${summary.n}` : '—',
    })),
    summaries: { current: currentSummary, auto_anchor: autoSummary, manual_gt: manualSummary },
    transitions,
    transitionNames,
    geometry,
    anchorVerdict: anchor.verdict,
    anchorWhy: anchor.why,
    failures,
    answers,
    frames,
    verdict: decision.verdict,
    verdictWhy: decision.why,
    next,
  };
  const outDir = join(reportsDir, 'art-crop-ceiling-v1');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(reportsDir, 'art-crop-ceiling-v1.md'), markdown(report));
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, 'index.html'), ceilingHtml(report));
  log(`wrote ${join(reportsDir, 'art-crop-ceiling-v1.md')}`);
  log(`${decision.verdict}: ${decision.why}`);
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
