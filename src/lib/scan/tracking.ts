// Track a detected card across frames and decide when it is stable enough
// for expensive recognition. Pure geometry — no DOM.

import { dist, type Quad } from './geometry';
import {
  STABILITY_MAX_AREA_CHANGE,
  STABILITY_MAX_CORNER_MOVE,
  STABILITY_WINDOW,
  TRACK_COAST_FRAMES,
  TRACK_SMOOTH_ALPHA,
} from './params';
import type { CardCorners, Point } from './types';

export interface TrackSample {
  area: number;
  corners: CardCorners;
  score: number;
  /** Wall-clock ms, for age; optional in offline harness. */
  t?: number;
}

export interface TrackState {
  /** Consecutive frames without a detection while coasting. */
  coast: number;
  history: TrackSample[];
  /** Smoothed corners for overlay (EMA). */
  smoothed: CardCorners | null;
  /** True when the last STABILITY_WINDOW samples agree geometrically. */
  stable: boolean;
}

export const emptyTrack = (): TrackState => ({
  coast: 0,
  history: [],
  smoothed: null,
  stable: false,
});

const cornerList = (c: CardCorners): Point[] => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];

const quadArea = (c: CardCorners): number => {
  const pts = cornerList(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % 4];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

const meanCornerMove = (a: CardCorners, b: CardCorners): number => {
  const pa = cornerList(a);
  const pb = cornerList(b);
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += dist(pa[i], pb[i]);
  return sum / 4;
};

const diagonal = (c: CardCorners): number =>
  Math.max(dist(c.topLeft, c.bottomRight), dist(c.topRight, c.bottomLeft), 1);

const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x * (1 - t) + b.x * t,
  y: a.y * (1 - t) + b.y * t,
});

const smoothCorners = (
  prev: CardCorners | null,
  next: CardCorners,
  alpha = TRACK_SMOOTH_ALPHA,
): CardCorners => {
  if (!prev) return next;
  // next weight = 1 - alpha
  const w = 1 - alpha;
  return {
    bottomLeft: lerpPoint(prev.bottomLeft, next.bottomLeft, w),
    bottomRight: lerpPoint(prev.bottomRight, next.bottomRight, w),
    topLeft: lerpPoint(prev.topLeft, next.topLeft, w),
    topRight: lerpPoint(prev.topRight, next.topRight, w),
  };
};

/**
 * Push a detection into the track.
 *
 * `null` does not immediately clear history — brief misses are coasted so a
 * single bad frame does not drop a locked card. After TRACK_COAST_FRAMES misses
 * the track resets.
 */
export const pushTrack = (
  state: TrackState,
  sample: TrackSample | null,
  window = STABILITY_WINDOW,
): TrackState => {
  if (!sample) {
    const coast = state.coast + 1;
    if (coast > TRACK_COAST_FRAMES || !state.history.length) {
      return emptyTrack();
    }
    return {
      ...state,
      coast,
      stable: false,
    };
  }

  const next: TrackSample = {
    ...sample,
    area: sample.area || quadArea(sample.corners),
  };
  const history = [...state.history, next].slice(-Math.max(2, window + 2));
  const smoothed = smoothCorners(state.smoothed, next.corners);

  if (history.length < window) {
    return { coast: 0, history, smoothed, stable: false };
  }

  const recent = history.slice(-window);
  let stable = true;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const cur = recent[i];
    const move = meanCornerMove(prev.corners, cur.corners) / diagonal(cur.corners);
    if (move > STABILITY_MAX_CORNER_MOVE) {
      stable = false;
      break;
    }
    const areaDelta =
      Math.abs(cur.area - prev.area) / Math.max(cur.area, prev.area, 1);
    if (areaDelta > STABILITY_MAX_AREA_CHANGE) {
      stable = false;
      break;
    }
  }
  return { coast: 0, history, smoothed, stable };
};

/** Overlay / lock corners: prefer EMA-smoothed when available. */
export const latestCorners = (state: TrackState): CardCorners | null =>
  state.smoothed ??
  (state.history.length ? state.history[state.history.length - 1].corners : null);

/** Mean corner motion (fraction of diagonal) over the track window. */
export const trackMotion = (state: TrackState): number => {
  if (state.history.length < 2) return 1;
  const a = state.history[state.history.length - 2];
  const b = state.history[state.history.length - 1];
  return meanCornerMove(a.corners, b.corners) / diagonal(b.corners);
};

export const sampleFromQuad = (
  corners: CardCorners,
  score: number,
  t?: number,
): TrackSample => ({
  area: quadArea(corners),
  corners,
  score,
  t,
});

export const geometryChanged = (
  a: CardCorners,
  b: CardCorners,
  threshold = STABILITY_MAX_CORNER_MOVE * 4,
): boolean => meanCornerMove(a, b) / diagonal(b) > threshold;

export const areaOfQuad = (q: Quad): number => {
  const pts = [q[0], q[1], q[2], q[3]];
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const r = pts[(i + 1) % 4];
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};
