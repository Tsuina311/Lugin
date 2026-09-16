/** Per-cardSession acquisition waterfall — device + deck telemetry. */

export type WhyNotStable =
  | 'QUAD_MOVING'
  | 'LOW_DETECT_SCORE'
  | 'ASPECT_IMPLAUSIBLE'
  | 'ROLE_UNCERTAIN'
  | 'SLEEVE_AMBIGUITY'
  | 'FOCUS_WAIT'
  | 'TITLE_BAND_INVALID'
  | 'RECOGNITION_QUAD_INVALID'
  | 'STABILITY_WINDOW'
  | 'CLIPPED'
  | 'AWAITING_HIRES'
  | 'OTHER'
  | null;

export type AcquisitionTiming = {
  cardSessionId: number;
  sessionStartedAt: number | null;
  firstDetectorFrameAt: number | null;
  firstRawQuadAt: number | null;
  firstPlausibleCardQuadAt: number | null;
  firstTrackedQuadAt: number | null;
  firstPresentedQuadAt: number | null;
  geometryStableAt: number | null;
  focusStartAt: number | null;
  hiresCaptureStartAt: number | null;
  hiresCaptureDoneAt: number | null;
  recognitionStartAt: number | null;
  foundAt: number | null;
  lastDetectorMs: number | null;
  whyNotStable: WhyNotStable;
  fastAccept: boolean;
  fastPathUsed: boolean;
};

export const emptyAcquisitionTiming = (cardSessionId = 0): AcquisitionTiming => ({
  cardSessionId,
  sessionStartedAt: null,
  firstDetectorFrameAt: null,
  firstRawQuadAt: null,
  firstPlausibleCardQuadAt: null,
  firstTrackedQuadAt: null,
  firstPresentedQuadAt: null,
  geometryStableAt: null,
  focusStartAt: null,
  hiresCaptureStartAt: null,
  hiresCaptureDoneAt: null,
  recognitionStartAt: null,
  foundAt: null,
  lastDetectorMs: null,
  whyNotStable: null,
  fastAccept: false,
  fastPathUsed: false,
});

export type AcquisitionDerivedMs = {
  sessionToFirstRawMs: number | null;
  firstRawToPresentedMs: number | null;
  firstRawToStableMs: number | null;
  stableToHiresMs: number | null;
  hiresToRecognitionMs: number | null;
  recognitionToFoundMs: number | null;
  sessionToFoundMs: number | null;
};

const delta = (a: number | null, b: number | null): number | null =>
  a != null && b != null ? Math.max(0, b - a) : null;

export const deriveAcquisitionMs = (t: AcquisitionTiming): AcquisitionDerivedMs => ({
  sessionToFirstRawMs: delta(t.sessionStartedAt, t.firstRawQuadAt),
  firstRawToPresentedMs: delta(t.firstRawQuadAt, t.firstPresentedQuadAt),
  firstRawToStableMs: delta(t.firstRawQuadAt, t.geometryStableAt),
  stableToHiresMs: delta(t.geometryStableAt, t.hiresCaptureDoneAt),
  hiresToRecognitionMs: delta(t.hiresCaptureDoneAt, t.recognitionStartAt),
  recognitionToFoundMs: delta(t.recognitionStartAt, t.foundAt),
  sessionToFoundMs: delta(t.sessionStartedAt, t.foundAt),
});

/** Mark first occurrence only. */
export const markFirst = (
  t: AcquisitionTiming,
  key: keyof AcquisitionTiming,
  at: number,
): AcquisitionTiming => {
  if (t[key] != null) return t;
  return { ...t, [key]: at };
};
