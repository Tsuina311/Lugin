// Track a detected card across frames and decide when it is stable enough
// for expensive recognition. Pure geometry — no DOM.

import { dist, type Quad } from './geometry';
import {
  STABILITY_MAX_AREA_CHANGE,
  STABILITY_MAX_CORNER_MOVE,
  STABILITY_WINDOW,
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
  history: TrackSample[];
  /** True when the last STABILITY_WINDOW samples agree geometrically. */
  stable: boolean;
}

export const emptyTrack = (): TrackState => ({ history: [], stable: false });

const cornerList = (c: CardCorners): Point[] => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];

const quadArea = (c: CardCorners): number => {
  // Shoelace on the ordered corners.
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
  Math.max(
    dist(c.topLeft, c.bottomRight),
    dist(c.topRight, c.bottomLeft),
    1,
  );

/**
 * Push a detection into the track. Pass `null` when the frame has no card —
 * that clears stability and ages out the history so a later card starts fresh.
 */
export const pushTrack = (
  state: TrackState,
  sample: TrackSample | null,
  window = STABILITY_WINDOW,
): TrackState => {
  if (!sample) return { history: [], stable: false };

  const next: TrackSample = {
    ...sample,
    area: sample.area || quadArea(sample.corners),
  };
  const history = [...state.history, next].slice(-Math.max(2, window));
  if (history.length < window) return { history, stable: false };

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
  return { history, stable };
};

/** Latest tracked corners, if any. */
export const latestCorners = (state: TrackState): CardCorners | null =>
  state.history.length ? state.history[state.history.length - 1].corners : null;

/** Convert a Quad into a TrackSample (area computed). */
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

/** True when two quads are far enough apart to count as a different card. */
export const geometryChanged = (
  a: CardCorners,
  b: CardCorners,
  threshold = STABILITY_MAX_CORNER_MOVE * 4,
): boolean => meanCornerMove(a, b) / diagonal(b) > threshold;

/** Quad helper for callers that still hold geometry.Quad. */
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
