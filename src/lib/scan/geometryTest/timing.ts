import type { GeometryTestDerivedMs, GeometryTestTiming } from './types';

const delta = (a: number | null, b: number | null): number | null =>
  a != null && b != null ? Math.max(0, b - a) : null;

export const deriveGeometryTestMs = (t: GeometryTestTiming): GeometryTestDerivedMs => {
  const buttonToWarpDoneMs = delta(t.buttonPressedAt, t.warpDoneAt);
  const displayedAt = t.previewDisplayedAt ?? t.imageDisplayedAt;
  const firstQuadAt = t.firstPlausibleQuadAt ?? t.firstRawQuadAt;
  const buttonToFirstQuadMs = delta(t.buttonPressedAt, firstQuadAt);
  const buttonToFirstCaptureSafeMs = delta(t.buttonPressedAt, t.firstCaptureSafeAt);
  return {
    buttonToFirstRawMs: delta(t.buttonPressedAt, t.firstRawQuadAt),
    buttonToFirstPlausibleMs: delta(t.buttonPressedAt, t.firstPlausibleQuadAt),
    buttonToFirstQuadMs,
    buttonToFirstCaptureSafeMs,
    firstQuadToFirstCaptureSafeMs: delta(firstQuadAt, t.firstCaptureSafeAt),
    captureSafeToLockMs: delta(t.firstCaptureSafeAt, t.captureQuadLockedAt),
    plausibleToLockMs: delta(t.firstPlausibleQuadAt, t.captureQuadLockedAt),
    buttonToCaptureRequestMs: delta(t.buttonPressedAt, t.captureRequestedAt),
    buttonToCaptureDoneMs: delta(t.buttonPressedAt, t.captureCompletedAt),
    buttonToWarpDoneMs,
    buttonToCaptureReadyMs: buttonToWarpDoneMs,
    buttonToDisplayMs: delta(t.buttonPressedAt, displayedAt),
    warpToPreviewEncodeMs: delta(t.warpDoneAt, t.cardPreviewEncodeStartAt),
    previewEncodeMs: delta(t.cardPreviewEncodeStartAt, t.cardPreviewEncodeDoneAt),
    previewEncodeToDisplayedMs: delta(t.cardPreviewEncodeDoneAt, displayedAt),
    warpToDisplayedMs: delta(t.warpDoneAt, displayedAt),
    warpToArtifactEncodeMs: delta(t.warpDoneAt, t.cardArtifactEncodeStartAt),
    artifactCardEncodeMs: delta(t.cardArtifactEncodeStartAt, t.cardArtifactEncodeDoneAt),
    artifactCardWriteMs: delta(t.cardFileWriteStartAt, t.cardFileWriteDoneAt),
    writeToFullResReadyMs: delta(t.cardFileWriteDoneAt, t.fullResPreviewReadyAt),
    displayToArtifactEncodeDoneMs: delta(displayedAt, t.artifactEncodeDoneAt),
    artifactEncodeMs: delta(t.artifactEncodeStartAt, t.artifactEncodeDoneAt),
  };
};

export const monoNow = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};
