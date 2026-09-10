// Turn a live `detectCardQuad` result into the PreparedCard the session
// controller expects — without warping to 744×1039 on every search frame.

import type { DetectResult, PreparedCard, ScanImage } from './sharedCore';
import { DETECT_MIN_SCORE } from './sharedCore';

export const preparedFromDetection = (
  image: ScanImage,
  detection: DetectResult,
): PreparedCard => {
  const lock = detection.lockCorners ?? detection.trackedCorners ?? detection.corners;
  const detected = Boolean(lock) && detection.score >= DETECT_MIN_SCORE;
  return {
    corners: detected ? lock : null,
    detected,
    detection: detection.debug,
    image,
    score: detection.score,
    source: detected ? 'detected' : 'whole-frame',
  };
};
