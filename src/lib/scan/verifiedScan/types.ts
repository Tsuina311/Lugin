/**
 * Verified Scan — one explicit card at a time.
 * NEXT / ADD+NEXT is the authoritative session boundary (not Card Change Watch).
 */

export type VerifiedScanPhase =
  | 'ready'
  | 'acquiring'
  | 'captured'
  | 'identifying'
  | 'result'
  | 'failed';

export type VerifiedCorrectionType =
  | 'NONE'
  | 'CARD_CHANGED'
  | 'PRINTING_CHANGED'
  | 'LANGUAGE_CHANGED'
  | 'OTHER';

export type VerifiedScanTiming = {
  cardSessionStartedAt: number | null;
  firstQuadAt: number | null;
  firstCaptureSafeAt: number | null;
  lockAt: number | null;
  captureLockedAt: number | null;
  captureRequestedAt: number | null;
  captureDoneAt: number | null;
  warpStartedAt: number | null;
  warpDoneAt: number | null;
  previewEncodeStartAt: number | null;
  previewEncodeDoneAt: number | null;
  previewStateCommittedAt: number | null;
  /**
   * Double-rAF / fallback barrier after preview commit — not a proven GPU paint.
   * Prefer this name in new code; previewPaintConfirmedAt kept as alias.
   */
  previewPaintBarrierPassedAt: number | null;
  /** @deprecated alias of previewPaintBarrierPassedAt */
  previewPaintConfirmedAt: number | null;
  /** @deprecated alias of previewPaintBarrierPassedAt for older readers */
  previewDisplayedAt: number | null;
  recognitionStartAt: number | null;
  titleOcrStartedAt: number | null;
  titleOcrDoneAt: number | null;
  identityAt: number | null;
  printingResolvedAt: number | null;
  resultShownAt: number | null;
  terminalAt: number | null;
  nextPressedAt: number | null;
  nextFirstQuadAt: number | null;
};

export type VerifiedScanDerivedMs = {
  sessionToFirstQuadMs: number | null;
  firstQuadToSafeMs: number | null;
  safeToLockMs: number | null;
  lockToCaptureDoneMs: number | null;
  captureDoneToWarpMs: number | null;
  warpToPreviewEncodeMs: number | null;
  previewEncodeMs: number | null;
  paintToRecognitionMs: number | null;
  recognitionToIdentityMs: number | null;
  sessionToIdentityMs: number | null;
  nextToFirstQuadMs: number | null;
};

export const emptyVerifiedScanTiming = (): VerifiedScanTiming => ({
  cardSessionStartedAt: null,
  firstQuadAt: null,
  firstCaptureSafeAt: null,
  lockAt: null,
  captureLockedAt: null,
  captureRequestedAt: null,
  captureDoneAt: null,
  warpStartedAt: null,
  warpDoneAt: null,
  previewEncodeStartAt: null,
  previewEncodeDoneAt: null,
  previewStateCommittedAt: null,
  previewPaintBarrierPassedAt: null,
  previewPaintConfirmedAt: null,
  previewDisplayedAt: null,
  recognitionStartAt: null,
  titleOcrStartedAt: null,
  titleOcrDoneAt: null,
  identityAt: null,
  printingResolvedAt: null,
  resultShownAt: null,
  terminalAt: null,
  nextPressedAt: null,
  nextFirstQuadAt: null,
});

const delta = (a: number | null, b: number | null): number | null =>
  a != null && b != null ? Math.max(0, b - a) : null;

export const deriveVerifiedScanMs = (t: VerifiedScanTiming): VerifiedScanDerivedMs => {
  const paint =
    t.previewPaintBarrierPassedAt ?? t.previewPaintConfirmedAt ?? t.previewDisplayedAt;
  return {
    sessionToFirstQuadMs: delta(t.cardSessionStartedAt, t.firstQuadAt),
    firstQuadToSafeMs: delta(t.firstQuadAt, t.firstCaptureSafeAt),
    safeToLockMs: delta(t.firstCaptureSafeAt, t.lockAt ?? t.captureLockedAt),
    lockToCaptureDoneMs: delta(t.lockAt ?? t.captureLockedAt, t.captureDoneAt),
    captureDoneToWarpMs: delta(t.captureDoneAt, t.warpDoneAt),
    warpToPreviewEncodeMs: delta(t.warpDoneAt, t.previewEncodeStartAt),
    previewEncodeMs: delta(t.previewEncodeStartAt, t.previewEncodeDoneAt),
    paintToRecognitionMs: delta(paint, t.recognitionStartAt),
    recognitionToIdentityMs: delta(t.recognitionStartAt, t.identityAt),
    sessionToIdentityMs: delta(t.cardSessionStartedAt, t.identityAt),
    nextToFirstQuadMs: delta(t.nextPressedAt, t.nextFirstQuadAt),
  };
};

export const markFirstVerified = <K extends keyof VerifiedScanTiming>(
  t: VerifiedScanTiming,
  key: K,
  at: number,
): VerifiedScanTiming => {
  if (t[key] != null) return t;
  return { ...t, [key]: at };
};

/** While result is open, Card Change Watch must not advance the session. */
export const verifiedScanBlocksChangeWatch = (phase: VerifiedScanPhase): boolean =>
  phase === 'captured' ||
  phase === 'identifying' ||
  phase === 'result' ||
  phase === 'failed';

export const verifiedScanBlocksAcquisition = (phase: VerifiedScanPhase): boolean =>
  verifiedScanBlocksChangeWatch(phase);
