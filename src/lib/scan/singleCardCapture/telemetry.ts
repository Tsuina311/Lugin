/**
 * Confirmation reset / hold reasons — why a still card fails to lock.
 */

export type ConfirmationResetReason =
  | 'UNSAFE'
  | 'SECOND_CONSECUTIVE_UNSAFE'
  | 'QUAD_IOU_DISAGREEMENT'
  | 'CORNER_MOTION'
  | 'CANDIDATE_SWITCH'
  | 'OUT_OF_FRAME'
  | 'NO_GEOMETRY'
  | 'SCORE_FLOOR'
  | 'OTHER'
  | null;

export type GeometryTickTelemetry = {
  at: number;
  captureSafe: boolean;
  unsafeReasons: string[];
  confirmationStreak: number;
  iouVsPrev: number | null;
  meanCornerDelta: number | null;
  centerDelta: number | null;
  areaRatio: number | null;
  candidateSwitch: boolean;
  candidateSwitchCount: number;
  candidateSwitchesPerSecond: number | null;
  longestStableCandidateRunFrames: number;
  resetReason: ConfirmationResetReason;
  incumbentHeld: boolean;
};
