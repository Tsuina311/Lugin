/**
 * Physical MTG card boundary refinement V2 — global nested sleeve/card consensus.
 *
 * Represent ONE nested planar pair:
 *   outerQuad (sleeve / detector seed)
 *   physicalCardQuad (manufactured card)
 *
 * Fit in rectified outer-quad UV, then map back. Never mix independent side
 * hypotheses into a "half-sleeved" crop. Prefer a little sleeve over clipping ink.
 *
 * No OCR / identity / mana / title.
 */

import {
  CARD_ASPECT,
  applyH,
  cornersToQuad,
  dist,
  homographyDestToSrc,
  type Quad,
} from '../geometry';
import type { CardCorners, Point, ScanImage } from '../types';

/** Per-corner evidence for dual-boundary telemetry / debug. */
export type CornerEvidenceKind =
  | 'NONE'
  | 'OUTER_ONLY'
  | 'INNER_ROUNDED_OBSERVED'
  | 'INNER_PREDICTED'
  | 'INNER_VERIFIED'
  /** @deprecated legacy aliases kept for older telemetry readers */
  | 'rounded_physical'
  | 'sharp_outer'
  | 'nested_rounded_inner'
  | 'unknown';

export type EdgeEvidenceKind =
  | 'NONE'
  | 'OBSERVED'
  | 'PREDICTED'
  | 'VERIFIED'
  | 'REJECTED_INTERNAL';

/** Boundary classification for the outer candidate + optional nested card. */
export type BoundaryClassification =
  | 'UNSLEEVED_CARD'
  | 'SLEEVED_CARD'
  | 'SLEEVE_SUSPECTED'
  | 'AMBIGUOUS'
  | 'UNKNOWN'
  | 'BAD_SEED';

export type PhysicalRefineStatus =
  | 'NO_REFINEMENT'
  | 'CARD_BOUNDARY_CONFIRMED'
  | 'SLEEVED_CARD_DUAL'
  | 'AMBIGUOUS'
  | 'BAD_SEED'
  | 'INTERNAL_EDGE_REJECTED';

export type RefineRejectionReason =
  | 'NONE'
  | 'LARGE_INSET'
  | 'NO_ROUNDED_CORNERS'
  | 'INTERNAL_EDGE'
  | 'BAD_SEED'
  | 'INSUFFICIENT_CONSENSUS'
  | 'ASPECT_REGRESSED'
  | 'NON_CONVEX'
  | 'CORNER_FRAGMENT'
  | 'NO_GEOMETRY'
  | 'NO_IMAGE';

export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type CornerKey = 'TL' | 'TR' | 'BR' | 'BL';

export type PhysicalRefineResult = {
  status: PhysicalRefineStatus;
  classification: BoundaryClassification;
  /** Alias of classification for telemetry naming. */
  boundaryModel: BoundaryClassification;
  outerCandidateQuad: CardCorners;
  sleeveQuad: CardCorners | null;
  physicalCardQuad: CardCorners | null;
  /** @deprecated alias — use physicalCardQuad when selected. */
  refinedQuad: CardCorners | null;
  originalQuad: CardCorners;
  selectedQuad: CardCorners;
  selectedForCapture: 'ORIGINAL' | 'PHYSICAL_CARD';
  captureSelectedQuad: CardCorners;
  refinementMs: number;
  cornerEvidence: Record<CornerKey, CornerEvidenceKind>;
  edgeEvidence: Record<'top' | 'right' | 'bottom' | 'left', EdgeEvidenceKind>;
  physicalEdgeSupport: EdgeInsets;
  sleeveToCardInset: EdgeInsets;
  edgeInsetNormalized: EdgeInsets;
  edgeInsetPixels: EdgeInsets;
  sleeveInset: EdgeInsets;
  meanInset: number;
  maxInset: number;
  sleeveLike: boolean;
  globalConsensusScore: number;
  outwardPaddingApplied: number;
  confidence: number;
  reason: string;
  rejectionReason: RefineRejectionReason;
};

/** Side insets above this (vs min outer side) are treated as internal printed structure. */
export const MAX_PLAUSIBLE_SIDE_INSET = 0.035;
export const MAX_PLAUSIBLE_TOP_INSET = 0.055;
export const MIN_MEAN_SLEEVE_INSET = 0.004;
export const BAD_SEED_OCCUPANCY = 0.65;
export const MIN_PHYSICAL_AREA_FRAC = 0.82;
export const MIN_ROUNDED_CORNERS_FOR_PHYSICAL = 2;
/** UV outward pad on accepted physical card (frac of unit side) — anti-clip. */
export const PHYSICAL_OUTWARD_PAD = 0.012;
/** Minimum global consensus to select PHYSICAL_CARD. */
export const MIN_GLOBAL_CONSENSUS = 0.62;

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;
type SideName = (typeof SIDE_NAMES)[number];
const CORNER_KEYS: CornerKey[] = ['TL', 'TR', 'BR', 'BL'];

const UNIT_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const cornersToPts = (c: CardCorners): Point[] => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];

const ptsToCorners = (pts: Point[]): CardCorners => ({
  topLeft: pts[0]!,
  topRight: pts[1]!,
  bottomRight: pts[2]!,
  bottomLeft: pts[3]!,
});

const emptyInsets = (): EdgeInsets => ({ top: 0, right: 0, bottom: 0, left: 0 });

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const lumaAt = (img: ScanImage, x: number, y: number): number => {
  const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const o = (yi * img.width + xi) * 4;
  const d = img.data;
  return 0.299 * d[o]! + 0.587 * d[o + 1]! + 0.114 * d[o + 2]!;
};

const isConvexPts = (pts: Point[]): boolean => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 4]!;
    const c = pts[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
};

const aspectOfPts = (pts: Point[]): number => {
  const w = (dist(pts[0]!, pts[1]!) + dist(pts[3]!, pts[2]!)) / 2;
  const h = (dist(pts[0]!, pts[3]!) + dist(pts[1]!, pts[2]!)) / 2;
  return w / Math.max(h, 1e-6);
};

const quadAreaPts = (pts: Point[]): number => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i]!;
    const r = pts[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

export const quadOccupancy = (
  corners: CardCorners,
  frame: { width: number; height: number },
): number => {
  const q = cornersToQuad(corners) as Quad;
  return quadAreaPts(q) / Math.max(1, frame.width * frame.height);
};

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

type NestedHit = {
  key: CornerKey;
  /** Inner corner in UV (outer = unit square). */
  u: number;
  v: number;
  strength: number;
  outerSharp: boolean;
};

/**
 * Sample along UV inward diagonal from an outer corner.
 * Nested rounded = outer sharp locus + inner rounded locus within sleeve band.
 */
const observeNestedCorner = (
  img: ScanImage,
  HuvToImg: Float64Array,
  key: CornerKey,
  maxInsetUv: number,
  steps: number,
): NestedHit | null => {
  const outerUv =
    key === 'TL'
      ? { x: 0, y: 0 }
      : key === 'TR'
        ? { x: 1, y: 0 }
        : key === 'BR'
          ? { x: 1, y: 1 }
          : { x: 0, y: 1 };
  const toward = { x: 0.5 - outerUv.x, y: 0.5 - outerUv.y };
  const samples: { t: number; g: number }[] = [];
  const lumas: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * maxInsetUv;
    const u = outerUv.x + toward.x * 2 * t; // toward center; t is inset-ish
    const v = outerUv.y + toward.y * 2 * t;
    // Clamp to unit square inward
    const uu = Math.max(0, Math.min(1, u));
    const vv = Math.max(0, Math.min(1, v));
    const p = applyH(HuvToImg, { x: uu, y: vv });
    lumas.push(lumaAt(img, p.x, p.y));
  }
  for (let i = 1; i < lumas.length - 1; i++) {
    samples.push({
      t: (i / steps) * maxInsetUv,
      g: Math.abs(lumas[i + 1]! - lumas[i - 1]!) / 2,
    });
  }
  const maxG = Math.max(...samples.map(s => s.g), 1e-6);
  const peaks = samples
    .filter((s, i) => {
      if (s.g < 0.4 * maxG) return false;
      const prev = samples[i - 1]?.g ?? 0;
      const next = samples[i + 1]?.g ?? 0;
      return s.g >= prev && s.g >= next;
    })
    .sort((a, b) => b.g - a.g);

  if (!peaks.length) return null;
  const outer = peaks.find(p => p.t <= 0.012);
  // Prefer nearest strong peak inside the sleeve band — deep internal edges
  // often dominate gradient but are NOT the physical card perimeter.
  const sleeveCap = MAX_PLAUSIBLE_SIDE_INSET + 0.008;
  const sleeveBand = peaks
    .filter(p => p.t >= 0.006 && p.t <= sleeveCap && p.g >= 0.45 * maxG)
    .sort((a, b) => {
      // Prefer nearer sleeve gap when strengths are close (avoid internal frames).
      if (Math.abs(a.g - b.g) < 0.15 * maxG) return a.t - b.t;
      return b.g - a.g;
    });
  const inner =
    sleeveBand[0] ??
    peaks.find(p => p.t >= 0.006 && p.t <= Math.min(maxInsetUv, MAX_PLAUSIBLE_TOP_INSET + 0.005));
  if (!inner || inner.g < 0.45 * maxG) {
    // Outer-only sharp — not nested.
    if (outer && !inner) return null;
    // Unsleved rounded at outer locus — signal via null nested (handled elsewhere).
    return null;
  }

  // Map diagonal parameter t → UV of inner corner along bisector.
  // Then split into axis insets (same t on both axes in UV for a square nest;
  // asymmetric sleeves are reconciled in fitGlobalInnerRect via medians).
  const u = outerUv.x + toward.x * 2 * inner.t;
  const v = outerUv.y + toward.y * 2 * inner.t;
  return {
    key,
    u: Math.max(0.002, Math.min(0.998, u)),
    v: Math.max(0.002, Math.min(0.998, v)),
    strength: inner.g / maxG,
    outerSharp: Boolean(outer),
  };
};

/** Cheap outer-corner class: rounded at seed vs sharp outer. */
const classifyOuterCorner = (
  img: ScanImage,
  HuvToImg: Float64Array,
  key: CornerKey,
  maxInsetUv: number,
  steps: number,
): 'rounded_physical' | 'sharp_outer' | 'unknown' => {
  const outerUv =
    key === 'TL'
      ? { x: 0, y: 0 }
      : key === 'TR'
        ? { x: 1, y: 0 }
        : key === 'BR'
          ? { x: 1, y: 1 }
          : { x: 0, y: 1 };
  const toward = { x: 0.5 - outerUv.x, y: 0.5 - outerUv.y };
  const lumas: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * maxInsetUv;
    const p = applyH(HuvToImg, {
      x: Math.max(0, Math.min(1, outerUv.x + toward.x * 2 * t)),
      y: Math.max(0, Math.min(1, outerUv.y + toward.y * 2 * t)),
    });
    lumas.push(lumaAt(img, p.x, p.y));
  }
  const grads: { t: number; g: number }[] = [];
  for (let i = 1; i < lumas.length - 1; i++) {
    grads.push({
      t: (i / steps) * maxInsetUv,
      g: Math.abs(lumas[i + 1]! - lumas[i - 1]!) / 2,
    });
  }
  const maxG = Math.max(...grads.map(g => g.g), 1e-6);
  const peaks = grads
    .filter((g, i) => {
      if (g.g < 0.4 * maxG) return false;
      return g.g >= (grads[i - 1]?.g ?? 0) && g.g >= (grads[i + 1]?.g ?? 0);
    })
    .sort((a, b) => b.g - a.g);
  if (!peaks.length) return 'unknown';
  const near = peaks.find(p => p.t <= 0.012);
  const mid = peaks.find(p => p.t > 0.012 && p.t <= maxInsetUv);
  // Sleeve outer: sharp locus near + inner card locus mid.
  if (near && mid && mid.g >= 0.45 * maxG) return 'sharp_outer';
  // Single near peak — treat as manufactured card corner on the seed.
  if (near && !mid) return 'rounded_physical';
  // Peak only inward of seed — card corner slightly inside a loose outer.
  if (mid && !near) return 'rounded_physical';
  if (near) return 'sharp_outer';
  return 'unknown';
};

/** Verify edge support along a UV-constant side of the proposed inner rect. */
const verifyEdgeUv = (
  img: ScanImage,
  HuvToImg: Float64Array,
  side: SideName,
  L: number,
  R: number,
  T: number,
  B: number,
  stations: number,
): { support: number; offsetUv: number } => {
  const samples: { o: number; g: number }[] = [];
  const span = 0.025;
  const nOff = 9;
  for (let si = 0; si < stations; si++) {
    const t = (si + 0.5) / stations;
    let u0 = 0;
    let v0 = 0;
    let nu = 0;
    let nv = 0;
    if (side === 'top') {
      u0 = L + (R - L) * t;
      v0 = T;
      nu = 0;
      nv = 1;
    } else if (side === 'bottom') {
      u0 = L + (R - L) * t;
      v0 = B;
      nu = 0;
      nv = -1;
    } else if (side === 'left') {
      u0 = L;
      v0 = T + (B - T) * t;
      nu = 1;
      nv = 0;
    } else {
      u0 = R;
      v0 = T + (B - T) * t;
      nu = -1;
      nv = 0;
    }
    const lumas: number[] = [];
    for (let k = 0; k < nOff; k++) {
      const o = -span + (2 * span * k) / (nOff - 1);
      const p = applyH(HuvToImg, {
        x: Math.max(0, Math.min(1, u0 + nu * o)),
        y: Math.max(0, Math.min(1, v0 + nv * o)),
      });
      lumas.push(lumaAt(img, p.x, p.y));
    }
    for (let k = 1; k < nOff - 1; k++) {
      const o = -span + (2 * span * k) / (nOff - 1);
      const g = Math.abs(lumas[k + 1]! - lumas[k - 1]!) / 2;
      const row = samples.find(s => Math.abs(s.o - o) < 1e-6);
      if (row) row.g += g;
      else samples.push({ o, g });
    }
  }
  for (const s of samples) s.g /= stations;
  const maxG = Math.max(...samples.map(s => s.g), 1e-6);
  let best = samples[0]!;
  for (const s of samples) if (s.g > best.g) best = s;
  return { support: best.g / maxG, offsetUv: best.o };
};

type InnerRect = { L: number; R: number; T: number; B: number };

/**
 * Fit one coherent inner AABB in UV from observed nested corners.
 * Missing sides inferred from typical sleeve gap — never from unrelated printed edges.
 */
const fitGlobalInnerRect = (hits: NestedHit[]): InnerRect | null => {
  if (!hits.length) return null;

  const lefts: number[] = [];
  const rights: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];
  const gapSamples: number[] = [];

  for (const h of hits) {
    if (h.key === 'TL') {
      lefts.push(h.u);
      tops.push(h.v);
      gapSamples.push(h.u, h.v);
    } else if (h.key === 'TR') {
      rights.push(h.u);
      tops.push(h.v);
      gapSamples.push(1 - h.u, h.v);
    } else if (h.key === 'BR') {
      rights.push(h.u);
      bottoms.push(h.v);
      gapSamples.push(1 - h.u, 1 - h.v);
    } else {
      lefts.push(h.u);
      bottoms.push(h.v);
      gapSamples.push(h.u, 1 - h.v);
    }
  }

  const typicalGap = Math.max(0.004, Math.min(0.04, median(gapSamples)));

  // Prefer the outermost coherent observation per side (less shrink / anti-clip).
  let L = lefts.length ? Math.min(...lefts) : typicalGap;
  let R = rights.length ? Math.max(...rights) : 1 - typicalGap;
  let T = tops.length ? Math.min(...tops) : typicalGap;
  let B = bottoms.length ? Math.max(...bottoms) : 1 - typicalGap;

  // Fill missing sides from typical gap (global model — not independent rediscovery).
  if (!lefts.length) L = typicalGap;
  if (!rights.length) R = 1 - typicalGap;
  if (!tops.length) T = typicalGap;
  if (!bottoms.length) B = 1 - typicalGap;

  // Plausibility: keep nested and card-sized. Allow top-opening-scale gaps
  // on any side from diagonal sampling noise; reject only gross internal frames.
  const maxGap = MAX_PLAUSIBLE_TOP_INSET + 0.012;
  if (L < 0.002 || T < 0.002 || R > 0.998 || B > 0.998) return null;
  if (R - L < 0.7 || B - T < 0.7) return null;
  if (L > maxGap || 1 - R > maxGap || T > maxGap || 1 - B > maxGap) return null;

  // Soft-clamp to side-plausible after fit — keeps one coherent rect.
  const clampSide = (g: number, isTop: boolean) =>
    Math.min(g, isTop ? MAX_PLAUSIBLE_TOP_INSET : MAX_PLAUSIBLE_SIDE_INSET);
  L = clampSide(L, false);
  R = 1 - clampSide(1 - R, false);
  T = clampSide(T, true);
  B = 1 - clampSide(1 - B, false);
  if (R - L < 0.7 || B - T < 0.7) return null;

  return { L, R, T, B };
};

const padInnerRect = (r: InnerRect, pad: number): InnerRect => ({
  L: Math.max(0, r.L - pad),
  R: Math.min(1, r.R + pad),
  T: Math.max(0, r.T - pad),
  B: Math.min(1, r.B + pad),
});

const innerRectToPts = (r: InnerRect, HuvToImg: Float64Array): Point[] => [
  applyH(HuvToImg, { x: r.L, y: r.T }),
  applyH(HuvToImg, { x: r.R, y: r.T }),
  applyH(HuvToImg, { x: r.R, y: r.B }),
  applyH(HuvToImg, { x: r.L, y: r.B }),
];

const baseResult = (args: {
  corners: CardCorners;
  status: PhysicalRefineStatus;
  classification: BoundaryClassification;
  rejectionReason: RefineRejectionReason;
  reason: string;
  t0: number;
  cornerEvidence?: PhysicalRefineResult['cornerEvidence'];
  edgeEvidence?: PhysicalRefineResult['edgeEvidence'];
  confidence?: number;
  globalConsensusScore?: number;
  sleeveQuad?: CardCorners | null;
  physicalCardQuad?: CardCorners | null;
  selectedForCapture?: 'ORIGINAL' | 'PHYSICAL_CARD';
  insetsNorm?: EdgeInsets;
  insetsPx?: EdgeInsets;
  outwardPaddingApplied?: number;
}): PhysicalRefineResult => {
  const insetsNorm = args.insetsNorm ?? emptyInsets();
  const insetsPx = args.insetsPx ?? emptyInsets();
  const vals = SIDE_NAMES.map(s => insetsNorm[s]);
  const meanInset = vals.reduce((a, b) => a + b, 0) / 4;
  const maxInset = Math.max(...vals);
  const selected =
    args.selectedForCapture === 'PHYSICAL_CARD' && args.physicalCardQuad
      ? args.physicalCardQuad
      : args.corners;
  const cornerEvidence = args.cornerEvidence ?? {
    TL: 'NONE',
    TR: 'NONE',
    BR: 'NONE',
    BL: 'NONE',
  };
  const edgeEvidence = args.edgeEvidence ?? {
    top: 'NONE',
    right: 'NONE',
    bottom: 'NONE',
    left: 'NONE',
  };
  return {
    status: args.status,
    classification: args.classification,
    boundaryModel: args.classification,
    outerCandidateQuad: args.corners,
    originalQuad: args.corners,
    sleeveQuad: args.sleeveQuad ?? null,
    physicalCardQuad: args.physicalCardQuad ?? null,
    refinedQuad: args.physicalCardQuad ?? null,
    selectedQuad: selected,
    selectedForCapture: args.selectedForCapture ?? 'ORIGINAL',
    captureSelectedQuad: selected,
    refinementMs: nowMs() - args.t0,
    cornerEvidence,
    edgeEvidence,
    physicalEdgeSupport: emptyInsets(),
    sleeveToCardInset: insetsNorm,
    edgeInsetNormalized: insetsNorm,
    edgeInsetPixels: insetsPx,
    sleeveInset: insetsNorm,
    meanInset,
    maxInset,
    sleeveLike: args.classification === 'SLEEVED_CARD' || args.classification === 'SLEEVE_SUSPECTED',
    globalConsensusScore: args.globalConsensusScore ?? 0,
    outwardPaddingApplied: args.outwardPaddingApplied ?? 0,
    confidence: args.confidence ?? 0,
    reason: args.reason,
    rejectionReason: args.rejectionReason,
  };
};

/**
 * Global dual-boundary refine. Fail closed — default keeps original selected.
 * Local ROIs only; no full-frame processing.
 */
export const refinePhysicalCardBoundary = (args: {
  image: ScanImage;
  corners: CardCorners | null;
  candidateRole?: string | null;
  force?: boolean;
  frame?: { width: number; height: number };
}): PhysicalRefineResult => {
  const t0 = nowMs();
  if (!args.corners) {
    const z = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    };
    return baseResult({
      corners: z,
      status: 'NO_REFINEMENT',
      classification: 'UNKNOWN',
      rejectionReason: 'NO_GEOMETRY',
      reason: 'no_geometry',
      t0,
    });
  }

  const img = args.image;
  if (!(img.width > 8 && img.height > 8) || !img.data?.length) {
    return baseResult({
      corners: args.corners,
      status: 'NO_REFINEMENT',
      classification: 'UNKNOWN',
      rejectionReason: 'NO_IMAGE',
      reason: 'no_image',
      t0,
    });
  }

  const frame = args.frame ?? { width: img.width, height: img.height };
  const pts0 = cornersToPts(args.corners);
  const minSide = Math.min(
    dist(pts0[0]!, pts0[1]!),
    dist(pts0[1]!, pts0[2]!),
    dist(pts0[2]!, pts0[3]!),
    dist(pts0[3]!, pts0[0]!),
  );
  if (minSide < 24) {
    return baseResult({
      corners: args.corners,
      status: 'NO_REFINEMENT',
      classification: 'UNKNOWN',
      rejectionReason: 'CORNER_FRAGMENT',
      reason: 'quad_too_small',
      t0,
    });
  }

  const occ = quadOccupancy(args.corners, frame);
  if (occ >= BAD_SEED_OCCUPANCY) {
    return baseResult({
      corners: args.corners,
      status: 'BAD_SEED',
      classification: 'BAD_SEED',
      rejectionReason: 'BAD_SEED',
      reason: `occupancy=${occ.toFixed(3)}>=${BAD_SEED_OCCUPANCY}`,
      t0,
      confidence: 0.1,
    });
  }

  let HuvToImg: Float64Array;
  try {
    HuvToImg = homographyDestToSrc(pts0 as Quad, UNIT_QUAD);
  } catch {
    return baseResult({
      corners: args.corners,
      status: 'NO_REFINEMENT',
      classification: 'UNKNOWN',
      rejectionReason: 'NO_GEOMETRY',
      reason: 'homography_failed',
      t0,
    });
  }

  const maxInsetUv = Math.max(MAX_PLAUSIBLE_TOP_INSET, MAX_PLAUSIBLE_SIDE_INSET) + 0.01;
  const steps = 14;

  const hits: NestedHit[] = [];
  const outerClass: Record<CornerKey, 'rounded_physical' | 'sharp_outer' | 'unknown'> = {
    TL: 'unknown',
    TR: 'unknown',
    BR: 'unknown',
    BL: 'unknown',
  };
  for (const key of CORNER_KEYS) {
    outerClass[key] = classifyOuterCorner(img, HuvToImg, key, maxInsetUv, steps);
    const hit = observeNestedCorner(img, HuvToImg, key, maxInsetUv, steps);
    // Nested sleeve evidence requires sharp outer plastic + inner rounded card.
    // Skip corners that already look like manufactured card rounds on the seed.
    if (
      hit &&
      hit.strength >= 0.45 &&
      (hit.outerSharp || outerClass[key] === 'sharp_outer') &&
      outerClass[key] !== 'rounded_physical'
    ) {
      hits.push(hit);
    }
  }

  const nestedN = hits.length;
  const outerRoundedN = CORNER_KEYS.filter(k => outerClass[k] === 'rounded_physical').length;

  // Unsleved: rounded manufactured corners on the outer seed, without a
  // coherent nested sleeve pair. If outer looks rounded AND we only have
  // weak/absent nest evidence, keep the seed (printed frames ≠ sleeve).
  if (outerRoundedN >= 2 && nestedN < MIN_ROUNDED_CORNERS_FOR_PHYSICAL) {
    const ce: PhysicalRefineResult['cornerEvidence'] = {
      TL: outerClass.TL === 'rounded_physical' ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      TR: outerClass.TR === 'rounded_physical' ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      BR: outerClass.BR === 'rounded_physical' ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      BL: outerClass.BL === 'rounded_physical' ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
    };
    return baseResult({
      corners: args.corners,
      status: 'CARD_BOUNDARY_CONFIRMED',
      classification: 'UNSLEEVED_CARD',
      rejectionReason: 'NONE',
      reason: nestedN > 0 ? 'outer_rounded_weak_nest' : 'outer_rounded_physical',
      t0,
      cornerEvidence: ce,
      confidence: 0.7,
      globalConsensusScore: 0.7,
      physicalCardQuad: args.corners,
    });
  }

  if (nestedN === 0) {
    return baseResult({
      corners: args.corners,
      status: 'NO_REFINEMENT',
      classification: outerRoundedN >= 1 ? 'UNSLEEVED_CARD' : 'UNKNOWN',
      rejectionReason: 'NO_ROUNDED_CORNERS',
      reason: 'no_nested_corners',
      t0,
      cornerEvidence: {
        TL: outerClass.TL === 'sharp_outer' ? 'OUTER_ONLY' : 'NONE',
        TR: outerClass.TR === 'sharp_outer' ? 'OUTER_ONLY' : 'NONE',
        BR: outerClass.BR === 'sharp_outer' ? 'OUTER_ONLY' : 'NONE',
        BL: outerClass.BL === 'sharp_outer' ? 'OUTER_ONLY' : 'NONE',
      },
      confidence: 0.15,
    });
  }

  // SLEEVE PRESENT from ≥1 nested outer+inner (prefer ≥2 for accept).
  const rect0 = fitGlobalInnerRect(hits);
  if (!rect0) {
    return baseResult({
      corners: args.corners,
      status: 'AMBIGUOUS',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: 'INSUFFICIENT_CONSENSUS',
      reason: `nested=${nestedN}_fit_failed`,
      t0,
      cornerEvidence: {
        TL: hits.some(h => h.key === 'TL') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
        TR: hits.some(h => h.key === 'TR') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
        BR: hits.some(h => h.key === 'BR') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
        BL: hits.some(h => h.key === 'BL') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      },
      sleeveQuad: args.corners,
      confidence: 0.3,
      globalConsensusScore: 0.3,
    });
  }

  const insetsNorm: EdgeInsets = {
    top: rect0.T,
    right: 1 - rect0.R,
    bottom: 1 - rect0.B,
    left: rect0.L,
  };
  const meanInset = SIDE_NAMES.reduce((s, k) => s + insetsNorm[k], 0) / 4;
  const maxInset = Math.max(...SIDE_NAMES.map(s => insetsNorm[s]));

  if (
    meanInset > MAX_PLAUSIBLE_SIDE_INSET + 0.008 ||
    insetsNorm.right > MAX_PLAUSIBLE_SIDE_INSET + 0.008 ||
    insetsNorm.bottom > MAX_PLAUSIBLE_SIDE_INSET + 0.008 ||
    insetsNorm.left > MAX_PLAUSIBLE_SIDE_INSET + 0.008 ||
    insetsNorm.top > MAX_PLAUSIBLE_TOP_INSET + 0.008
  ) {
    const ce: PhysicalRefineResult['cornerEvidence'] = {
      TL: hits.some(h => h.key === 'TL') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      TR: hits.some(h => h.key === 'TR') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      BR: hits.some(h => h.key === 'BR') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
      BL: hits.some(h => h.key === 'BL') ? 'INNER_ROUNDED_OBSERVED' : 'OUTER_ONLY',
    };
    return baseResult({
      corners: args.corners,
      status: 'INTERNAL_EDGE_REJECTED',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: meanInset > 0.05 ? 'LARGE_INSET' : 'INTERNAL_EDGE',
      reason: `meanInset=${meanInset.toFixed(3)} max=${maxInset.toFixed(3)}`,
      t0,
      cornerEvidence: ce,
      insetsNorm,
      sleeveQuad: args.corners,
      confidence: 0.25,
      globalConsensusScore: 0.25,
    });
  }

  // Verify predicted perimeter locally (same global model — not new rectangles).
  const edgeEvidence: PhysicalRefineResult['edgeEvidence'] = {
    top: 'NONE',
    right: 'NONE',
    bottom: 'NONE',
    left: 'NONE',
  };
  const edgeSupport: EdgeInsets = emptyInsets();
  let verifiedEdges = 0;
  for (const side of SIDE_NAMES) {
    const { support } = verifyEdgeUv(
      img,
      HuvToImg,
      side,
      rect0.L,
      rect0.R,
      rect0.T,
      rect0.B,
      8,
    );
    edgeSupport[side] = support;
    const observedSide =
      (side === 'top' && hits.some(h => h.key === 'TL' || h.key === 'TR')) ||
      (side === 'bottom' && hits.some(h => h.key === 'BL' || h.key === 'BR')) ||
      (side === 'left' && hits.some(h => h.key === 'TL' || h.key === 'BL')) ||
      (side === 'right' && hits.some(h => h.key === 'TR' || h.key === 'BR'));
    if (support >= 0.55) {
      edgeEvidence[side] = observedSide ? 'VERIFIED' : 'VERIFIED';
      verifiedEdges += 1;
    } else if (observedSide) {
      edgeEvidence[side] = 'OBSERVED';
    } else {
      edgeEvidence[side] = 'PREDICTED';
    }
  }

  const cornerEvidence: PhysicalRefineResult['cornerEvidence'] = {
    TL: 'NONE',
    TR: 'NONE',
    BR: 'NONE',
    BL: 'NONE',
  };
  for (const key of CORNER_KEYS) {
    if (hits.some(h => h.key === key)) {
      cornerEvidence[key] = 'INNER_ROUNDED_OBSERVED';
    } else if (outerClass[key] === 'sharp_outer') {
      // Predicted from global model — try local verify near predicted UV corner.
      const pu =
        key === 'TL' || key === 'BL' ? rect0.L : rect0.R;
      const pv =
        key === 'TL' || key === 'TR' ? rect0.T : rect0.B;
      const p = applyH(HuvToImg, { x: pu, y: pv });
      // Tiny ROI gradient check
      const g =
        Math.abs(lumaAt(img, p.x + 1, p.y) - lumaAt(img, p.x - 1, p.y)) +
        Math.abs(lumaAt(img, p.x, p.y + 1) - lumaAt(img, p.x, p.y - 1));
      cornerEvidence[key] = g > 8 ? 'INNER_VERIFIED' : 'INNER_PREDICTED';
    } else {
      cornerEvidence[key] = 'INNER_PREDICTED';
    }
  }

  const verifiedCorners = CORNER_KEYS.filter(
    k =>
      cornerEvidence[k] === 'INNER_ROUNDED_OBSERVED' || cornerEvidence[k] === 'INNER_VERIFIED',
  ).length;

  // Consensus — require ≥2 observed nested corners (no half-sleeved invent from 1).
  // Path A: 2+ nested + ≥2 verified edges + mean inset in band
  // Path B: 2+ nested with 1 very strong + ≥3 verified edges (asymmetric occlusion)
  const strongOne = hits.some(h => h.strength >= 0.7);
  const pathA =
    nestedN >= MIN_ROUNDED_CORNERS_FOR_PHYSICAL &&
    verifiedEdges >= 2 &&
    meanInset >= MIN_MEAN_SLEEVE_INSET &&
    meanInset <= 0.032;
  const pathB =
    nestedN >= MIN_ROUNDED_CORNERS_FOR_PHYSICAL &&
    strongOne &&
    verifiedEdges >= 3 &&
    meanInset >= MIN_MEAN_SLEEVE_INSET &&
    meanInset <= 0.032;

  let consensus =
    0.2 * nestedN +
    0.12 * verifiedEdges +
    0.1 * verifiedCorners +
    (meanInset >= MIN_MEAN_SLEEVE_INSET && meanInset <= MAX_PLAUSIBLE_SIDE_INSET + 0.006
      ? 0.15
      : 0) +
    (pathA || pathB ? 0.25 : 0);
  consensus = Math.min(0.95, consensus);
  if (!pathA && !pathB) {
    consensus = Math.min(consensus, MIN_GLOBAL_CONSENSUS - 0.05);
  }

  if (!pathA && !pathB) {
    return baseResult({
      corners: args.corners,
      status: 'AMBIGUOUS',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: 'INSUFFICIENT_CONSENSUS',
      reason: `nested=${nestedN};verifiedEdges=${verifiedEdges};consensus=${consensus.toFixed(2)}`,
      t0,
      cornerEvidence,
      edgeEvidence,
      insetsNorm,
      sleeveQuad: args.corners,
      // Do NOT attach a partial physicalCardQuad for capture — fail closed.
      confidence: consensus,
      globalConsensusScore: consensus,
    });
  }

  const pad = PHYSICAL_OUTWARD_PAD;
  const rectPad = padInnerRect(rect0, pad);
  // Keep pad smaller than sleeve gap.
  const gapMin = Math.min(rect0.L, 1 - rect0.R, rect0.T, 1 - rect0.B);
  const safePad = Math.min(pad, Math.max(0, gapMin * 0.45));
  const rect = safePad < pad ? padInnerRect(rect0, safePad) : rectPad;
  const outwardApplied = Math.min(pad, safePad);

  const pts = innerRectToPts(rect, HuvToImg);
  if (!isConvexPts(pts)) {
    return baseResult({
      corners: args.corners,
      status: 'AMBIGUOUS',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: 'NON_CONVEX',
      reason: 'refined_non_convex',
      t0,
      cornerEvidence,
      edgeEvidence,
      insetsNorm,
      sleeveQuad: args.corners,
      confidence: 0.2,
      globalConsensusScore: consensus,
    });
  }

  const area0 = quadAreaPts(pts0);
  const area1 = quadAreaPts(pts);
  if (area1 < area0 * MIN_PHYSICAL_AREA_FRAC) {
    return baseResult({
      corners: args.corners,
      status: 'AMBIGUOUS',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: 'CORNER_FRAGMENT',
      reason: `areaFrac=${(area1 / area0).toFixed(3)}`,
      t0,
      cornerEvidence,
      edgeEvidence,
      insetsNorm,
      sleeveQuad: args.corners,
      confidence: 0.2,
      globalConsensusScore: consensus,
    });
  }

  const aspect0 = aspectOfPts(pts0);
  const aspect1 = aspectOfPts(pts);
  const err0 = Math.abs(aspect0 - CARD_ASPECT) / CARD_ASPECT;
  const err1 = Math.abs(aspect1 - CARD_ASPECT) / CARD_ASPECT;
  if (err1 > 0.45 && err1 > err0 + 0.06) {
    return baseResult({
      corners: args.corners,
      status: 'AMBIGUOUS',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: 'ASPECT_REGRESSED',
      reason: 'aspect_regressed',
      t0,
      cornerEvidence,
      edgeEvidence,
      insetsNorm,
      sleeveQuad: args.corners,
      confidence: 0.25,
      globalConsensusScore: consensus,
    });
  }

  if (consensus < MIN_GLOBAL_CONSENSUS) {
    return baseResult({
      corners: args.corners,
      status: 'AMBIGUOUS',
      classification: 'SLEEVE_SUSPECTED',
      rejectionReason: 'INSUFFICIENT_CONSENSUS',
      reason: `low_consensus=${consensus.toFixed(2)}`,
      t0,
      cornerEvidence,
      edgeEvidence,
      insetsNorm,
      sleeveQuad: args.corners,
      confidence: consensus,
      globalConsensusScore: consensus,
    });
  }

  const physical = ptsToCorners(pts);
  const insetsPx: EdgeInsets = {
    top: insetsNorm.top * minSide,
    right: insetsNorm.right * minSide,
    bottom: insetsNorm.bottom * minSide,
    left: insetsNorm.left * minSide,
  };

  return {
    ...baseResult({
      corners: args.corners,
      status: 'SLEEVED_CARD_DUAL',
      classification: 'SLEEVED_CARD',
      rejectionReason: 'NONE',
      reason: `global nested=${nestedN};edges=${verifiedEdges};consensus=${consensus.toFixed(2)};pad=${outwardApplied.toFixed(3)}`,
      t0,
      cornerEvidence,
      edgeEvidence,
      confidence: consensus,
      globalConsensusScore: consensus,
      insetsNorm,
      insetsPx,
      sleeveQuad: args.corners,
      physicalCardQuad: physical,
      selectedForCapture: 'PHYSICAL_CARD',
      outwardPaddingApplied: outwardApplied,
    }),
    physicalEdgeSupport: edgeSupport,
  };
};
