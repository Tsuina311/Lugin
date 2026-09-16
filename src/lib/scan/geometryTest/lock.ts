/** Short confirmation lock for Geometry Test — independent of production stability. */

import { compareQuads } from '../session/postLock';
import type { CardCorners } from '../types';
import type { GeometryTestTiming } from './types';
import {
  GEOMETRY_TEST_CORNER_MOVE_AGREE,
  GEOMETRY_TEST_HIGH_SCORE,
  GEOMETRY_TEST_IOU_AGREE,
  GEOMETRY_TEST_MIN_SCORE,
} from './types';

const corner = (c: CardCorners, k: keyof CardCorners) => c[k];

export const meanNormalizedCornerMove = (a: CardCorners, b: CardCorners): number => {
  const keys: (keyof CardCorners)[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  let sum = 0;
  for (const k of keys) {
    const pa = corner(a, k);
    const pb = corner(b, k);
    sum += Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }
  const mean = sum / 4;
  const xs = keys.map(k => corner(b, k).x);
  const ys = keys.map(k => corner(b, k).y);
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return mean / Math.max(diag, 1);
};

export const framesRequiredForScore = (score: number): number =>
  score >= GEOMETRY_TEST_HIGH_SCORE ? 2 : 3;

export const quadsAgreeForGeometryLock = (prev: CardCorners, next: CardCorners): boolean => {
  const iou = compareQuads(prev, next).iou;
  if (iou >= GEOMETRY_TEST_IOU_AGREE) return true;
  return meanNormalizedCornerMove(prev, next) <= GEOMETRY_TEST_CORNER_MOVE_AGREE;
};

export type GeometryLockState = {
  agreeingStreak: number;
  lastPlausible: CardCorners | null;
  locked: CardCorners | null;
  confirmationStartedAt: number | null;
  lockedAt: number | null;
};

export const emptyGeometryLockState = (): GeometryLockState => ({
  agreeingStreak: 0,
  lastPlausible: null,
  locked: null,
  confirmationStartedAt: null,
  lockedAt: null,
});

export type GeometryLockTick = {
  now: number;
  score: number;
  plausible: CardCorners | null;
};

export type GeometryLockResult = {
  state: GeometryLockState;
  decision: 'none' | 'confirming' | 'locked' | 'reset' | 'unsafe';
  iouVsPrev: number | null;
  cornerMovement: number | null;
};

/**
 * Advance short confirmation. Once locked, state.locked stays frozen until reset.
 * Disappearing geometry resets confirmation (not a frozen lock).
 */
export const tickGeometryLock = (
  prev: GeometryLockState,
  tick: GeometryLockTick,
): GeometryLockResult => {
  if (prev.locked) {
    return {
      state: prev,
      decision: 'locked',
      iouVsPrev: null,
      cornerMovement: null,
    };
  }

  if (!tick.plausible || tick.score < GEOMETRY_TEST_MIN_SCORE) {
    if (prev.agreeingStreak > 0 || prev.lastPlausible) {
      return {
        state: emptyGeometryLockState(),
        decision: 'reset',
        iouVsPrev: null,
        cornerMovement: null,
      };
    }
    return {
      state: prev,
      decision: 'none',
      iouVsPrev: null,
      cornerMovement: null,
    };
  }

  const need = framesRequiredForScore(tick.score);
  let iouVsPrev: number | null = null;
  let cornerMovement: number | null = null;
  let streak = 1;
  let confirmationStartedAt = tick.now;

  if (prev.lastPlausible) {
    iouVsPrev = compareQuads(prev.lastPlausible, tick.plausible).iou;
    cornerMovement = meanNormalizedCornerMove(prev.lastPlausible, tick.plausible);
    if (quadsAgreeForGeometryLock(prev.lastPlausible, tick.plausible)) {
      streak = prev.agreeingStreak + 1;
      confirmationStartedAt = prev.confirmationStartedAt ?? tick.now;
    } else {
      streak = 1;
      confirmationStartedAt = tick.now;
    }
  }

  if (streak >= need) {
    return {
      state: {
        agreeingStreak: streak,
        lastPlausible: tick.plausible,
        locked: tick.plausible,
        confirmationStartedAt,
        lockedAt: tick.now,
      },
      decision: 'locked',
      iouVsPrev,
      cornerMovement,
    };
  }

  return {
    state: {
      agreeingStreak: streak,
      lastPlausible: tick.plausible,
      locked: null,
      confirmationStartedAt,
      lockedAt: null,
    },
    decision: 'confirming',
    iouVsPrev,
    cornerMovement,
  };
};

export const emptyGeometryTiming = (): GeometryTestTiming => ({
  buttonPressedAt: null,
  firstDetectorFrameAt: null,
  firstRawQuadAt: null,
  firstPlausibleQuadAt: null,
  confirmationStartedAt: null,
  firstCaptureSafeAt: null,
  captureQuadLockedAt: null,
  captureRequestedAt: null,
  captureCompletedAt: null,
  warpDoneAt: null,
  cardPreviewEncodeStartAt: null,
  cardPreviewEncodeDoneAt: null,
  cardArtifactEncodeStartAt: null,
  cardArtifactEncodeDoneAt: null,
  cardFileWriteStartAt: null,
  cardFileWriteDoneAt: null,
  previewLoadStartAt: null,
  previewDisplayedAt: null,
  imageDisplayedAt: null,
  fullResPreviewReadyAt: null,
  artifactEncodeStartAt: null,
  artifactEncodeDoneAt: null,
  uploadAckAt: null,
});

export const markFirstTiming = <K extends keyof GeometryTestTiming>(
  t: GeometryTestTiming,
  key: K,
  at: number,
): GeometryTestTiming => {
  if (t[key] != null) return t;
  return { ...t, [key]: at };
};
