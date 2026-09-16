/**
 * Frozen capture provenance + warp input validation for Single Scan forensics.
 * Evidence-first — no product-threshold changes.
 */

import { CARD_ASPECT, CARD_HEIGHT, CARD_WIDTH, cornersToQuad, type Quad } from '../geometry';
import type { CardCorners, Point, ScanImage } from '../types';

export const SINGLE_SCAN_DIAGNOSTIC_VERSION = 2;
export const MAPPING_VERSION = 'same-fov-v1';
export const WARP_VERSION = 'warpQuadToCard-v1';
export const CAPTURE_PIPELINE_VERSION = 'geometry-v2';

export type QuadSelectionSource =
  | 'RAW_SELECTED'
  | 'HYSTERESIS_SELECTED'
  | 'HYSTERESIS_INCUMBENT'
  | 'BEST_RECENT_SAFE'
  | 'FINAL_CONFIRM_FRAME'
  | 'OTHER';

export type WarpInputStatus = 'OK' | 'WARP_INPUT_INVALID';
export type WarpSuspectStatus = 'OK' | 'WARP_SUSPECT';

export type GeometryFailureClass =
  | 'OK'
  | 'ANALYSIS_QUAD_TIGHT'
  | 'SOURCE_PROJECTION_SUSPECT'
  | 'SOURCE_POSE_MISMATCH'
  | 'WARP_SUSPECT'
  | 'WARP_ERROR'
  | 'UNKNOWN';

export type FrozenCaptureProvenance = {
  attemptId: number;
  cardSessionId: number;
  captureId: number;

  analysisDimensions: { width: number; height: number } | null;
  sourceDimensions: { width: number; height: number };

  /** Detector-space quad frozen at lock (immutable after capture request). */
  analysisQuad: CardCorners | null;
  /** Source-space quad actually used for warp. */
  projectedSourceQuad: CardCorners;

  mappingKind: 'same-fov' | 'oriented-full' | 'other';
  mappingVersion: string;
  warpVersion: string;
  capturePipelineVersion: string;

  orientation: string | null;
  rotation: number | null;
  mirror: boolean;

  quadSelectionSource: QuadSelectionSource;
  candidateScore: number | null;
  captureSafe: boolean | null;

  selectedQuadAt: number | null;
  captureRequestedAt: number | null;
  captureDoneAt: number | null;
  sourceAvailableAt: number | null;
  warpStartedAt: number | null;
  warpDoneAt: number | null;

  /** captureRequestedAt - selectedQuadAt */
  quadAgeAtCaptureMs: number | null;
  /** sourceAvailableAt - captureRequestedAt */
  captureLatencyMs: number | null;
  /** sourceAvailableAt - selectedQuadAt */
  sourceVsQuadAgeMs: number | null;

  warpInputStatus: WarpInputStatus;
  warpSuspectStatus: WarpSuspectStatus;
  warpSuspectReasons: string[];
  geometryFailureClass: GeometryFailureClass;

  /** Telemetry for right-edge clip classification. */
  analysisMinMarginNorm?: number | null;
  sourceMinMarginPx?: number | null;
};

export type RecognitionQuadArtifact = FrozenCaptureProvenance & {
  kind: 'recognition-quad';
  singleScanDiagnosticVersion: number;
};

const finitePt = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

const quadArea = (q: Quad): number => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const r = q[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

const isConvex = (q: Quad): boolean => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const z = cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
    if (Math.abs(z) < 1e-6) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return true;
};

const segmentsIntersect = (
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const den = cross(abx, aby, cdx, cdy);
  if (Math.abs(den) < 1e-9) return false;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const t = cross(acx, acy, cdx, cdy) / den;
  const u = cross(acx, acy, abx, aby) / den;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
};

const selfIntersects = (q: Quad): boolean =>
  segmentsIntersect(q[0]!, q[1]!, q[2]!, q[3]!) || segmentsIntersect(q[1]!, q[2]!, q[3]!, q[0]!);

/** Validate projected source quad before warp. */
export const validateWarpInput = (args: {
  quad: CardCorners;
  source: { width: number; height: number };
}): { status: WarpInputStatus; reasons: string[] } => {
  const reasons: string[] = [];
  const c = args.quad;
  const pts = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  if (!pts.every(finitePt)) reasons.push('non_finite');
  const q = cornersToQuad(c);
  if (!isConvex(q)) reasons.push('non_convex');
  if (selfIntersects(q)) reasons.push('self_intersect');
  const area = quadArea(q);
  const frameArea = Math.max(1, args.source.width * args.source.height);
  if (!(area > frameArea * 0.02)) reasons.push('area_too_small');
  if (area > frameArea * 0.98) reasons.push('area_too_large');
  let minMargin = Infinity;
  for (const p of pts) {
    const m = Math.min(p.x, p.y, args.source.width - p.x, args.source.height - p.y);
    minMargin = Math.min(minMargin, m);
  }
  if (minMargin < -2) reasons.push('substantially_oob');
  const top = Math.hypot(c.topRight.x - c.topLeft.x, c.topRight.y - c.topLeft.y);
  const left = Math.hypot(c.bottomLeft.x - c.topLeft.x, c.bottomLeft.y - c.topLeft.y);
  if (top > 1 && left > 1) {
    const aspect = top / left;
    if (aspect < CARD_ASPECT * 0.35 || aspect > CARD_ASPECT * 2.8) reasons.push('aspect_implausible');
  }
  // TL should be leftmost-topish relative to BR (soft ordering check).
  if (c.topLeft.y > c.bottomLeft.y + 20 || c.topRight.y > c.bottomRight.y + 20) {
    reasons.push('corner_order_suspect');
  }
  return {
    status: reasons.length ? 'WARP_INPUT_INVALID' : 'OK',
    reasons,
  };
};

/** Post-warp diagnostic only — not a product gate. */
export const assessWarpSuspect = (args: {
  warp: ScanImage;
  sourceQuad: CardCorners;
  source: { width: number; height: number };
}): { status: WarpSuspectStatus; reasons: string[] } => {
  const reasons: string[] = [];
  if (args.warp.width !== CARD_WIDTH || args.warp.height !== CARD_HEIGHT) {
    reasons.push(`dims_${args.warp.width}x${args.warp.height}`);
  }
  const aspect = args.warp.width / Math.max(1, args.warp.height);
  if (Math.abs(aspect - CARD_ASPECT) > 0.08) reasons.push('warp_aspect');
  const q = cornersToQuad(args.sourceQuad);
  const area = quadArea(q);
  const frameArea = Math.max(1, args.source.width * args.source.height);
  const occ = area / frameArea;
  // Catastrophic strip: source polygon was tiny but we still filled 744×1039.
  if (occ < 0.08) reasons.push('source_poly_tiny');
  // Sample edge variance — blank/uniform warps look like strip failures.
  let edgeSum = 0;
  let edgeN = 0;
  const { data, width, height } = args.warp;
  for (let x = 0; x < width; x += 8) {
    for (const y of [2, height - 3]) {
      const i = (y * width + x) * 4;
      edgeSum += data[i]! + data[i + 1]! + data[i + 2]!;
      edgeN += 1;
    }
  }
  const edgeMean = edgeN ? edgeSum / (edgeN * 3) : 0;
  let varSum = 0;
  for (let x = 0; x < width; x += 8) {
    for (const y of [2, height - 3]) {
      const i = (y * width + x) * 4;
      const v = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      varSum += (v - edgeMean) ** 2;
    }
  }
  const edgeVar = edgeN ? varSum / edgeN : 0;
  if (edgeVar < 8) reasons.push('near_blank_edges');
  return { status: reasons.length ? 'WARP_SUSPECT' : 'OK', reasons };
};

export const classifyGeometryFailure = (args: {
  warpInput: WarpInputStatus;
  warpSuspect: WarpSuspectStatus;
  analysisMinMarginNorm: number | null;
  sourceMinMarginPx: number | null;
  sourceVsQuadAgeMs: number | null;
}): GeometryFailureClass => {
  if (args.warpInput === 'WARP_INPUT_INVALID') return 'WARP_ERROR';
  if (args.warpSuspect === 'WARP_SUSPECT') return 'WARP_SUSPECT';
  if (args.analysisMinMarginNorm != null && args.analysisMinMarginNorm < 0.03) {
    return 'ANALYSIS_QUAD_TIGHT';
  }
  if (args.sourceMinMarginPx != null && args.sourceMinMarginPx < 40) {
    return 'SOURCE_PROJECTION_SUSPECT';
  }
  if (args.sourceVsQuadAgeMs != null && args.sourceVsQuadAgeMs > 350) {
    return 'SOURCE_POSE_MISMATCH';
  }
  return 'OK';
};

export const buildRecognitionQuadArtifact = (
  p: FrozenCaptureProvenance,
): RecognitionQuadArtifact => ({
  kind: 'recognition-quad',
  singleScanDiagnosticVersion: SINGLE_SCAN_DIAGNOSTIC_VERSION,
  ...p,
});

export const msDelta = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a != null && b != null ? Math.max(0, b - a) : null;

/** Deep-ish clone of corners so later detector ticks cannot mutate frozen capture. */
export const freezeCorners = (c: CardCorners): CardCorners => ({
  topLeft: { x: c.topLeft.x, y: c.topLeft.y },
  topRight: { x: c.topRight.x, y: c.topRight.y },
  bottomRight: { x: c.bottomRight.x, y: c.bottomRight.y },
  bottomLeft: { x: c.bottomLeft.x, y: c.bottomLeft.y },
});
