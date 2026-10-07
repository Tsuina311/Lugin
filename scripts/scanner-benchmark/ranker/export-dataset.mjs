#!/usr/bin/env node
/**
 * Export accepted card candidates for the learned ranker.
 * Human-reviewed quads are the only real labels. The detector only proposes quads.
 *
 *   node scripts/scanner-benchmark/ranker/export-dataset.mjs
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir } from '../lib/paths.mjs';
import { FIXTURES_DIR } from '../../geometry/lib/paths.mjs';
import { fixtureTrustedEval, fixtureUsableForGeometry, isCompleteQuad } from '../../geometry/lib/schema.mjs';
import { quadArea, quadIoU } from '../../geometry/lib/frame-regions/report.mjs';
import { detectFrameRegions } from '../../geometry/lib/frame-regions/detect.mjs';
import { quadInImageSpace } from '../../geometry/lib/source-space.mjs';
import { DATASET_VERSION, FEATURE_SCHEMA_VERSION, FRAME_WARP_WIDTH, bandFor } from './schema.mjs';
import { buildFeatureRows, structureFeatures } from './features.mjs';
import { initSplits } from './splits.mjs';

const CARD_ASPECT = 63 / 88;
const PEAK = 0.35;
const WARP_HEIGHT = Math.round(FRAME_WARP_WIDTH / CARD_ASPECT);
const dataDir = join(rootDir, 'scanner-benchmark/ranker-data', DATASET_VERSION);

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-ranker-export-'));
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
        export { warpQuadToCard } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export { containsCandidate, selectPrimaryAmongDebugCandidates } from '${join(rootDir, 'src/lib/scan/detection/multi.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'ranker-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const peakedArea = frameFrac => {
  if (frameFrac <= PEAK) return Math.min(1, Math.max(0, frameFrac / PEAK));
  if (frameFrac <= 0.7) return Math.min(1, Math.max(0, 1 - (frameFrac - PEAK) / PEAK));
  return 0;
};

const fromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const toPoints = quad => [quad.tl, quad.tr, quad.br, quad.bl].map(([x, y]) => ({ x, y }));

const termsOf = (quad, imageW, imageH) => {
  const [tl, tr, br, bl] = toPoints(quad);
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
  const peakedScore = aspectScore * 0.4 + parallelScore * 0.25 + peakedArea(frameFraction) * 0.25 + centerScore * 0.1;
  return { aspectRatio, aspectScore, parallelRaw, parallelScore, frameFraction, areaScore, centerX, centerY, centerScore, detectorScore, peakedScore };
};

const traceNested = (scan, candidates, rows, width, height, scoreOf) => {
  const scored = candidates.map((candidate, index) => {
    const row = rows.find(item => item.index === index);
    return row ? { ...candidate, score: scoreOf(row) } : candidate;
  });
  const official = scan.selectPrimaryAmongDebugCandidates(scored, width, height);
  const accepted = [];
  scored.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause?.length) return;
    const row = rows.find(item => item.index === index);
    accepted.push({ index, score: candidate.score, corners: candidate.corners, areaRatio: row.frameFraction });
  });
  if (!accepted.length) return { selected: -1, relations: [], inner: null, outer: null };
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
  let max = accepted[0];
  for (const row of accepted) if (row.score > max.score) max = row;
  let selected = max.index;
  let inner = null;
  let outer = null;
  if (relations.length) {
    let pair = relations[0];
    for (const next of relations) if (next.innerScore > pair.innerScore) pair = next;
    const outerRow = accepted.find(row => row.index === pair.outer);
    const innerRow = accepted.find(row => row.index === pair.inner);
    inner = pair.inner;
    outer = pair.outer;
    if (innerRow.score >= 0.28 || innerRow.score >= outerRow.score * 0.75) selected = pair.inner;
    else selected = pair.outer;
  }
  if (selected !== official.selectedIndex) throw new Error(`nested trace ${selected} != detector ${official.selectedIndex}`);
  return { selected, relations, inner, outer, max: max.index };
};

const classOf = fixture => {
  if ((fixture.tags ?? []).includes('frozen-quad-series')) return null;
  if ((fixture.tags ?? []).includes('synthetic') || fixture.cards?.some(card => (card.tags ?? []).includes('synthetic'))) return null;
  const usable = fixtureUsableForGeometry(fixture);
  if (!usable.ok || fixture.negative) return null;
  const quads = (fixture.cards ?? []).filter(card => isCompleteQuad(card.groundTruthQuad));
  if (quads.length !== 1) return null;
  if (fixtureTrustedEval(fixture) && (quads[0].groundTruthSource === 'manually-reviewed' || quads[0].groundTruthSource === 'existing-annotation')) {
    return 'trusted-real';
  }
  return 'bootstrap';
};

const loadMetadata = async fixture => {
  const metaPath = fixture.provenance?.metadataPaths?.[0];
  if (!metaPath) return null;
  try {
    return JSON.parse(await readFile(join(rootDir, metaPath), 'utf8'));
  } catch {
    return null;
  }
};

const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

const gitInfo = () => {
  try {
    const rev = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim().length > 0;
    return { rev, dirty };
  } catch {
    return { rev: null, dirty: null };
  }
};

const main = async () => {
  const scan = await loadScan();
  const names = (await readdir(FIXTURES_DIR)).filter(name => name.endsWith('.json'));
  const fixtures = [];
  for (const name of names) {
    const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8'));
    const source = classOf(fixture);
    if (source) fixtures.push({ fixture, source });
  }
  const cache = new Map();
  const frames = [];
  const errors = [];
  let done = 0;
  for (const { fixture, source } of fixtures) {
    done += 1;
    if (done % 20 === 0) log(`${done}/${fixtures.length}`);
    const abs = join(rootDir, fixture.image);
    if (!existsSync(abs)) {
      errors.push({ id: fixture.id, error: 'missing image' });
      continue;
    }
    let decoded = cache.get(abs);
    if (!decoded) {
      const png = PNG.sync.read(readFileSync(abs));
      decoded = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data), det: null };
      cache.set(abs, decoded);
    }
    if ((fixture.imageWidth != null && decoded.width !== fixture.imageWidth) || (fixture.imageHeight != null && decoded.height !== fixture.imageHeight)) {
      errors.push({ id: fixture.id, error: 'png size mismatch' });
      continue;
    }
    const metadata = await loadMetadata(fixture);
    const card = fixture.cards.find(row => isCompleteQuad(row.groundTruthQuad));
    let human;
    try {
      human = quadInImageSpace({
        quad: card.groundTruthQuad,
        imageWidth: decoded.width,
        imageHeight: decoded.height,
        captureWidth: metadata?.photo?.decodedWidth ?? null,
        captureHeight: metadata?.photo?.decodedHeight ?? null,
        label: fixture.id,
      }).quad;
    } catch (error) {
      errors.push({ id: fixture.id, error: error.message });
      continue;
    }
    if (!decoded.det) decoded.det = scan.detectCardQuad({ width: decoded.width, height: decoded.height, data: decoded.data });
    const measured = [];
    decoded.det.debug.candidates.forEach((candidate, index) => {
      if (!candidate.corners || candidate.rejectedBecause.length) return;
      const quad = fromCorners(candidate.corners);
      const terms = termsOf(quad, decoded.width, decoded.height);
      if (!terms) return;
      if (Math.abs(terms.detectorScore - candidate.score) > 1e-6) {
        throw new Error(`${fixture.id} ${candidate.method} score ${terms.detectorScore} != ${candidate.score}`);
      }
      let structure = null;
      try {
        const warped = scan.warpQuadToCard(decoded, toPoints(quad), FRAME_WARP_WIDTH, WARP_HEIGHT);
        structure = structureFeatures(detectFrameRegions(warped));
      } catch {
        structure = null;
      }
      const iou = quadIoU(quad, human);
      measured.push({ index, method: candidate.method, quad, iou, band: bandFor(iou), structure, ...terms });
    });
    const current = traceNested(scan, decoded.det.debug.candidates, measured, decoded.width, decoded.height, row => row.detectorScore);
    const peaked = traceNested(scan, decoded.det.debug.candidates, measured, decoded.width, decoded.height, row => row.peakedScore);
    const oracle = measured.reduce((best, row) => (row.iou > best.iou + 1e-12 || (Math.abs(row.iou - best.iou) <= 1e-12 && row.index < best.index) ? row : best), measured[0] ?? null);
    const iouOf = index => measured.find(row => row.index === index)?.iou ?? 0;
    const featureRows = buildFeatureRows({
      rows: measured,
      width: decoded.width,
      height: decoded.height,
      nested: { relations: current.relations, inner: current.inner, outer: current.outer, selected: current.selected },
    });
    frames.push({
      id: fixture.id,
      image: fixture.image,
      label: fixture.label,
      source,
      labelAuthority: source === 'trusted-real' ? 'human' : 'untrusted',
      captureGroup: fixture.captureGroup || fixture.seriesId || fixture.id,
      seriesId: fixture.seriesId,
      corpusSplit: fixture.split ?? null,
      tags: [...new Set([...(fixture.tags ?? []), ...(card.tags ?? [])])].sort(),
      frameFamily: card.frameFamily ?? 'unknown',
      humanFraction: quadArea(human) / (decoded.width * decoded.height),
      oracleBestIou: oracle?.iou ?? 0,
      oracleIndex: oracle?.index ?? -1,
      noUsableCandidate: (oracle?.iou ?? 0) < 0.7,
      hasGoodCandidate: (oracle?.iou ?? 0) >= 0.8,
      baselines: {
        current: { index: current.selected, iou: iouOf(current.selected) },
        maxScore: { index: current.max, iou: iouOf(current.max) },
        peaked: { index: peaked.selected, iou: iouOf(peaked.selected) },
      },
      candidates: featureRows,
    });
  }
  const trusted = frames.filter(frame => frame.labelAuthority === 'human');
  const existingPath = join(dataDir, 'splits.json');
  const existing = existsSync(existingPath) ? JSON.parse(readFileSync(existingPath, 'utf8')) : null;
  const splits = initSplits(trusted, existing);
  mkdirSync(dataDir, { recursive: true });
  const body = frames.map(frame => JSON.stringify(frame)).join('\n') + '\n';
  const datasetHash = createHash('sha256').update(body).digest('hex');
  await writeFile(join(dataDir, 'frames.jsonl'), body);
  await writeFile(join(dataDir, 'splits.json'), `${JSON.stringify({ ...splits, note: 'Holdout groups stay frozen. New capture groups enter cross-validation only.' }, null, 2)}\n`);
  const manifest = {
    featureSchema: FEATURE_SCHEMA_VERSION,
    datasetVersion: DATASET_VERSION,
    createdAt: new Date().toISOString(),
    datasetHash,
    git: gitInfo(),
    detectorFiles: {
      'src/lib/scan/detectCard.ts': fileHash(join(rootDir, 'src/lib/scan/detectCard.ts')),
      'src/lib/scan/geometry.ts': fileHash(join(rootDir, 'src/lib/scan/geometry.ts')),
      'src/lib/scan/detection/multi.ts': fileHash(join(rootDir, 'src/lib/scan/detection/multi.ts')),
    },
    labelRule: 'Human-reviewed or existing-annotation card quads on trusted fixtures. Bootstrap quads are stored as untrusted and are not training labels.',
    frames: frames.length,
    trustedFrames: trusted.length,
    bootstrapFrames: frames.length - trusted.length,
    candidates: frames.reduce((sum, frame) => sum + frame.candidates.length, 0),
    trustedCandidates: trusted.reduce((sum, frame) => sum + frame.candidates.length, 0),
    captureGroups: [...new Set(trusted.map(frame => frame.captureGroup))].sort(),
    holdoutGroups: splits.holdoutGroups,
    foldIds: splits.foldIds,
    errors,
    frameStructure: {
      warpWidth: FRAME_WARP_WIDTH,
      warpHeight: WARP_HEIGHT,
      note: 'Optional family. Same fractional frame-region detector on a rectified warp narrower than the 744px production card.',
    },
    pipeline: 'PIPELINE / EARLY MODEL',
  };
  await writeFile(join(dataDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`trusted ${trusted.length} candidates ${manifest.trustedCandidates} holdout groups ${splits.holdoutGroups.length} hash ${datasetHash.slice(0, 12)}`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
