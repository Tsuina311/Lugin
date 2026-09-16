/** Geometry Test — button → live quad → short lock → one hi-res capture. No recognition. */

import type { CardCorners } from '../types';

export type GeometryEngineId = 'current' | 'future-mtg-fast' | 'future-corner-first';

/** Prefocus once when the Geometry tab opens; never on START/NEXT. */
export type GeometryFocusMode = 'prefocus-once' | 'no-explicit-focus';

export type GeometryTestPhase =
  | 'idle'
  | 'ready'
  | 'acquiring'
  | 'capturing'
  | 'captured'
  | 'complete'
  | 'cancelled';

export type GeometryTestTiming = {
  buttonPressedAt: number | null;
  firstDetectorFrameAt: number | null;
  firstRawQuadAt: number | null;
  firstPlausibleQuadAt: number | null;
  confirmationStartedAt: number | null;
  /** First frame that passed CAPTURE_SAFE (independent of lock). */
  firstCaptureSafeAt: number | null;
  captureQuadLockedAt: number | null;
  captureRequestedAt: number | null;
  /** Snapshot + decode complete (before warp). */
  captureCompletedAt: number | null;
  /**
   * In-memory 744×1039 warp ready.
   * Production recognition should start here — not after PNG / preview / upload.
   */
  warpDoneAt: number | null;
  /** Cheap display-only preview encode (not the benchmark artifact). */
  cardPreviewEncodeStartAt: number | null;
  cardPreviewEncodeDoneAt: number | null;
  /** Full-res 744×1039 benchmark artifact encode (background). */
  cardArtifactEncodeStartAt: number | null;
  cardArtifactEncodeDoneAt: number | null;
  cardFileWriteStartAt: number | null;
  cardFileWriteDoneAt: number | null;
  previewLoadStartAt: number | null;
  previewDisplayedAt: number | null;
  /** First time operator sees a result image (usually = previewDisplayedAt). */
  imageDisplayedAt: number | null;
  /** Full-res file ready and preview swapped (if applicable). */
  fullResPreviewReadyAt: number | null;
  artifactEncodeStartAt: number | null;
  artifactEncodeDoneAt: number | null;
  uploadAckAt: number | null;
};

export type GeometryTestDerivedMs = {
  buttonToFirstRawMs: number | null;
  buttonToFirstPlausibleMs: number | null;
  /** Explicit: button → first raw/plausible quad. */
  buttonToFirstQuadMs: number | null;
  buttonToFirstCaptureSafeMs: number | null;
  /** Explicit: firstQuad → firstCaptureSafe (safety-hunt duration). */
  firstQuadToFirstCaptureSafeMs: number | null;
  captureSafeToLockMs: number | null;
  plausibleToLockMs: number | null;
  buttonToCaptureRequestMs: number | null;
  buttonToCaptureDoneMs: number | null;
  buttonToWarpDoneMs: number | null;
  /** Alias of button→warp — recognition-relevant capture ready. */
  buttonToCaptureReadyMs: number | null;
  buttonToDisplayMs: number | null;
  warpToPreviewEncodeMs: number | null;
  previewEncodeMs: number | null;
  previewEncodeToDisplayedMs: number | null;
  warpToDisplayedMs: number | null;
  /** Breakdown of full-res artifact path (background). */
  warpToArtifactEncodeMs: number | null;
  artifactCardEncodeMs: number | null;
  artifactCardWriteMs: number | null;
  writeToFullResReadyMs: number | null;
  displayToArtifactEncodeDoneMs: number | null;
  artifactEncodeMs: number | null;
};

export type GeometryAcquisitionPhase =
  | 'searching'
  | 'detected_not_safe'
  | 'confirming'
  | 'capturing';

export type GeometryTestFrameDiag = {
  timestamp: number;
  detectorScore: number;
  rawQuad: CardCorners | null;
  plausibleQuad: CardCorners | null;
  iouVsPrev: number | null;
  cornerMovement: number | null;
  aspect: number | null;
  occupancy: number | null;
  minEdgeMarginNorm: number | null;
  maxOppositeSideRatio: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  rawCandidateCount: number | null;
  selectedCandidateScore: number | null;
  selectedRole: string | null;
  fastAccept: boolean;
  captureSafe: boolean;
  captureUnsafeReasons: string[];
  lockDecision: 'none' | 'confirming' | 'locked' | 'reset' | 'unsafe';
};

export type GeometryTestItemRecord = {
  itemIndex: number;
  geometryTestId: string;
  captureId: number | null;
  geometryEngine: GeometryEngineId;
  manualCapture: boolean;
  /** Observational only — not from a START-path AF request. */
  focusReportedSuccess: boolean | null;
  sharpness: number | null;
  /** In-memory source buffer size. */
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** In-memory card warp size (expected 744×1039). */
  warpWidth: number | null;
  warpHeight: number | null;
  /** Encoded PNG IHDR (must match buffer for ARTIFACT_OK). */
  sourceEncodedWidth?: number | null;
  sourceEncodedHeight?: number | null;
  cardEncodedWidth?: number | null;
  cardEncodedHeight?: number | null;
  sourceArtifactBytes?: number | null;
  cardArtifactBytes?: number | null;
  detectorFrameCount: number;
  lockFrameCount: number;
  /** Last-frame capture readiness (telemetry). */
  captureSafe?: boolean | null;
  captureUnsafeReasons?: string[];
  /**
   * Accumulated ms spent blocked per unsafe reason across the whole acquisition
   * (survives frame-ring truncation).
   */
  captureUnsafeReasonMs?: Record<string, number>;
  /** Dominant unsafe reason by duration (null if never blocked). */
  dominantUnsafeReason?: string | null;
  /**
   * Telemetry at CAPTURE_SAFE lock (analysis space). Not a behavioral gate.
   * Answers how close corners were to the analysis FOV edge when we locked.
   */
  minCornerMarginNormalized?: number | null;
  minCornerMarginPixelsAnalysis?: number | null;
  /**
   * Telemetry after frozen quad → snapshot/source map.
   * Answers residual pixel margin in the hi-res source (e.g. 1022×1920).
   */
  minCornerMarginPixelsSource?: number | null;
  /**
   * Predicted source-space anti-clip at lock (independent of analysis 2.5%).
   * minSourceMarginPx calibrated on 165339 (~56px thr).
   */
  sourceSafety?: {
    sourceSafe: boolean | null;
    predictedSourceQuad?: CardCorners | null;
    sourceCornerMarginsPx?: Record<string, number> | null;
    minSourceMarginPx?: number | null;
    cornerJitterPx?: number | null;
    effectiveSourceMarginPx?: number | null;
    reason?: string | null;
  } | null;
  /** Physical-card refinement V2 (global nested sleeve/card consensus). */
  physicalRefine?: {
    status: string;
    classification?: string | null;
    boundaryModel?: string | null;
    refinementMs: number | null;
    selectedForCapture: 'ORIGINAL' | 'PHYSICAL_CARD' | 'original' | 'refined';
    outerCandidateQuad?: CardCorners | null;
    sleeveQuad?: CardCorners | null;
    physicalCardQuad?: CardCorners | null;
    originalQuad: CardCorners | null;
    refinedQuad: CardCorners | null;
    captureSelectedQuad?: CardCorners | null;
    cornerEvidence: Record<string, string> | null;
    edgeEvidence?: Record<string, string> | null;
    edgeInsetNormalized: Record<string, number> | null;
    sleeveInset?: Record<string, number> | null;
    meanInset?: number | null;
    maxInset?: number | null;
    globalConsensusScore?: number | null;
    outwardPaddingApplied?: number | null;
    rejectionReason?: string | null;
    originalOccupancy: number | null;
    refinedOccupancy: number | null;
    originalCaptureSafe: boolean | null;
    refinedCaptureSafe: boolean | null;
    candidateRoleBefore: string | null;
    candidateRoleAfter: string | null;
    confidence: number | null;
    reason: string | null;
  } | null;
  timing: GeometryTestTiming;
  derivedMs: GeometryTestDerivedMs;
  frames: GeometryTestFrameDiag[];
  lockedQuad: CardCorners | null;
  files: {
    metadata: string;
    source?: string;
    cardWarp?: string;
    /** Optional debug thumbnail — never a substitute for cardWarp. */
    cardThumbnail?: string;
  };
  artifacts?: {
    source?: {
      role: 'source';
      logicalWidth: number;
      logicalHeight: number;
      encodedWidth: number;
      encodedHeight: number;
      bytes: number;
    };
    cardWarp?: {
      role: 'card-warp';
      logicalWidth: number;
      logicalHeight: number;
      encodedWidth: number;
      encodedHeight: number;
      bytes: number;
    };
  };
  recordedAt: string;
};

export type GeometryTestBundle = {
  kind: 'geometry-test';
  fixtureId: string;
  createdAt: string;
  completedAt: string | null;
  geometryEngine: GeometryEngineId;
  focusMode: GeometryFocusMode;
  /** Session-level: issued when Geometry tab opened, BEFORE any START. */
  initialFocusRequested: boolean;
  initialFocusRequestedAt: number | null;
  initialFocusReportedSuccess: boolean | null;
  items: GeometryTestItemRecord[];
  phase: GeometryTestPhase;
  note: string;
  uploadStatus?: 'PENDING' | 'INCOMPLETE' | 'COMPLETE' | null;
  uploadManifest?: {
    expectedFiles: string[];
    uploadedFiles: string[];
    missingFiles: string[];
    skippedEmpty: string[];
  } | null;
  missingFiles?: string[];
};

export const GEOMETRY_TEST_SEARCHING_HINT_MS = 5_000;
/** Agree IoU for consecutive frames (AABB). */
export const GEOMETRY_TEST_IOU_AGREE = 0.75;
export const GEOMETRY_TEST_CORNER_MOVE_AGREE = 0.035;
export const GEOMETRY_TEST_HIGH_SCORE = 0.85;
/** Soft floor — Geometry Test also accepts any non-null quad with boosted score. */
export const GEOMETRY_TEST_MIN_SCORE = 0.35;
