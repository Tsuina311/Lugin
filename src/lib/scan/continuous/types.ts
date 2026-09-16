/**
 * Continuous Single Scan — fast identity track (Phase B).
 *
 * RECOGNITION_ELIGIBLE is intentionally looser than CAPTURE_SAFE.
 * Do not reuse 2.5% edge margin or 56px source-margin gates here.
 */

export type ContinuousPhase =
  | 'NO_CARD'
  | 'CANDIDATE'
  | 'RECOGNIZING'
  | 'IDENTITY_LOCKED'
  | 'CARD_CHANGE';

export type PublishSource = 'VISUAL' | 'OCR' | 'DUAL';

export type ContinuousIdentity = {
  name: string;
  oracleId: string | null;
};

export type ContinuousVisualObservation = {
  at: number;
  name: string;
  oracleId: string | null;
  score: number;
  margin: number | null;
  /** L2-normalized embedding when available (card-change / ownership). */
  embedding: Float32Array | number[] | null;
};

export type ContinuousOcrObservation = {
  at: number;
  name: string;
  oracleId: string | null;
  score: number;
  /** Exact folded title hit (not fuzzy). */
  exact: boolean;
};

export type ContinuousCardTrack = {
  trackId: number;
  startedAt: number;
  attemptCount: number;
  visualObservations: ContinuousVisualObservation[];
  ocrObservations: ContinuousOcrObservation[];
  bestCandidate: ContinuousIdentity | null;
  confidence: number;
  publishedIdentity: ContinuousIdentity | null;
  publishedAt: number | null;
  lastEmbeddingSimilarity: number | null;
  locked: boolean;
  /** Generation token — async results must match to publish. */
  generation: number;
};

/**
 * Recognition-eligible policy — NOT capture-safe.
 *
 * Capture-safe (Geometry Test / Verified) requires ~2.5% edge inset and often
 * 56px predicted source margin. Continuous identity must fire earlier: plausible
 * card, enough area, mostly in frame, not tiny. Tunable via telemetry later.
 */
export const RECOGNITION_ELIGIBLE_MIN_OCCUPANCY = 0.05;
export const RECOGNITION_ELIGIBLE_MAX_OCCUPANCY = 0.92;
/** Fraction of corners allowed outside the frame (0–1). One corner ≈ 0.25. */
export const RECOGNITION_ELIGIBLE_MAX_OOB_FRACTION = 0.35;
/** Min mean side length in analysis pixels — rejects postage-stamp ROIs. */
export const RECOGNITION_ELIGIBLE_MIN_RESOLUTION_PX = 72;
/** Loose aspect tolerance vs 63:88 (perspective-tolerant). */
export const RECOGNITION_ELIGIBLE_MAX_ASPECT_ERR = 0.55;

export type RecognitionEligiblePolicy = {
  minOccupancy: number;
  maxOccupancy: number;
  maxOobFraction: number;
  minResolutionPx: number;
  maxAspectErr: number;
};

export const DEFAULT_RECOGNITION_ELIGIBLE_POLICY: RecognitionEligiblePolicy = {
  minOccupancy: RECOGNITION_ELIGIBLE_MIN_OCCUPANCY,
  maxOccupancy: RECOGNITION_ELIGIBLE_MAX_OCCUPANCY,
  maxOobFraction: RECOGNITION_ELIGIBLE_MAX_OOB_FRACTION,
  minResolutionPx: RECOGNITION_ELIGIBLE_MIN_RESOLUTION_PX,
  maxAspectErr: RECOGNITION_ELIGIBLE_MAX_ASPECT_ERR,
};

export type ContinuousSession = {
  phase: ContinuousPhase;
  activeTrack: ContinuousCardTrack | null;
  /** Monotonic track id allocator. */
  nextTrackId: number;
  /** Last published names for HUD strip (newest last). */
  recentIdentities: ContinuousIdentity[];
  missFrames: number;
};
