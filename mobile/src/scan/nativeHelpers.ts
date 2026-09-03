// Native FrameHelpers for SessionController.
//
// Focus: controller already throttles (700 ms / 1600 ms + 0.04). This helper
// must not add a second throttle. It does ignore card-center focus for a short
// window after a user tap so the two do not fight.
//
// refineCard: sync. Returns a cached hi-res warp or warps the last analysis
// frame. Photo / snapshot stay async and populate the cache from outside.

import type { CameraRef } from 'react-native-vision-camera';

import { refineFromStore, type HiResStore } from './hiresCapture';
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
  store: HiResStore;
}

export const createNativeHelperState = (store: HiResStore): NativeHelperState => ({
  analysis: null,
  detection: null,
  lastTapAt: 0,
  preview: { height: 0, width: 0 },
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
  prepareAnalysis: (frame: ScanImage): PreparedCard | null => {
    if (!state.detection || state.analysis !== frame) return null;
    return preparedFromDetection(frame, state.detection);
  },
  refineCard: (corners: CardCorners): PreparedCard | null =>
    refineFromStore(state.store, state.analysis, corners, state.detection?.score ?? 0),
  requestFocusNorm: (x: number, y: number) => {
    if (Date.now() - state.lastTapAt < TAP_FOCUS_GUARD_MS) return;
    requestFocusOnCamera(camera.current, state.preview, x, y);
  },
});
