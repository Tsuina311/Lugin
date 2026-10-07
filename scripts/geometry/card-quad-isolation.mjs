#!/usr/bin/env node
/**
 * Isolate card geometry from the frame-region detector.
 * Path A warps the detected card quad. Path B warps the human card outline.
 * detectFrameRegions is called unchanged. Human art is a ruler only.
 *
 *   node scripts/geometry/card-quad-isolation.mjs
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir, reportsDir, resolveSafeMedia, manifestsDir } from '../scanner-benchmark/lib/paths.mjs';
import { hashDataset, loadAnnotations } from '../scanner-benchmark/lib/annotations.mjs';
import { confirmedIdentities } from '../scanner-benchmark/lib/metrics.mjs';
import { FIXTURES_DIR } from './lib/paths.mjs';
import { isCompleteQuad } from './lib/schema.mjs';
import { CARD_HEIGHT, CARD_WIDTH, canonicalQuadToSource, regionOrientation, sourceQuadToCanonical } from './lib/frame-regions/project.mjs';
import { RESEARCH_PRIORS } from './lib/frame-regions/priors.mjs';
import { detectFrameRegions, horizontalProfile, lumaOf, verticalProfile } from './lib/frame-regions/detect.mjs';
import { measureQuads, quadIoU } from './lib/frame-regions/report.mjs';
import { assertImageSpace, quadInImageSpace } from './lib/source-space.mjs';
import { isManualArtBox, encodeArtCrop, namedQuadToPoints, rankInGallery } from '../scanner-benchmark/embedding/crop-ceiling.mjs';
import { artQuadAtMargin } from '../scanner-benchmark/embedding/art-margin.mjs';
import { AUTO_PAD } from '../scanner-benchmark/embedding/auto-policy.mjs';
import { B1_ADAPTER_PATH, B1_GALLERY_DIR, buildB1Gallery } from '../scanner-benchmark/embedding/b1-gallery.mjs';
import { forward, loadModel } from '../scanner-benchmark/embedding/math.mjs';
import { loadEncoder } from '../recognition/encoders.mjs';
import { identityMatches, resolveExpected } from '../recognition/scoring.mjs';

/** Same material-agreement line used for auto/human art IoU. Chosen before this run. */
const RECOVERED_IOU = 0.75;
const ART_EDGES = [
  { edge: 'top', id: 'titleArt', axis: 'h' },
  { edge: 'bottom', id: 'artType', axis: 'h' },
  { edge: 'left', id: 'innerLeft', axis: 'v' },
  { edge: 'right', id: 'innerRight', axis: 'v' },
];

const TARGETS = [
  { slug: 'negate', card: 'Negate', loose: false, imageId: '.scan-fixtures/replay/negate-20260908T082630/source-highres.png' },
  { slug: 'island-cq', card: 'Island cq-120629', loose: true, imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png' },
  { slug: 'wand', card: 'Wand of Wonder cq-120751', loose: true, imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png' },
  { slug: 'livaan', card: 'Livaan cq-120813', loose: true, imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png' },
  { slug: 'bulk-up', card: 'Bulk Up', loose: true, imageId: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png' },
  { slug: 'mudbutton', card: 'Mudbutton Torchrunner', loose: true, imageId: '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png' },
  { slug: 'island-geom', card: 'Island geom-001', loose: false, imageId: '.scan-inbox/sessions/geometry-test-20260910-165339/geom-001-source/geom-001-source.png' },
];

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const fmtPx = value => (value == null ? '—' : `${value.toFixed(1)} px`);

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-card-iso-'));
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
      sourcefile: 'card-iso-entry.ts',
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
      quad: region.quad,
      cardQuad: card.groundTruthQuad,
      imageWidth: fixture.imageWidth ?? null,
      imageHeight: fixture.imageHeight ?? null,
      metadata,
      frameFamily: card.frameFamily ?? fixture.frameFamily ?? null,
    });
  }
  return map;
};

const namedFromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const quadToPoints = quad => [quad.tl, quad.tr, quad.br, quad.bl].map(([x, y]) => ({ x, y }));

const nearest = (rows, t) => {
  if (!rows.length || t == null) return null;
  return rows.reduce((best, row) => (Math.abs(row.t - t) < Math.abs(best.t - t) ? row : best));
};

const humanEdgeT = (quad, width, height) => ({
  top: (quad.tl[1] + quad.tr[1]) / 2 / (height - 1),
  bottom: (quad.bl[1] + quad.br[1]) / 2 / (height - 1),
  left: (quad.tl[0] + quad.bl[0]) / 2 / (width - 1),
  right: (quad.tr[0] + quad.br[0]) / 2 / (width - 1),
});

const traceEdges = (warp, humanCanon) => {
  const detected = detectFrameRegions(warp);
  const luma = lumaOf(warp);
  const horizontal = horizontalProfile(luma, warp.width, warp.height);
  const byId = Object.fromEntries(detected.debug.boundaries.map(row => [row.id, row]));
  const artTop = byId.titleArt.detected ? byId.titleArt.t : 0.18;
  const artBottom = byId.artType.detected ? byId.artType.t : 0.7;
  const vertical = verticalProfile(luma, warp.width, warp.height, artTop, artBottom);
  const humanT = humanEdgeT(humanCanon, warp.width, warp.height);
  const edges = ART_EDGES.map(spec => {
    const boundary = byId[spec.id];
    const profile = spec.axis === 'h' ? horizontal : vertical;
    const full = spec.axis === 'h' ? horizontal : verticalProfile(luma, warp.width, warp.height, 0.02, 0.98);
    const winner = boundary.t == null ? null : nearest(profile, boundary.t);
    const atHuman = nearest(full, humanT[spec.edge]);
    const span = spec.axis === 'h' ? warp.height - 1 : warp.width - 1;
    const inside = humanT[spec.edge] >= boundary.lo && humanT[spec.edge] <= boundary.hi;
    return {
      edge: spec.edge,
      id: spec.id,
      lo: boundary.lo,
      hi: boundary.hi,
      humanT: humanT[spec.edge],
      insideWindow: inside,
      selectedT: boundary.t,
      energy: winner?.energy ?? null,
      energyAtHuman: atHuman?.energy ?? null,
      continuityAtHuman: atHuman?.continuity ?? null,
      continuity: boundary.continuity,
      prominence: boundary.prominence,
      confidence: boundary.confidence,
      detected: boundary.detected,
      reason: boundary.reason,
      deltaPx: boundary.t == null ? null : Math.abs(boundary.t - humanT[spec.edge]) * span,
    };
  });
  const art = detected.regions.artBox ?? null;
  let artIou = null;
  let corner = null;
  if (art?.quad) {
    const keys = ['tl', 'tr', 'br', 'bl'];
    const corners = keys.map(key => Math.hypot(art.quad[key][0] - humanCanon[key][0], art.quad[key][1] - humanCanon[key][1]));
    artIou = quadIoU(art.quad, humanCanon);
    corner = corners.reduce((sum, value) => sum + value, 0) / 4;
  }
  return { detected, edges, art, artIou, corner, humanT };
};

/**
 * Recovery is an emitted box that actually agrees with the human art.
 * A box with IoU under 0.75 is still a frame-region miss.
 * This cutoff is the existing material-agreement line, not tuned on this run.
 */
const recoveryOf = (current, human) => {
  const humanBox = human.anchor && human.artIou >= RECOVERED_IOU;
  const currentWeak = !current.anchor || (current.artIou ?? 0) < RECOVERED_IOU;
  if (humanBox && currentWeak) return 'RECOVERED_BY_CARD_QUAD';
  return 'STILL_FRAME_REGION_FAILURE';
};

const causeOf = (target, current, human) => {
  if (target.loose && recoveryOf(current, human) === 'RECOVERED_BY_CARD_QUAD') return 'CARD_QUAD';
  const bottom = human.edges.find(edge => edge.edge === 'bottom');
  const failed = human.edges.filter(edge => !edge.detected);
  const outside = failed.filter(edge => !edge.insideWindow);
  const weakInside = failed.filter(
    edge => edge.insideWindow && (edge.energyAtHuman == null || edge.energyAtHuman < 6 || edge.continuityAtHuman < 0.28),
  );
  if (human.anchor && human.artIou != null && human.artIou < RECOVERED_IOU && bottom && !bottom.insideWindow) return 'FRAME_PRIOR';
  if (!human.anchor && outside.length && outside.length >= failed.length) return 'FRAME_PRIOR';
  if (!human.anchor && weakInside.length === failed.length && failed.length) return 'IMAGE_EVIDENCE';
  if (!human.anchor && outside.length && weakInside.length) return 'MIXED';
  if (bottom && !bottom.insideWindow) return 'FRAME_PRIOR';
  return 'MIXED';
};

const verdictOf = looseRows => {
  const recovered = looseRows.filter(row => row.recovery === 'RECOVERED_BY_CARD_QUAD').length;
  if (recovered >= 4) return { verdict: 'CARD_GEOMETRY_PRIMARY', recovered };
  if (recovered <= 1) return { verdict: 'FRAME_REGION_PRIMARY', recovered };
  return { verdict: 'MIXED', recovered };
};

const scale = (image, maxW) => {
  const s = Math.min(1, maxW / image.width);
  const w = Math.max(1, Math.round(image.width * s));
  const h = Math.max(1, Math.round(image.height * s));
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
  return png;
};

const paint = (warp, edges, art) => {
  const png = scale(warp, 420);
  const sx = png.width / warp.width;
  const sy = png.height / warp.height;
  const hLine = (t, r, g, b) => {
    if (t == null) return;
    const y = Math.round(t * (warp.height - 1) * sy);
    for (let x = 0; x < png.width; x++) {
      const i = (Math.max(0, Math.min(png.height - 1, y)) * png.width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
    }
  };
  const vLine = (t, r, g, b) => {
    if (t == null) return;
    const x = Math.round(t * (warp.width - 1) * sx);
    for (let y = 0; y < png.height; y++) {
      const i = (y * png.width + Math.max(0, Math.min(png.width - 1, x))) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
    }
  };
  for (const edge of edges) {
    const draw = edge.edge === 'top' || edge.edge === 'bottom' ? hLine : vLine;
    draw(edge.humanT, 40, 210, 120);
    draw(edge.selectedT, edge.detected ? 80 : 255, edge.detected ? 170 : 70, edge.detected ? 255 : 70);
  }
  if (art?.quad) {
    hLine(art.quad.tl[1] / (warp.height - 1), 80, 170, 255);
    hLine(art.quad.bl[1] / (warp.height - 1), 80, 170, 255);
  }
  return png;
};

const markdownTable = rows => {
  const head = rows[0];
  return [head, head.map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');
};

const rankCrop = async ({ scan, encoder, model, gallery, source, cardQuad, artQuad, warp, expected }) => {
  const expanded = artQuadAtMargin(canonicalQuadToSource(artQuad, cardQuad, warp.width, warp.height), cardQuad, AUTO_PAD);
  const currentCrop = scan.extractArtCropFromCard(warp).crop;
  const crop = scan.warpQuadToCard(source, namedQuadToPoints(expanded), currentCrop.width, currentCrop.height);
  const png = encodeArtCrop(scan.scanImageToPngBytes, crop);
  const dir = await mkdtemp(join(tmpdir(), 'lugin-card-iso-crop-'));
  const path = join(dir, 'crop.png');
  await writeFile(path, png);
  const raw = Float32Array.from(await encoder.embedPath(path));
  const vector = forward(model, raw).y;
  return rankInGallery(gallery.embeddings, gallery.refs, gallery.dims, vector, hit => identityMatches(expected, hit));
};

const main = async () => {
  const manuals = await loadManuals();
  const scan = await loadScan();
  const outDir = join(reportsDir, 'card-quad-isolation-v1');
  mkdirSync(outDir, { recursive: true });
  const rows = [];

  for (const target of TARGETS) {
    const manual = manuals.get(target.imageId);
    if (!manual) throw new Error(`missing human card and art for ${target.card}`);
    const decoded = PNG.sync.read(readFileSync(resolveSafeMedia(target.imageId)));
    if (manual.imageWidth != null || manual.imageHeight != null) {
      if (decoded.width !== manual.imageWidth || decoded.height !== manual.imageHeight) {
        throw new Error(`${target.card} PNG does not match the fixture image size`);
      }
    }
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const det = scan.detectCardQuad(source);
    const corners = det.recognitionCorners ?? det.corners;
    if (!corners) throw new Error(`no detected card: ${target.card}`);
    const detectorCard = namedFromCorners(corners);
    const photo = manual.metadata?.photo ?? null;
    const fitted = quadInImageSpace({
      quad: manual.cardQuad,
      imageWidth: decoded.width,
      imageHeight: decoded.height,
      captureWidth: photo?.decodedWidth ?? null,
      captureHeight: photo?.decodedHeight ?? null,
      label: `${target.card} card`,
    });
    assertImageSpace(fitted.quad, decoded.width, decoded.height, `${target.card} card`);
    const humanOutline = fitted.quad;
    if (fitted.scale !== 1) log(`${target.card} card outline scaled ×${fitted.scale.toFixed(4)} from capture ${photo.decodedWidth}x${photo.decodedHeight}`);
    const orderedArt = regionOrientation({
      regionQuadSource: manual.quad,
      cardQuadSource: humanOutline,
    }).ordered;
    const paths = [];
    for (const [name, cardQuad] of [
      ['current', detectorCard],
      ['humanCard', humanOutline],
    ]) {
      const warp = scan.warpQuadToCard(source, quadToPoints(cardQuad));
      if (warp.width !== CARD_WIDTH || warp.height !== CARD_HEIGHT) throw new Error(`warp size ${warp.width}x${warp.height}`);
      const humanCanon = sourceQuadToCanonical(orderedArt, cardQuad, warp.width, warp.height);
      const traced = traceEdges(warp, humanCanon);
      const autoSource = traced.art ? canonicalQuadToSource(traced.art.quad, cardQuad, warp.width, warp.height) : null;
      const published = autoSource ? measureQuads(humanOutline, autoSource, orderedArt) : null;
      if (published && traced.artIou != null && name === 'humanCard') {
        if (Math.abs(published.iou - traced.artIou) > 0.02) {
          throw new Error(`${target.card} human-card IoU disagrees ${published.iou} vs ${traced.artIou}`);
        }
      }
      const png = paint(warp, traced.edges, traced.art);
      const file = `${target.slug}-${name}.png`;
      await writeFile(join(outDir, file), PNG.sync.write(png));
      paths.push({
        name,
        cardIou: quadIoU(humanOutline, cardQuad),
        anchor: Boolean(traced.art?.quad),
        confidence: traced.art?.confidence ?? null,
        artIou: published?.iou ?? traced.artIou,
        corner: published?.meanCornerError ?? traced.corner,
        warpArtIou: traced.artIou,
        warpCorner: traced.corner,
        edges: traced.edges,
        artQuad: traced.art?.quad ?? null,
        cardQuad,
        warp,
        file,
      });
    }
    const [current, humanCard] = paths;
    rows.push({
      ...target,
      frameFamily: manual.frameFamily,
      source,
      expectedName: null,
      current,
      humanCard,
      outlineScale: fitted.scale,
      outlineFrom: fitted.from ?? null,
      recovery: target.loose ? recoveryOf(current, humanCard) : null,
      cause: causeOf(target, current, humanCard),
    });
    log(
      `${target.card} current ${current.anchor ? 'box' : 'NO'} iou ${fmt(current.artIou)} → human-card ${humanCard.anchor ? 'box' : 'NO'} iou ${fmt(humanCard.artIou)} ${target.loose ? recoveryOf(current, humanCard) : causeOf(target, current, humanCard)}`,
    );
  }

  const island = rows.find(row => row.slug === 'island-geom');
  if (!island?.current.artIou || Math.abs(island.current.artIou - 0.536) > 0.02 || Math.abs(island.current.corner - 175.4) > 8) {
    throw new Error(`Island geom current art measurement drifted: iou ${island?.current.artIou} corner ${island?.current.corner}`);
  }

  log('loading frozen CLIP+B1');
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
  };
  const model = loadModel(JSON.parse(readFileSync(B1_ADAPTER_PATH, 'utf8')));
  const stills = JSON.parse(await readFile(join(manifestsDir, 'stills-v1.json'), 'utf8'));
  const annotations = await loadAnnotations();
  const evalHash = hashDataset(stills, annotations);
  if (!evalHash.startsWith('c9470c26eebd')) throw new Error('eval set moved');
  const confirmed = new Map(confirmedIdentities(annotations.identities).map(row => [row.imageId, row]));
  const { runtime: encoder } = await loadEncoder('CLIP_VIT_B32');

  for (const row of rows) {
    const identity = confirmed.get(row.imageId);
    if (!identity) throw new Error(`no confirmed identity for ${row.card}`);
    row.expectedName = identity.cardName;
    const expected = resolveExpected(rootDir, { expectedName: identity.cardName, oracleId: identity.oracleId ?? null });
    for (const path of [row.current, row.humanCard]) {
      path.rank = null;
      path.top1Name = null;
      if (!path.artQuad) continue;
      const scored = await rankCrop({
        scan,
        encoder,
        model,
        gallery,
        source: row.source,
        cardQuad: path.cardQuad,
        artQuad: path.artQuad,
        warp: path.warp,
        expected,
      });
      path.rank = scored.rank;
      path.top1Name = scored.top1Name;
      path.top1 = scored.top1;
    }
    log(`${row.card} rank current ${row.current.rank ?? '—'} human-card ${row.humanCard.rank ?? '—'}`);
  }

  const loose = rows.filter(row => row.loose);
  const decision = verdictOf(loose);
  const negate = rows.find(row => row.slug === 'negate');
  const negateBottom = negate.humanCard.edges.find(edge => edge.edge === 'bottom');
  const islandBottom = island.humanCard.edges.find(edge => edge.edge === 'bottom');
  const secondPrior = !negateBottom.insideWindow && !islandBottom.insideWindow;
  const summary = {
    recoveredIou: RECOVERED_IOU,
    decision,
    secondLayoutPrior: secondPrior,
    negateBottom: negateBottom.humanT,
    islandBottom: islandBottom.humanT,
    islandSelected: islandBottom.selectedT,
    rows: rows.map(row => ({
      ...row,
      source: undefined,
      current: { ...row.current, warp: undefined, cardQuad: undefined },
      humanCard: { ...row.humanCard, warp: undefined, cardQuad: undefined },
    })),
  };
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(reportsDir, 'card-quad-isolation-v1.md'), renderMarkdown(rows, decision, secondPrior));
  log(`${decision.verdict}: ${decision.recovered}/5 loose frames recovered`);
  log(`wrote ${join(reportsDir, 'card-quad-isolation-v1.md')}`);
};

const renderMarkdown = (rows, decision, secondPrior) => {
  const lines = [];
  lines.push('# CARD QUAD ISOLATION V1');
  lines.push('');
  lines.push('The frame-region detector is unchanged. Path A warps the detected card quad. Path B warps the human-reviewed card outline. Human art is measured afterward and does not choose an edge.');
  lines.push('');
  lines.push('A recovered loose frame emits an art box on the human-card warp with auto/human art IoU ≥ 0.75. That cutoff is the existing material-agreement line.');
  lines.push('');
  lines.push('## SUMMARY');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Current card IoU', 'Current anchor', 'Current art IoU', 'Current corner', 'Human-card anchor', 'Human-card art IoU', 'Human-card corner', 'Rank current', 'Rank human-card', 'Cause'],
    ...rows.map(row => [
      row.card,
      fmt(row.current.cardIou),
      row.current.anchor ? `yes ${fmt(row.current.confidence)}` : 'no',
      fmt(row.current.artIou),
      fmtPx(row.current.corner),
      row.humanCard.anchor ? `yes ${fmt(row.humanCard.confidence)}` : 'no',
      fmt(row.humanCard.artIou),
      fmtPx(row.humanCard.corner),
      row.current.rank ?? '—',
      row.humanCard.rank ?? '—',
      row.cause,
    ]),
  ]));
  lines.push('');
  lines.push(`Loose-card recoveries: ${decision.recovered}/5.`);
  lines.push('');
  lines.push(`**${decision.verdict}**`);
  lines.push('');
  lines.push('Island geom-001 still places the art bottom at 0.831, outside 0.470–0.575, and the detector still takes an illustration edge near 0.52. That layout is not the standard art window. Negate\'s art bottom is 0.610, only 0.035 past the same cap, on an otherwise normal frame. The two misses do not justify one wider window, and only Island geom-001 is evidence for a separate layout prior.');
  lines.push('');
  for (const row of rows) {
    lines.push(`## ${row.card}`);
    lines.push('');
    if (row.outlineScale !== 1) {
      lines.push(`The stored card outline was in ${row.outlineFrom} capture pixels. It is scaled by ${row.outlineScale.toFixed(4)} onto the ${row.outlineScale === 1 ? '' : ''}PNG. The art box was already in PNG pixels and was not scaled.`);
    }
    if (row.loose) lines.push(`Classification: \`${row.recovery}\`.`);
    lines.push('');
    lines.push(`| Path | Card IoU | artBox | Confidence | Art IoU | Corner | +3% rank |`);
    lines.push(`| --- | ---: | --- | ---: | ---: | ---: | ---: |`);
    for (const path of [row.current, row.humanCard]) {
      lines.push(`| ${path.name} | ${fmt(path.cardIou)} | ${path.anchor ? 'yes' : 'no'} | ${fmt(path.confidence)} | ${fmt(path.artIou)} | ${fmtPx(path.corner)} | ${path.rank ?? '—'} ${path.top1Name ? `(${path.top1Name})` : ''} |`);
    }
    lines.push('');
    const edgeTable = [[
      'Path', 'Edge', 'Human', 'In window', 'Selected', 'Energy', 'Energy at human', 'Continuity', 'Prominence', 'Confidence', 'Accepted', 'Δ',
    ]];
    for (const path of [row.current, row.humanCard]) {
      for (const edge of path.edges) {
        edgeTable.push([
          path.name,
          edge.edge,
          fmt(edge.humanT),
          edge.insideWindow ? 'yes' : 'no',
          fmt(edge.selectedT),
          fmt(edge.energy, 1),
          `${fmt(edge.energyAtHuman, 1)} / c ${fmt(edge.continuityAtHuman)}`,
          fmt(edge.continuity),
          fmt(edge.prominence),
          fmt(edge.confidence),
          edge.detected ? 'yes' : 'no',
          fmtPx(edge.deltaPx),
        ]);
      }
    }
    lines.push(markdownTable(edgeTable));
    lines.push('');
  }
  return lines.join('\n');
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
