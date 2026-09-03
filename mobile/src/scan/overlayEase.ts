// Presentation interpolation for the preview polygon.
//
// The detector updates at ~6–10 Hz. The preview runs at 30–60 Hz. This eases
// the drawn quad toward the latest *confirmed* detection. It does not invent
// geometry: no extrapolation, and the polygon clears when detections stop.

import type { CardCorners, Point2D } from './sharedCore';

/** Weight of the previous display toward the new target per tick (0–1). */
export const OVERLAY_EASE = 0.35;
/** Drop the polygon if no detection arrives within this window. */
export const OVERLAY_STALE_MS = 220;

const lerp = (a: Point2D, b: Point2D, t: number): Point2D => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const easeCorners = (
  current: CardCorners | null,
  target: CardCorners,
  alpha = 1 - OVERLAY_EASE,
): CardCorners => {
  if (!current) return target;
  return {
    bottomLeft: lerp(current.bottomLeft, target.bottomLeft, alpha),
    bottomRight: lerp(current.bottomRight, target.bottomRight, alpha),
    topLeft: lerp(current.topLeft, target.topLeft, alpha),
    topRight: lerp(current.topRight, target.topRight, alpha),
  };
};

export interface OverlayClock {
  display: CardCorners | null;
  targetAt: number;
}

export const tickOverlay = (
  state: OverlayClock,
  target: CardCorners | null,
  now: number,
  staleMs = OVERLAY_STALE_MS,
): OverlayClock => {
  if (target) {
    return { display: easeCorners(state.display, target), targetAt: now };
  }
  if (state.display && now - state.targetAt > staleMs) {
    return { display: null, targetAt: state.targetAt };
  }
  return state;
};
