/**
 * Capture readiness for Geometry Test.
 *
 * DETECTED (live polygon) stays immediate.
 * CAPTURE_SAFE is a separate, cheap gate before 2–3-frame lock / freeze / capture.
 * No OCR / recognition.
 */

import { CARD_ASPECT, cornersToQuad, dist, type Quad } from '../geometry';
import type { CardCorners } from '../types';

/** Normalized inset from each frame edge (fraction of min(w,h)). */
export const CAPTURE_SAFE_EDGE_MARGIN = 0.025;

/** Quad area / frame area floors — useful detail without filling the sensor. */
export const CAPTURE_SAFE_MIN_OCCUPANCY = 0.12;
export const CAPTURE_SAFE_MAX_OCCUPANCY = 0.82;

/**
 * Perspective-tolerant aspect error vs 63:88.
 * Looser than MTG fast-accept — allow skew, reject only extreme projective shapes.
 */
export const CAPTURE_SAFE_MAX_ASPECT_ERR = 0.42;

/** Opposite-side length ratio above this ⇒ extreme foreshortening. */
export const CAPTURE_SAFE_MAX_SIDE_RATIO = 2.6;

export type CaptureUnsafeReason =
  | 'no_geometry'
  | 'out_of_frame'
  | 'near_edge'
  /** Predicted hi-res source margin too thin (independent of analysis 2.5%). */
  | 'source_near_edge'
  | 'too_small'
  | 'too_large'
  | 'extreme_angle'
  | 'non_convex'
  | 'weak_support';

export type CaptureSafeVerdict = {
  captureSafe: boolean;
  reasons: CaptureUnsafeReason[];
  /** Minimal operator-facing line (empty when safe). */
  message: string;
  occupancy: number | null;
  aspect: number | null;
  minEdgeMarginNorm: number | null;
  /** Alias for telemetry naming. */
  minCornerMarginNormalized: number | null;
  minCornerMarginPixelsAnalysis: number | null;
  maxOppositeSideRatio: number | null;
};

/** Telemetry-only corner margin vs a frame (analysis or source). No gate. */
export const cornerMarginMetrics = (args: {
  corners: CardCorners | null;
  frame: { width: number; height: number };
}): {
  minCornerMarginNormalized: number | null;
  minCornerMarginPixels: number | null;
} => {
  if (!args.corners) return { minCornerMarginNormalized: null, minCornerMarginPixels: null };
  const w = args.frame.width;
  const h = args.frame.height;
  if (!(w > 1 && h > 1)) {
    return { minCornerMarginNormalized: null, minCornerMarginPixels: null };
  }
  const q = cornersToQuad(args.corners);
  const minDim = Math.min(w, h);
  let minPx = Infinity;
  for (const p of q) {
    const m = Math.min(p.x, p.y, w - p.x, h - p.y);
    minPx = Math.min(minPx, m);
  }
  if (!Number.isFinite(minPx)) {
    return { minCornerMarginNormalized: null, minCornerMarginPixels: null };
  }
  return {
    minCornerMarginNormalized: minPx / minDim,
    minCornerMarginPixels: minPx,
  };
};

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
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z === 0) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
};

const perspectiveAspect = (q: Quad): number | null => {
  const top = dist(q[0], q[1]);
  const bottom = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  if (h < 1e-3) return null;
  return w / h;
};

const oppositeSideRatio = (q: Quad): number => {
  const top = dist(q[0], q[1]);
  const bottom = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const tb = Math.max(top, bottom) / Math.max(1e-3, Math.min(top, bottom));
  const lr = Math.max(left, right) / Math.max(1e-3, Math.min(left, right));
  return Math.max(tb, lr);
};

/** Map internal reasons → short Geometry Test HUD copy. */
export const captureSafeMessage = (reasons: CaptureUnsafeReason[]): string => {
  if (!reasons.length) return '';
  if (reasons.includes('no_geometry')) return 'WAITING FOR GEOMETRY';
  if (reasons.includes('out_of_frame')) return 'MOVE CARD INTO FRAME';
  if (reasons.includes('near_edge') || reasons.includes('source_near_edge')) {
    return 'TOO CLOSE TO EDGE';
  }
  if (reasons.includes('extreme_angle') || reasons.includes('non_convex')) {
    return 'ANGLE TOO EXTREME';
  }
  if (reasons.includes('too_small')) return 'CARD TOO SMALL';
  if (reasons.includes('too_large') || reasons.includes('weak_support')) {
    return 'MOVE CARD INTO FRAME';
  }
  return 'WAITING FOR GEOMETRY';
};

/**
 * Cheap capture-readiness check in detector/analysis pixel space.
 * Does not mutate geometry and does not touch recognition.
 *
 * `edgeMarginNorm` overrides CAPTURE_SAFE_EDGE_MARGIN for host counterfactuals / tests only.
 */
export const evaluateCaptureSafe = (args: {
  corners: CardCorners | null;
  frame: { width: number; height: number };
  /** Override near_edge inset (fraction of min(w,h)). Default: CAPTURE_SAFE_EDGE_MARGIN. */
  edgeMarginNorm?: number;
}): CaptureSafeVerdict => {
  const empty = (reasons: CaptureUnsafeReason[]): CaptureSafeVerdict => ({
    captureSafe: false,
    reasons,
    message: captureSafeMessage(reasons),
    occupancy: null,
    aspect: null,
    minEdgeMarginNorm: null,
    minCornerMarginNormalized: null,
    minCornerMarginPixelsAnalysis: null,
    maxOppositeSideRatio: null,
  });

  if (!args.corners) return empty(['no_geometry']);
  const w = args.frame.width;
  const h = args.frame.height;
  if (!(w > 1 && h > 1)) return empty(['no_geometry']);

  const q = cornersToQuad(args.corners);
  const reasons: CaptureUnsafeReason[] = [];
  const minDim = Math.min(w, h);
  const edgeMargin =
    typeof args.edgeMarginNorm === 'number' && Number.isFinite(args.edgeMarginNorm)
      ? args.edgeMarginNorm
      : CAPTURE_SAFE_EDGE_MARGIN;
  const marginPx = edgeMargin * minDim;

  let minEdgeMarginNorm: number | null = Infinity;
  let minCornerMarginPixelsAnalysis: number | null = Infinity;
  let outOfFrame = false;
  let nearEdge = false;
  for (const p of q) {
    if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) outOfFrame = true;
    const m = Math.min(p.x, p.y, w - p.x, h - p.y);
    minCornerMarginPixelsAnalysis = Math.min(minCornerMarginPixelsAnalysis ?? Infinity, m);
    minEdgeMarginNorm = Math.min(minEdgeMarginNorm ?? Infinity, m / minDim);
    if (m < marginPx) nearEdge = true;
  }
  if (minEdgeMarginNorm == null || !Number.isFinite(minEdgeMarginNorm)) minEdgeMarginNorm = null;
  if (
    minCornerMarginPixelsAnalysis == null ||
    !Number.isFinite(minCornerMarginPixelsAnalysis)
  ) {
    minCornerMarginPixelsAnalysis = null;
  }

  // HARD GATE: true out-of-frame always blocks, independent of near_edge threshold.
  if (outOfFrame) reasons.push('out_of_frame');
  else if (nearEdge) reasons.push('near_edge');

  if (!isConvex(q)) reasons.push('non_convex');

  const occupancy = quadArea(q) / (w * h);
  if (occupancy < CAPTURE_SAFE_MIN_OCCUPANCY) reasons.push('too_small');
  if (occupancy > CAPTURE_SAFE_MAX_OCCUPANCY) reasons.push('too_large');

  const aspect = perspectiveAspect(q);
  const sideRatio = oppositeSideRatio(q);
  if (aspect == null) {
    reasons.push('extreme_angle');
  } else {
    const err = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;
    if (err > CAPTURE_SAFE_MAX_ASPECT_ERR) reasons.push('extreme_angle');
  }
  if (sideRatio > CAPTURE_SAFE_MAX_SIDE_RATIO) {
    if (!reasons.includes('extreme_angle')) reasons.push('extreme_angle');
    reasons.push('weak_support');
  }

  // Deduplicate while preserving order.
  const uniq: CaptureUnsafeReason[] = [];
  for (const r of reasons) {
    if (!uniq.includes(r)) uniq.push(r);
  }

  return {
    captureSafe: uniq.length === 0,
    reasons: uniq,
    message: captureSafeMessage(uniq),
    occupancy,
    aspect,
    minEdgeMarginNorm,
    minCornerMarginNormalized: minEdgeMarginNorm,
    minCornerMarginPixelsAnalysis,
    maxOppositeSideRatio: sideRatio,
  };
};
