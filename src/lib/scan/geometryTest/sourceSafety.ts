/**
 * Source-space anti-clip gate for Geometry Test.
 *
 * Analysis CAPTURE_SAFE (2.5% of min dim) is necessary but not sufficient:
 * same-FOV map to ~1022×1920 can leave only ~27–42 px of real margin on
 * clipped captures, while comfortable ones land ~148–162 px.
 *
 * Calibrated on geometry-test-20260910-165339:
 *   clip band ≈ 27–42 px (#1/#4/#9); #10@88; #3 clipped despite 177 (wrong quad)
 *   good band ≈ 148–162 (#6/#7/#8); #2@41 was lip-lucky
 * Counterfactual: thr 56 rejects lip clips + borderline #2 (correct — wait),
 * keeps comfortable goods. Does not fix high-margin wrong-geometry clips (#3).
 *
 * Does NOT change CAPTURE_SAFE_EDGE_MARGIN (2.5%).
 */

import { cornersToQuad } from '../geometry';
import type { CardCorners, Point } from '../types';

/** Min predicted source corner margin (px) after analysis→source map. */
export const MIN_SOURCE_MARGIN_PX = 56;

/** Long-edge target for same-FOV snapshot prediction (matches mobile hi-res). */
export const PREDICTED_SOURCE_LONG_EDGE = 1920;

export type SourceCornerMargins = {
  TL: number;
  TR: number;
  BR: number;
  BL: number;
};

export type SourceSafetyVerdict = {
  sourceSafe: boolean;
  predictedSourceQuad: CardCorners | null;
  sourceCornerMarginsPx: SourceCornerMargins | null;
  minSourceMarginPx: number | null;
  /** Analysis-space mean corner jitter scaled to source px (confirm frames). */
  cornerJitterPx: number | null;
  /** minSourceMargin − cornerJitter (envelope). */
  effectiveSourceMarginPx: number | null;
  reason: string;
};

export type Size2D = { width: number; height: number };

/** Scale a size so max(w,h) == longEdge (same aspect). */
export const predictedSourceSizeFromDetector = (
  detector: Size2D,
  longEdge: number = PREDICTED_SOURCE_LONG_EDGE,
): Size2D => {
  const long = Math.max(detector.width, detector.height);
  if (!(long > 1)) return { width: longEdge, height: longEdge };
  const s = longEdge / long;
  return {
    width: Math.max(1, Math.round(detector.width * s)),
    height: Math.max(1, Math.round(detector.height * s)),
  };
};

/** Prefer known oriented buffer scaled to long edge; else detector aspect. */
export const resolvePredictedSourceSize = (args: {
  detector: Size2D;
  oriented?: Size2D | null;
  longEdge?: number;
}): Size2D => {
  const longEdge = args.longEdge ?? PREDICTED_SOURCE_LONG_EDGE;
  if (args.oriented && args.oriented.width > 1 && args.oriented.height > 1) {
    const aspect = args.oriented.width / args.oriented.height;
    const detAspect = args.detector.width / Math.max(1, args.detector.height);
    // Same-FOV snapshot matches detector cover crop, not full oriented buffer.
    // Use detector aspect when oriented differs (letterbox / full-frame).
    if (Math.abs(aspect - detAspect) < 0.04) {
      return predictedSourceSizeFromDetector(args.oriented, longEdge);
    }
  }
  return predictedSourceSizeFromDetector(args.detector, longEdge);
};

const mapSameFov = (p: Point, detector: Size2D, dest: Size2D): Point => ({
  x: detector.width > 0 ? (p.x / detector.width) * dest.width : 0,
  y: detector.height > 0 ? (p.y / detector.height) * dest.height : 0,
});

export const mapCornersToPredictedSource = (
  corners: CardCorners,
  detector: Size2D,
  source: Size2D,
): CardCorners => ({
  topLeft: mapSameFov(corners.topLeft, detector, source),
  topRight: mapSameFov(corners.topRight, detector, source),
  bottomRight: mapSameFov(corners.bottomRight, detector, source),
  bottomLeft: mapSameFov(corners.bottomLeft, detector, source),
});

const marginAt = (p: Point, w: number, h: number): number =>
  Math.min(p.x, p.y, w - p.x, h - p.y);

export const sourceCornerMargins = (
  corners: CardCorners,
  frame: Size2D,
): { margins: SourceCornerMargins; min: number } => {
  const q = cornersToQuad(corners);
  const m = {
    TL: marginAt(q[0]!, frame.width, frame.height),
    TR: marginAt(q[1]!, frame.width, frame.height),
    BR: marginAt(q[2]!, frame.width, frame.height),
    BL: marginAt(q[3]!, frame.width, frame.height),
  };
  return { margins: m, min: Math.min(m.TL, m.TR, m.BR, m.BL) };
};

/**
 * Mean corner displacement in analysis pixels between two quads
 * (for confirmation-frame jitter envelope).
 */
export const meanCornerDisplacementPx = (a: CardCorners, b: CardCorners): number => {
  const keys: (keyof CardCorners)[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  let sum = 0;
  for (const k of keys) {
    sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y);
  }
  return sum / 4;
};

/** Scale analysis-pixel jitter → predicted source pixels (isotropic approx). */
export const scaleJitterToSource = (
  analysisJitterPx: number,
  detector: Size2D,
  source: Size2D,
): number => {
  const sx = source.width / Math.max(1, detector.width);
  const sy = source.height / Math.max(1, detector.height);
  return analysisJitterPx * ((sx + sy) / 2);
};

/**
 * Predict source margins for the capture quad BEFORE snapshot.
 * Safe iff (minSourceMargin − cornerJitter) >= minSourceMarginPx threshold.
 */
export const evaluateSourceCaptureSafe = (args: {
  corners: CardCorners | null;
  detector: Size2D;
  expectedSource?: Size2D | null;
  oriented?: Size2D | null;
  /** Recent agreeing-frame corner jitter in analysis pixels. */
  cornerJitterAnalysisPx?: number | null;
  minSourceMarginPx?: number;
}): SourceSafetyVerdict => {
  const thr = args.minSourceMarginPx ?? MIN_SOURCE_MARGIN_PX;
  if (!args.corners) {
    return {
      sourceSafe: false,
      predictedSourceQuad: null,
      sourceCornerMarginsPx: null,
      minSourceMarginPx: null,
      cornerJitterPx: null,
      effectiveSourceMarginPx: null,
      reason: 'no_geometry',
    };
  }
  const det = args.detector;
  if (!(det.width > 1 && det.height > 1)) {
    return {
      sourceSafe: false,
      predictedSourceQuad: null,
      sourceCornerMarginsPx: null,
      minSourceMarginPx: null,
      cornerJitterPx: null,
      effectiveSourceMarginPx: null,
      reason: 'no_detector_size',
    };
  }

  const source =
    args.expectedSource && args.expectedSource.width > 1
      ? args.expectedSource
      : resolvePredictedSourceSize({ detector: det, oriented: args.oriented ?? null });

  const predicted = mapCornersToPredictedSource(args.corners, det, source);
  const { margins, min } = sourceCornerMargins(predicted, source);

  const jitterAnalysis =
    typeof args.cornerJitterAnalysisPx === 'number' && Number.isFinite(args.cornerJitterAnalysisPx)
      ? Math.max(0, args.cornerJitterAnalysisPx)
      : 0;
  const jitterSrc = scaleJitterToSource(jitterAnalysis, det, source);
  const effective = min - jitterSrc;
  const sourceSafe = effective >= thr;

  return {
    sourceSafe,
    predictedSourceQuad: predicted,
    sourceCornerMarginsPx: margins,
    minSourceMarginPx: min,
    cornerJitterPx: jitterSrc > 0 ? jitterSrc : jitterAnalysis > 0 ? jitterSrc : null,
    effectiveSourceMarginPx: effective,
    reason: sourceSafe
      ? `source_ok min=${min.toFixed(1)} eff=${effective.toFixed(1)} thr=${thr}`
      : `source_near_edge min=${min.toFixed(1)} eff=${effective.toFixed(1)} thr=${thr}`,
  };
};
