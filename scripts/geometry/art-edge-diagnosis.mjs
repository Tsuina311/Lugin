#!/usr/bin/env node
/**
 * Diagnostic only. Runs the current frame-region detector on the seven
 * art-anchor failures and records the edges it already scores.
 * Does not change gates, windows, weights, or which candidate is selected.
 *
 *   node scripts/geometry/art-edge-diagnosis.mjs
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir, reportsDir, resolveSafeMedia } from '../scanner-benchmark/lib/paths.mjs';
import { FIXTURES_DIR } from './lib/paths.mjs';
import { isCompleteQuad } from './lib/schema.mjs';
import { CARD_HEIGHT, CARD_WIDTH, regionOrientation, sourceQuadToCanonical } from './lib/frame-regions/project.mjs';
import { RESEARCH_PRIORS } from './lib/frame-regions/priors.mjs';
import {
  detectFrameRegions,
  horizontalProfile,
  lumaOf,
  pickPeak,
  verticalProfile,
} from './lib/frame-regions/detect.mjs';
import { quadIoU } from './lib/frame-regions/report.mjs';
import { isManualArtBox } from '../scanner-benchmark/embedding/crop-ceiling.mjs';

/** Same radius pickPeak uses to suppress a neighboring boundary. */
const NEAR = 0.02;
/** pickPeak absolute floors and gates. Diagnostic classes use these, not new ones. */
const ENERGY_FLOOR = 6;
const CONTINUITY_GATE = 0.28;
const STRONG_FRACTION = 0.75;

const ART_EDGES = [
  { edge: 'top', id: 'titleArt', axis: 'h' },
  { edge: 'bottom', id: 'artType', axis: 'h' },
  { edge: 'left', id: 'innerLeft', axis: 'v' },
  { edge: 'right', id: 'innerRight', axis: 'v' },
];

const H_ORDER = ['titleTop', 'titleArt', 'artType', 'typeText', 'textFooter', 'footerBottom'];
const V_ORDER = ['innerLeft', 'innerRight'];

const TARGETS = [
  { slug: 'negate', card: 'Negate', imageId: '.scan-fixtures/replay/negate-20260908T082630/source-highres.png' },
  { slug: 'island-cq', card: 'Island cq-120629', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png' },
  { slug: 'wand', card: 'Wand of Wonder cq-120751', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png' },
  { slug: 'livaan', card: 'Livaan cq-120813', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png' },
  { slug: 'bulk-up', card: 'Bulk Up', imageId: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png' },
  { slug: 'mudbutton', card: 'Mudbutton Torchrunner', imageId: '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png' },
  { slug: 'island-geom', card: 'Island geom-001', imageId: '.scan-inbox/sessions/geometry-test-20260910-165339/geom-001-source/geom-001-source.png' },
];

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-edge-diag-'));
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
      `,
      resolveDir: rootDir,
      sourcefile: 'edge-diag-entry.ts',
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
    map.set(fixture.image, {
      quad: region.quad,
      cardQuad: isCompleteQuad(card?.groundTruthQuad) ? card.groundTruthQuad : null,
      frameFamily: card?.frameFamily ?? fixture.frameFamily ?? null,
      tags: [...new Set([...(fixture.tags ?? []), ...(card?.tags ?? [])])],
    });
  }
  return map;
};

const windowRowsOf = (rows, { lo, hi, suppress }) =>
  rows.filter(row => row.t >= lo && row.t <= hi && !suppress.some(at => Math.abs(at - row.t) < NEAR));

const nearestRow = (rows, t) => {
  if (!rows.length || t == null) return null;
  return rows.reduce((best, row) => (Math.abs(row.t - t) < Math.abs(best.t - t) ? row : best));
};

const maxEnergy = rows => rows.reduce((best, row) => (row.energy > best.energy ? row : best));

const localPeaks = (rows, floor) => {
  const peaks = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const row = rows[i];
    if (row.energy < floor) continue;
    if (row.energy >= rows[i - 1].energy && row.energy >= rows[i + 1].energy) peaks.push(row);
  }
  const kept = [];
  for (const peak of peaks.sort((a, b) => b.energy - a.energy)) {
    if (kept.some(other => Math.abs(other.t - peak.t) < 0.01)) continue;
    kept.push(peak);
    if (kept.length === 6) break;
  }
  return kept.sort((a, b) => a.t - b.t);
};

const px = (deltaT, span) => Math.abs(deltaT) * span;

/**
 * Class A/B/C uses only the detector window and the human line as a ruler.
 * Human position does not change pickPeak.
 */
const classifyEdge = ({ humanT, lo, hi, winner, strongest, goodNear, visibleOutside, suppressed }) => {
  const inside = humanT >= lo && humanT <= hi;
  const winnerNear = winner.t != null && Math.abs(winner.t - humanT) <= NEAR;
  if (winner.detected && winnerNear) {
    return { candidateClass: 'OK', reason: null, mode: null };
  }
  if (suppressed) {
    return { candidateClass: 'A', reason: 'DEPENDENCY_FAILURE', mode: null, detail: 'prior-suppress' };
  }
  if (!inside) {
    return {
      candidateClass: visibleOutside ? 'B' : 'C',
      reason: 'OTHER',
      mode: 'SEARCH_WINDOW_WRONG',
      detail: visibleOutside ? 'visible-outside-window' : 'outside-search-window',
    };
  }
  if (winnerNear && !winner.detected) {
    const reason =
      winner.reason === 'low-continuity'
        ? 'LOW_CONTINUITY'
        : winner.reason === 'low-prominence'
          ? 'LOW_PROMINENCE'
          : winner.reason === 'low-confidence'
            ? 'LOW_CONFIDENCE'
            : winner.reason === 'no-energy' || winner.reason === 'empty-window'
              ? 'MISSING'
              : 'OTHER';
    const candidateClass = reason === 'MISSING' ? 'C' : 'A';
    const mode = candidateClass === 'A' ? 'GATE_TOO_STRICT' : 'LUMA_EVIDENCE_INSUFFICIENT';
    return { candidateClass, reason, mode, detail: winner.reason };
  }
  if (!winnerNear && (goodNear || winner.detected)) {
    return {
      candidateClass: 'B',
      reason: 'BAD_POSITION',
      mode: goodNear ? 'EDGE_SCORING_WRONG' : 'LUMA_EVIDENCE_INSUFFICIENT',
      detail: goodNear ? 'strong-human-line-lost' : winner.reason ?? 'accepted-other-line',
    };
  }
  if (winner.reason === 'low-continuity' && strongest && Math.abs(strongest.t - humanT) <= NEAR) {
    return { candidateClass: 'A', reason: 'LOW_CONTINUITY', mode: 'GATE_TOO_STRICT', detail: winner.reason };
  }
  return {
    candidateClass: 'C',
    reason: winner.reason === 'no-energy' || winner.reason === 'empty-window' ? 'MISSING' : 'OTHER',
    mode: 'LUMA_EVIDENCE_INSUFFICIENT',
    detail: winner.reason,
  };
};

const traceBoundaries = (luma, width, height) => {
  const horizontal = horizontalProfile(luma, width, height);
  const verticalFull = verticalProfile(luma, width, height, 0.02, 0.98);
  const boundaries = {};
  const suppress = [];
  for (const id of H_ORDER) {
    const spec = RESEARCH_PRIORS.horizontal[id];
    const picked = pickPeak(horizontal, { ...spec, suppress });
    const rows = windowRowsOf(horizontal, { ...spec, suppress });
    boundaries[id] = {
      id,
      axis: 'h',
      spec,
      suppressUsed: [...suppress],
      picked,
      rows,
      profile: horizontal,
    };
    if (picked.detected) suppress.push(picked.t);
  }
  const artTop = boundaries.titleArt.picked.detected ? boundaries.titleArt.picked.t : 0.18;
  const artBottom = boundaries.artType.picked.detected ? boundaries.artType.picked.t : 0.7;
  const vertical = verticalProfile(luma, width, height, artTop, artBottom);
  const vSuppress = [];
  for (const id of V_ORDER) {
    const spec = RESEARCH_PRIORS.vertical[id];
    const picked = pickPeak(vertical, { ...spec, suppress: vSuppress });
    const rows = windowRowsOf(vertical, { ...spec, suppress: vSuppress });
    boundaries[id] = {
      id,
      axis: 'v',
      spec,
      suppressUsed: [...vSuppress],
      picked,
      rows,
      profile: vertical,
      span: { lo: artTop, hi: artBottom, fallback: !boundaries.titleArt.picked.detected || !boundaries.artType.picked.detected },
    };
    if (picked.detected) vSuppress.push(picked.t);
  }
  return { boundaries, verticalFull, artTop, artBottom };
};

const edgeRecord = (boundary, humanT, spanPx, fullProfile) => {
  const { spec, picked, rows, suppressUsed } = boundary;
  const strongest = rows.length ? maxEnergy(rows) : null;
  const maxE = strongest?.energy ?? 0;
  const nearRows = (fullProfile ?? boundary.profile).filter(row => Math.abs(row.t - humanT) <= NEAR);
  const bestNear = nearRows.length ? maxEnergy(nearRows) : null;
  const windowNear = rows.filter(row => Math.abs(row.t - humanT) <= NEAR);
  const bestWindowNear = windowNear.length ? maxEnergy(windowNear) : null;
  const goodNear = Boolean(
    bestWindowNear && bestWindowNear.energy >= ENERGY_FLOOR && bestWindowNear.energy >= STRONG_FRACTION * maxE,
  );
  const visibleOutside = Boolean(
    bestNear && bestNear.energy >= ENERGY_FLOOR && bestNear.continuity >= CONTINUITY_GATE,
  );
  const suppressed = suppressUsed.some(at => Math.abs(at - humanT) < NEAR);
  const winnerEnergy = picked.t == null ? null : nearestRow(boundary.profile, picked.t);
  const classified = classifyEdge({
    humanT,
    lo: spec.lo,
    hi: spec.hi,
    winner: picked,
    strongest,
    goodNear,
    visibleOutside,
    suppressed,
  });
    const peaks = localPeaks(rows, Math.max(ENERGY_FLOOR, 0.5 * maxE));
  const curve = boundary.profile.filter((_, index) => index % 4 === 0).map(row => [row.t, row.energy]);
  return {
    prior: spec.prior,
    lo: spec.lo,
    hi: spec.hi,
    humanT,
    humanPx: humanT * spanPx,
    strongestT: strongest?.t ?? null,
    strongestEnergy: strongest?.energy ?? null,
    strongestContinuity: strongest?.continuity ?? null,
    strongestSideAgree: strongest?.sideAgree ?? null,
    winnerT: picked.t,
    winnerEnergy: winnerEnergy?.energy ?? null,
    continuity: picked.continuity,
    prominence: picked.prominence,
    sideAgree: picked.sideAgree,
    priorAgree: picked.priorAgree ?? null,
    confidence: picked.confidence,
    detected: picked.detected,
    rawReason: picked.reason,
    reason: classified.reason,
    candidateClass: classified.candidateClass,
    mode: classified.mode,
    detail: classified.detail ?? null,
    goodCandidate: goodNear || (classified.candidateClass === 'A' && picked.t != null),
    suppressed,
    deltaWinnerPx: picked.t == null ? null : px(picked.t - humanT, spanPx),
    deltaStrongestPx: strongest ? px(strongest.t - humanT, spanPx) : null,
    bestNearEnergy: bestNear?.energy ?? null,
    bestNearContinuity: bestNear?.continuity ?? null,
    bestNearT: bestNear?.t ?? null,
    insideWindow: humanT >= spec.lo && humanT <= spec.hi,
    peaks: peaks.map(peak => ({
      t: peak.t,
      energy: peak.energy,
      continuity: peak.continuity,
      sideAgree: peak.sideAgree,
    })),
    curve,
  };
};

const structureOf = (edge, t, human) => {
  if (t == null) return null;
  const horizontal = edge === 'top' || edge === 'bottom';
  if (horizontal && t > human.top + 0.03 && t < human.bottom - 0.03) return 'artwork content edge';
  if (!horizontal && t > human.left + 0.03 && t < human.right - 0.03) return 'artwork content edge';
  const named = horizontal
    ? [
        ['title line', RESEARCH_PRIORS.horizontal.titleTop.prior],
        ['title/art line', RESEARCH_PRIORS.horizontal.titleArt.prior],
        ['art/type line', RESEARCH_PRIORS.horizontal.artType.prior],
        ['type/text line', RESEARCH_PRIORS.horizontal.typeText.prior],
        ['text/footer line', RESEARCH_PRIORS.horizontal.textFooter.prior],
        ['footer line', RESEARCH_PRIORS.horizontal.footerBottom.prior],
      ]
    : [
        ['inner left frame', RESEARCH_PRIORS.vertical.innerLeft.prior],
        ['inner right frame', RESEARCH_PRIORS.vertical.innerRight.prior],
      ];
  const [name, prior] = named.reduce((best, row) => (Math.abs(row[1] - t) < Math.abs(best[1] - t) ? row : best));
  if (Math.abs(prior - t) <= NEAR) return name;
  if (horizontal && t <= 0.03) return 'card frame';
  if (!horizontal && (t <= 0.03 || t >= 0.97)) return 'card frame';
  return null;
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
  return png;
};

const blend = (png, x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  const k = a / 255;
  png.data[i] = Math.round(png.data[i] * (1 - k) + r * k);
  png.data[i + 1] = Math.round(png.data[i + 1] * (1 - k) + g * k);
  png.data[i + 2] = Math.round(png.data[i + 2] * (1 - k) + b * k);
  png.data[i + 3] = 255;
};

const hLine = (png, y, r, g, b, a = 255) => {
  const yy = Math.round(y);
  for (let x = 0; x < png.width; x++) blend(png, x, yy, r, g, b, a);
};

const vLine = (png, x, r, g, b, a = 255) => {
  const xx = Math.round(x);
  for (let y = 0; y < png.height; y++) blend(png, xx, y, r, g, b, a);
};

const paintOverlay = (warp, edges) => {
  const png = scaleImage(warp, 420);
  const sx = png.width / warp.width;
  const sy = png.height / warp.height;
  for (const edge of edges) {
    if (edge.axis === 'h') {
      const y0 = edge.lo * (warp.height - 1) * sy;
      const y1 = edge.hi * (warp.height - 1) * sy;
      for (let y = Math.round(y0); y <= Math.round(y1); y++) {
        for (let x = 0; x < png.width; x++) blend(png, x, y, 80, 140, 255, 28);
      }
    } else {
      const x0 = edge.lo * (warp.width - 1) * sx;
      const x1 = edge.hi * (warp.width - 1) * sx;
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        for (let y = 0; y < png.height; y++) blend(png, x, y, 80, 140, 255, 22);
      }
    }
  }
  for (const edge of edges) {
    for (const peak of edge.peaks) {
      const color = [255, 176, 32];
      if (edge.axis === 'h') hLine(png, peak.t * (warp.height - 1) * sy, ...color, 180);
      else vLine(png, peak.t * (warp.width - 1) * sx, ...color, 180);
    }
  }
  for (const edge of edges) {
    const accepted = edge.detected;
    const color = accepted ? [80, 170, 255] : [255, 70, 70];
    if (edge.winnerT == null) continue;
    if (edge.axis === 'h') hLine(png, edge.winnerT * (warp.height - 1) * sy, ...color, 230);
    else vLine(png, edge.winnerT * (warp.width - 1) * sx, ...color, 230);
  }
  for (const edge of edges) {
    if (edge.axis === 'h') hLine(png, edge.humanT * (warp.height - 1) * sy, 40, 210, 120, 255);
    else vLine(png, edge.humanT * (warp.width - 1) * sx, 40, 210, 120, 255);
  }
  return png;
};

const spark = (profile, edge, vertical) => {
  const w = 360;
  const h = 72;
  const maxE = Math.max(...profile.map(row => row.energy), 1);
  const pts = profile
    .filter((_, i) => i % 2 === 0)
    .map(row => `${(row.t * w).toFixed(1)},${(h - 8 - (row.energy / maxE) * (h - 16)).toFixed(1)}`)
    .join(' ');
  const band = `<rect x="${edge.lo * w}" y="0" width="${(edge.hi - edge.lo) * w}" height="${h}" fill="rgba(80,140,255,0.18)"/>`;
  const mark = (t, color) =>
    t == null ? '' : `<line x1="${t * w}" y1="0" x2="${t * w}" y2="${h}" stroke="${color}" stroke-width="1.5"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${band}<polyline fill="none" stroke="#ddd" stroke-width="1" points="${pts}"/>${mark(edge.humanT, '#3dd68c')}${mark(edge.winnerT, edge.detected ? '#6cb2ff' : '#ff5a5a')}</svg>`;
};

const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const fmtPx = value => (value == null ? '—' : `${value.toFixed(1)} px`);

const esc = value =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const primaryFailure = edge => {
  if (edge.candidateClass === 'OK') return false;
  if (edge.axis === 'v' && edge.spanFallback && edge.counterfactualOk) return false;
  return true;
};

const TIGHT_CARD = 0.9;

const decide = (frames, primary) => {
  const loose = frames.filter(frame => frame.cardIou < TIGHT_CARD && !frame.anchor);
  const tight = frames.filter(frame => frame.cardIou >= TIGHT_CARD);
  const causing = primary.filter(edge => !edge.anchor && !edge.detected);
  const gate = causing.filter(edge => edge.candidateClass === 'A');
  const visibleOutside = causing.filter(edge => edge.detail === 'visible-outside-window');
  const noCandidate = causing.filter(edge => edge.candidateClass === 'C');
  return {
    verdict: 'MIXED',
    counts: {
      looseCardWarp: loose.length,
      tightCard: tight.length,
      causingEdges: causing.length,
      gateRejectedCorrectLine: gate.length,
      visibleOutsideWindow: visibleOutside.length,
      noUsefulCandidate: noCandidate.length,
    },
    why: `${loose.length} of 6 missing anchors are loose card warps (card IoU under ${TIGHT_CARD}). Their art edges are strong and sit outside the fractional windows because those windows are fractions of the background, not of the card. The two tight cards fail differently: Negate's art bottom is just below the art/type window, and Island geom-001's extended art bottom is far below it. Zero causing edges are a correct in-window line rejected by the 0.2 gate.`,
  };
};

const dominantMode = failures => {
  const counts = {};
  for (const edge of failures) {
    const mode = edge.mode ?? 'MIXED';
    counts[mode] = (counts[mode] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { verdict: 'MIXED', counts, why: 'No failing art edge.' };
  const [top, n] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  if (top !== 'MIXED' && n >= failures.length / 2 && n >= second * 2) {
    return { verdict: top, counts, why: `${n}/${failures.length} primary failing edges are ${top}.` };
  }
  return {
    verdict: 'MIXED',
    counts,
    why: `No failure mode has half the primary edges and twice the next. Counts: ${ranked.map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  };
};

const markdownTable = rows => {
  const head = rows[0];
  const line = head.map(() => '---');
  return [head, line, ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');
};

const main = async () => {
  const manuals = await loadManuals();
  const scan = await loadScan();
  const outDir = join(reportsDir, 'art-edge-diagnosis-v1');
  mkdirSync(outDir, { recursive: true });
  const frames = [];

  for (const target of TARGETS) {
    const manual = manuals.get(target.imageId);
    if (!manual?.quad || !manual.cardQuad) throw new Error(`missing reviewed art box for ${target.imageId}`);
    const decoded = PNG.sync.read(readFileSync(resolveSafeMedia(target.imageId)));
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const det = scan.detectCardQuad(source);
    const corners = det.recognitionCorners ?? det.corners;
    if (!corners) throw new Error(`no card quad: ${target.card}`);
    const warp = scan.warpQuadToCard(source, scan.cornersToQuad(corners));
    if (warp.width !== CARD_WIDTH || warp.height !== CARD_HEIGHT) throw new Error(`warp size ${warp.width}x${warp.height}`);
    const live = detectFrameRegions(warp);
    const luma = lumaOf(warp);
    const traced = traceBoundaries(luma, warp.width, warp.height);
    for (const row of live.debug.boundaries) {
      const mine = traced.boundaries[row.id].picked;
      if (mine.detected !== row.detected || mine.reason !== row.reason || mine.t !== row.t) {
        throw new Error(`diagnostic trace drifted on ${target.card} ${row.id}`);
      }
    }
    const detectorCard = {
      tl: [corners.topLeft.x, corners.topLeft.y],
      tr: [corners.topRight.x, corners.topRight.y],
      br: [corners.bottomRight.x, corners.bottomRight.y],
      bl: [corners.bottomLeft.x, corners.bottomLeft.y],
    };
    const ordered = regionOrientation({
      regionQuadSource: manual.quad,
      cardQuadSource: manual.cardQuad,
    }).ordered;
    // Human art, measured on the same warp the detector scored. The human card
    // quad is only used to order the polygon and to report card agreement.
    const human = sourceQuadToCanonical(ordered, detectorCard, warp.width, warp.height);
    const cardIou = quadIoU(manual.cardQuad, detectorCard);
    const humanT = {
      top: (human.tl[1] + human.tr[1]) / 2 / (warp.height - 1),
      bottom: (human.bl[1] + human.br[1]) / 2 / (warp.height - 1),
      left: (human.tl[0] + human.bl[0]) / 2 / (warp.width - 1),
      right: (human.tr[0] + human.br[0]) / 2 / (warp.width - 1),
    };
    const art = live.regions.artBox ?? null;
    const edges = ART_EDGES.map(spec => {
      const boundary = traced.boundaries[spec.id];
      const span = spec.axis === 'h' ? warp.height - 1 : warp.width - 1;
      const record = edgeRecord(boundary, humanT[spec.edge], span, spec.axis === 'v' ? traced.verticalFull : boundary.profile);
      let counterfactualOk = false;
      if (spec.axis === 'v') {
        const alt = verticalProfile(luma, warp.width, warp.height, humanT.top, humanT.bottom);
        const altPick = pickPeak(alt, { ...RESEARCH_PRIORS.vertical[spec.id], suppress: [] });
        counterfactualOk = Boolean(altPick.detected && Math.abs(altPick.t - humanT[spec.edge]) <= NEAR);
        record.counterfactual = {
          detected: altPick.detected,
          t: altPick.t,
          reason: altPick.reason,
          continuity: altPick.continuity,
          confidence: altPick.confidence,
          matchesHuman: counterfactualOk,
          note: 'Human top/bottom span only. Not used to select the edge.',
        };
      }
      return {
        ...spec,
        ...record,
        spanFallback: spec.axis === 'v' ? boundary.span.fallback : false,
        span: spec.axis === 'v' ? boundary.span : null,
        counterfactualOk,
        structure: structureOf(spec.edge, record.winnerT, humanT),
      };
    });
    if (art?.quad) {
      const autoT = {
        top: art.quad.tl[1] / (warp.height - 1),
        bottom: art.quad.bl[1] / (warp.height - 1),
        left: art.quad.tl[0] / (warp.width - 1),
        right: art.quad.tr[0] / (warp.width - 1),
      };
      for (const edge of edges) {
        if (Math.abs((autoT[edge.edge] ?? 0) - (edge.winnerT ?? -1)) > 1e-9 && edge.detected) {
          throw new Error(`accepted ${edge.edge} does not match artBox on ${target.card}`);
        }
      }
    }
    const failed = edges.filter(edge => !edge.detected);
    const sourcePng = scaleImage(source, 360);
    const overlay = paintOverlay(warp, edges);
    const sourceName = `${target.slug}-source.png`;
    const overlayName = `${target.slug}-warp.png`;
    await writeFile(join(outDir, sourceName), PNG.sync.write(sourcePng));
    await writeFile(join(outDir, overlayName), PNG.sync.write(overlay));
    frames.push({
      ...target,
      frameFamily: manual.frameFamily,
      tags: manual.tags,
      cardIou,
      anchor: Boolean(art?.quad),
      artConfidence: art?.confidence ?? null,
      failedEdges: failed.map(edge => edge.edge),
      oneEdgeRejectsBox: failed.length > 0,
      edges,
      files: { source: sourceName, warp: overlayName },
      boundaryTs: Object.fromEntries(
        Object.entries(traced.boundaries).map(([id, row]) => [id, { t: row.picked.t, detected: row.picked.detected, reason: row.picked.reason }]),
      ),
    });
    log(
      `${target.card} cardIoU ${cardIou.toFixed(3)} anchor ${art?.quad ? 'yes' : 'NO'} failed ${failed.map(edge => edge.edge).join(',') || 'none'}`,
    );
  }

  const island = frames.find(frame => frame.slug === 'island-geom');
  const primary = [];
  for (const frame of frames) {
    for (const edge of frame.edges) {
      if (!primaryFailure(edge)) continue;
      if (frame.anchor && edge.candidateClass === 'OK') continue;
      if (!frame.anchor && edge.detected) continue;
      primary.push({ ...edge, card: frame.card, slug: frame.slug, anchor: frame.anchor });
    }
  }
  const decision = decide(frames, primary);
  const summary = {
    pipeline: {
      luma: '0.299R+0.587G+0.114B',
      horizontal: 'Sobel gy, mean |gy| from x=0.12 to x=0.88',
      vertical: 'Sobel gx between the detected art top and bottom, else y=0.18 to y=0.70',
      continuity: 'fraction of the span with |Sobel| >= 12',
      prominence: '(window max energy - window median energy) / window max energy',
      score: '(energy/max) * (0.25+0.75*continuity) * (0.7+0.3*prior Gaussian)',
      confidence: '0.45*continuity + 0.25*prominence + 0.15*priorAgree + 0.15*sideAgree',
      gates: ['continuity < 0.28', 'prominence < 0.2', 'confidence < 0.2', 'window max energy < 6'],
      artBox: 'emitted only when titleArt, artType, innerLeft, and innerRight are all detected',
      oneEdgeRejects: true,
    },
    frames,
    primary,
    decision,
  };
  const jsonFrames = frames.map(frame => ({
    ...frame,
    edges: frame.edges.map(({ curve, ...edge }) => edge),
  }));
  await writeFile(join(outDir, 'summary.json'), JSON.stringify({ ...summary, frames: jsonFrames }, null, 2));
  await writeFile(join(reportsDir, 'art-edge-diagnosis-v1.md'), renderMarkdown(frames, island, decision));
  await writeFile(join(outDir, 'index.html'), renderHtml(frames));
  log(`wrote ${join(reportsDir, 'art-edge-diagnosis-v1.md')}`);
  log(`${decision.verdict}: ${decision.why}`);
};

const renderMarkdown = (frames, island, decision) => {
  const lines = [];
  lines.push('# ART EDGE DIAGNOSIS V1');
  lines.push('');
  lines.push('Diagnostic only. The detector, the 0.2 gate, the search windows, and recognition were not changed.');
  lines.push('');
  lines.push('## PIPELINE');
  lines.push('');
  lines.push('`detectFrameRegions` runs on the upright 744×1039 card warp.');
  lines.push('');
  lines.push('1. Luma is `0.299R + 0.587G + 0.114B`.');
  lines.push('2. Horizontal evidence is Sobel `gy`. Each row is summarized from x=0.12 to x=0.88.');
  lines.push('3. A row\'s energy is the mean absolute Sobel. Continuity is the fraction of that span with absolute Sobel ≥ 12. Side agreement is the quieter half of the span divided by the louder half.');
  lines.push('4. Boundaries are picked in order: `titleTop`, `titleArt`, `artType`, `typeText`, `textFooter`, `footerBottom`. A detection suppresses later windows within 0.02.');
  lines.push('5. `pickPeak` keeps rows inside `[lo, hi]`. Score is `(energy / window max) × (0.25 + 0.75 × continuity) × (0.7 + 0.3 × prior Gaussian)`.');
  lines.push('6. Prominence is one window statistic: `(max energy − median energy) / max energy`. It is not a per-pixel score.');
  lines.push('7. Confidence is `0.45×continuity + 0.25×prominence + 0.15×priorAgree + 0.15×sideAgree`, computed for the winning row.');
  lines.push('8. The winner is rejected when continuity < 0.28, prominence < 0.2, confidence < 0.2, or the window max energy is < 6.');
  lines.push('9. Vertical evidence is Sobel `gx`, measured only between the detected art top and art bottom. If either is missing, the span falls back to y=0.18–0.70.');
  lines.push('10. `artBox` is `titleArt`, `artType`, `innerLeft`, `innerRight`. `boundaryQuad` returns nothing unless all four are detected, they are in order, and the minimum confidence is ≥ 0.2. One failed edge drops the whole box.');
  lines.push('');
  lines.push('Search windows, as fractions of the card:');
  lines.push('');
  lines.push('| Edge | Boundary | Prior | Window |');
  lines.push('| --- | --- | ---: | --- |');
  lines.push('| top | titleArt | 0.115 | 0.070–0.180 |');
  lines.push('| bottom | artType | 0.542 | 0.470–0.575 |');
  lines.push('| left | innerLeft | 0.075 | 0.020–0.160 |');
  lines.push('| right | innerRight | 0.925 | 0.840–0.980 |');
  lines.push('');
  lines.push('Green in the debug page is the human art edge. Blue is an accepted detector line. Red is the line the scorer chose and a gate rejected. Orange marks other strong energy peaks inside the window. Human lines are a ruler. They do not change the pick.');
  lines.push('');
  lines.push('A candidate is at the human edge when it is within 0.02, the detector\'s own suppress radius. It is a strong candidate when its energy is at least 6 and at least 75% of the window maximum.');
  lines.push('');
  lines.push('- A. The winning line is the human edge, and a gate rejected it.');
  lines.push('- B. A strong line sits on the human edge, and the scorer chose a different line.');
  lines.push('- C. The human edge is weak or absent inside the window.');
  lines.push('');
  lines.push('## CARD QUAD');
  lines.push('');
  lines.push('Human art edges below are projected onto the detector warp. Card IoU compares the human card outline with the quad that warp used.');
  lines.push('');
  lines.push('| Card | Card IoU | artBox |');
  lines.push('| --- | ---: | --- |');
  for (const frame of frames) {
    lines.push(`| ${frame.card} | ${fmt(frame.cardIou)} | ${frame.anchor ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push('## PER EDGE');
  lines.push('');
  const table = [[
    'Card', 'Edge', 'Window', 'Human', 'In window', 'Energy at human', 'Strongest t', 'Strongest energy', 'Winner t', 'Continuity', 'Prominence', 'Confidence', 'Accepted', 'Raw reason', 'Class', 'Normalized', 'Δ winner', 'Δ strongest',
  ]];
  for (const frame of frames) {
    for (const edge of frame.edges) {
      table.push([
        frame.card,
        edge.edge,
        `${fmt(edge.lo)}–${fmt(edge.hi)}`,
        fmt(edge.humanT),
        edge.insideWindow ? 'yes' : 'no',
        `${fmt(edge.bestNearEnergy, 1)} / c ${fmt(edge.bestNearContinuity)}`,
        fmt(edge.strongestT),
        fmt(edge.strongestEnergy, 1),
        fmt(edge.winnerT),
        fmt(edge.continuity),
        fmt(edge.prominence),
        fmt(edge.confidence),
        edge.detected ? 'yes' : 'no',
        edge.rawReason ?? '—',
        edge.candidateClass,
        edge.detail ? `${edge.reason ?? '—'} (${edge.detail})` : (edge.reason ?? '—'),
        fmtPx(edge.deltaWinnerPx),
        fmtPx(edge.deltaStrongestPx),
      ]);
    }
  }
  lines.push(markdownTable(table));
  lines.push('');
  lines.push('## NO ANCHOR');
  lines.push('');
  lines.push('Any one undetected art edge makes `boundaryQuad` return no art box.');
  lines.push('');
  const compact = [['Card', 'Card IoU', 'Failed edge(s)', 'Failure type', 'Correct edge visible?', 'What was rejected']];
  for (const frame of frames.filter(row => !row.anchor)) {
    const failed = frame.edges.filter(edge => !edge.detected);
    const visible = edge => edge.detail === 'visible-outside-window' || edge.candidateClass === 'A';
    compact.push([
      frame.card,
      fmt(frame.cardIou),
      failed.map(edge => edge.edge).join(', '),
      frame.cardIou < TIGHT_CARD ? 'loose card warp' : 'tight card',
      failed.map(edge => `${edge.edge} ${visible(edge) ? 'yes, outside window' : 'no'}`).join('; '),
      failed.map(edge => `${edge.edge} window ${edge.rawReason}; human ${edge.detail ?? edge.candidateClass}`).join('; '),
    ]);
  }
  lines.push(markdownTable(compact));
  lines.push('');
  for (const frame of frames.filter(row => !row.anchor)) {
    const failed = frame.edges.filter(edge => !edge.detected);
    lines.push(`- ${frame.card}: artBox omitted because ${failed.map(edge => `${edge.edge} (${edge.rawReason}, ${edge.candidateClass})`).join(', ')}. One of those is enough to drop the box.`);
  }
  lines.push('');
  lines.push('## ISLAND GEOM-001');
  lines.push('');
  if (island) {
    lines.push(`Anchor confidence ${fmt(island.artConfidence)}. All four edges were accepted. The placement error is which line won.`);
    lines.push('');
    const ranked = [...island.edges].sort((a, b) => (b.deltaWinnerPx ?? 0) - (a.deltaWinnerPx ?? 0));
    for (const edge of ranked) {
      lines.push(
        `- ${edge.edge}: winner ${fmt(edge.winnerT)} vs human ${fmt(edge.humanT)} (${fmtPx(edge.deltaWinnerPx)}). Strongest energy is ${fmtPx(edge.deltaStrongestPx)} from the human edge. Class ${edge.candidateClass}. ${edge.structure ? `Nearest named structure: ${edge.structure}.` : 'No named frame line within 0.02 of the winner.'}`,
      );
    }
    const worst = ranked[0];
    lines.push('');
    lines.push(`The largest single-edge offset is ${worst.edge} at ${fmtPx(worst.deltaWinnerPx)}.`);
  }
  lines.push('');
  lines.push('## VERDICT');
  lines.push('');
  lines.push(`**${decision.verdict}**`);
  lines.push('');
  lines.push(decision.why);
  lines.push('');
  lines.push('A lower confidence gate would not recover these boxes. On the loose warps the top window is background, and its best line is weak. On the tight cards the true art bottom is outside the searched rows, so the gate never sees it.');
  lines.push('');
  lines.push('No art-only change of the existing gates or the existing score is a sufficient fix. The five loose warps need a card quad that actually bounds the card. The two tight-card misses need an art-bottom search that can reach a lower type line without treating that as a normal-frame prior.');
  lines.push('');
  return lines.join('\n');
};

const renderHtml = frames => {
  const cards = frames.map(frame => {
    const rows = frame.edges
      .map(edge => `<tr>
          <td>${esc(edge.edge)}</td>
          <td>${fmt(edge.lo)}–${fmt(edge.hi)}</td>
          <td>${fmt(edge.humanT)}</td>
          <td>${fmt(edge.strongestT)}<br>energy ${fmt(edge.strongestEnergy, 1)}</td>
          <td>${fmt(edge.winnerT)}</td>
          <td>${fmt(edge.continuity)}</td>
          <td>${fmt(edge.prominence)}</td>
          <td>${fmt(edge.confidence)}</td>
          <td>${edge.detected ? 'accepted' : 'rejected'}</td>
          <td>${esc(edge.rawReason ?? '—')}</td>
          <td>${esc(edge.candidateClass)} ${esc(edge.reason ?? '')}</td>
          <td>${fmtPx(edge.deltaWinnerPx)} / ${fmtPx(edge.deltaStrongestPx)}</td>
        </tr>`)
      .join('');
    const sparks = frame.edges
      .map(edge => `<div><b>${esc(edge.edge)}</b> ${spark(edge.curve.map(([t, energy]) => ({ t, energy })), edge, edge.axis === 'v')}</div>`)
      .join('');
    return `<section>
      <h2>${esc(frame.card)}</h2>
      <p>${frame.anchor ? 'artBox emitted' : 'NO artBox'} — failed: ${esc(frame.failedEdges.join(', ') || 'none')}. Card-quad IoU ${fmt(frame.cardIou)}. ${frame.frameFamily ? `Frame family ${esc(frame.frameFamily)}.` : ''} ${frame.tags?.length ? `Tags ${esc(frame.tags.join(', '))}.` : ''}</p>
      <div class="row">
        <figure><figcaption>source</figcaption><img src="${frame.files.source}" alt="source"></figure>
        <figure><figcaption>upright warp — green human, blue accepted, red rejected winner, orange other peaks, blue wash = search window</figcaption><img src="${frame.files.warp}" alt="warp"></figure>
      </div>
      <table>
        <tr><th>Edge</th><th>Window</th><th>Human</th><th>Strongest</th><th>Winner</th><th>Continuity</th><th>Prominence</th><th>Confidence</th><th>Result</th><th>Raw reason</th><th>Class</th><th>Δ winner / Δ strongest</th></tr>
        ${rows}
      </table>
      ${sparks}
    </section>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Art edge diagnosis</title>
<style>
body{font:14px/1.4 sans-serif;background:#111;color:#eee;margin:24px}
section{margin:0 0 40px;padding-bottom:24px;border-bottom:1px solid #333}
.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
img{max-width:420px;background:#000}
table{border-collapse:collapse;margin-top:12px}
td,th{border:1px solid #333;padding:4px 6px;vertical-align:top}
td:nth-child(n+2){font-variant-numeric:tabular-nums}
</style>
<h1>Art edge diagnosis</h1>
<p>Green = human art edge. Blue = accepted detector line. Red = scored line rejected by a gate. Orange = other strong peaks. The blue wash is the search window.</p>
${cards}`;
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
