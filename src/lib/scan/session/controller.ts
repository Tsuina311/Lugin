// Continuous scan session state machine (portable — no React / DOM).

import { describeArtwork, descriptorSimilarity } from '../artwork/descriptors';
import { focusAttemptDecision, focusGateDecision } from '../cameraCapabilities';
import type { DetectionDebug } from '../detection/types';
import { emptyDetectionDebug } from '../detection/types';
import { foldName } from '../matchName';
import {
  CAPTURE_REPLACE_MAX,
  DETECT_MIN_SCORE,
  DETECT_STALE_MS,
  FOCUS_ATTEMPT_MS,
  FOCUS_COOLDOWN_MS,
  GONE_FRAMES,
  LOCK_MIN_SCORE,
  QUALITY_MIN_SCORE,
  QUALITY_POOL_SIZE,
  RECOGNIZE_MAX_ATTEMPTS,
  RECOGNIZE_RETRY_MS,
  REPLACE_VISUAL_DELTA,
  SHARPNESS_MIN,
  STABILITY_MAX_CORNER_MOVE,
  STABILITY_WINDOW,
} from '../params';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cornersToQuad,
  normalizeCardCorners,
  warpQuadToCard,
} from '../geometry';
import { prepareCard, type PreparedCard } from '../prepareCard';
import { frameQualityScore, pushQualityPool, type FrameQuality } from '../quality';
import type { FusedResult } from '../ranking/fuse';
import { profileForCard } from '../regions';
import { emptyTemporal, type TemporalState } from '../temporal/consensus';
import {
  emptyTrack,
  geometryChanged,
  latestCorners,
  pushTrack,
  sampleFromQuad,
  trackMotion,
  type TrackState,
} from '../tracking';
import {
  extractTitleCrop,
  hashScanImage,
  ocrInputHashFor,
  shouldSkipDuplicateOcr,
} from '../ocrInput';
import type { TitleOcrDebug } from '../ocrDebug';
import { titleOcrDebugWithoutImages } from '../ocrDebug';
import { cropImage, type CardCorners, type ScanImage } from '../types';

import { selectRecognitionQuad } from '../recognitionQuad';
import { TITLE_ONLY_MIN } from '../ranking/fuse';
import {
  acceptCapturedResult,
  capturedToRecognizeResult,
  hashRecognitionQuad,
  recognizeCapturedCard,
  type CapturedRecognitionResult,
} from '../recognizeCaptured';
import {
  cardFingerprintFromWarp,
  emptyCardSessionVisual,
  observeCardFingerprint,
  type CardFingerprint,
  type CardSessionResetReason,
  type CardSessionVisualState,
  type CardVisualClass,
} from './cardSession';
import {
  changeFingerprintFromWarpedCard,
  emptyCardChangeWatch,
  noteChangeWatchProbe,
  seedCardChangeWatch,
  snapshotCardChangeWatch,
  tickCardChangeWatch,
  type CardChangeWatchSnapshot,
  type CardChangeWatchState,
} from './cardChangeWatch';
import {
  assertRecognizeBudget,
  attemptStatusFromIdentity,
  compareQuads,
  emptyPostLock,
  nextAfterFailedRecognition,
  postLockStallActive,
  shouldReplaceCaptureQuad,
  type PostLockDebug,
  type RecognitionAttempt,
  type RecognitionAttemptStatus,
} from './postLock';

export type { CardSessionResetReason, CardVisualClass } from './cardSession';
export type {
  CardChangeEvidence,
  CardChangeState,
  CardChangeWatchSnapshot,
  ChangeBand,
} from './cardChangeWatch';
export {
  CHANGE_WATCH_DIFF_MIN,
  CHANGE_WATCH_SAME_MAX,
  changeFingerprintDistance,
  changeFingerprintFromWarpedCard,
  classifyChangeDistance,
} from './cardChangeWatch';

export type { PostLockDebug, RecognitionAttempt, RecognitionAttemptStatus } from './postLock';
export { compareQuads, emptyPostLock, shouldReplaceCaptureQuad } from './postLock';
import {
  isStrongArtOnly,
  isStrongDualEvidence,
  isStrongFooterPrinting,
  isStrongTitleOnly,
  recognizeCard,
  type RecognizeDeps,
  type RecognizeOptions,
  type RecognizeResult,
} from './recognize';

export type ScannerPhase =
  | 'searching'
  | 'detected'
  | 'focusing'
  | 'locking'
  | 'recognizing'
  | 'found'
  | 'ambiguous';

export type LockBlocker =
  | 'none'
  | 'no-geometry'
  | 'stability'
  | 'capture-quality'
  | 'awaiting-focus'
  | 'awaiting-hires'
  | 'awaiting-retry'
  | 'weak-score'
  | 'clipped'
  | 'recognizing'
  | 'insufficient'
  | 'capture-failed'
  | 'post-lock-stall';

export type LockQualityInput = 'hires' | 'luma-proxy' | 'none';

export interface LockGates {
  bestFrame: boolean;
  bestFrameSource: LockQualityInput;
  bestQuality: number | null;
  blocker: LockBlocker;
  consecutiveStable: number;
  cornerOrderCorrections: number;
  cornerOrderValid: boolean;
  detectorHits: number;
  detectorMisses: number;
  detectorScore: number;
  detectorThreshold: number;
  /** Continuity / detector track — same rectangle location, not physical card. */
  currentTrackId: number | null;
  geometryTrackId: number | null;
  /** Physical card being scanned — independent of geometryTrackId. */
  cardSessionId: number;
  focusCardSessionId: number | null;
  sameCardSessionFocus: boolean;
  sessionResetReason: CardSessionResetReason | null;
  visualChange: CardVisualClass;
  fingerprintDelta: number | null;
  /** Frames of visual-change evidence toward a session reset (0..confirm). */
  visualConfirmPending: number;
  /** Independent analysis-domain change watch (not hi-res fingerprint). */
  cardChangeState: string | null;
  cardChangeEvidence: string | null;
  changeWatchDelta: number | null;
  changeWatchBand: string | null;
  changeWatchConfirmCount: number | null;
  swapSuspicion: number | null;
  resultCardSessionId: number | null;
  resultPossiblyStale: boolean;
  previousSessionIdentity: string | null;
  currentSessionIdentity: string | null;
  focusAgeMs: number | null;
  focusAttemptId: number;
  focusKind: string;
  focusOk: boolean;
  focusReentries: number;
  focusRequestedAt: number | null;
  focusRequests: number;
  focusResolvedAt: number | null;
  focusSuccesses: number;
  focusTimedOut: boolean;
  focusTimedOutAt: number | null;
  focusTimeouts: number;
  /** @deprecated Prefer focusCardSessionId — geometry track ≠ physical card. */
  focusTrackId: number | null;
  focusWaitMs: number | null;
  /** @deprecated Prefer sameCardSessionFocus. */
  sameTrackFocus: boolean;
  highResFailure: number;
  highResRequests: number;
  highResSuccess: number;
  lastHighResError: string | null;
  lockCommittedAt: number | null;
  lockEligibleAt: number | null;
  postLockStall: boolean;
  recognitionStatus: string | null;
  retryReason: string | null;
  retryScheduledAt: number | null;
  geometryAgeMs: number | null;
  geometryDetected: boolean;
  highResEligible: boolean;
  lastHitAgeMs: number | null;
  motionScore: number;
  motionThreshold: number;
  poolSize: number;
  qualityGating: boolean;
  qualityInput: LockQualityInput;
  qualityOk: boolean;
  qualityScore: number | null;
  qualityThreshold: number;
  recognitionPending: boolean;
  requiredStable: number;
  sharpness: number | null;
  sharpnessThreshold: number;
  stable: boolean;
  stableDurationMs: number | null;
  staleClearThresholdMs: number;
  trackFrames: number;
  waiting: string;
}

export interface PhaseTransition {
  at: number;
  from: ScannerPhase;
  reason: string;
  to: ScannerPhase;
}

export interface ScanContext {
  preferLanguage?: string;
  preferSets?: readonly string[];
}

/** Optional live-camera helpers (hi-res crop / focus). DOM-free contract. */
export interface FrameHelpers {
  /**
   * Supply a detect-only (or already-prepared) analysis result.
   *
   * Live camera already ran `detectCardQuad` for the overlay. Calling
   * `prepareCard` again would detect *and* warp to 744×1039 on every search
   * frame. When this returns a result, `onFrame` uses it instead.
   *
   * Recognition still goes through {@link refineCard} (or `prepareCard` if
   * that helper is absent) so the 744×1039 crop is not skipped at lock.
   */
  prepareAnalysis?: (frame: ScanImage) => PreparedCard | null;
  /**
   * Build a recognition crop from the full camera frame using analysis corners.
   * When absent (fixtures / stills), analysis-frame prepareCard is used.
   */
  refineCard?: (
    corners: CardCorners,
    analysisSize: { height: number; width: number },
  ) => PreparedCard | null;
  /** Request focus/metering at normalized video coords (0–1). */
  requestFocusNorm?: (x: number, y: number) => void;
  /**
   * When false, stay in locking without starting recognition.
   * Native uses this while a high-res still is in flight.
   */
  allowRecognize?: () => boolean;
  /** Live hi-res counters — request ≠ success. */
  captureReport?: () => {
    completedAt: number | null;
    corners: CardCorners | null;
    error: string | null;
    failure: number;
    startedAt: number | null;
    success: number;
  } | null;
  /** Drop a frozen hi-res cache so the next refine uses a newer tracked quad. */
  invalidateCapture?: (reason: string) => void;
  /** Debug/trace: every attempt crop, including failures. */
  /** Frozen hi-res source + source-space recognition quad. Lab/live parity. */
  getFrozenRecognitionInput?: () => {
    captureAt: number | null;
    recognitionQuad: CardCorners;
    source: ScanImage;
  } | null;
  /** Persist last live attempt for Lab replay (source + hashes + live result). */
  onCanonicalRecognition?: (info: {
    hashes: CapturedRecognitionResult['hashes'];
    published: boolean;
    recognitionQuad: CardCorners | null;
    rejectReason: string | null;
    result: CapturedRecognitionResult;
    source: ScanImage;
  }) => void;
  onRecognitionAttempt?: (info: {
    attemptNumber: number;
    captureAt: number | null;
    image: ScanImage;
    ocrDebug?: TitleOcrDebug | null;
    quad: CardCorners | null;
    sameInputAsPreviousAttempt?: boolean;
    status: RecognitionAttemptStatus;
    trackId: number | null;
  }) => void;
}

/** User-facing latency anchors (performance.now ms). */
export interface SessionUserLatency {
  /** Stable lock → first provisional/final oracle name on screen. */
  lockToFirstOracleMs: number | null;
  /** Stable lock → final fused identity (after channels settle). */
  lockToFinalOracleMs: number | null;
  /** Stable lock → exact printing (identified, not printing-ambiguous). */
  lockToPrintingMs: number | null;
  /** Recognize start → first oracle name (early or final). */
  recognizeToFirstOracleMs: number | null;
}

export interface SessionSnapshot {
  /** Analysis frame size corners are expressed in. */
  analysisSize: { height: number; width: number } | null;
  /** Lightweight physical-card change watch (analysis-domain). */
  cardChangeWatch?: CardChangeWatchSnapshot | null;
  corners: CardCorners | null;
  detection: DetectionDebug;
  detectorAttempts?: number;
  detectorHitRate?: number;
  detectorInterval?: { max: number; p50: number; p95: number } | null;
  lockGates?: LockGates;
  phaseTimeline?: PhaseTransition[];
  recognizeInvocations?: number;
  /** cardSessionId that owns the currently published fused result. */
  resultCardSessionId?: number | null;
  /** Wall time when provisional identity first reached the UI (if any). */
  earlyShownAt?: number | null;
  /** Wall time when final identity was applied after recognize settled. */
  finalIdentityAt?: number | null;
  fused?: FusedResult;
  /** Wall time when track first became lock-ready (phase → locking). */
  lockedAt?: number | null;
  message: string;
  /** Mean corner motion (fraction of diagonal); lower = more stable. */
  motion: number;
  phase: ScannerPhase;
  /** Wall time when exact printing first applied (fused.status === identified). */
  printingShownAt?: number | null;
  quality?: FrameQuality;
  recognition?: RecognizeResult;
  /** Wall time when the current recognize pass started. */
  recognizingStartedAt?: number | null;
  /** Recent recognition observations for the current track. */
  temporal?: TemporalState;
  /** Frames currently held in the track. */
  trackFrames: number;
  /** Derived lock→oracle / printing deltas for debug + export. */
  userLatency?: SessionUserLatency;
  /** Lock → hi-res → recognize → retry counters (trace 0016). */
  postLock?: PostLockDebug;
}

export interface SessionController {
  /** Last locked/recognized normalized card, if any (for corpus / debug). */
  lastNormalized(): ScanImage | null;
  onFrame(frame: ScanImage, helpers?: FrameHelpers): Promise<SessionSnapshot>;
  recognizeStill(frame: ScanImage): Promise<SessionSnapshot>;
  /**
   * Same post-capture path as live, without camera/detector.
   * Warps `source` with `recognitionQuad` via recognizeCapturedCard.
   */
  recognizeFrozenCapture(input: {
    captureAt?: number | null;
    helpers?: FrameHelpers;
    recognitionQuad: CardCorners;
    source: ScanImage;
    trackId?: number | null;
  }): Promise<SessionSnapshot>;
  /** Test/debug: change the active track while a recognize is in flight. */
  setActiveTrackId(trackId: number): void;
  /** Debug: skip stability/focus and recognize from the latest quad. */
  forceRecognize(helpers?: FrameHelpers): Promise<SessionSnapshot>;
  /**
   * Debug Focus Series only: mint a fresh focus attempt for this press,
   * even if geometryTrackId / cardSessionId did not change.
   */
  mintDebugFocusAttempt(): void;
  /**
   * Debug Card Swap Test only: force a new cardSessionId while keeping
   * geometryTrackId sticky. Resets focus + recognition budget.
   */
  markDebugCardSwapped(): void;
  reset(): void;
  snapshot(): SessionSnapshot;
}

interface QualFrame {
  card: PreparedCard;
  quality: FrameQuality;
}

const emptyLockGates = (): LockGates => ({
  bestFrame: false,
  bestFrameSource: 'none',
  bestQuality: null,
  blocker: 'no-geometry',
  consecutiveStable: 0,
  cornerOrderCorrections: 0,
  cornerOrderValid: true,
  detectorHits: 0,
  detectorMisses: 0,
  detectorScore: 0,
  detectorThreshold: DETECT_MIN_SCORE,
  currentTrackId: null,
  geometryTrackId: null,
  cardSessionId: 0,
  focusCardSessionId: null,
  sameCardSessionFocus: false,
  sessionResetReason: null,
  visualChange: 'same',
  fingerprintDelta: null,
  visualConfirmPending: 0,
  cardChangeState: null,
  cardChangeEvidence: null,
  changeWatchDelta: null,
  changeWatchBand: null,
  changeWatchConfirmCount: null,
  swapSuspicion: null,
  resultCardSessionId: null,
  resultPossiblyStale: false,
  previousSessionIdentity: null,
  currentSessionIdentity: null,
  focusAgeMs: null,
  focusAttemptId: 0,
  focusKind: 'none',
  focusOk: true,
  focusReentries: 0,
  focusRequestedAt: null,
  focusRequests: 0,
  focusResolvedAt: null,
  focusSuccesses: 0,
  focusTimedOut: false,
  focusTimedOutAt: null,
  focusTimeouts: 0,
  focusTrackId: null,
  focusWaitMs: null,
  sameTrackFocus: false,
  highResFailure: 0,
  highResRequests: 0,
  highResSuccess: 0,
  lastHighResError: null,
  lockCommittedAt: null,
  lockEligibleAt: null,
  postLockStall: false,
  recognitionStatus: null,
  retryReason: null,
  retryScheduledAt: null,
  geometryAgeMs: null,
  geometryDetected: false,
  highResEligible: false,
  lastHitAgeMs: null,
  motionScore: 1,
  motionThreshold: STABILITY_MAX_CORNER_MOVE,
  poolSize: 0,
  qualityGating: false,
  qualityInput: 'none',
  qualityOk: true,
  qualityScore: null,
  qualityThreshold: QUALITY_MIN_SCORE,
  recognitionPending: false,
  requiredStable: STABILITY_WINDOW,
  sharpness: null,
  sharpnessThreshold: SHARPNESS_MIN,
  stable: false,
  stableDurationMs: null,
  staleClearThresholdMs: DETECT_STALE_MS,
  trackFrames: 0,
  waiting: 'no card',
});

const percentileTriple = (
  values: readonly number[],
): { max: number; p50: number; p95: number } | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
  return { max: sorted[sorted.length - 1], p50: at(0.5), p95: at(0.95) };
};

const sameNamedCorners = (a: CardCorners, b: CardCorners): boolean =>
  a.topLeft.x === b.topLeft.x &&
  a.topLeft.y === b.topLeft.y &&
  a.topRight.x === b.topRight.x &&
  a.topRight.y === b.topRight.y &&
  a.bottomRight.x === b.bottomRight.x &&
  a.bottomRight.y === b.bottomRight.y &&
  a.bottomLeft.x === b.bottomLeft.x &&
  a.bottomLeft.y === b.bottomLeft.y;

const isCanonicalCard = (image: ScanImage): boolean =>
  image.width === CARD_WIDTH && image.height === CARD_HEIGHT;

const cornerCenter = (c: CardCorners): { x: number; y: number } => ({
  x: (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) / 4,
  y: (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) / 4,
});

export const createSessionController = (
  deps: RecognizeDeps,
  context: ScanContext = {},
): SessionController => {
  let phase: ScannerPhase = 'searching';
  let track: TrackState = emptyTrack();
  /** One-shot Lab / fixture replay — empty track is not “card gone”. */
  let frozenCaptureActive = false;
  let temporal: TemporalState = emptyTemporal();
  let pool: QualFrame[] = [];
  let gone = 0;
  let foundDescriptor: ReturnType<typeof describeArtwork> | null = null;
  let foundCorners: CardCorners | null = null;
  let lastFused: FusedResult | undefined;
  let lastRecognition: RecognizeResult | undefined;
  let lastQuality: FrameQuality | undefined;
  let lastDetection: DetectionDebug = emptyDetectionDebug();
  let analysisSize: { height: number; width: number } | null = null;
  let recognizing = false;
  let message = 'Place a card in view';
  let lastNormalized: ScanImage | null = null;
  let lastFrame: ScanImage | null = null;
  let lastLockGates: LockGates = emptyLockGates();
  let phaseTimeline: PhaseTransition[] = [];
  let recognizeInvocations = 0;
  let detectorAttempts = 0;
  let detectorHits = 0;
  let detectorMisses = 0;
  let lastHitAt: number | null = null;
  let cornerOrderCorrections = 0;
  const hitIntervals: number[] = [];
  let focusingSince: number | null = null;
  let focusRequestedAt: number | null = null;
  let focusSuccessAt: number | null = null;
  let focusResolvedAt: number | null = null;
  let focusTimedOut = false;
  let focusTimedOutAt: number | null = null;
  let focusRequests = 0;
  let focusSuccesses = 0;
  let focusTimeouts = 0;
  let focusReentries = 0;
  let focusAttemptId = 0;
  let focusTrackId: number | null = null;
  let focusCardSessionId: number | null = null;
  let localTrackId = 1;
  let cardSessionId = 1;
  let sessionResetReason: CardSessionResetReason | null = 'initial';
  let visualState: CardSessionVisualState = emptyCardSessionVisual();
  let changeWatch: CardChangeWatchState = emptyCardChangeWatch();
  let resultCardSessionId: number | null = null;
  let resultPossiblyStale = false;
  let changeWatchProbePending = false;
  let lastSessionIdentity: string | null = null;
  let previousSessionIdentity: string | null = null;
  let highResRequests = 0;
  let highResSuccess = 0;
  let highResFailure = 0;
  let lastHighResError: string | null = null;
  let highResCaptureStartedAt: number | null = null;
  let highResCaptureCompletedAt: number | null = null;
  let lockEligibleAt: number | null = null;
  let lockCommittedAt: number | null = null;
  let quadAtLock: CardCorners | null = null;
  let quadAtCaptureRequest: CardCorners | null = null;
  let latestTrackedQuadAtCapture: CardCorners | null = null;
  let quadUsedForHighRes: CardCorners | null = null;
  let quadActuallyUsedForWarp: CardCorners | null = null;
  let quadTimestamp: number | null = null;
  let quadTrackId: number | null = null;
  let quadTrackAge: number | null = null;
  let quadStabilityAtCapture: number | null = null;
  let captureReplaceUsed = 0;
  let recognitionCropCreatedAt: number | null = null;
  let recognitionCropWidth: number | null = null;
  let recognitionCropHeight: number | null = null;
  let titleOcrSubmittedAt: number | null = null;
  let titleOcrCompletedAt: number | null = null;
  let titleRawText: string | null = null;
  let titleTopCandidate: string | null = null;
  let titleScore: number | null = null;
  let lastTitleDecode: import('../titleDecode').TitleDecodeResult | null = null;
  let recognitionStatus: string | null = null;
  let resultPublishedAt: number | null = null;
  let retryScheduledAt: number | null = null;
  let retryReason: string | null = null;
  let phaseAfterRecognition: ScannerPhase | null = null;
  let recognizeCompletedAt: number | null = null;
  let attemptIdSeq = 0;
  let currentAttempt: RecognitionAttempt | null = null;
  let attempts: RecognitionAttempt[] = [];
  let attemptNumberForTrack = 0;
  let recaptureUsedForTrack = false;
  let geometryImprovementRetryUsedForTrack = false;
  let lastRecognitionDecision: ReturnType<typeof selectRecognitionQuad> | null = null;
  let lastEmptyRecognitionHash: string | null = null;
  let lastEmptyTitleCropHash: string | null = null;
  let lastOcrInputHash: string | null = null;
  let sameInputAsPreviousAttempt = false;
  let duplicateInputSuppressed = false;
  let duplicateOcrSkips = 0;
  let duplicateUploadsSuppressed = 0;
  let activeRecognitionAttemptId: number | null = null;
  let recognitionResolvedAt: number | null = null;
  let recognitionReturnedName: string | null = null;
  let recognitionReturnedStatus: string | null = null;
  let resultAccepted: boolean | null = null;
  let resultApplicationPending = false;
  let resultRejectReason: string | null = null;
  let sourceImageHash: string | null = null;
  let recognitionQuadHash: string | null = null;
  let warpedCardHash: string | null = null;
  let titleCropHashLive: string | null = null;
  let postLockStall = false;
  let lastForwardProgressAt: number | null = null;
  let watchdogActivations = 0;
  let lastFocusRequestAt = 0;
  let lastFocusCenter: { x: number; y: number } | null = null;
  let recognizingStartedAt: number | null = null;
  let earlyShownAt: number | null = null;
  let lockedAt: number | null = null;
  let finalIdentityAt: number | null = null;
  let printingShownAt: number | null = null;
  let earlyApplied = false;

  const userLatency = (): SessionUserLatency => {
    const firstOracleAt = earlyShownAt ?? finalIdentityAt;
    const delta = (from: number | null, to: number | null): number | null =>
      from != null && to != null && to >= from ? to - from : null;
    return {
      lockToFirstOracleMs: delta(lockedAt, firstOracleAt),
      lockToFinalOracleMs: delta(lockedAt, finalIdentityAt),
      lockToPrintingMs: delta(lockedAt, printingShownAt),
      recognizeToFirstOracleMs: delta(recognizingStartedAt, firstOracleAt),
    };
  };

  const setPhase = (next: ScannerPhase, reason: string) => {
    if (next === phase) return;
    phaseTimeline = [...phaseTimeline, { at: performance.now(), from: phase, reason, to: next }].slice(
      -16,
    );
    phase = next;
  };

  const snap = (): SessionSnapshot => ({
    analysisSize,
    cardChangeWatch: snapshotCardChangeWatch(changeWatch),
    corners: latestCorners(track) ?? foundCorners,
    detection: lastDetection,
    earlyShownAt,
    finalIdentityAt,
    fused:
      resultCardSessionId != null && resultCardSessionId !== cardSessionId
        ? undefined
        : lastFused,
    lockGates: lastLockGates,
    lockedAt,
    message,
    motion: trackMotion(track),
    phase,
    phaseTimeline,
    printingShownAt,
    quality: lastQuality,
    recognition:
      resultCardSessionId != null && resultCardSessionId !== cardSessionId
        ? undefined
        : lastRecognition,
    recognizeInvocations,
    recognizingStartedAt,
    resultCardSessionId,
    detectorAttempts,
    detectorHitRate: detectorAttempts ? detectorHits / detectorAttempts : 0,
    detectorInterval: percentileTriple(hitIntervals),
    temporal,
    trackFrames: track.history.length,
    userLatency: userLatency(),
    postLock: buildPostLock(),
  });

  const buildPostLock = (): PostLockDebug => {
    const latest = latestCorners(track);
    const used = quadActuallyUsedForWarp ?? quadUsedForHighRes;
    const iou =
      used && latest ? compareQuads(used, latest).iou : used && quadAtLock ? compareQuads(used, quadAtLock).iou : null;
    return {
      ...emptyPostLock(),
      attemptNumber: attemptNumberForTrack,
      attemptStatus: currentAttempt?.status ?? attempts[attempts.length - 1]?.status ?? null,
      attempts: attempts.slice(-6),
      highResCaptureCompletedAt,
      highResCaptureStartedAt,
      highResFailure,
      highResRequests,
      highResSuccess,
      lastHighResError,
      latestTrackedQuadAtCapture: latest ?? latestTrackedQuadAtCapture,
      lockCommittedAt,
      lockEligibleAt,
      phaseAfterRecognition,
      postLockStall,
      quadAtCaptureRequest,
      quadAtLock,
      quadActuallyUsedForWarp,
      quadIouCaptureVsLatest: iou,
      quadStabilityAtCapture,
      quadTimestamp,
      quadTrackAge,
      quadTrackId: lastDetection.trackId ?? quadTrackId,
      quadUsedForHighRes,
      recognitionAttemptId: currentAttempt?.id ?? attempts[attempts.length - 1]?.id ?? null,
      recognitionCropCreatedAt,
      recognitionCropHeight,
      recognitionCropWidth,
      recognitionStatus,
      recognizeCompletedAt,
      recognizeInvocations,
      recognizeStartedAt: recognizingStartedAt,
      resultPublishedAt,
      retryReason,
      retryScheduledAt,
      titleOcrCompletedAt,
      titleOcrSubmittedAt,
      titleDecode: lastTitleDecode,
      titleMargin: lastTitleDecode?.titleMargin ?? null,
      titleRawText,
      titleScore,
      titleSecondScore: lastTitleDecode?.titleSecondScore ?? null,
      titleTopCandidate,
      titleTopScore: lastTitleDecode?.titleTopScore ?? null,
      variantConsensusCount: lastTitleDecode?.consensusCount ?? null,
      trackHoldReason: lastDetection.trackHoldReason ?? null,
      trackUpdateReason: lastDetection.trackUpdateReason ?? lastDetection.continuityReason ?? null,
      trackedQuadUpdatedAt: lastDetection.trackedQuadUpdatedAt ?? null,
      watchdogActivations,
      geometryImprovementRetryUsed: geometryImprovementRetryUsedForTrack,
      maxRecognizeAttempts: RECOGNIZE_MAX_ATTEMPTS,
      recaptureUsedForTrack,
      recognizeAttemptsForTrack: attemptNumberForTrack,
      recognitionQuad: lastRecognitionDecision?.recognitionQuad ?? quadActuallyUsedForWarp,
      recognitionQuadSource: lastRecognitionDecision?.recognitionQuadSource ?? null,
      recognitionQuadValid: lastRecognitionDecision?.recognitionQuadValid ?? null,
      recognitionRejectReasons: lastRecognitionDecision?.rejectReasons ?? [],
      retryBudgetRemaining: Math.max(0, RECOGNIZE_MAX_ATTEMPTS - attemptNumberForTrack),
      trackingQuad: latest,
      ocrInputHash: lastOcrInputHash,
      sameInputAsPreviousAttempt,
      duplicateInputSuppressed,
      duplicateOcrSkips,
      duplicateUploadsSuppressed,
      activeRecognitionAttemptId,
      recognitionResolvedAt,
      recognitionReturnedName,
      recognitionReturnedStatus,
      resultAccepted,
      resultApplicationPending,
      resultRejectReason,
      sourceImageHash,
      recognitionQuadHash,
      warpedCardHash,
      titleCropHash: titleCropHashLive,
    };
  };

  const fillGates = (partial: Partial<LockGates>): LockGates => {
    const now = performance.now();
    const lastHitAgeMs = lastHitAt == null ? null : now - lastHitAt;
    const stableDurationMs =
      track.stable && track.stableSince != null ? now - track.stableSince : null;
    return {
      ...emptyLockGates(),
      consecutiveStable: track.consecutiveStable,
      cornerOrderCorrections,
      detectorHits,
      detectorMisses,
      detectorThreshold: DETECT_MIN_SCORE,
      lastHitAgeMs,
      motionScore: track.lastMove,
      motionThreshold: STABILITY_MAX_CORNER_MOVE,
      requiredStable: STABILITY_WINDOW,
      stable: track.stable,
      stableDurationMs,
      staleClearThresholdMs: DETECT_STALE_MS,
      trackFrames: track.history.length,
      currentTrackId: lastDetection.trackId ?? focusTrackId ?? localTrackId,
      geometryTrackId: lastDetection.trackId ?? focusTrackId ?? localTrackId,
      cardSessionId,
      focusCardSessionId,
      sameCardSessionFocus: focusCardSessionId != null && focusCardSessionId === cardSessionId,
      sessionResetReason,
      visualChange: visualState.visualChange,
      fingerprintDelta: changeWatch.visualDelta ?? visualState.fingerprintDelta,
      visualConfirmPending: Math.max(
        visualState.pendingVisualChanges,
        changeWatch.consecutiveChangeCount,
        changeWatch.pendingStrong,
      ),
      cardChangeState: changeWatch.cardChangeState,
      cardChangeEvidence: changeWatch.changeEvidence,
      changeWatchDelta: changeWatch.visualDelta,
      changeWatchBand: changeWatch.visualBand,
      changeWatchConfirmCount: Math.max(changeWatch.consecutiveChangeCount, changeWatch.pendingStrong),
      swapSuspicion: changeWatch.swapSuspicion,
      resultCardSessionId,
      resultPossiblyStale,
      previousSessionIdentity,
      currentSessionIdentity: lastSessionIdentity,
      focusAgeMs: focusRequestedAt == null ? null : now - focusRequestedAt,
      focusAttemptId,
      focusReentries,
      focusRequestedAt,
      focusRequests,
      focusResolvedAt,
      focusSuccesses,
      focusTimedOut,
      focusTimedOutAt,
      focusTimeouts,
      focusTrackId,
      focusWaitMs: focusRequestedAt == null ? null : performance.now() - focusRequestedAt,
      sameTrackFocus:
        focusCardSessionId != null
          ? focusCardSessionId === cardSessionId
          : focusTrackId != null &&
            focusTrackId === (lastDetection.trackId ?? focusTrackId ?? localTrackId),
      highResFailure,
      highResRequests,
      highResSuccess,
      lastHighResError,
      lockCommittedAt,
      lockEligibleAt,
      postLockStall,
      recognitionStatus,
      retryReason,
      retryScheduledAt,
      ...partial,
    };
  };

  const resetFocusAttempt = () => {
    focusingSince = null;
    focusRequestedAt = null;
    focusSuccessAt = null;
    focusResolvedAt = null;
    focusTimedOut = false;
    focusTimedOutAt = null;
    lastFocusCenter = null;
    lastFocusRequestAt = 0;
    focusTrackId = null;
    focusCardSessionId = null;
  };

  /**
   * New physical card session. Keeps geometryTrackId / continuity sticky.
   * Resets focus lifecycle + recognize retry budget owned by the card session.
   */
  const beginCardSession = (
    reason: CardSessionResetReason,
    seedFingerprint: CardFingerprint | null = null,
    seedChangeFp: import('./cardChangeWatch').ChangeFingerprint | null = null,
  ) => {
    previousSessionIdentity = lastSessionIdentity;
    lastSessionIdentity = null;
    cardSessionId += 1;
    sessionResetReason = reason;
    visualState = seedFingerprint
      ? {
          fingerprint: seedFingerprint,
          fingerprintDelta: 0,
          pendingVisualChanges: 0,
          visualChange: 'same',
        }
      : emptyCardSessionVisual();
    changeWatch = seedCardChangeWatch(seedChangeFp ?? changeWatch.currentFingerprint);
    resultPossiblyStale = false;
    changeWatchProbePending = false;
    // Drop ownership of previous published result without deleting history for debug.
    resultCardSessionId = null;
    lastFused = undefined;
    lastRecognition = undefined;
    pool = [];
    temporal = emptyTemporal();
    foundDescriptor = null;
    foundCorners = null;
    lastNormalized = null;
    resetFocusAttempt();
    recognizingStartedAt = null;
    earlyShownAt = null;
    lockedAt = null;
    finalIdentityAt = null;
    printingShownAt = null;
    earlyApplied = false;
    lockEligibleAt = null;
    lockCommittedAt = null;
    captureReplaceUsed = 0;
    recaptureUsedForTrack = false;
    geometryImprovementRetryUsedForTrack = false;
    recognitionStatus = null;
    resultPublishedAt = null;
    retryScheduledAt = null;
    retryReason = null;
    phaseAfterRecognition = null;
    recognizeCompletedAt = null;
    currentAttempt = null;
    attempts = [];
    attemptNumberForTrack = 0;
    lastEmptyRecognitionHash = null;
    lastEmptyTitleCropHash = null;
    lastOcrInputHash = null;
    sameInputAsPreviousAttempt = false;
    duplicateInputSuppressed = false;
    resultAccepted = null;
    resultApplicationPending = false;
    resultRejectReason = null;
    postLockStall = false;
    lastForwardProgressAt = null;
  };

  const clearLock = () => {
    pool = [];
    temporal = emptyTemporal();
    foundDescriptor = null;
    foundCorners = null;
    lastFused = undefined;
    lastRecognition = undefined;
    lastNormalized = null;
    resetFocusAttempt();
    recognizingStartedAt = null;
    earlyShownAt = null;
    lockedAt = null;
    finalIdentityAt = null;
    printingShownAt = null;
    earlyApplied = false;
    lockEligibleAt = null;
    lockCommittedAt = null;
    highResSuccess = 0;
    highResFailure = 0;
    lastHighResError = null;
    highResCaptureStartedAt = null;
    highResCaptureCompletedAt = null;
    quadAtLock = null;
    quadAtCaptureRequest = null;
    latestTrackedQuadAtCapture = null;
    quadUsedForHighRes = null;
    quadActuallyUsedForWarp = null;
    quadTimestamp = null;
    quadTrackId = null;
    quadTrackAge = null;
    quadStabilityAtCapture = null;
    captureReplaceUsed = 0;
    recaptureUsedForTrack = false;
    geometryImprovementRetryUsedForTrack = false;
    lastRecognitionDecision = null;
    recognitionCropCreatedAt = null;
    recognitionCropWidth = null;
    recognitionCropHeight = null;
    titleOcrSubmittedAt = null;
    titleOcrCompletedAt = null;
    titleRawText = null;
    titleTopCandidate = null;
    titleScore = null;
    lastTitleDecode = null;
    recognitionStatus = null;
    resultPublishedAt = null;
    retryScheduledAt = null;
    retryReason = null;
    phaseAfterRecognition = null;
    recognizeCompletedAt = null;
    currentAttempt = null;
    attempts = [];
    attemptNumberForTrack = 0;
    lastEmptyRecognitionHash = null;
    lastEmptyTitleCropHash = null;
    lastOcrInputHash = null;
    sameInputAsPreviousAttempt = false;
    duplicateInputSuppressed = false;
    duplicateOcrSkips = 0;
    duplicateUploadsSuppressed = 0;
    activeRecognitionAttemptId = null;
    recognitionResolvedAt = null;
    recognitionReturnedName = null;
    recognitionReturnedStatus = null;
    resultAccepted = null;
    resultApplicationPending = false;
    resultRejectReason = null;
    sourceImageHash = null;
    recognitionQuadHash = null;
    warpedCardHash = null;
    titleCropHashLive = null;
    postLockStall = false;
    lastForwardProgressAt = null;
    visualState = emptyCardSessionVisual();
    // cardSessionId is owned by beginCardSession / enterSearching — not cleared here alone
  };

  const recordTitleFromResult = (result: RecognizeResult) => {
    const titleReading = result.readings.find(r => r.source.includes('title')) ?? result.readings[0];
    const raw = result.ocrDebug?.result.rawText;
    titleRawText = raw != null && raw.trim().length > 0 ? raw : titleReading?.text ?? raw ?? null;
    titleTopCandidate = result.titleCandidates[0]?.name ?? null;
    titleScore = result.titleCandidates[0]?.score ?? null;
    if (result.timings.titleMs != null && result.timings.titleMs > 0) {
      titleOcrSubmittedAt = titleOcrSubmittedAt ?? recognizingStartedAt;
      titleOcrCompletedAt = performance.now();
    }
  };

  const finishAttempt = (status: RecognitionAttemptStatus) => {
    recognitionStatus = status;
    recognizeCompletedAt = performance.now();
    phaseAfterRecognition = phase;
    if (currentAttempt) {
      currentAttempt.status = status;
      currentAttempt.completedAt = recognizeCompletedAt;
      currentAttempt.titleRawText = titleRawText;
      currentAttempt.titleTopCandidate = titleTopCandidate;
      currentAttempt.titleScore = titleScore;
    }
  };

  const scheduleRetry = (reason: string) => {
    retryReason = reason;
    retryScheduledAt = performance.now() + RECOGNIZE_RETRY_MS;
    lastForwardProgressAt = performance.now();
    setPhase('locking', `retry scheduled: ${reason}`);
    message = 'Hold steady…';
    lastLockGates = fillGates({
      blocker: 'awaiting-retry',
      waiting: `retry ${attemptNumberForTrack}/${RECOGNIZE_MAX_ATTEMPTS} in ${RECOGNIZE_RETRY_MS}ms`,
    });
  };

  const applyIdentity = (
    result: RecognizeResult,
    card: PreparedCard,
    opts: { provisional?: boolean } = {},
  ) => {
    const status = result.fused.status;
    const nowMs = performance.now();
    recordTitleFromResult(result);
    if (status === 'identified' || status === 'printing-ambiguous') {
      const nextName = result.fused.card?.name ?? null;
      if (
        nextName &&
        lastSessionIdentity &&
        foldName(lastSessionIdentity) !== foldName(nextName)
      ) {
        // Definitive physical-card change — keep geometry track sticky.
        const changeFp = changeFingerprintFromWarpedCard(card.image);
        beginCardSession('identity-change', cardFingerprintFromWarp(card.image), changeFp);
      }
      lastRecognition = {
        ...result,
        ocrDebug: result.ocrDebug ? titleOcrDebugWithoutImages(result.ocrDebug) : undefined,
      };
      lastFused = result.fused;
      if (nextName) lastSessionIdentity = nextName;
      resultCardSessionId = cardSessionId;
      resultPossiblyStale = false;
      finishAttempt(status === 'identified' ? 'identified' : 'printing-ambiguous');
      setPhase('found', opts.provisional ? 'early identity' : 'final identity');
      phaseAfterRecognition = 'found';
      message = result.fused.card?.name ?? 'Identified';
      foundCorners = card.corners;
      foundDescriptor = artDescriptor(card);
      if (!visualState.fingerprint) {
        visualState = {
          fingerprint: cardFingerprintFromWarp(card.image),
          fingerprintDelta: 0,
          pendingVisualChanges: 0,
          visualChange: 'same',
        };
      }
      if (!changeWatch.baselineFingerprint) {
        changeWatch = seedCardChangeWatch(changeFingerprintFromWarpedCard(card.image));
      }
      resultPublishedAt = nowMs;
      retryScheduledAt = null;
      retryReason = null;
      lastForwardProgressAt = nowMs;
      if (!opts.provisional) {
        if (finalIdentityAt == null) finalIdentityAt = nowMs;
        if (status === 'identified' && printingShownAt == null) printingShownAt = nowMs;
      }
    } else if (status === 'card-ambiguous') {
      lastRecognition = {
        ...result,
        ocrDebug: result.ocrDebug ? titleOcrDebugWithoutImages(result.ocrDebug) : undefined,
      };
      lastFused = result.fused;
      finishAttempt('card-ambiguous');
      setPhase('ambiguous', 'card-ambiguous');
      phaseAfterRecognition = 'ambiguous';
      message = 'Ambiguous — keep steady or pick a candidate';
      resultPublishedAt = nowMs;
      retryScheduledAt = null;
      lastForwardProgressAt = nowMs;
    } else {
      lastRecognition = {
        ...result,
        ocrDebug: result.ocrDebug ? titleOcrDebugWithoutImages(result.ocrDebug) : undefined,
      };
      lastFused = result.fused;
      const attemptStatus = attemptStatusFromIdentity({
        fusedStatus: status,
        nativeError: result.ocrDebug?.native.errorCode
          ? {
              code: result.ocrDebug.native.errorCode,
              message: result.ocrDebug.native.errorMessage ?? '',
            }
          : null,
        ocrInputInvalid: result.ocrDebug?.buffer.ocrInputInvalid === true,
        ocrSkippedReason: result.ocrDebug?.ocrSkippedReason,
        titleRawText,
      });
      finishAttempt(attemptStatus);
      if (attemptStatus === 'ocr-unavailable') {
        message = 'OCR unavailable: no adapter';
      }
      settleFailedRecognition();
    }
  };

  /** Final wins only when it strongly contradicts the provisional early identity. */
  const stronglyContradictsEarly = (early: FusedResult, final: FusedResult): boolean => {
    const earlyKey = early.card?.oracleId ?? early.card?.name;
    const finalKey = final.card?.oracleId ?? final.card?.name;
    if (!earlyKey || !finalKey || earlyKey === finalKey) return false;
    if (final.status !== 'identified' && final.status !== 'printing-ambiguous') return false;
    // Sticky title provisional must not be displaced by art-only disagreement.
    if (isStrongTitleOnly(early) && isStrongArtOnly(final) && !isStrongTitleOnly(final)) {
      return false;
    }
    if (early.artConflict && isStrongArtOnly(final) && !isStrongDualEvidence(final)) {
      return false;
    }
    return (
      isStrongDualEvidence(final) || isStrongTitleOnly(final) || isStrongFooterPrinting(final)
    );
  };

  const enterSearching = (why: string) => {
    const reason: CardSessionResetReason =
      why === 'Scan again' || why.toLowerCase().includes('scan again')
        ? 'scan-again'
        : why.toLowerCase().includes('new card')
          ? 'visual-change'
          : why.toLowerCase().includes('place a card')
            ? 'card-gone'
            : 'card-gone';
    beginCardSession(reason);
    setPhase('searching', why);
    track = emptyTrack();
    localTrackId += 1;
    clearLock();
    gone = 0;
    message = why;
    lastLockGates = fillGates({ blocker: 'no-geometry', waiting: why });
  };

  /** Live: empty track means the card left. Frozen one-shot: keep hashes. */
  const settleFailedRecognition = (retryLabel?: string) => {
    if (frozenCaptureActive) {
      const why = retryLabel ?? 'frozen capture';
      setPhase('locking', why);
      phaseAfterRecognition = 'locking';
      retryScheduledAt = null;
      retryReason = why;
      lastLockGates = fillGates({
        blocker: 'insufficient',
        waiting: why,
      });
      return;
    }
    const next = nextAfterFailedRecognition({
      attemptsUsed: attemptNumberForTrack,
      trackPresent: track.history.length > 0,
    });
    if (next.action === 'retry') {
      scheduleRetry(retryLabel ?? next.reason);
      phaseAfterRecognition = 'locking';
    } else if (next.action === 'searching') {
      enterSearching('Place a card in view');
      phaseAfterRecognition = 'searching';
    } else {
      // Stay in locking — ambiguous is only for real multi-card identity.
      // Publishing ambiguous here permanently opens the result card and
      // blocks further recognizes on the same track.
      setPhase('locking', next.reason);
      phaseAfterRecognition = 'locking';
      message = 'Hold steady…';
      retryScheduledAt = null;
      retryReason = next.reason;
      lastLockGates = fillGates({
        blocker: 'insufficient',
        waiting: next.reason,
      });
    }
  };

  const artDescriptor = (card: PreparedCard) => {
    const profile = profileForCard(card.image.width, card.image.height);
    return describeArtwork(cropImage(card.image, profile.artwork));
  };

  const strongTitleAlreadyPublished = (): boolean => {
    if (resultPublishedAt == null || !lastFused?.card) return false;
    if (lastFused.status !== 'identified' && lastFused.status !== 'printing-ambiguous') {
      return false;
    }
    const titleScore = lastFused.candidates[0]?.titleScore ?? lastFused.card.confidence ?? 0;
    return titleScore >= TITLE_ONLY_MIN || isStrongTitleOnly(lastFused);
  };

  const applyCapturedFailure = (captured: CapturedRecognitionResult, card: PreparedCard) => {
    const rec = capturedToRecognizeResult(captured);
    applyIdentity(rec, {
      ...card,
      corners: captured.warpQuad ?? card.corners,
      image: captured.warp ?? card.image,
    });
  };

  const runRecognize = async (
    card: PreparedCard,
    helpers?: FrameHelpers,
    opts: { changeWatchProbe?: boolean; force?: boolean; titleOnly?: boolean } = {},
  ): Promise<void> => {
    if (recognizing) return;
    const changeWatchProbe = opts.changeWatchProbe === true;
    const bypassPublished = changeWatchProbe || opts.force === true;
    if (!bypassPublished && strongTitleAlreadyPublished()) return;

    const frozen = helpers?.getFrozenRecognitionInput?.() ?? null;
    const source = frozen?.source ?? card.image;
    const recognitionQuad = frozen?.recognitionQuad ?? card.corners ?? null;
    const alreadyWarped = frozen == null;
    const recognitionHash = hashScanImage(source);
    const titleCropHash = alreadyWarped
      ? hashScanImage(extractTitleCrop(source).image)
      : hashRecognitionQuad(recognitionQuad);
    lastOcrInputHash = ocrInputHashFor(recognitionHash, titleCropHash);
    sameInputAsPreviousAttempt = shouldSkipDuplicateOcr({
      currentRecognitionHash: recognitionHash,
      currentTitleCropHash: titleCropHash,
      previousRecognitionHash: lastEmptyRecognitionHash,
      previousStatus: recognitionStatus,
      previousTitleCropHash: lastEmptyTitleCropHash,
    });
    // Only the change-watch probe may bypass duplicate-input suppression.
    // forceRecognize still respects it (OCR G / flood A).
    if (sameInputAsPreviousAttempt && !changeWatchProbe) {
      duplicateInputSuppressed = true;
      duplicateOcrSkips += 1;
      duplicateUploadsSuppressed += 1;
      recognitionStatus = 'ocr-empty';
      retryScheduledAt = null;
      retryReason = 'duplicate-ocr-input';
      setPhase('locking', 'duplicate-ocr-input');
      message = 'Hold steady…';
      lastLockGates = fillGates({ blocker: 'insufficient', waiting: 'duplicate-ocr-input' });
      return;
    }
    recognizing = true;
    resultApplicationPending = true;
    resultAccepted = null;
    resultRejectReason = null;
    recognitionResolvedAt = null;
    recognitionReturnedName = null;
    recognitionReturnedStatus = null;
    earlyApplied = false;
    earlyShownAt = null;
    recognizeInvocations += 1;
    if (!changeWatchProbe) {
      attemptNumberForTrack += 1;
      assertRecognizeBudget(attemptNumberForTrack);
    } else {
      changeWatch = noteChangeWatchProbe(changeWatch, performance.now(), null);
      changeWatchProbePending = false;
    }
    attemptIdSeq += 1;
    activeRecognitionAttemptId = attemptIdSeq;
    recognizingStartedAt = performance.now();
    lastForwardProgressAt = recognizingStartedAt;
    retryScheduledAt = null;
    postLockStall = false;
    recognitionCropCreatedAt = recognizingStartedAt;
    recognitionCropWidth = source.width;
    recognitionCropHeight = source.height;
    quadActuallyUsedForWarp = recognitionQuad;
    titleOcrSubmittedAt = null;
    titleOcrCompletedAt = null;
    currentAttempt = {
      attemptNumber: changeWatchProbe ? attemptNumberForTrack : attemptNumberForTrack,
      attemptQuad: recognitionQuad,
      completedAt: null,
      id: attemptIdSeq,
      startedAt: recognizingStartedAt,
      status: 'running',
      trackId: lastDetection.trackId ?? quadTrackId,
    };
    attempts = [...attempts, currentAttempt].slice(-8);
    setPhase('recognizing', changeWatchProbe ? 'change-watch identity probe' : 'recognizeCapturedCard');
    message = changeWatchProbe ? 'Checking new card…' : 'Recognizing…';
    lastNormalized = alreadyWarped ? card.image : lastNormalized;
    focusingSince = null;
    lastLockGates = fillGates({
      blocker: 'recognizing',
      recognitionPending: true,
      waiting: message,
    });
    const titleOnly = opts.titleOnly === true;
    let attemptOcrDebug: TitleOcrDebug | null = null;
    let captured: CapturedRecognitionResult | null = null;
    try {
      titleOcrSubmittedAt = performance.now();
      captured = await recognizeCapturedCard({
        alreadyWarped,
        attemptId: attemptIdSeq,
        captureAt: frozen?.captureAt ?? highResCaptureCompletedAt,
        nameIndex: deps.nameIndex,
        ocr: deps.resolveOcr?.() ?? deps.ocr ?? null,
        quadSource: lastRecognitionDecision?.recognitionQuadSource ?? (alreadyWarped ? 'already-warped' : 'frozen-hires'),
        recognitionQuad,
        source,
        trackId: lastDetection.trackId ?? quadTrackId,
      });
      recognitionResolvedAt = performance.now();
      recognitionReturnedStatus = captured.status;
      recognitionReturnedName = captured.matchName;
      sourceImageHash = captured.hashes.sourceImageHash;
      recognitionQuadHash = captured.hashes.recognitionQuadHash;
      warpedCardHash = captured.hashes.warpedCardHash;
      titleCropHashLive = captured.hashes.titleCropHash;
      titleOcrCompletedAt = recognitionResolvedAt;
      titleRawText = captured.ocrText || null;
      titleTopCandidate = captured.matchName;
      titleScore = captured.matchScore;
      lastTitleDecode = captured.titleDecode;
      if (captured.warp) lastNormalized = captured.warp;
      if (captured.warpQuad) quadActuallyUsedForWarp = captured.warpQuad;
      recognitionCropWidth = captured.warp?.width ?? recognitionCropWidth;
      recognitionCropHeight = captured.warp?.height ?? recognitionCropHeight;

      const acceptance = acceptCapturedResult({
        activeTrackId: lastDetection.trackId ?? quadTrackId,
        result: captured,
      });
      resultAccepted = acceptance.accepted;
      resultRejectReason = acceptance.accepted ? null : acceptance.reason;
      if (!acceptance.accepted) {
        finishAttempt(
          captured.status === 'identified' || captured.status === 'insufficient-confidence'
            ? captured.status
            : captured.status,
        );
        setPhase('locking', `result rejected: ${acceptance.reason}`);
        phaseAfterRecognition = 'locking';
        message = 'Hold steady…';
        lastLockGates = fillGates({
          blocker: 'insufficient',
          waiting: `result rejected: ${acceptance.reason}`,
        });
        return;
      }

      if (
        captured.status === 'ocr-unavailable' ||
        captured.status === 'ocr-native-error' ||
        captured.status === 'crop-invalid'
      ) {
        finishAttempt(captured.status);
        if (captured.status === 'ocr-unavailable') {
          message = 'OCR unavailable: no adapter';
        } else if (captured.status === 'ocr-native-error') {
          message = `OCR native error: ${captured.error ?? 'native'}`;
        } else {
          message = 'Hold steady…';
        }
        settleFailedRecognition(captured.status);
        return;
      }

      if (captured.status === 'identified') {
        const rec = capturedToRecognizeResult(captured);
        const prepared = {
          ...card,
          corners: captured.warpQuad ?? card.corners,
          image: captured.warp ?? card.image,
        };
        earlyApplied = true;
        earlyShownAt = performance.now();
        applyIdentity(rec, prepared, { provisional: false });
        deps.onEarlyIdentity?.(rec);
        return;
      }

      const canFallback =
        !titleOnly &&
        Boolean(deps.artwork || deps.artworkIndex || deps.printingIndex);
      if (canFallback) {
        const warp = captured.warp ?? card.image;
        const recOpts: RecognizeOptions = {
          preferSets: context.preferSets,
          ...deps.recognizeOptions?.(),
        };
        const { result, temporal: nextTemp } = await recognizeCard(
          warp,
          {
            ...deps,
            onEarlyIdentity: provisional => {
              if (!bypassPublished && strongTitleAlreadyPublished()) return;
              earlyApplied = true;
              earlyShownAt = performance.now();
              applyIdentity(provisional, { ...card, image: warp }, { provisional: true });
              deps.onEarlyIdentity?.(provisional);
            },
          },
          recOpts,
          temporal,
        );
        temporal = nextTemp;
        attemptOcrDebug = result.ocrDebug ?? null;
        if (attemptOcrDebug) {
          attemptOcrDebug.sameInputAsPreviousAttempt = false;
          attemptOcrDebug.sourceAttemptId = currentAttempt?.id ?? null;
        }
        if (!bypassPublished && strongTitleAlreadyPublished()) return;
        if (earlyApplied && lastFused) {
          const same =
            (lastFused.card?.oracleId &&
              lastFused.card.oracleId === result.fused.card?.oracleId) ||
            (lastFused.card?.name && lastFused.card.name === result.fused.card?.name);
          if (!same && stronglyContradictsEarly(lastFused, result.fused)) {
            if (isStrongTitleOnly(lastFused) && !isStrongTitleOnly(result.fused)) {
              finishAttempt(
                lastFused.status === 'identified' ? 'identified' : 'printing-ambiguous',
              );
            } else {
              applyIdentity(result, { ...card, image: warp });
            }
          } else if (!same) {
            lastRecognition = {
              ...result,
              earlyIdentity: true,
              earlyReason: lastRecognition?.earlyReason ?? result.earlyReason ?? null,
              fused: lastFused,
            };
            if (finalIdentityAt == null) finalIdentityAt = performance.now();
            finishAttempt(
              lastFused.status === 'identified'
                ? 'identified'
                : lastFused.status === 'printing-ambiguous'
                  ? 'printing-ambiguous'
                  : 'insufficient-confidence',
            );
          } else {
            applyIdentity(result, { ...card, image: warp });
          }
        } else {
          applyIdentity(result, { ...card, image: warp });
        }
      } else {
        applyCapturedFailure(captured, card);
      }
      if (recognitionStatus === 'ocr-empty') {
        lastEmptyRecognitionHash = recognitionHash;
        lastEmptyTitleCropHash = titleCropHash;
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      lastHighResError = why;
      recognitionReturnedStatus = 'ocr-native-error';
      recognitionResolvedAt = performance.now();
      finishAttempt('ocr-native-error');
      message = `OCR native error: ${why}`;
      settleFailedRecognition(why);
    } finally {
      recognizing = false;
      resultApplicationPending = false;
      activeRecognitionAttemptId = null;
      try {
        if (captured) {
          helpers?.onCanonicalRecognition?.({
            hashes: captured.hashes,
            published: resultAccepted === true && resultPublishedAt != null,
            recognitionQuad,
            rejectReason: resultRejectReason,
            result: captured,
            source,
          });
        }
        helpers?.onRecognitionAttempt?.({
          attemptNumber: attemptNumberForTrack,
          captureAt: frozen?.captureAt ?? highResCaptureCompletedAt ?? quadTimestamp,
          image: captured?.warp ?? card.image,
          ocrDebug: attemptOcrDebug,
          quad: recognitionQuad,
          sameInputAsPreviousAttempt: false,
          status: currentAttempt?.status ?? 'insufficient-confidence',
          trackId: lastDetection.trackId ?? quadTrackId,
        });
      } catch {
        /* debug hook must never stall the session */
      }
    }
  };

  const clippedCornerCount = (c: CardCorners, size: { height: number; width: number }): number => {
    const pad = 2;
    return [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft].filter(
      p => p.x < -pad || p.y < -pad || p.x > size.width + pad || p.y > size.height + pad,
    ).length;
  };

  const maybeRequestFocus = (
    corners: CardCorners,
    size: { height: number; width: number },
    helpers?: FrameHelpers,
  ) => {
    if (!helpers?.requestFocusNorm) return;
    const now = performance.now();
    const c = cornerCenter(corners);
    const nx = c.x / Math.max(1, size.width);
    const ny = c.y / Math.max(1, size.height);
    const incomingTrackId = lastDetection.trackId ?? localTrackId;
    const sessionChanged = focusCardSessionId != null && focusCardSessionId !== cardSessionId;
    if (sessionChanged) resetFocusAttempt();
    const movedMaterially =
      Boolean(lastFocusCenter) &&
      Math.hypot(nx - (lastFocusCenter?.x ?? nx), ny - (lastFocusCenter?.y ?? ny)) > 0.12;
    const decision = focusAttemptDecision({
      attemptMs: FOCUS_ATTEMPT_MS,
      cooldownMs: FOCUS_COOLDOWN_MS,
      lastRequestAt: lastFocusRequestAt > 0 ? lastFocusRequestAt : null,
      movedMaterially,
      now,
      requestedAt: focusRequestedAt,
      successAt: focusSuccessAt,
      trackChanged: sessionChanged,
    });
    if (!decision.shouldRequest) return;
    const retrying = focusRequestedAt != null || focusSuccessAt != null || focusTimedOut;
    if (retrying) focusReentries += 1;
    focusRequests += 1;
    focusAttemptId += 1;
    focusTrackId = incomingTrackId;
    focusCardSessionId = cardSessionId;
    focusRequestedAt = now;
    focusSuccessAt = null;
    focusResolvedAt = null;
    focusTimedOut = false;
    focusTimedOutAt = null;
    focusingSince = now;
    lastFocusRequestAt = now;
    lastFocusCenter = { x: nx, y: ny };
    helpers.requestFocusNorm(nx, ny);
  };

  return {
    lastNormalized: () => lastNormalized,

    async onFrame(frame, helpers) {
      lastFrame = frame;
      analysisSize = { height: frame.height, width: frame.width };
      detectorAttempts += 1;
      const prepared = helpers?.prepareAnalysis?.(frame) ?? prepareCard(frame);
      lastDetection = prepared.detection;
      const rawCorners = prepared.corners;
      const corners = rawCorners ? normalizeCardCorners(rawCorners) : null;
      if (rawCorners && corners && !sameNamedCorners(rawCorners, corners)) {
        cornerOrderCorrections += 1;
      }
      const cornerOrderValid = !rawCorners || !corners || sameNamedCorners(rawCorners, corners);

      if (!prepared.detected || !corners || prepared.score < DETECT_MIN_SCORE) {
        detectorMisses += 1;
        lastQuality = frameQualityScore(frame, prepared.score);
        track = pushTrack(track, null);
        const lastHitAgeMs = lastHitAt == null ? null : performance.now() - lastHitAt;
        const stale = lastHitAgeMs == null || lastHitAgeMs > DETECT_STALE_MS;
        // Change watch still ticks on misses (occlusion evidence) while a session is live.
        if (phase === 'found' || phase === 'ambiguous' || phase === 'locking' || phase === 'focusing') {
          const missTick = tickCardChangeWatch({
            corners: null,
            detectorMiss: true,
            frame: null,
            geometryDelta: 0,
            now: performance.now(),
            sessionActive: true,
            state: changeWatch,
          });
          changeWatch = missTick.state;
          resultPossiblyStale = resultPossiblyStale || missTick.resultPossiblyStale;
        }
        lastLockGates = fillGates({
          blocker: track.stable && !stale ? lastLockGates.blocker : 'no-geometry',
          cornerOrderValid,
          detectorScore: prepared.score,
          geometryDetected: false,
          poolSize: pool.length,
          qualityScore: lastQuality.score,
          recognitionPending: recognizing,
          sharpness: lastQuality.sharpness,
          waiting: track.stable && !stale ? 'detector miss (grace)' : 'no geometry',
        });
        if (phase === 'found' || phase === 'ambiguous') {
          gone += 1;
          if (gone >= GONE_FRAMES) enterSearching('Place a card in view');
        } else if (phase !== 'searching' && phase !== 'recognizing' && !track.history.length) {
          enterSearching('Place a card in view');
        } else if (track.history.length && phase !== 'recognizing') {
          if (track.stable && !stale && (phase === 'locking' || phase === 'focusing')) {
            message = 'Hold steady…';
          } else {
            setPhase('detected', 'coasting miss');
            message = 'Hold steady…';
          }
        }
        return snap();
      }

      detectorHits += 1;
      const hitNow = performance.now();
      if (lastHitAt != null) {
        hitIntervals.push(hitNow - lastHitAt);
        if (hitIntervals.length > 32) hitIntervals.shift();
      }
      lastHitAt = hitNow;
      gone = 0;
      track = pushTrack(track, sampleFromQuad(corners, prepared.score, hitNow));

      // Hi-res warp is capture quality. Luma analysis is geometry only.
      const refined = helpers?.refineCard?.(corners, analysisSize) ?? null;
      const captureReady = Boolean(refined && isCanonicalCard(refined.image));
      const forQuality = captureReady && refined ? refined : prepared;
      lastQuality = frameQualityScore(forQuality.image, prepared.score);
      const qualityInput: LockQualityInput = captureReady ? 'hires' : 'luma-proxy';
      // Absolute SHARPNESS_MIN was calibrated on RGB analysis / 744×1039.
      // A 250×480 luma proxy cannot satisfy it — do not gate lock on that.
      const qualityGating = qualityInput === 'hires';

      // ——— Independent CARD CHANGE WATCH (analysis pixels; not hi-res) ———
      // Continues after found / ambiguous / retry exhausted. Does not require
      // a new session first. Breaks the hi-res↔session circular dependency.
      const sessionLive =
        phase === 'found' ||
        phase === 'ambiguous' ||
        phase === 'locking' ||
        phase === 'focusing' ||
        phase === 'detected' ||
        phase === 'recognizing';
      if (sessionLive && !recognizing) {
        const watchTick = tickCardChangeWatch({
          corners,
          detectorMiss: false,
          frame,
          geometryDelta: track.lastMove,
          now: performance.now(),
          sessionActive: true,
          state: changeWatch,
        });
        changeWatch = watchTick.state;
        // Mirror live deltas into legacy visual fields for swap-test instrumentation.
        if (changeWatch.visualDelta != null) {
          visualState = {
            ...visualState,
            fingerprintDelta: changeWatch.visualDelta,
            pendingVisualChanges: Math.max(
              visualState.pendingVisualChanges,
              changeWatch.pendingStrong,
              changeWatch.consecutiveChangeCount,
            ),
            visualChange:
              changeWatch.visualBand === 'changed'
                ? 'changed'
                : changeWatch.visualBand === 'uncertain'
                  ? 'uncertain'
                  : 'same',
          };
        }
        if (watchTick.resultPossiblyStale) resultPossiblyStale = true;
        if (watchTick.beginSession) {
          beginCardSession(
            'visual-change',
            null,
            changeWatch.currentFingerprint,
          );
          setPhase('focusing', 'new card session (change-watch visual)');
          message = 'New card…';
          lastLockGates = fillGates({ waiting: 'New card…' });
          return snap();
        }
        if (watchTick.requestIdentityProbe && !changeWatchProbePending && !recognizing) {
          changeWatchProbePending = true;
          // Prefer fresh hi-res if present; else analysis prepared card.
          const probeCard =
            captureReady && refined
              ? refined
              : prepared;
          await runRecognize(probeCard, helpers, { changeWatchProbe: true, force: true });
          // If probe identified a different card, beginCardSession already ran.
          if (phase === 'found' || phase === 'ambiguous') {
            lastLockGates = fillGates({});
            return snap();
          }
          if (sessionResetReason === 'identity-change' || sessionResetReason === 'visual-change') {
            lastLockGates = fillGates({ waiting: message });
            return snap();
          }
        }
      }

      // Seed / update hi-res fingerprint while locking (supplementary; change-watch is primary).
      if (
        captureReady &&
        refined &&
        (phase === 'locking' || phase === 'focusing' || phase === 'detected')
      ) {
        const observed = observeCardFingerprint(visualState, refined.image, {
          allowReset: Boolean(lastSessionIdentity) || attemptNumberForTrack > 0,
        });
        visualState = observed.state;
        if (observed.reset) {
          beginCardSession(
            'visual-change',
            visualState.fingerprint,
            changeFingerprintFromWarpedCard(refined.image),
          );
          setPhase('focusing', 'new card session (visual)');
          message = 'New card…';
        }
      }

      if (phase === 'found' && foundCorners && foundDescriptor) {
        const geomMoved = geometryChanged(foundCorners, corners);
        // Change-watch already ran above. Do NOT require hi-res refine for
        // appearance compare. Early-return only when geometry is still and
        // change-watch is not suspecting a new card.
        const watching =
          changeWatch.cardChangeState === 'suspect' ||
          changeWatch.cardChangeState === 'confirming' ||
          changeWatch.cardChangeState === 'identity-probe' ||
          changeWatch.cardChangeState === 'changed';
        if (!geomMoved && !watching && !resultPossiblyStale) {
          lastLockGates = fillGates({ waiting: 'holding identity' });
          return snap();
        }
        if (!geomMoved) {
          lastLockGates = fillGates({
            waiting: watching ? `change-watch ${changeWatch.cardChangeState}` : 'holding identity',
          });
          return snap();
        }
        // Geometry moved substantially — traditional art check / searching.
        if (captureReady && refined) {
          const desc = artDescriptor(refined);
          if (descriptorSimilarity(foundDescriptor, desc) > 1 - REPLACE_VISUAL_DELTA) {
            lastLockGates = fillGates({ waiting: 'geometry moved, same art' });
            return snap();
          }
        }
        enterSearching('New card…');
        track = pushTrack(emptyTrack(), sampleFromQuad(corners, prepared.score));
        return snap();
      }

      if (phase === 'recognizing') {
        lastLockGates = fillGates({
          blocker: 'recognizing',
          cornerOrderValid,
          detectorScore: prepared.score,
          geometryDetected: true,
          highResEligible: true,
          poolSize: pool.length,
          qualityGating,
          qualityInput,
          qualityOk: !qualityGating || lastQuality.score >= QUALITY_MIN_SCORE,
          qualityScore: lastQuality.score,
          recognitionPending: true,
          sharpness: lastQuality.sharpness,
          waiting: 'recognition running',
        });
        return snap();
      }

      const now = performance.now();
      const clippedEarly = clippedCornerCount(corners, analysisSize) >= 2;
      const scoreOkEarly = prepared.score >= LOCK_MIN_SCORE;
      if (scoreOkEarly && !clippedEarly) maybeRequestFocus(corners, analysisSize, helpers);
      const sessionChanged = focusCardSessionId != null && focusCardSessionId !== cardSessionId;
      if (sessionChanged) {
        resetFocusAttempt();
      }
      const movedMaterially =
        Boolean(lastFocusCenter) &&
        Math.hypot(
          cornerCenter(corners).x / Math.max(1, analysisSize.width) - (lastFocusCenter?.x ?? 0),
          cornerCenter(corners).y / Math.max(1, analysisSize.height) - (lastFocusCenter?.y ?? 0),
        ) > 0.12;
      const attempt = helpers?.requestFocusNorm
        ? focusAttemptDecision({
            attemptMs: FOCUS_ATTEMPT_MS,
            cooldownMs: FOCUS_COOLDOWN_MS,
            lastRequestAt: lastFocusRequestAt > 0 ? lastFocusRequestAt : null,
            movedMaterially,
            now,
            requestedAt: focusRequestedAt,
            successAt: focusSuccessAt,
            trackChanged: sessionChanged,
          })
        : { allowCapture: true, kind: 'ready' as const, shouldRequest: false };
      if (attempt.kind === 'timeout' && !focusTimedOut) {
        focusTimedOut = true;
        focusTimeouts += 1;
        focusTimedOutAt = now;
        focusResolvedAt = now;
      }
      const focusAgeMs = focusRequestedAt == null ? null : now - focusRequestedAt;
      const sharpEnough =
        lastQuality.score >= QUALITY_MIN_SCORE && lastQuality.sharpness >= SHARPNESS_MIN;
      const qualityGate = qualityGating
        ? focusGateDecision({
            focusingSince,
            minQuality: QUALITY_MIN_SCORE,
            minSharpness: SHARPNESS_MIN,
            now,
            qualityScore: lastQuality.score,
            sharpness: lastQuality.sharpness,
            stable: track.stable,
            timeoutMs: FOCUS_ATTEMPT_MS,
          })
        : { kind: 'ready' as const };
      const captureQualityReady =
        !qualityGating || sharpEnough || qualityGate.kind === 'timeout' || attempt.kind === 'timeout';
      const clipped = clippedCornerCount(corners, analysisSize) >= 2;
      const scoreOk = prepared.score >= LOCK_MIN_SCORE;

      if (!track.stable) {
        const advisoryFocus = Boolean(helpers?.requestFocusNorm) && attempt.kind === 'waiting';
        setPhase(advisoryFocus ? 'focusing' : 'detected', 'awaiting stability');
        message = `Hold steady… ${track.consecutiveStable}/${STABILITY_WINDOW}`;
        lastLockGates = fillGates({
          blocker: 'stability',
          cornerOrderValid,
          detectorScore: prepared.score,
          focusAgeMs,
          focusKind: attempt.kind,
          focusOk: attempt.allowCapture,
          geometryDetected: true,
          highResEligible: false,
          poolSize: pool.length,
          qualityGating,
          qualityInput,
          qualityOk: true,
          qualityScore: lastQuality.score,
          sharpness: lastQuality.sharpness,
          waiting: `stability ${track.consecutiveStable}/${STABILITY_WINDOW}`,
        });
        return snap();
      }

      if (!scoreOk) {
        setPhase('detected', 'weak detector score');
        message = 'Hold steady…';
        lastLockGates = fillGates({
          blocker: 'weak-score',
          cornerOrderValid,
          detectorScore: prepared.score,
          focusAgeMs,
          focusKind: attempt.kind,
          focusOk: attempt.allowCapture,
          geometryDetected: true,
          highResEligible: false,
          qualityGating,
          qualityInput,
          qualityOk: true,
          qualityScore: lastQuality.score,
          sharpness: lastQuality.sharpness,
          waiting: `score ${prepared.score.toFixed(2)} < ${LOCK_MIN_SCORE}`,
        });
        return snap();
      }

      if (clipped) {
        setPhase('detected', 'clipped geometry');
        message = 'Move the card fully into view';
        lastLockGates = fillGates({
          blocker: 'clipped',
          cornerOrderValid,
          detectorScore: prepared.score,
          focusAgeMs,
          focusKind: attempt.kind,
          focusOk: attempt.allowCapture,
          geometryDetected: true,
          highResEligible: false,
          qualityGating,
          qualityInput,
          qualityOk: true,
          qualityScore: lastQuality.score,
          sharpness: lastQuality.sharpness,
          waiting: 'quad clipped by frame edge',
        });
        return snap();
      }

      const postLockActive =
        lockCommittedAt != null || focusTimedOut || attemptNumberForTrack > 0;
      const setFocusOrLock = (focusingWhy: string, lockingWhy: string) => {
        if (postLockActive) setPhase('locking', lockingWhy);
        else setPhase('focusing', focusingWhy);
      };

      if (!attempt.allowCapture) {
        setFocusOrLock('bounded focus attempt', 'focus already completed — continue lock');
        pool = pushQualityPool(
          pool,
          { card: forQuality, quality: lastQuality },
          QUALITY_POOL_SIZE,
        );
        message = postLockActive ? 'Card locked' : 'Focusing…';
        lastLockGates = fillGates({
          bestFrame: pool.length > 0,
          bestFrameSource: qualityInput,
          bestQuality: pool[0]?.quality.score ?? lastQuality.score,
          blocker: postLockActive ? 'none' : 'awaiting-focus',
          cornerOrderValid,
          detectorScore: prepared.score,
          focusAgeMs,
          focusKind: attempt.kind,
          focusOk: postLockActive,
          geometryDetected: true,
          highResEligible: true,
          poolSize: pool.length,
          qualityGating,
          qualityInput,
          qualityOk: !qualityGating || sharpEnough,
          qualityScore: lastQuality.score,
          recognitionPending: recognizing,
          sharpness: lastQuality.sharpness,
          waiting: postLockActive
            ? 'focus lifecycle complete'
            : `focus attempt ${Math.round(focusAgeMs ?? 0)}/${FOCUS_ATTEMPT_MS} ms`,
        });
        return snap();
      }

      if (!captureQualityReady) {
        if (focusingSince == null) focusingSince = now;
        setFocusOrLock('hi-res not sharp yet', 'quality wait after lock');
        pool = pushQualityPool(
          pool,
          { card: forQuality, quality: lastQuality },
          QUALITY_POOL_SIZE,
        );
        message = postLockActive ? 'Card locked' : 'Focusing…';
        lastLockGates = fillGates({
          bestFrame: pool.length > 0,
          bestFrameSource: qualityInput,
          bestQuality: pool[0]?.quality.score ?? lastQuality.score,
          blocker: 'capture-quality',
          cornerOrderValid,
          detectorScore: prepared.score,
          focusAgeMs,
          focusKind: qualityGate.kind,
          focusOk: postLockActive,
          geometryDetected: true,
          highResEligible: true,
          poolSize: pool.length,
          qualityGating,
          qualityInput,
          qualityOk: false,
          qualityScore: lastQuality.score,
          recognitionPending: recognizing,
          sharpness: lastQuality.sharpness,
          waiting: `quality ${lastQuality.score.toFixed(2)} < ${QUALITY_MIN_SCORE} or sharp ${lastQuality.sharpness.toFixed(0)} < ${SHARPNESS_MIN}`,
        });
        return snap();
      }

      if (phase !== 'found' && phase !== 'ambiguous') {
        const lockQuad = latestCorners(track) ?? corners;
        if (lockEligibleAt == null) lockEligibleAt = now;
        setPhase('locking', qualityGating ? 'capture sharp' : 'geometry stable');
        if (lockedAt == null) {
          lockedAt = now;
          lockCommittedAt = now;
          quadAtLock = lockQuad;
          highResRequests += 1;
          lastForwardProgressAt = now;
        }
        const report = helpers?.captureReport?.();
        if (report) {
          if (report.success > highResSuccess || report.failure > highResFailure) {
            lastForwardProgressAt = now;
          }
          highResSuccess = report.success;
          highResFailure = report.failure;
          lastHighResError = report.error;
          highResCaptureStartedAt = report.startedAt ?? highResCaptureStartedAt;
          highResCaptureCompletedAt = report.completedAt ?? highResCaptureCompletedAt;
          if (report.corners) {
            quadUsedForHighRes = report.corners;
            if (quadAtCaptureRequest == null) quadAtCaptureRequest = report.corners;
          }
        } else if (captureReady) {
          highResSuccess = Math.max(highResSuccess, 1);
        }

        pool = pushQualityPool(
          pool,
          { card: forQuality, quality: lastQuality },
          QUALITY_POOL_SIZE,
        );
        const best = pool[0];
        const retryWaiting = retryScheduledAt != null && now < retryScheduledAt;
        const stall = postLockStallActive({
          hasResult: resultPublishedAt != null,
          highResRequests,
          lastProgressAt: lastForwardProgressAt,
          now,
          recognizing,
          resultApplicationPending,
          retryScheduled: retryWaiting,
        });
        if (stall && !postLockStall) {
          postLockStall = true;
          watchdogActivations += 1;
          lastForwardProgressAt = now;
          if (attemptNumberForTrack < RECOGNIZE_MAX_ATTEMPTS) {
            scheduleRetry(highResSuccess === 0 && highResRequests > 0 ? 'POST_LOCK_STALL capture' : 'POST_LOCK_STALL');
          }
          message = 'Hold steady…';
          lastLockGates = fillGates({
            blocker: 'post-lock-stall',
            waiting: retryReason ?? 'POST_LOCK_STALL',
          });
          return snap();
        }

        if (retryWaiting) {
          message = 'Hold steady…';
          lastLockGates = fillGates({
            bestFrame: pool.length > 0,
            bestFrameSource: qualityInput,
            bestQuality: best?.quality.score ?? lastQuality.score,
            blocker: 'awaiting-retry',
            cornerOrderValid,
            detectorScore: prepared.score,
            focusAgeMs,
            focusKind: attempt.kind,
            focusOk: true,
            geometryDetected: true,
            highResEligible: true,
            poolSize: pool.length,
            qualityGating,
            qualityInput,
            qualityOk: true,
            qualityScore: lastQuality.score,
            sharpness: lastQuality.sharpness,
            waiting: retryReason ?? 'retry scheduled',
          });
          return snap();
        }

        if (attemptNumberForTrack >= RECOGNIZE_MAX_ATTEMPTS) {
          setPhase('locking', 'max recognition attempts');
          message = 'Hold steady…';
          lastLockGates = fillGates({
            blocker: 'insufficient',
            waiting: 'max recognition attempts',
          });
          return snap();
        }

        const recPick = selectRecognitionQuad({
          candidates: (lastDetection.candidates ?? [])
            .filter(c => c.corners)
            .map(c => ({ corners: c.corners!, score: c.score })),
          frame: analysisSize,
          rawQuad: lastDetection.rawCorners ?? prepared.corners,
          trackingQuad: lockQuad,
        });
        lastRecognitionDecision = recPick;
        const recognitionQuad = recPick.recognitionQuad;

        const captureQuad = quadUsedForHighRes ?? report?.corners ?? null;
        const stale = shouldReplaceCaptureQuad(captureQuad, recognitionQuad);
        const allowRecapture =
          !recaptureUsedForTrack &&
          captureReplaceUsed < CAPTURE_REPLACE_MAX &&
          !geometryImprovementRetryUsedForTrack;
        if (stale.replace && allowRecapture && helpers?.invalidateCapture) {
          captureReplaceUsed += 1;
          recaptureUsedForTrack = true;
          if (attemptNumberForTrack > 0) geometryImprovementRetryUsedForTrack = true;
          highResRequests += 1;
          lastForwardProgressAt = now;
          helpers.invalidateCapture('track improved before recognize');
          retryReason = 'stale-capture-quad';
          quadAtCaptureRequest = recognitionQuad;
          latestTrackedQuadAtCapture = lockQuad;
          message = 'Updating crop…';
          lastLockGates = fillGates({
            bestFrame: pool.length > 0,
            bestFrameSource: qualityInput,
            bestQuality: best?.quality.score ?? lastQuality.score,
            blocker: 'awaiting-hires',
            waiting: `stale capture IoU ${stale.iou.toFixed(2)} — recapture once`,
          });
          return snap();
        }

        const watchdogForce =
          postLockStall &&
          highResSuccess > 0 &&
          recognizeInvocations === 0 &&
          attemptNumberForTrack < RECOGNIZE_MAX_ATTEMPTS;
        const mayStart =
          !recognizing &&
          (watchdogForce ||
            (qualityGating ? Boolean(best) && best.quality.score >= QUALITY_MIN_SCORE : true));
        if (
          mayStart &&
          helpers?.allowRecognize &&
          !helpers.allowRecognize() &&
          !watchdogForce
        ) {
          if (highResFailure > 0 && highResSuccess === 0) {
            message = 'Capture failed — retrying';
            if (retryScheduledAt == null && attemptNumberForTrack < RECOGNIZE_MAX_ATTEMPTS) {
              attemptIdSeq += 1;
              currentAttempt = {
                attemptNumber: attemptNumberForTrack,
                attemptQuad: recognitionQuad ?? lockQuad,
                completedAt: now,
                id: attemptIdSeq,
                startedAt: now,
                status: 'capture-failed',
                trackId: lastDetection.trackId ?? quadTrackId,
              };
              attempts = [...attempts, currentAttempt].slice(-8);
              recognitionStatus = 'capture-failed';
              scheduleRetry('capture-failed');
            }
          } else {
            message = 'Capturing…';
          }
          lastLockGates = fillGates({
            bestFrame: pool.length > 0,
            bestFrameSource: qualityInput,
            bestQuality: best?.quality.score ?? lastQuality.score,
            blocker: highResFailure > 0 && highResSuccess === 0 ? 'capture-failed' : 'awaiting-hires',
            cornerOrderValid,
            detectorScore: prepared.score,
            focusAgeMs,
            focusKind: attempt.kind,
            focusOk: true,
            geometryDetected: true,
            highResEligible: true,
            poolSize: pool.length,
            qualityGating,
            qualityInput,
            qualityOk: !qualityGating || (best?.quality.score ?? 0) >= QUALITY_MIN_SCORE,
            qualityScore: lastQuality.score,
            sharpness: lastQuality.sharpness,
            waiting: highResFailure > 0 && highResSuccess === 0 ? 'capture failed' : 'requesting snapshot',
          });
          return snap();
        }
        if (mayStart && !recognitionQuad) {
          message = 'Hold steady…';
          lastLockGates = fillGates({
            blocker: 'insufficient',
            waiting: `recognition quad rejected: ${recPick.rejectReasons.join(',') || 'invalid'}`,
          });
          return snap();
        }
        if (mayStart && recognitionQuad) {
          message = 'Card locked';
          latestTrackedQuadAtCapture = lockQuad;
          quadTimestamp = now;
          quadTrackId = lastDetection.trackId ?? quadTrackId;
          quadTrackAge = lastDetection.trackAge ?? track.history.length;
          quadStabilityAtCapture = track.lastIou;
          if (quadAtCaptureRequest == null) quadAtCaptureRequest = recognitionQuad;
          const refinedNow = helpers?.refineCard?.(recognitionQuad, analysisSize) ?? null;
          const fromPool = best && isCanonicalCard(best.card.image) ? best.card : null;
          const card =
            refinedNow && isCanonicalCard(refinedNow.image)
              ? { ...refinedNow, corners: refinedNow.corners ?? recognitionQuad }
              : fromPool ??
                {
                  ...prepared,
                  corners: recognitionQuad,
                  detected: true,
                  image: warpQuadToCard(frame, cornersToQuad(recognitionQuad)),
                };
          quadActuallyUsedForWarp = card.corners ?? recognitionQuad;
          lastNormalized = card.image;
          lastLockGates = fillGates({
            bestFrame: pool.length > 0,
            bestFrameSource: qualityInput,
            bestQuality: best?.quality.score ?? lastQuality.score,
            blocker: 'none',
            cornerOrderValid,
            detectorScore: prepared.score,
            focusAgeMs,
            focusKind: attempt.kind,
            focusOk: true,
            geometryDetected: true,
            highResEligible: true,
            poolSize: pool.length,
            qualityGating,
            qualityInput,
            qualityOk: true,
            qualityScore: lastQuality.score,
            recognitionPending: true,
            sharpness: lastQuality.sharpness,
            waiting: 'starting recognition',
          });
          await runRecognize(card, helpers);
        }
      }

      return snap();
    },

    async forceRecognize(helpers) {
      const corners = latestCorners(track)
        ? normalizeCardCorners(latestCorners(track)!)
        : lastDetection.candidates[0]?.corners
          ? normalizeCardCorners(lastDetection.candidates[0].corners)
          : null;
      const frame = lastFrame;
      if (!corners || !frame || !analysisSize) {
        message = 'Force recognize: no quad';
        recognitionStatus = 'crop-invalid';
        return snap();
      }
      track = { ...track, stable: true };
      setPhase('locking', 'force recognize');
      if (lockedAt == null) lockedAt = performance.now();
      if (lockCommittedAt == null) lockCommittedAt = performance.now();
      retryScheduledAt = null;
      helpers?.invalidateCapture?.('force recognize');
      quadAtCaptureRequest = corners;
      latestTrackedQuadAtCapture = corners;
      quadTimestamp = performance.now();
      const refined = helpers?.refineCard?.(corners, analysisSize);
      const card =
        refined && isCanonicalCard(refined.image)
          ? { ...refined, corners: refined.corners ?? corners }
          : {
              corners,
              detected: true,
              detection: lastDetection,
              image: warpQuadToCard(frame, cornersToQuad(corners)),
              score: 1,
              source: 'detected' as const,
            };
      quadActuallyUsedForWarp = card.corners ?? corners;
      lastNormalized = card.image;
      await runRecognize(card, helpers, { force: true });
      return snap();
    },

    async recognizeStill(frame) {
      analysisSize = { height: frame.height, width: frame.width };
      clearLock();
      track = emptyTrack();
      const prepared = prepareCard(frame);
      lastDetection = prepared.detection;
      lastQuality = frameQualityScore(prepared.image, prepared.score);
      lastNormalized = prepared.image;
      if (prepared.corners) {
        track = pushTrack(track, sampleFromQuad(prepared.corners, prepared.score));
        track = { ...track, stable: true };
      }
      await runRecognize(prepared);
      return snap();
    },

    setActiveTrackId(trackId) {
      quadTrackId = trackId;
      lastDetection = { ...lastDetection, trackId };
    },

    async recognizeFrozenCapture(input) {
      frozenCaptureActive = true;
      try {
        const trackId = input.trackId ?? lastDetection.trackId ?? quadTrackId ?? 1;
        quadTrackId = trackId;
        lastDetection = { ...lastDetection, trackId };
        if (lockedAt == null) lockedAt = performance.now();
        if (lockCommittedAt == null) lockCommittedAt = performance.now();
        setPhase('locking', 'frozen capture');
        track = pushTrack(emptyTrack(), sampleFromQuad(input.recognitionQuad, 1));
        track = { ...track, stable: true };
        const card: PreparedCard = {
          corners: input.recognitionQuad,
          detected: true,
          detection: lastDetection,
          image: input.source,
          score: 1,
          source: 'detected',
        };
        await runRecognize(card, {
          ...input.helpers,
          getFrozenRecognitionInput: () => ({
            captureAt: input.captureAt ?? null,
            recognitionQuad: input.recognitionQuad,
            source: input.source,
          }),
        });
        return snap();
      } finally {
        frozenCaptureActive = false;
      }
    },

    reset() {
      enterSearching('Place a card in view');
      lastDetection = emptyDetectionDebug();
      analysisSize = null;
      detectorAttempts = 0;
      detectorHits = 0;
      detectorMisses = 0;
      lastHitAt = null;
      cornerOrderCorrections = 0;
      hitIntervals.length = 0;
      phaseTimeline = [];
      recognizeInvocations = 0;
      focusRequests = 0;
      focusSuccesses = 0;
      focusTimeouts = 0;
      focusReentries = 0;
      highResRequests = 0;
      highResSuccess = 0;
      highResFailure = 0;
      lastHighResError = null;
      watchdogActivations = 0;
      attemptIdSeq = 0;
      recaptureUsedForTrack = false;
      geometryImprovementRetryUsedForTrack = false;
      lastRecognitionDecision = null;
      resetFocusAttempt();
      sessionResetReason = 'manual';
      changeWatch = emptyCardChangeWatch();
      resultCardSessionId = null;
      resultPossiblyStale = false;
      changeWatchProbePending = false;
    },

    mintDebugFocusAttempt() {
      const now = performance.now();
      focusAttemptId += 1;
      focusCardSessionId = cardSessionId;
      focusTrackId = lastDetection.trackId ?? localTrackId;
      focusRequestedAt = now;
      focusSuccessAt = null;
      focusResolvedAt = null;
      focusTimedOut = false;
      focusTimedOutAt = null;
      focusingSince = now;
      lastFocusRequestAt = now;
      focusRequests += 1;
      sessionResetReason = sessionResetReason ?? 'debug-focus-series';
      lastLockGates = fillGates({
        focusAttemptId,
        focusCardSessionId,
        focusRequestedAt,
        focusRequests,
        waiting: lastLockGates.waiting,
      });
    },

    markDebugCardSwapped() {
      beginCardSession(
        'manual-swap-test',
        null,
        changeWatch.currentFingerprint,
      );
      setPhase('focusing', 'debug mark card swapped');
      message = 'New card (manual)…';
      resultPossiblyStale = false;
      lastLockGates = fillGates({ waiting: 'manual-swap-test' });
    },

    snapshot: snap,
  };
};
