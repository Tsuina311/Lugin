#!/usr/bin/env node
/**
 * Frozen comparison of automatic art-anchor crop policies.
 * Current, auto-exact, and human +3% ranks come from the corrected margin sweep.
 * Only the automatic +3% crop is newly embedded. Nothing here trains.
 *
 *   yarn scanner:auto-anchor-policy
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { hashDataset, loadAnnotations } from './lib/annotations.mjs';
import { confirmedIdentities } from './lib/metrics.mjs';
import { manifestsDir, reportsDir, resolveSafeMedia, rootDir } from './lib/paths.mjs';
import { loadEncoder } from '../recognition/encoders.mjs';
import { identityMatches, resolveExpected } from '../recognition/scoring.mjs';
import { CARD_HEIGHT, CARD_WIDTH, canonicalQuadToSource, regionOrientation } from '../geometry/lib/frame-regions/project.mjs';
import { detectFrameRegions } from '../geometry/lib/frame-regions/detect.mjs';
import { measureQuads } from '../geometry/lib/frame-regions/report.mjs';
import { FIXTURES_DIR } from '../geometry/lib/paths.mjs';
import { isCompleteQuad } from '../geometry/lib/schema.mjs';
import { forward, loadModel } from './embedding/math.mjs';
import { B1_ADAPTER_PATH, B1_GALLERY_DIR, buildB1Gallery } from './embedding/b1-gallery.mjs';
import { artQuadAtMargin } from './embedding/art-margin.mjs';
import {
  AUTO_PAD,
  chooseAutoPolicy,
  gapCause,
  iouBucket,
  scoreFromRank,
} from './embedding/auto-policy.mjs';
import {
  assertNoEvalLeak,
  emptyMiss,
  isManualArtBox,
  encodeArtCrop,
  namedQuadToPoints,
  pairedNames,
  pairedTransitions,
  rankInGallery,
  summarizeCrop,
} from './embedding/crop-ceiling.mjs';

const FROZEN_PREFIX = 'c9470c26eebd';
const PUBLISHED = {
  current: { top1: 32, top3: 35, top5: 36, top10: 37, wrongConfident: 2 },
  auto_exact: { top1: 35, top3: 35, top5: 35, top10: 35, wrongConfident: 2, coverage: 40 },
  human3: { top1: 39, top3: 39, top5: 40, top10: 41, wrongConfident: 1 },
};
const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const gitCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-auto-policy-'));
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
      sourcefile: 'auto-policy-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const loadManuals = async () => {
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
      cardQuad: isCompleteQuad(card?.groundTruthQuad) ? card.groundTruthQuad : null,
    });
  }
  return map;
};

const cornersNamed = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const fmt = (summary, key) => `${summary[key]}/${summary.n}`;

const shortName = frame => `${frame.cardName} | ${frame.imageId.split('/').slice(-2).join('/')}`;

const assertPublished = (id, summary, coverage) => {
  const expected = PUBLISHED[id];
  for (const key of ['top1', 'top3', 'top5', 'top10', 'wrongConfident']) {
    if (summary[key] !== expected[key]) {
      throw new Error(`${id} ${key} ${summary[key]} != published ${expected[key]}`);
    }
  }
  if (expected.coverage != null && coverage !== expected.coverage) {
    throw new Error(`${id} coverage ${coverage} != published ${expected.coverage}`);
  }
};

const markdown = report => {
  const lines = [];
  lines.push('# AUTO ANCHOR POLICY V1');
  lines.push('');
  lines.push(`Frozen eval stills-v1 \`${report.evalHash}\`. Git \`${report.git}\`.`);
  lines.push('');
  lines.push('Current, automatic exact, and human +3% ranks are the corrected margin sweep. The new crop is the automatic art box expanded +3% in the detector card\'s canonical coordinates, with the same scale used for the human margin sweep. Human polygons are a ceiling. They do not choose a crop. No policy sees the card identity.');
  lines.push('');
  lines.push('P4 is skipped. The detector\'s `artBox.confidence` is the minimum of four uncalibrated edge scores, and boxes below 0.2 are already discarded. That score has not been calibrated against identity, so a further threshold would be a new gate.');
  lines.push('');
  lines.push('## VERSIONS');
  lines.push('');
  lines.push(`- CLIP: \`${report.clip}\``);
  lines.push(`- Adapter: \`${report.adapter}\``);
  lines.push(`- B1 gallery: \`${report.gallery.id}\` \`${report.gallery.sha256}\` (${report.gallery.count} arts)`);
  lines.push(`- Eval: stills-v1 \`${report.evalHash}\``);
  lines.push('');
  lines.push('## POLICIES');
  lines.push('');
  lines.push('| Policy | Coverage | Top1 | Top3 | Top5 | Top10 | Wrong-confident |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of report.table) {
    lines.push(`| ${row.label} | ${row.coverage} | ${row.top1} | ${row.top3} | ${row.top5} | ${row.top10} | ${row.wrongConfident} |`);
  }
  lines.push('');
  lines.push('Pure auto policies leave a frame unranked when the anchor is missing. Those frames count against Top1. The fallback policy ranks every frame.');
  lines.push('');
  lines.push('## PAIRED VERSUS CURRENT');
  lines.push('');
  for (const row of report.transitions) {
    lines.push(`- ${row.label}: wrong→correct ${row.wrongToCorrect}, correct→wrong ${row.correctToWrong}, unchanged correct ${row.unchangedCorrect}, unchanged wrong ${row.unchangedWrong}`);
    if (row.fixes.length) lines.push(`  - fixes: ${row.fixes.join('; ')}`);
    if (row.regressions.length) lines.push(`  - regressions: ${row.regressions.join('; ')}`);
  }
  lines.push('');
  lines.push('## NO ANCHOR');
  lines.push('');
  lines.push('These frames have no automatic art box. The fallback keeps the current production crop. They are not turned into recognition misses.');
  lines.push('');
  for (const frame of report.noAnchor) {
    lines.push(`- ${frame.cardName} [${frame.imageId}]: current rank ${frame.currentRank} (${frame.currentTop1}), current ${frame.currentHit ? 'correct' : 'wrong'}. Fallback uses current.`);
  }
  lines.push('');
  lines.push('## HUMAN +3% FIXES RECOVERED');
  lines.push('');
  lines.push(`The corrected human +3% crop fixes ${report.recovery.total} current misses. Automatic policies recover:`);
  lines.push('');
  lines.push(`- auto exact: ${report.recovery.autoExact}/${report.recovery.total}`);
  lines.push(`- auto +3%: ${report.recovery.auto3}/${report.recovery.total}`);
  lines.push(`- auto +3% → current fallback: ${report.recovery.fallback}/${report.recovery.total}`);
  lines.push('');
  for (const frame of report.recovery.frames) {
    lines.push(`- ${frame.cardName}: auto exact ${frame.autoExact}, auto +3% ${frame.auto3}, fallback ${frame.fallback}`);
  }
  lines.push('');
  lines.push('## HUMAN +3% HIT, AUTO +3% MISS');
  lines.push('');
  if (!report.gaps.length) lines.push('None.');
  for (const frame of report.gaps) {
    lines.push(`- ${frame.cardName} [${frame.imageId}]: anchor ${frame.anchor ? 'yes' : 'no'}, IoU ${frame.iou == null ? '—' : frame.iou.toFixed(3)}, corner error ${frame.corner == null ? '—' : frame.corner.toFixed(1)} px, auto +3% rank ${frame.autoRank}, human +3% rank ${frame.humanRank}. ${frame.cause}`);
  }
  lines.push('');
  lines.push('## IOU BUCKETS');
  lines.push('');
  lines.push('Diagnostic only. Human IoU is not a production threshold.');
  lines.push('');
  lines.push('| Auto/human IoU | n | auto +3% Top1 | fallback Top1 | human +3% Top1 |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const row of report.buckets) {
    lines.push(`| ${row.label} | ${row.n} | ${row.auto3} | ${row.fallback} | ${row.human3} |`);
  }
  lines.push('');
  lines.push('## VERDICT');
  lines.push('');
  lines.push(`**${report.verdict}**`);
  lines.push('');
  lines.push(report.verdictWhy);
  lines.push('');
  lines.push(`Best practical policy: \`${report.practicalId}\`. Distance to the human +3% ceiling: ${report.distance} Top1.`);
  lines.push('');
  lines.push('## PRODUCTION');
  lines.push('');
  lines.push('CLIP, the B1 adapter, the gallery, the 46-frame eval set, detector thresholds, OCR, fusion, and Android were not changed. The cascade is not wired into the scanner.');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

const html = report => {
  const table = report.table
    .map(row => `<tr><td>${row.label}</td><td>${row.coverage}</td><td>${row.top1}</td><td>${row.top3}</td><td>${row.top5}</td><td>${row.top10}</td><td>${row.wrongConfident}</td></tr>`)
    .join('');
  const gaps = report.gaps.map(frame => `<li>${frame.cardName}: ${frame.cause}, IoU ${frame.iou == null ? '—' : frame.iou.toFixed(3)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Auto anchor policy</title>
<style>body{font:14px sans-serif;margin:24px;background:#111;color:#eee}td,th{padding:4px 8px;border-bottom:1px solid #333}</style>
</head><body><h1>${report.verdict}</h1><p>${report.verdictWhy}</p>
<table><tr><th>Policy</th><th>Coverage</th><th>Top1</th><th>Top3</th><th>Top5</th><th>Top10</th><th>Wrong-confident</th></tr>${table}</table>
<h2>Human +3% hit, auto +3% miss</h2><ul>${gaps}</ul></body></html>`;
};

const main = async () => {
  const sweep = JSON.parse(readFileSync(join(reportsDir, 'art-crop-margin-sweep-v1', 'summary.json'), 'utf8'));
  const galleryMeta = buildB1Gallery({ log });
  if (!galleryMeta.adapterSha256.startsWith('b0e10ffe2c9c')) throw new Error('adapter moved');
  if (!galleryMeta.gallerySha256.startsWith('be0a66141de7')) throw new Error('gallery moved');
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
  if (!evalHash.startsWith(FROZEN_PREFIX) || evalHash !== stills.datasetHash || evalHash !== sweep.evalHash) {
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
  if (items.length !== 46 || sweep.frames.length !== 46) throw new Error(`expected 46 frames, got ${items.length}`);
  assertNoEvalLeak(items.map(item => item.path), ['.scan-fixtures/visual-embed/art-crops', '.scan-fixtures/embedding-bakeoff/full-cards']);
  const prior = new Map(sweep.frames.map(frame => [frame.imageId, frame]));

  log('loading CLIP');
  const { runtime: encoder } = await loadEncoder('CLIP_VIT_B32');
  const scan = await loadScan();
  const outDir = join(reportsDir, 'auto-anchor-policy-v1');
  await mkdir(outDir, { recursive: true });

  const frames = [];
  for (const item of items) {
    const saved = prior.get(item.path);
    if (!saved) throw new Error(`margin sweep missing ${item.path}`);
    const current = scoreFromRank(saved.scores.current);
    const autoExact = scoreFromRank(saved.scores.auto_anchor);
    const human3 = scoreFromRank(saved.scores['manual_+3']);
    const expected = resolveExpected(rootDir, { expectedName: item.cardName, oracleId: item.oracleId });
    const abs = resolveSafeMedia(item.path);
    const decoded = PNG.sync.read(readFileSync(abs));
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const det = scan.detectCardQuad(source);
    const corners = det.recognitionCorners ?? det.corners;
    let auto3 = emptyMiss('NO_ANCHOR');
    let anchor = false;
    let confidence = null;
    let autoSource = null;
    if (!corners) {
      if (autoExact.available) throw new Error(`sweep had an anchor without detector corners: ${item.path}`);
    } else {
      const warp = scan.warpQuadToCard(source, scan.cornersToQuad(corners));
      if (warp.width !== CARD_WIDTH || warp.height !== CARD_HEIGHT) {
        throw new Error(`warp ${warp.width}x${warp.height} is not the canonical card`);
      }
      const detected = detectFrameRegions(warp);
      const art = detected.regions?.artBox;
      const sweepHadAnchor = saved.scores.auto_anchor?.available !== false;
      if (Boolean(art?.quad) !== sweepHadAnchor) {
        throw new Error(`anchor presence drifted for ${item.path}`);
      }
      if (art?.quad) {
        anchor = true;
        confidence = art.confidence ?? null;
        const card = cornersNamed(corners);
        const autoSourceQuad = canonicalQuadToSource(art.quad, card, warp.width, warp.height);
        const expanded = artQuadAtMargin(autoSourceQuad, card, AUTO_PAD);
        const currentCrop = scan.extractArtCropFromCard(warp).crop;
        const crop = scan.warpQuadToCard(source, namedQuadToPoints(expanded), currentCrop.width, currentCrop.height);
        const slug = item.imageId.replace(/[^\w.-]+/g, '_').slice(-80);
        const dir = join(outDir, 'artifacts', slug);
        mkdirSync(dir, { recursive: true });
        const png = encodeArtCrop(scan.scanImageToPngBytes, crop);
        const path = join(dir, 'auto3.png');
        await writeFile(path, png);
        const raw = Float32Array.from(await encoder.embedPath(path));
        const vector = forward(model, raw).y;
        auto3 = {
          available: true,
          failed: false,
          ...rankInGallery(gallery.embeddings, gallery.refs, gallery.dims, vector, hit => identityMatches(expected, hit)),
        };
        autoSource = autoSourceQuad;
      }
    }
    frames.push({
      imageId: item.path,
      cardName: item.cardName,
      current,
      autoExact,
      auto3,
      human3,
      anchor,
      confidence,
      autoSource,
    });
    log(`${item.cardName} anchor ${anchor ? 'yes' : 'NO'} auto3 ${auto3.available ? auto3.rank : 'NO_ANCHOR'}`);
  }

  const manuals = await loadManuals();
  for (const frame of frames) {
    const manual = manuals.get(frame.imageId);
    if (!frame.autoSource || !manual?.quad || !manual.cardQuad) continue;
    const ordered = regionOrientation({
      regionQuadSource: manual.quad,
      cardQuadSource: manual.cardQuad,
    }).ordered;
    frame.geometry = measureQuads(manual.cardQuad, frame.autoSource, ordered);
  }

  const policies = [
    ['current', 'current', frame => frame.current, true],
    ['auto_exact', 'auto exact', frame => frame.autoExact, false],
    ['auto3', 'auto +3%', frame => frame.auto3, false],
    ['auto3_current_fallback', 'auto +3% → current fallback', frame => (frame.anchor ? frame.auto3 : frame.current), true],
  ];
  const rowsFor = pick => frames.map(pick);
  const table = policies.map(([id, label, pick, always]) => {
    const rows = rowsFor(pick);
    const summary = summarizeCrop(rows);
    const coverage = frames.filter(frame => pick(frame).available !== false).length;
    return {
      id,
      label,
      coverage: `${coverage}/${frames.length}`,
      coverageN: coverage,
      always,
      summary,
      top1: fmt(summary, 'top1'),
      top3: fmt(summary, 'top3'),
      top5: fmt(summary, 'top5'),
      top10: fmt(summary, 'top10'),
      wrongConfident: `${summary.wrongConfident}/${summary.n}`,
    };
  });
  assertPublished('current', table[0].summary, table[0].coverageN);
  assertPublished('auto_exact', table[1].summary, table[1].coverageN);
  assertPublished('human3', summarizeCrop(frames.map(frame => frame.human3)), frames.length);

  const names = frames.map(shortName);
  const transitions = policies.filter(([id]) => id !== 'current').map(([id, label, pick]) => {
    const paired = pairedNames(frames.map(frame => frame.current), rowsFor(pick), names);
    return {
      id,
      label,
      ...pairedTransitions(frames.map(frame => frame.current), rowsFor(pick)),
      fixes: paired.wrongToCorrect,
      regressions: paired.correctToWrong,
    };
  });

  const humanFixes = frames.filter(frame => !frame.current.top1 && frame.human3.top1);
  const recovered = (pick) => humanFixes.filter(frame => pick(frame).top1).length;
  const recoveryFrames = humanFixes.map(frame => ({
    cardName: shortName(frame),
    autoExact: frame.autoExact.top1 ? 'yes' : 'no',
    auto3: frame.auto3.top1 ? 'yes' : 'no',
    fallback: (frame.anchor ? frame.auto3 : frame.current).top1 ? 'yes' : 'no',
  }));

  const gaps = frames
    .filter(frame => frame.human3.top1 && !frame.auto3.top1)
    .map(frame => ({
      cardName: frame.cardName,
      imageId: frame.imageId,
      anchor: frame.anchor,
      iou: frame.geometry?.iou ?? null,
      corner: frame.geometry?.meanCornerError ?? null,
      autoRank: frame.auto3.available ? frame.auto3.rank : 'NO_ANCHOR',
      humanRank: frame.human3.rank,
      cause: gapCause({ anchor: frame.anchor, iou: frame.geometry?.iou ?? null }),
    }));

  const bucketOrder = ['no anchor', '<0.75', '0.75–0.90', '>=0.90'];
  const buckets = bucketOrder.map(label => {
    const group = frames.filter(frame => iouBucket({ anchor: frame.anchor, iou: frame.geometry?.iou ?? null }) === label);
    const count = pick => `${group.filter(frame => pick(frame).top1).length}/${group.length}`;
    return {
      label,
      n: group.length,
      auto3: group.length ? count(frame => frame.auto3) : '—',
      fallback: group.length ? count(frame => (frame.anchor ? frame.auto3 : frame.current)) : '—',
      human3: group.length ? count(frame => frame.human3) : '—',
    };
  });

  const fallback = table.find(row => row.id === 'auto3_current_fallback');
  const fallbackTransition = transitions.find(row => row.id === 'auto3_current_fallback');
  const decision = chooseAutoPolicy({
    currentTop1: table[0].summary.top1,
    policyTop1: fallback.summary.top1,
    wrongToCorrect: fallbackTransition.wrongToCorrect,
    correctToWrong: fallbackTransition.correctToWrong,
    recoveredFixes: recovered(frame => (frame.anchor ? frame.auto3 : frame.current)),
    humanFixCount: humanFixes.length,
    humanCeilingTop1: PUBLISHED.human3.top1,
    gapCauses: frames
      .filter(frame => frame.human3.top1 && !(frame.anchor ? frame.auto3 : frame.current).top1)
      .map(frame => gapCause({ anchor: frame.anchor, iou: frame.geometry?.iou ?? null })),
  });

  const noAnchor = frames.filter(frame => !frame.anchor).map(frame => ({
    cardName: frame.cardName,
    imageId: frame.imageId,
    currentRank: frame.current.rank ?? '—',
    currentTop1: frame.current.top1Name ?? 'none',
    currentHit: frame.current.top1,
  }));

  const report = {
    date: new Date().toISOString(),
    git: gitCommit(),
    evalHash,
    clip: galleryMeta.baseEncoderVersion,
    adapter: galleryMeta.adapterSha256,
    gallery: { id: galleryMeta.id, sha256: galleryMeta.gallerySha256, count: galleryMeta.count },
    table,
    transitions,
    noAnchor,
    recovery: {
      total: humanFixes.length,
      autoExact: recovered(frame => frame.autoExact),
      auto3: recovered(frame => frame.auto3),
      fallback: recovered(frame => (frame.anchor ? frame.auto3 : frame.current)),
      frames: recoveryFrames,
    },
    gaps,
    buckets,
    verdict: decision.verdict,
    verdictWhy: decision.why,
    practicalId: decision.practicalId,
    distance: PUBLISHED.human3.top1 - fallback.summary.top1,
    frames: frames.map(frame => ({
      imageId: frame.imageId,
      cardName: frame.cardName,
      anchor: frame.anchor,
      confidence: frame.confidence,
      iou: frame.geometry?.iou ?? null,
      corner: frame.geometry?.meanCornerError ?? null,
      currentRank: frame.current.rank,
      currentTop1: frame.current.top1,
      autoExactRank: frame.autoExact.rank,
      autoExactTop1: frame.autoExact.top1,
      auto3Rank: frame.auto3.rank,
      auto3Top1: frame.auto3.top1,
      human3Rank: frame.human3.rank,
      human3Top1: frame.human3.top1,
      fallbackTop1: (frame.anchor ? frame.auto3 : frame.current).top1,
    })),
  };
  await writeFile(join(reportsDir, 'auto-anchor-policy-v1.md'), markdown(report));
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outDir, 'index.html'), html(report));
  log(`wrote ${join(reportsDir, 'auto-anchor-policy-v1.md')}`);
  log(`${decision.verdict}: ${decision.why}`);
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
