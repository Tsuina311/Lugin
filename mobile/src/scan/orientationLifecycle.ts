// Portrait-locked scanner: when is Frame.orientation allowed to drive detection?
//
// VisionCamera: Frame.orientation is the rotation of the pixel buffer relative
// to CameraFrameOutput.outputOrientation — not sensor-native rotation.
//
// The app is Expo-locked to portrait (`app.config.ts` orientation: 'portrait').
// The intended preview/output orientation is therefore always `'up'` (UI
// upright). We must assign that on the frame output immediately. Waiting for
// `useOrientation('device')` is what broke Samsung startup: that hook is
// `undefined` until a physical orientation *change*, so a still phone never
// wrote outputOrientation and the first frames used the native default
// (landscape buffer claiming orientation `'up'`).
//
// Coherence is a metadata check, not a hardcoded 90°: a portrait output
// cannot be already-upright (`'up'`/`'down'`) while the buffer is landscape.

import type { FrameOrientation } from './frameToScanImage';

/** UI-upright. The only correct initial target for a portrait-locked app. */
export const PORTRAIT_OUTPUT_ORIENTATION: FrameOrientation = 'up';

export const resolveDesiredOutputOrientation = (
  interfaceOrientation: string | undefined,
): FrameOrientation => {
  if (
    interfaceOrientation === 'up' ||
    interfaceOrientation === 'right' ||
    interfaceOrientation === 'down' ||
    interfaceOrientation === 'left'
  ) {
    return interfaceOrientation;
  }
  return PORTRAIT_OUTPUT_ORIENTATION;
};

const isPortrait = (orientation: FrameOrientation): boolean =>
  orientation === 'up' || orientation === 'down';

/**
 * Whether this frame's pixels + Frame.orientation can be the desired output.
 *
 * After outputOrientation is applied, a landscape sensor buffer aimed at a
 * portrait UI reports `'left'` or `'right'`. The stale startup state reports
 * `'up'` on that same landscape buffer — metadata claiming the pixels already
 * match the output, which they do not.
 */
export const isFrameCoherentWithOutput = (
  desired: FrameOrientation,
  frameWidth: number,
  frameHeight: number,
  frameOrientation: FrameOrientation,
): boolean => {
  if (frameWidth <= 0 || frameHeight <= 0) return false;
  const bufferPortrait = frameHeight >= frameWidth;
  const destPortrait = isPortrait(desired);
  if (destPortrait === bufferPortrait) return isPortrait(frameOrientation);
  return frameOrientation === 'left' || frameOrientation === 'right';
};

/** What frameToScanImage will apply, for the debug line. */
export const detectorRotationLabel = (frameOrientation: FrameOrientation): string => {
  switch (frameOrientation) {
    case 'right':
      return 'counter-rotate 90° CCW (Frame.orientation=right)';
    case 'left':
      return 'counter-rotate 90° CW (Frame.orientation=left)';
    case 'down':
      return 'rotate 180° (Frame.orientation=down)';
    default:
      return 'none (Frame.orientation=up)';
  }
};
