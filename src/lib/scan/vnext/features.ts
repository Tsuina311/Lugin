/**
 * Ranker features for the frozen GBM. The formulas match
 * scripts/scanner-benchmark/ranker/features.mjs and export-dataset termsOf.
 * Candidate generation is not modified. Human IoU is not a feature.
 */

import { detectFrameRegions as detectFrameRegionsImpl } from '../../../../scripts/geometry/lib/frame-regions/detect.mjs';
import { containsCandidate } from '../detection/multi';
import type { DetectionCandidateDebug } from '../detection/types';
import { CARD_ASPECT, cornersToQuad, warpQuadToCard } from '../geometry';
import type { CardCorners, ScanImage } from '../types';
import { ensureFrameBuffer } from './bufferShim';
import { frozenGbm, gbmUtility, selectByUtility, vectorOf } from './gbm';

export const FRAME_WARP_WIDTH = 372;
export const FRAME_WARP_HEIGHT = Math.round(FRAME_WARP_WIDTH / CARD_ASPECT);
const PEAK = 0.35;

export type NamedQuad = {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
};

type Point = { x: number; y: number };

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export const namedQuad = (corners: CardCorners): NamedQuad => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const namedPoints = (quad: NamedQuad): Point[] => [
  { x: quad.tl[0], y: quad.tl[1] },
  { x: quad.tr[0], y: quad.tr[1] },
  { x: quad.br[0], y: quad.br[1] },
  { x: quad.bl[0], y: quad.bl[1] },
];

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const shoelace = (pts: Point[]): number => {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
};

const edgeIntersect = (p: Point, q: Point, a: Point, b: Point): Point | null => {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / det;
  return { x: p.x + t * dx, y: p.y + t * dy };
};

const clipPolygon = (subject: Point[], clip: Point[]): Point[] => {
  let output = subject.map(point => ({ ...point }));
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = cross(a, b, p) >= 0;
      const qin = cross(a, b, q) >= 0;
      if (pin && qin) output.push(q);
      else if (pin && !qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
      } else if (!pin && qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
        output.push(q);
      }
    }
  }
  return output;
};

/** Share of `subject` inside `clip`. Same polygon clip as the ranker export. */
export const quadCoverage = (subject: NamedQuad, clip: NamedQuad): number => {
  const area = shoelace(namedPoints(subject));
  if (area < 1e-6) return 0;
  return shoelace(clipPolygon(namedPoints(subject), namedPoints(clip))) / area;
};

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const parseMethod = (method: string) => {
  const lumaMult = method.match(/^luma×([0-9.]+)$/);
  const lumaAbs = method.match(/^luma@([0-9.]+)$/);
  const chroma = method.match(/^chroma@([0-9.]+)$/);
  const family = method.startsWith('edge')
    ? 'edge'
    : method.startsWith('chroma')
      ? 'chroma'
      : method.startsWith('luma')
        ? 'luma'
        : 'other';
  return {
    srcEdge: family === 'edge' ? 1 : 0,
    srcLuma: family === 'luma' ? 1 : 0,
    srcChroma: family === 'chroma' ? 1 : 0,
    lumaMultiplier: lumaMult ? Number(lumaMult[1]) : 0,
    lumaThreshold: lumaAbs ? Number(lumaAbs[1]) : 0,
    chromaThreshold: chroma ? Number(chroma[1]) : 0,
  };
};

const center = (quad: NamedQuad) => ({
  x: (quad.tl[0] + quad.tr[0] + quad.br[0] + quad.bl[0]) / 4,
  y: (quad.tl[1] + quad.tr[1] + quad.br[1] + quad.bl[1]) / 4,
});

export const emptyStructure = () => ({
  frameRegionSuccess: 0,
  artBoxConfidence: 0,
  titleArtConfidence: 0,
  artTypeConfidence: 0,
  innerLeftConfidence: 0,
  innerRightConfidence: 0,
});

type BoundaryRow = { id?: string; confidence?: number };

export const structureFromDetection = (detection: {
  regions?: { artBox?: { confidence?: number } | null };
  debug?: { boundaries?: BoundaryRow[] };
} | null) => {
  if (!detection) return emptyStructure();
  const boundary = (id: string) => detection.debug?.boundaries?.find(row => row.id === id)?.confidence ?? 0;
  return {
    frameRegionSuccess: detection.regions?.artBox ? 1 : 0,
    artBoxConfidence: detection.regions?.artBox?.confidence ?? 0,
    titleArtConfidence: boundary('titleArt'),
    artTypeConfidence: boundary('artType'),
    innerLeftConfidence: boundary('innerLeft'),
    innerRightConfidence: boundary('innerRight'),
  };
};

/** Geometric terms used as GBM inputs. Matches export-dataset termsOf. */
export const termsOfQuad = (quad: NamedQuad, imageW: number, imageH: number) => {
  const [tl, tr, br, bl] = namedPoints(quad);
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
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
  const area =
    Math.abs(
      tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y -
        (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
    ) / 2;
  const frameFraction = area / (imageW * imageH);
  const areaScore = Math.min(1, frameFraction / PEAK);
  const centerX = (tl.x + tr.x + br.x + bl.x) / 4 / imageW;
  const centerY = (tl.y + tr.y + br.y + bl.y) / 4 / imageH;
  const centerDist = Math.hypot(centerX * imageW - imageW / 2, centerY * imageH - imageH / 2);
  const centerScore = 1 - Math.min(1, centerDist / (Math.hypot(imageW, imageH) / 2));
  const detectorScore = aspectScore * 0.4 + parallelScore * 0.25 + areaScore * 0.25 + centerScore * 0.1;
  return {
    aspectRatio,
    aspectScore,
    parallelRaw,
    parallelScore,
    frameFraction,
    areaScore,
    centerX,
    centerY,
    centerScore,
    detectorScore,
  };
};

export type FeatureRowInput = {
  index: number;
  method: string;
  quad: NamedQuad;
  detectorScore: number;
  aspectScore: number;
  parallelScore: number;
  areaScore: number;
  centerScore: number;
  aspectRatio: number;
  frameFraction: number;
  centerX: number;
  centerY: number;
  parallelRaw: number;
  structure?: ReturnType<typeof emptyStructure> | null;
};

export type NestedTrace = {
  selected: number;
  relations: { outer: number; inner: number }[];
  inner: number | null;
  outer: number | null;
};

export const buildRankerFeatureRows = ({
  rows,
  width,
  height,
  nested,
}: {
  rows: FeatureRowInput[];
  width: number;
  height: number;
  nested: NestedTrace;
}) => {
  const scores = rows.map(row => row.detectorScore);
  const fracs = rows.map(row => row.frameFraction);
  const best = scores.length ? Math.max(...scores) : 0;
  const medScore = median(scores);
  const largest = fracs.length ? Math.max(...fracs) : 1;
  const medArea = median(fracs) || 1;
  const order = [...rows].sort((a, b) => b.detectorScore - a.detectorScore || a.index - b.index);
  const rankOf = new Map(order.map((row, rank) => [row.index, rank + 1]));
  const relations = nested.relations ?? [];
  const containedBy = new Map(rows.map(row => [row.index, [] as { ratio: number; offset: number }[]]));
  const contains = new Map(rows.map(row => [row.index, [] as { ratio: number }[]]));
  for (const outer of rows) {
    for (const inner of rows) {
      if (outer.index === inner.index || outer.frameFraction <= inner.frameFraction) continue;
      if (quadCoverage(inner.quad, outer.quad) < 0.9) continue;
      const ratio = inner.frameFraction / outer.frameFraction;
      const a = center(inner.quad);
      const b = center(outer.quad);
      const offset =
        Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.sqrt(outer.frameFraction * width * height));
      containedBy.get(inner.index)?.push({ ratio, offset });
      contains.get(outer.index)?.push({ ratio });
    }
  }
  return rows.map(row => {
    const containers = containedBy.get(row.index) ?? [];
    const contained = contains.get(row.index) ?? [];
    const closestContainer = containers.reduce<{ ratio: number; offset: number } | null>(
      (bestRow, item) => (!bestRow || item.ratio > bestRow.ratio ? item : bestRow),
      null,
    );
    const closestContained = contained.reduce<{ ratio: number } | null>(
      (bestRow, item) => (!bestRow || item.ratio > bestRow.ratio ? item : bestRow),
      null,
    );
    return {
      index: row.index,
      detectorScore: row.detectorScore,
      features: {
        detectorScore: row.detectorScore,
        aspectScore: row.aspectScore,
        parallelScore: row.parallelScore,
        areaScore: row.areaScore,
        centerScore: row.centerScore,
        aspectRatio: row.aspectRatio,
        frameFraction: row.frameFraction,
        centerX: row.centerX,
        centerY: row.centerY,
        parallelRaw: row.parallelRaw,
        scoreRank: rankOf.get(row.index) ?? 0,
        scoreMinusBest: row.detectorScore - best,
        scoreMinusMedian: row.detectorScore - medScore,
        areaOverLargest: largest > 0 ? row.frameFraction / largest : 0,
        areaOverMedian: medArea > 0 ? row.frameFraction / medArea : 0,
        candidateCount: rows.length,
        containedByCount: containers.length,
        containsCount: contained.length,
        hasContainer: closestContainer ? 1 : 0,
        closestContainerRatio: closestContainer?.ratio ?? 0,
        closestContainerOffset: closestContainer?.offset ?? 0,
        hasContained: closestContained ? 1 : 0,
        closestContainedRatio: closestContained?.ratio ?? 0,
        inNestedRelation: relations.some(rel => rel.outer === row.index || rel.inner === row.index) ? 1 : 0,
        isNestedInner: nested.selected === row.index && nested.selected === nested.inner ? 1 : 0,
        isNestedOuter: nested.selected === row.index && nested.selected === nested.outer ? 1 : 0,
        ...parseMethod(row.method),
        ...(row.structure ?? emptyStructure()),
      },
    };
  });
};

export const traceNested = (
  candidates: DetectionCandidateDebug[],
  rows: { index: number; detectorScore: number; frameFraction: number }[],
): NestedTrace => {
  const scored = candidates.map((candidate, index) => {
    const row = rows.find(item => item.index === index);
    return row ? { ...candidate, score: row.detectorScore } : candidate;
  });
  const accepted: { index: number; score: number; corners: CardCorners; areaRatio: number }[] = [];
  scored.forEach((candidate, index) => {
    if (!candidate.corners || candidate.rejectedBecause?.length) return;
    const row = rows.find(item => item.index === index);
    if (!row) return;
    accepted.push({
      index,
      score: candidate.score,
      corners: candidate.corners,
      areaRatio: row.frameFraction,
    });
  });
  if (!accepted.length) return { selected: -1, relations: [], inner: null, outer: null };
  const ranked = [...accepted].sort((a, b) => b.score - a.score).slice(0, 8);
  const relations: { outer: number; inner: number; innerScore: number }[] = [];
  for (const outer of ranked) {
    for (const inner of ranked) {
      if (outer.index === inner.index || outer.areaRatio <= inner.areaRatio) continue;
      const rel = containsCandidate(outer.corners, inner.corners);
      if (!rel.ok) continue;
      relations.push({ outer: outer.index, inner: inner.index, innerScore: inner.score });
    }
  }
  let max = accepted[0];
  for (const row of accepted) if (row.score > max.score) max = row;
  let selected = max.index;
  let inner: number | null = null;
  let outer: number | null = null;
  if (relations.length) {
    let pair = relations[0];
    for (const next of relations) if (next.innerScore > pair.innerScore) pair = next;
    const outerRow = accepted.find(row => row.index === pair.outer);
    const innerRow = accepted.find(row => row.index === pair.inner);
    inner = pair.inner;
    outer = pair.outer;
    if (innerRow && outerRow && (innerRow.score >= 0.28 || innerRow.score >= outerRow.score * 0.75)) {
      selected = pair.inner;
    } else selected = pair.outer;
  }
  return { selected, relations, inner, outer };
};

export type RankedCandidate = {
  index: number;
  detectorScore: number;
  utility: number;
  vector: number[];
};

/**
 * Score the existing detector candidate list once. Does not generate candidates.
 * `featureMs` is the structure-warp cost. `gbmMs` is the tree walk only.
 */
export const rankLiveCandidates = (image: ScanImage, candidates: DetectionCandidateDebug[]) => {
  ensureFrameBuffer();
  const t0 = now();
  const measured: FeatureRowInput[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate.corners || candidate.rejectedBecause.length) continue;
    const quad = namedQuad(candidate.corners);
    const terms = termsOfQuad(quad, image.width, image.height);
    if (!terms) continue;
    let structure = null;
    try {
      const warped = warpQuadToCard(image, cornersToQuad(candidate.corners), FRAME_WARP_WIDTH, FRAME_WARP_HEIGHT);
      structure = structureFromDetection(detectFrameRegions(warped));
    } catch {
      structure = null;
    }
    measured.push({ index, method: candidate.method, quad, structure, ...terms });
  }
  const nested = traceNested(candidates, measured);
  const built = buildRankerFeatureRows({
    rows: measured,
    width: image.width,
    height: image.height,
    nested,
  });
  const featureMs = now() - t0;
  const t1 = now();
  const scored: RankedCandidate[] = built.map(row => {
    const vector = vectorOf(row.features, frozenGbm.featureNames);
    return { index: row.index, detectorScore: row.detectorScore, utility: gbmUtility(frozenGbm, vector), vector };
  });
  const selected = selectByUtility(scored);
  return {
    scored,
    selected,
    featureMs,
    gbmMs: now() - t1,
    candidateCount: candidates.length,
    measuredCount: measured.length,
  };
};

/** Same scores as {@link rankLiveCandidates}. Yields between candidate warps. */
export const rankLiveCandidatesPaced = async (
  image: ScanImage,
  candidates: DetectionCandidateDebug[],
) => {
  ensureFrameBuffer();
  const t0 = now();
  const measured: FeatureRowInput[] = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (!candidate.corners || candidate.rejectedBecause.length) continue;
    const quad = namedQuad(candidate.corners);
    const terms = termsOfQuad(quad, image.width, image.height);
    if (!terms) continue;
    let structure = null;
    try {
      const warped = warpQuadToCard(image, cornersToQuad(candidate.corners), FRAME_WARP_WIDTH, FRAME_WARP_HEIGHT);
      structure = structureFromDetection(detectFrameRegions(warped));
    } catch {
      structure = null;
    }
    measured.push({ index, method: candidate.method, quad, structure, ...terms });
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  }
  const nested = traceNested(candidates, measured);
  const built = buildRankerFeatureRows({
    rows: measured,
    width: image.width,
    height: image.height,
    nested,
  });
  const featureMs = now() - t0;
  const t1 = now();
  const scored: RankedCandidate[] = built.map(row => {
    const vector = vectorOf(row.features, frozenGbm.featureNames);
    return { index: row.index, detectorScore: row.detectorScore, utility: gbmUtility(frozenGbm, vector), vector };
  });
  const selected = selectByUtility(scored);
  return {
    scored,
    selected,
    featureMs,
    gbmMs: now() - t1,
    candidateCount: candidates.length,
    measuredCount: measured.length,
  };
};

type FrameDetection = {
  regions?: { artBox?: { confidence?: number; quad?: NamedQuad } | null };
  debug?: { boundaries?: BoundaryRow[] };
};

const detectFrameRegions = (image: ScanImage): FrameDetection => {
  ensureFrameBuffer();
  return detectFrameRegionsImpl(image) as FrameDetection;
};
