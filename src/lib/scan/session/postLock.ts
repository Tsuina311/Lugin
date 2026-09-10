// Post-lock handoff: capture quad, bounded retry, stall watchdog.
// Portable — no React / DOM. Used by SessionController and scan-test.

import {
  CAPTURE_STALE_CENTER,
  CAPTURE_STALE_IOU,
  POST_LOCK_STALL_MS,
  RECOGNIZE_MAX_ATTEMPTS,
  RECOGNIZE_RETRY_MS,
} from '../params';
import type { CardCorners, Point } from '../types';
import { attemptStatusFromOcr } from '../ocrAttempt';

export type RecognitionAttemptStatus =
  | 'running'
  | 'capture-failed'
  | 'crop-invalid'
  | 'ocr-empty'
  | 'ocr-unavailable'
  | 'ocr-native-error'
  | 'ocr-input-invalid'
  | 'insufficient-confidence'
  | 'card-ambiguous'
  | 'printing-ambiguous'
  | 'identified';

export interface RecognitionAttempt {
  attemptNumber: number;
  attemptQuad: CardCorners | null;
  completedAt: number | null;
  id: number;
  startedAt: number;
  status: RecognitionAttemptStatus;
  titleRawText?: string | null;
  titleScore?: number | null;
  titleTopCandidate?: string | null;
  trackId: number | null;
}

export interface QuadCompare {
  areaDelta: number;
  centerDelta: number;
  iou: number;
}

export interface PostLockDebug {
  attemptNumber: number;
  attemptStatus: RecognitionAttemptStatus | null;
  attempts: RecognitionAttempt[];
  highResCaptureCompletedAt: number | null;
  highResCaptureStartedAt: number | null;
  highResFailure: number;
  highResRequests: number;
  highResSuccess: number;
  lastHighResError: string | null;
  latestTrackedQuadAtCapture: CardCorners | null;
  lockCommittedAt: number | null;
  lockEligibleAt: number | null;
  phaseAfterRecognition: string | null;
  postLockStall: boolean;
  quadAtCaptureRequest: CardCorners | null;
  quadAtLock: CardCorners | null;
  quadActuallyUsedForWarp: CardCorners | null;
  quadIouCaptureVsLatest: number | null;
  quadStabilityAtCapture: number | null;
  quadTimestamp: number | null;
  quadTrackAge: number | null;
  quadTrackId: number | null;
  quadUsedForHighRes: CardCorners | null;
  recognitionAttemptId: number | null;
  recognitionCropCreatedAt: number | null;
  recognitionCropHeight: number | null;
  recognitionCropWidth: number | null;
  recognitionStatus: string | null;
  recognizeCompletedAt: number | null;
  recognizeInvocations: number;
  recognizeStartedAt: number | null;
  resultPublishedAt: number | null;
  retryReason: string | null;
  retryScheduledAt: number | null;
  titleOcrCompletedAt: number | null;
  titleOcrSubmittedAt: number | null;
  titleDecode: import('../titleDecode').TitleDecodeResult | null;
  titleMargin: number | null;
  titleRawText: string | null;
  titleScore: number | null;
  titleSecondScore: number | null;
  titleTopCandidate: string | null;
  titleTopScore: number | null;
  variantConsensusCount: number | null;
  trackHoldReason: string | null;
  trackUpdateReason: string | null;
  trackedQuadUpdatedAt: number | null;
  watchdogActivations: number;
  geometryImprovementRetryUsed: boolean;
  maxRecognizeAttempts: number;
  recaptureUsedForTrack: boolean;
  recognizeAttemptsForTrack: number;
  recognitionQuad: CardCorners | null;
  recognitionQuadSource: string | null;
  recognitionQuadValid: boolean | null;
  recognitionRejectReasons: string[];
  retryBudgetRemaining: number;
  trackingQuad: CardCorners | null;
  ocrInputHash: string | null;
  sameInputAsPreviousAttempt: boolean;
  duplicateInputSuppressed: boolean;
  duplicateOcrSkips: number;
  duplicateUploadsSuppressed: number;
  activeRecognitionAttemptId: number | null;
  recognitionResolvedAt: number | null;
  recognitionReturnedName: string | null;
  recognitionReturnedStatus: string | null;
  resultAccepted: boolean | null;
  resultApplicationPending: boolean;
  resultRejectReason: string | null;
  sourceImageHash: string | null;
  recognitionQuadHash: string | null;
  warpedCardHash: string | null;
  titleCropHash: string | null;
}

export const emptyPostLock = (): PostLockDebug => ({
  attemptNumber: 0,
  attemptStatus: null,
  attempts: [],
  highResCaptureCompletedAt: null,
  highResCaptureStartedAt: null,
  highResFailure: 0,
  highResRequests: 0,
  highResSuccess: 0,
  lastHighResError: null,
  latestTrackedQuadAtCapture: null,
  lockCommittedAt: null,
  lockEligibleAt: null,
  phaseAfterRecognition: null,
  postLockStall: false,
  quadAtCaptureRequest: null,
  quadAtLock: null,
  quadActuallyUsedForWarp: null,
  quadIouCaptureVsLatest: null,
  quadStabilityAtCapture: null,
  quadTimestamp: null,
  quadTrackAge: null,
  quadTrackId: null,
  quadUsedForHighRes: null,
  recognitionAttemptId: null,
  recognitionCropCreatedAt: null,
  recognitionCropHeight: null,
  recognitionCropWidth: null,
  recognitionStatus: null,
  recognizeCompletedAt: null,
  recognizeInvocations: 0,
  recognizeStartedAt: null,
  resultPublishedAt: null,
  retryReason: null,
  retryScheduledAt: null,
  titleOcrCompletedAt: null,
  titleOcrSubmittedAt: null,
  titleDecode: null,
  titleMargin: null,
  titleRawText: null,
  titleScore: null,
  titleSecondScore: null,
  titleTopCandidate: null,
  titleTopScore: null,
  variantConsensusCount: null,
  trackHoldReason: null,
  trackUpdateReason: null,
  trackedQuadUpdatedAt: null,
  watchdogActivations: 0,
  geometryImprovementRetryUsed: false,
  maxRecognizeAttempts: RECOGNIZE_MAX_ATTEMPTS,
  recaptureUsedForTrack: false,
  recognizeAttemptsForTrack: 0,
  recognitionQuad: null,
  recognitionQuadSource: null,
  recognitionQuadValid: null,
  recognitionRejectReasons: [],
  retryBudgetRemaining: RECOGNIZE_MAX_ATTEMPTS,
  trackingQuad: null,
  ocrInputHash: null,
  sameInputAsPreviousAttempt: false,
  duplicateInputSuppressed: false,
  duplicateOcrSkips: 0,
  duplicateUploadsSuppressed: 0,
  activeRecognitionAttemptId: null,
  recognitionResolvedAt: null,
  recognitionReturnedName: null,
  recognitionReturnedStatus: null,
  resultAccepted: null,
  resultApplicationPending: false,
  resultRejectReason: null,
  sourceImageHash: null,
  recognitionQuadHash: null,
  warpedCardHash: null,
  titleCropHash: null,
});

const pts = (c: CardCorners): Point[] => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];

const quadArea = (c: CardCorners): number => {
  const p = pts(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const q = p[(i + 1) % 4];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
};

const quadCenter = (c: CardCorners): Point => ({
  x: (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) / 4,
  y: (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) / 4,
});

const diagonal = (c: CardCorners): number => {
  const d1 = Math.hypot(c.bottomRight.x - c.topLeft.x, c.bottomRight.y - c.topLeft.y);
  const d2 = Math.hypot(c.bottomLeft.x - c.topRight.x, c.bottomLeft.y - c.topRight.y);
  return Math.max(d1, d2, 1);
};

const aabb = (c: CardCorners): { x0: number; y0: number; x1: number; y1: number } => {
  const xs = [c.topLeft.x, c.topRight.x, c.bottomRight.x, c.bottomLeft.x];
  const ys = [c.topLeft.y, c.topRight.y, c.bottomRight.y, c.bottomLeft.y];
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
};

export const compareQuads = (a: CardCorners, b: CardCorners): QuadCompare => {
  const A = aabb(a);
  const B = aabb(b);
  const x0 = Math.max(A.x0, B.x0);
  const y0 = Math.max(A.y0, B.y0);
  const x1 = Math.min(A.x1, B.x1);
  const y1 = Math.min(A.y1, B.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(1, (A.x1 - A.x0) * (A.y1 - A.y0));
  const areaB = Math.max(1, (B.x1 - B.x0) * (B.y1 - B.y0));
  const union = areaA + areaB - inter;
  const iou = union > 1e-6 ? inter / union : 0;
  const ca = quadCenter(a);
  const cb = quadCenter(b);
  const areaAPoly = quadArea(a);
  const areaBPoly = quadArea(b);
  return {
    areaDelta: Math.abs(areaAPoly - areaBPoly) / Math.max(areaAPoly, areaBPoly, 1),
    centerDelta: Math.hypot(ca.x - cb.x, ca.y - cb.y) / diagonal(b),
    iou,
  };
};

export const shouldReplaceCaptureQuad = (
  used: CardCorners | null,
  latest: CardCorners | null,
  staleIou = CAPTURE_STALE_IOU,
  staleCenter = CAPTURE_STALE_CENTER,
): QuadCompare & { replace: boolean } => {
  if (!used || !latest) {
    return { areaDelta: 0, centerDelta: 0, iou: 1, replace: false };
  }
  const cmp = compareQuads(used, latest);
  return {
    ...cmp,
    replace: cmp.iou < staleIou || cmp.centerDelta > staleCenter,
  };
};

export const assertRecognizeBudget = (
  used: number,
  max = RECOGNIZE_MAX_ATTEMPTS,
): void => {
  if (used <= max) return;
  const msg = `SCANNER_RETRY_BUDGET_BROKEN recognizeAttemptsForTrack=${used} max=${max}`;
  console.error(msg);
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    throw new Error(msg);
  }
};

export const nextAfterFailedRecognition = (args: {
  attemptsUsed: number;
  maxAttempts?: number;
  trackPresent: boolean;
}): { action: 'retry' | 'insufficient' | 'searching'; reason: string } => {
  if (!args.trackPresent) return { action: 'searching', reason: 'card gone' };
  const max = args.maxAttempts ?? RECOGNIZE_MAX_ATTEMPTS;
  if (args.attemptsUsed >= max) {
    return { action: 'insufficient', reason: 'max recognition attempts' };
  }
  return { action: 'retry', reason: 'insufficient-confidence' };
};

export const postLockStallActive = (args: {
  hasResult: boolean;
  highResRequests: number;
  lastProgressAt: number | null;
  now: number;
  recognizing: boolean;
  resultApplicationPending?: boolean;
  retryScheduled: boolean;
  stallMs?: number;
}): boolean => {
  if (args.highResRequests <= 0) return false;
  if (args.recognizing || args.resultApplicationPending || args.hasResult || args.retryScheduled) {
    return false;
  }
  if (args.lastProgressAt == null) return false;
  return args.now - args.lastProgressAt > (args.stallMs ?? POST_LOCK_STALL_MS);
};

export const attemptStatusFromIdentity = (args: {
  fusedStatus: string | null | undefined;
  nativeError?: { code: string; message: string } | null;
  ocrInputInvalid?: boolean;
  ocrSkippedReason?: string | null;
  titleRawText: string | null | undefined;
}): RecognitionAttemptStatus => attemptStatusFromOcr(args);

export { CAPTURE_STALE_CENTER, CAPTURE_STALE_IOU, POST_LOCK_STALL_MS, RECOGNIZE_MAX_ATTEMPTS, RECOGNIZE_RETRY_MS };
