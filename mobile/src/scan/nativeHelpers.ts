// Native FrameHelpers for SessionController.
//
// Focus: controller already throttles (700 ms / 1600 ms + 0.04). This helper
// must not add a second throttle. It does ignore card-center focus for a short
// window after a user tap so the two do not fight.
//
// refineCard: cached true hi-res, or labeled analysis-fallback after the wait.

import type { CameraRef } from 'react-native-vision-camera';

import {
  canRecognizeFromStore,
  putFallback,
  refineFromStore,
  type HiResStore,
} from './hiresCapture';
import type { HiResSpaces } from './hiresCapture';
import { preparedFromDetection } from './preparedFromDetection';
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
  lastTapAt: number;
  preview: { height: number; width: number };
  /** Kick async hi-res capture when the controller first asks to recognize. */
  requestCapture: (() => void) | null;
  spaces: HiResSpaces | null;
  store: HiResStore;
}

export const createNativeHelperState = (store: HiResStore): NativeHelperState => ({
  analysis: null,
  detection: null,
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
    if (state.store.waitStartedAt == null) state.store.waitStartedAt = Date.now();
    // Ensure capture is in flight before the controller may fall back.
    state.requestCapture?.();
    return canRecognizeFromStore(state.store);
  },
  prepareAnalysis: (frame: ScanImage): PreparedCard | null => {
    if (!state.detection || state.analysis !== frame) return null;
    return preparedFromDetection(frame, state.detection);
  },
  refineCard: (corners: CardCorners): PreparedCard | null => {
    const cached = refineFromStore(state.store);
    if (cached) return cached;
    // Wait window elapsed (or capture finished as fallback) — label analysis.
    if (
      canRecognizeFromStore(state.store) &&
      state.analysis &&
      state.detection?.corners &&
      !state.store.inFlight
    ) {
      if (state.store.cache?.attempt.mode === 'analysis-fallback') {
        return state.store.cache.prepared;
      }
      return putFallback(
        state.store,
        state.analysis,
        corners,
        state.detection.score,
        state.store.lastAttempt?.reason ?? 'hi-res wait elapsed — analysis fallback',
      );
    }
    return null;
  },
  requestFocusNorm: (x: number, y: number) => {
    if (Date.now() - state.lastTapAt < TAP_FOCUS_GUARD_MS) return;
    requestFocusOnCamera(camera.current, state.preview, x, y);
  },
});
