// Native FrameHelpers for SessionController.
//
// Focus: controller already bounds attempts (FOCUS_ATTEMPT_MS / cooldown). This helper
// must not add a second throttle. It does ignore card-center focus for a short
// window after a user tap so the two do not fight.
//
// refineCard: cached true hi-res, or labeled analysis-fallback after the wait.

import type { CameraRef } from 'react-native-vision-camera';

import { isGeometryV2Pipeline } from '@/lib/scan/singleCardCapture';
import {
  canRecognizeFromStore,
  invalidateHiResCache,
  putFallback,
  refineFromStore,
  type HiResStore,
} from './hiresCapture';
import type { HiResSpaces } from './hiresCapture';
import { preparedFromDetection } from './preparedFromDetection';
import { softResetContinuityForCardSession } from './continuityBridge';
import type {
  CardCorners,
  DetectResult,
  FrameHelpers,
  PreparedCard,
  ScanImage,
} from './sharedCore';

/** Ignore automatic focus this long after a tap. */
export const TAP_FOCUS_GUARD_MS = 1800;

export interface NativeHelperState {
  analysis: ScanImage | null;
  detection: DetectResult | null;
  /** Live card session — used to reject stale hi-res owned by a prior session. */
  getCardSessionId: () => number | null;
  lastTapAt: number;
  preview: { height: number; width: number };
  /** Kick async hi-res capture when the controller first asks to recognize. */
  requestCapture: (() => void) | null;
  spaces: HiResSpaces | null;
  store: HiResStore;
}

export const createNativeHelperState = (
  store: HiResStore,
  getCardSessionId: () => number | null = () => null,
): NativeHelperState => ({
  analysis: null,
  detection: null,
  getCardSessionId,
  lastTapAt: 0,
  preview: { height: 0, width: 0 },
  requestCapture: null,
  spaces: null,
  store,
});

export const rememberTap = (state: NativeHelperState): void => {
  state.lastTapAt = Date.now();
};

export const requestFocusOnCamera = (
  camera: CameraRef | null,
  preview: { height: number; width: number },
  nx: number,
  ny: number,
): void => {
  if (!camera || preview.width <= 0 || preview.height <= 0) return;
  const x = Math.max(0, Math.min(preview.width, nx * preview.width));
  const y = Math.max(0, Math.min(preview.height, ny * preview.height));
  void camera
    .focusTo(
      { x, y },
      { adaptiveness: 'continuous', autoResetAfter: null, responsiveness: 'snappy' },
    )
    .catch(() => {
      // Focus is best-effort. The controller already has a timeout path.
    });
};

export const createFrameHelpers = (
  state: NativeHelperState,
  camera: { current: CameraRef | null },
): FrameHelpers => ({
  allowRecognize: () => {
    const sessionId = state.getCardSessionId();
    if (state.store.waitStartedAt == null) state.store.waitStartedAt = Date.now();
    // Drop prior-session frozen pixels before deciding readiness.
    const cache = state.store.cache;
    if (
      cache &&
      sessionId != null &&
      (cache.cardSessionId == null || cache.cardSessionId !== sessionId)
    ) {
      invalidateHiResCache(state.store, 'stale-capture-session');
    }
    // Ensure capture is in flight before the controller may fall back.
    state.requestCapture?.();
    return canRecognizeFromStore(state.store, undefined, sessionId);
  },
  prepareAnalysis: (frame: ScanImage): PreparedCard | null => {
    if (!state.detection || state.analysis !== frame) return null;
    return preparedFromDetection(frame, state.detection);
  },
  refineCard: (corners: CardCorners): PreparedCard | null => {
    const sessionId = state.getCardSessionId();
    const cached = refineFromStore(state.store, sessionId);
    if (cached) return cached;
    // Wait window elapsed (or capture finished as fallback) — label analysis.
    if (
      canRecognizeFromStore(state.store, undefined, sessionId) &&
      state.analysis &&
      state.detection?.corners &&
      !state.store.inFlight
    ) {
      if (
        state.store.cache?.attempt.mode === 'analysis-fallback' &&
        (state.store.cache.cardSessionId == null ||
          sessionId == null ||
          state.store.cache.cardSessionId === sessionId)
      ) {
        return state.store.cache.prepared;
      }
      return putFallback(
        state.store,
        state.analysis,
        corners,
        state.detection.score,
        state.store.lastAttempt?.reason ?? 'hi-res wait elapsed — analysis fallback',
        { cardSessionId: sessionId, captureId: null },
      );
    }
    return null;
  },
  requestFocusNorm: (x: number, y: number) => {
    // geometry-v2: no per-card AF in the critical path (Geometry acquisition model).
    if (isGeometryV2Pipeline()) return;
    if (Date.now() - state.lastTapAt < TAP_FOCUS_GUARD_MS) return;
    requestFocusOnCamera(camera.current, state.preview, x, y);
  },
  captureReport: () => {
    const snap = state.store.stats.snapshot;
    const photo = state.store.stats.photo;
    const frame = state.store.stats['high-res-frame'];
    const success = snap.success + photo.success + frame.success;
    const failure = snap.failure + photo.failure + frame.failure;
    const lastError = snap.lastError ?? photo.lastError ?? frame.lastError ?? state.store.lastAttempt?.reason ?? null;
    const startedAt = snap.lastRequestedAt ?? photo.lastRequestedAt ?? frame.lastRequestedAt ?? state.store.waitStartedAt;
    const completedAt = snap.lastCompletedAt ?? photo.lastCompletedAt ?? frame.lastCompletedAt ?? null;
    return {
      completedAt,
      corners: state.store.cache?.corners ?? null,
      error: lastError,
      failure,
      startedAt,
      success,
    };
  },
  invalidateCapture: (reason: string) => {
    invalidateHiResCache(state.store, reason);
  },
  softResetGeometry: (reason: string) => {
    softResetContinuityForCardSession(reason);
  },
  getFrozenRecognitionInput: () => {
    const cache = state.store.cache;
    if (!cache?.source || !cache.mapped) return null;
    if (cache.attempt.mode === 'analysis-fallback') return null;
    const sessionId = state.getCardSessionId();
    if (
      sessionId != null &&
      (cache.cardSessionId == null || cache.cardSessionId !== sessionId)
    ) {
      return null;
    }
    const snap = state.store.stats.snapshot;
    const photo = state.store.stats.photo;
    const frame = state.store.stats['high-res-frame'];
    return {
      captureAt: snap.lastCompletedAt ?? photo.lastCompletedAt ?? frame.lastCompletedAt ?? null,
      captureCardSessionId: cache.cardSessionId,
      captureId: cache.captureId,
      recognitionQuad: cache.mapped,
      source: cache.source,
      warped: cache.prepared?.image ?? null,
    };
  },
});
