/**
 * Capture profiles — Geometry experiment vs Normal production.
 *
 * Geometry may enable experimental refine / dual polygons.
 * Normal must only use currently validated, non-clipping selection.
 */

export type SingleCardCaptureProfileId = 'normal-production' | 'geometry-experiment';

export type SingleCardCaptureProfile = {
  id: SingleCardCaptureProfileId;
  /**
   * Physical sleeve/card refine. Geometry-only until host+live prove no clip.
   * Normal production keeps detector/outer candidate (prefer sleeve pixels).
   */
  enablePhysicalRefine: boolean;
  /** Predicted source-space anti-clip (calibrated thr 56px). */
  enableSourceSafety: boolean;
  /** Dual sleeve/physical debug polygons. */
  enableDualPolygonDebug: boolean;
  /** Skip per-card AF in the critical path. */
  skipPerCardFocus: boolean;
  /** Operator-facing copy only (no reason-code clutter). */
  simplifyUserMessages: boolean;
};

/** Validated Normal Scan profile — no unvalidated physical refine. */
export const NORMAL_PRODUCTION_PROFILE: SingleCardCaptureProfile = {
  id: 'normal-production',
  enablePhysicalRefine: false,
  enableSourceSafety: true,
  enableDualPolygonDebug: false,
  skipPerCardFocus: true,
  simplifyUserMessages: true,
};

/** Geometry Test laboratory profile. */
export const GEOMETRY_EXPERIMENT_PROFILE: SingleCardCaptureProfile = {
  id: 'geometry-experiment',
  enablePhysicalRefine: true,
  enableSourceSafety: true,
  enableDualPolygonDebug: true,
  skipPerCardFocus: true,
  simplifyUserMessages: false,
};

export const profileForScannerMode = (
  mode: 'normal' | 'geometry-test' | string,
): SingleCardCaptureProfile =>
  mode === 'geometry-test' ? GEOMETRY_EXPERIMENT_PROFILE : NORMAL_PRODUCTION_PROFILE;
