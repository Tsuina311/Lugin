import type { DeckFailureClass } from './types';

/** Minimal live peek used by failure classification (phone + host tests). */
export type DeckFailurePeek = {
  detectorScore?: number | null;
  gates?: {
    focusTimedOut?: boolean;
    geometryDetected?: boolean;
    highResFailure?: number;
    highResRequests?: number;
    highResSuccess?: number;
  } | null;
  ocrAvailable?: boolean | null;
  phase?: string | null;
  presentedCorners?: unknown | null;
  rawCorners?: unknown | null;
  recognizeAttempts?: number | null;
  recognitionStatus?: string | null;
  trackedCorners?: unknown | null;
};

/** Host-facing class when Deck Benchmark saves without a successful identity. */
export const classifyDeckFailure = (live: DeckFailurePeek): DeckFailureClass => {
  const gates = live.gates;
  const status = (live.recognitionStatus || live.phase || '').toLowerCase();
  const detected = Boolean(
    gates?.geometryDetected || live.rawCorners || live.trackedCorners || live.presentedCorners,
  );
  if (!detected) return 'NO_DETECTION';
  if (
    live.ocrAvailable === false ||
    status.includes('ocr-unavailable') ||
    status.includes('no-ocr')
  ) {
    return 'OCR_UNAVAILABLE';
  }
  if (gates?.focusTimedOut && (gates.highResSuccess ?? 0) === 0) return 'FOCUS_TIMEOUT';
  if ((gates?.highResRequests ?? 0) > 0 && (gates?.highResSuccess ?? 0) === 0) {
    return 'NO_HIRES_CAPTURE';
  }
  if (
    detected &&
    !status.includes('found') &&
    !status.includes('identif') &&
    !status.includes('recog') &&
    (live.recognizeAttempts ?? 0) === 0
  ) {
    return 'DETECTED_NEVER_STABLE';
  }
  if ((live.recognizeAttempts ?? 0) > 0 || status.includes('recog') || status.includes('lock')) {
    return 'RECOGNITION_TIMEOUT';
  }
  return 'OTHER';
};
