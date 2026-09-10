// Track a detected card across frames and decide when it is stable enough
// for expensive recognition. Pure geometry — no DOM.

import { dist, type Quad } from './geometry';
import {
  STABILITY_MAX_AREA_CHANGE,
  STABILITY_MAX_CENTER_MOVE,
  STABILITY_MAX_CORNER_MOVE,
  STABILITY_MIN_IOU,
  STABILITY_WINDOW,
  TRACK_COAST_FRAMES,
  TRACK_SMOOTH_ALPHA,
} from './params';
import type { CardCorners, Point } from './types';

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

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
  /** Trailing samples that pairwise agree (0 while building). */
  consecutiveStable: number;
  history: TrackSample[];
  /** AABB IoU vs previous sample (1 = identical). */
  lastIou: number;
  lastAreaDelta: number;
  lastCenterDelta: number;
  lastRotationDelta: number;
  /** Mean corner move as a fraction of diagonal. */
  lastMove: number;
  /** Smoothed corners for overlay (EMA). */
  smoothed: CardCorners | null;
  /** True when the last STABILITY_WINDOW samples agree geometrically. */
  stable: boolean;
  /** When `stable` first became true for this lock (ms). */
  stableSince: number | null;
}

export const emptyTrack = (): TrackState => ({
  coast: 0,
  consecutiveStable: 0,
  history: [],
  lastAreaDelta: 0,
  lastCenterDelta: 1,
  lastIou: 0,
  lastMove: 1,
  lastRotationDelta: 0,
  smoothed: null,
  stable: false,
  stableSince: null,
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

const aabb = (c: CardCorners): { x0: number; y0: number; x1: number; y1: number } => {
  const xs = [c.topLeft.x, c.topRight.x, c.bottomRight.x, c.bottomLeft.x];
  const ys = [c.topLeft.y, c.topRight.y, c.bottomRight.y, c.bottomLeft.y];
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
};

const aabbIou = (a: CardCorners, b: CardCorners): number => {
  const A = aabb(a);
  const B = aabb(b);
  const x0 = Math.max(A.x0, B.x0);
  const y0 = Math.max(A.y0, B.y0);
  const x1 = Math.min(A.x1, B.x1);
  const y1 = Math.min(A.y1, B.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(1, (A.x1 - A.x0) * (A.y1 - A.y0));
  const areaB = Math.max(1, (B.x1 - B.x0) * (B.y1 - B.y0));
  const union = areaA + areaB - inter;
  return union > 1e-6 ? inter / union : 0;
};

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
    // Grace: a single native miss must not drop a lock that already formed.
    return {
      ...state,
      coast,
      stable: state.stable,
      stableSince: state.stable ? state.stableSince : null,
    };
  }

  const next: TrackSample = {
    ...sample,
    area: sample.area || quadArea(sample.corners),
  };
  const prev = state.history.length ? state.history[state.history.length - 1] : null;
  const lastMove = prev
    ? meanCornerMove(prev.corners, next.corners) / diagonal(next.corners)
    : 1;
  const lastAreaDelta = prev
    ? Math.abs(next.area - prev.area) / Math.max(next.area, prev.area, 1)
    : 0;
  const lastIou = prev ? aabbIou(prev.corners, next.corners) : 0;
  const lastCenterDelta = prev
    ? (() => {
        const ca = {
          x:
            (prev.corners.topLeft.x +
              prev.corners.topRight.x +
              prev.corners.bottomRight.x +
              prev.corners.bottomLeft.x) /
            4,
          y:
            (prev.corners.topLeft.y +
              prev.corners.topRight.y +
              prev.corners.bottomRight.y +
              prev.corners.bottomLeft.y) /
            4,
        };
        const cb = {
          x:
            (next.corners.topLeft.x +
              next.corners.topRight.x +
              next.corners.bottomRight.x +
              next.corners.bottomLeft.x) /
            4,
          y:
            (next.corners.topLeft.y +
              next.corners.topRight.y +
              next.corners.bottomRight.y +
              next.corners.bottomLeft.y) /
            4,
        };
        return Math.hypot(ca.x - cb.x, ca.y - cb.y) / diagonal(next.corners);
      })()
    : 1;
  const lastRotationDelta = prev
    ? (() => {
        const a = Math.atan2(
          prev.corners.topRight.y - prev.corners.topLeft.y,
          prev.corners.topRight.x - prev.corners.topLeft.x,
        );
        const b = Math.atan2(
          next.corners.topRight.y - next.corners.topLeft.y,
          next.corners.topRight.x - next.corners.topLeft.x,
        );
        let d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return Math.abs(d);
      })()
    : 0;
  const history = [...state.history, next].slice(-Math.max(2, window + 2));
  const smoothed = smoothCorners(state.smoothed, next.corners);

  if (history.length < window) {
    return {
      coast: 0,
      consecutiveStable: history.length,
      history,
      lastAreaDelta,
      lastCenterDelta,
      lastIou,
      lastMove,
      lastRotationDelta,
      smoothed,
      stable: false,
      stableSince: null,
    };
  }

  const recent = history.slice(-window);
  let stable = true;
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1];
    const cur = recent[i];
    const move = meanCornerMove(a.corners, cur.corners) / diagonal(cur.corners);
    const areaDelta = Math.abs(cur.area - a.area) / Math.max(cur.area, a.area, 1);
    const iou = aabbIou(a.corners, cur.corners);
    const center =
      (() => {
        const ca = {
          x: (a.corners.topLeft.x + a.corners.topRight.x + a.corners.bottomRight.x + a.corners.bottomLeft.x) / 4,
          y: (a.corners.topLeft.y + a.corners.topRight.y + a.corners.bottomRight.y + a.corners.bottomLeft.y) / 4,
        };
        const cb = {
          x: (cur.corners.topLeft.x + cur.corners.topRight.x + cur.corners.bottomRight.x + cur.corners.bottomLeft.x) / 4,
          y: (cur.corners.topLeft.y + cur.corners.topRight.y + cur.corners.bottomRight.y + cur.corners.bottomLeft.y) / 4,
        };
        return Math.hypot(ca.x - cb.x, ca.y - cb.y) / diagonal(cur.corners);
      })();
    const tightCorners = move <= STABILITY_MAX_CORNER_MOVE && areaDelta <= STABILITY_MAX_AREA_CHANGE;
    const robust =
      iou >= STABILITY_MIN_IOU &&
      center <= STABILITY_MAX_CENTER_MOVE &&
      areaDelta <= STABILITY_MAX_AREA_CHANGE;
    if (!tightCorners && !robust) {
      stable = false;
      break;
    }
  }
  const consecutiveStable = stable ? window : Math.min(history.length, window - 1);
  const stableSince = stable ? (state.stableSince ?? nowMs()) : null;
  return {
    coast: 0,
    consecutiveStable,
    history,
    lastAreaDelta,
    lastCenterDelta,
    lastIou,
    lastMove,
    lastRotationDelta,
    smoothed,
    stable,
    stableSince,
  };
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
