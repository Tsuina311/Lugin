/**
 * Short-lived incumbent geometry hysteresis for Verified / geometry-v2 capture.
 *
 * Prevents frame-to-frame candidate oscillation from wiping confirmation while
 * a card is held still. Destroyed on every new cardSession / NEXT / retake.
 *
 * Does NOT change detector ranking globally — only which quad the capture tick
 * treats as the current hypothesis.
 */

import { compareQuads } from '../session/postLock';
import type { CardCorners } from '../types';
import { meanNormalizedCornerMove, quadsAgreeForGeometryLock } from '../geometryTest/lock';
import { cornersToQuad } from '../geometry';

/** Below this IoU vs incumbent ⇒ treat as a different candidate (spatial switch). */
export const INCUMBENT_SWITCH_IOU = 0.55;

/** Challenger must beat incumbent by this score margin to switch immediately. */
export const INCUMBENT_SCORE_MARGIN = 0.08;

/** Or win this many consecutive ticks while spatially different. */
export const INCUMBENT_CHALLENGER_FRAMES = 2;

export type IncumbentState = {
  quad: CardCorners | null;
  score: number;
  challenger: CardCorners | null;
  challengerScore: number;
  challengerStreak: number;
  candidateSwitchCount: number;
  longestStableRun: number;
  currentStableRun: number;
  /** Wall/monotonic times of recent switches (for switches/sec). */
  recentSwitchAts: number[];
};

export const emptyIncumbentState = (): IncumbentState => ({
  quad: null,
  score: 0,
  challenger: null,
  challengerScore: 0,
  challengerStreak: 0,
  candidateSwitchCount: 0,
  longestStableRun: 0,
  currentStableRun: 0,
  recentSwitchAts: [],
});

const quadCenter = (c: CardCorners): { x: number; y: number } => {
  const q = cornersToQuad(c);
  return {
    x: (q[0]!.x + q[1]!.x + q[2]!.x + q[3]!.x) / 4,
    y: (q[0]!.y + q[1]!.y + q[2]!.y + q[3]!.y) / 4,
  };
};

const quadArea = (c: CardCorners): number => {
  const q = cornersToQuad(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const r = q[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

/** Spatial metrics vs previous selected/incumbent quad. */
export const geometryDelta = (
  prev: CardCorners | null,
  next: CardCorners | null,
): {
  iou: number | null;
  meanCornerDelta: number | null;
  centerDelta: number | null;
  areaRatio: number | null;
} => {
  if (!prev || !next) {
    return { iou: null, meanCornerDelta: null, centerDelta: null, areaRatio: null };
  }
  const iou = compareQuads(prev, next).iou;
  const meanCornerDelta = meanNormalizedCornerMove(prev, next);
  const ca = quadCenter(prev);
  const cb = quadCenter(next);
  const centerDelta = Math.hypot(ca.x - cb.x, ca.y - cb.y);
  const aa = quadArea(prev);
  const ab = quadArea(next);
  const areaRatio = aa > 1 && ab > 1 ? ab / aa : null;
  return { iou, meanCornerDelta, centerDelta, areaRatio };
};

/** True when B is a materially different geometry from A (not index-based). */
export const isSpatialCandidateSwitch = (a: CardCorners, b: CardCorners): boolean => {
  const { iou } = geometryDelta(a, b);
  if (iou == null) return true;
  if (iou < INCUMBENT_SWITCH_IOU) return true;
  // Strong disagreement with lock-coherence also counts as a switch.
  return !quadsAgreeForGeometryLock(a, b) && iou < 0.7;
};

export type IncumbentTickResult = {
  state: IncumbentState;
  /** Quad the capture pipeline should use this frame. */
  selected: CardCorners;
  switched: boolean;
  heldIncumbent: boolean;
};

/**
 * Update incumbent. Prefer continuity of a stable still-card hypothesis.
 */
export const tickIncumbent = (
  prev: IncumbentState,
  args: { now: number; candidate: CardCorners; score: number },
): IncumbentTickResult => {
  const { candidate, score, now } = args;
  if (!prev.quad) {
    return {
      state: {
        ...emptyIncumbentState(),
        quad: candidate,
        score,
        currentStableRun: 1,
        longestStableRun: 1,
      },
      selected: candidate,
      switched: false,
      heldIncumbent: false,
    };
  }

  const consistent = quadsAgreeForGeometryLock(prev.quad, candidate);
  if (consistent || !isSpatialCandidateSwitch(prev.quad, candidate)) {
    const run = prev.currentStableRun + 1;
    return {
      state: {
        ...prev,
        quad: candidate, // follow mild jitter while same object
        score: Math.max(prev.score * 0.85 + score * 0.15, score),
        challenger: null,
        challengerScore: 0,
        challengerStreak: 0,
        currentStableRun: run,
        longestStableRun: Math.max(prev.longestStableRun, run),
      },
      selected: candidate,
      switched: false,
      heldIncumbent: false,
    };
  }

  // Materially different candidate — do not flip on a slight score edge.
  const immediate =
    score >= prev.score + INCUMBENT_SCORE_MARGIN || (score >= 0.95 && score > prev.score);
  const sameChallenger =
    prev.challenger != null && !isSpatialCandidateSwitch(prev.challenger, candidate);
  const challengerStreak = sameChallenger ? prev.challengerStreak + 1 : 1;
  const switchNow = immediate || challengerStreak >= INCUMBENT_CHALLENGER_FRAMES;

  if (switchNow) {
    const recentSwitchAts = [...prev.recentSwitchAts, now].filter(t => now - t < 1000);
    return {
      state: {
        quad: candidate,
        score,
        challenger: null,
        challengerScore: 0,
        challengerStreak: 0,
        candidateSwitchCount: prev.candidateSwitchCount + 1,
        longestStableRun: Math.max(prev.longestStableRun, prev.currentStableRun),
        currentStableRun: 1,
        recentSwitchAts,
      },
      selected: candidate,
      switched: true,
      heldIncumbent: false,
    };
  }

  // Hold incumbent; record challenger progress.
  return {
    state: {
      ...prev,
      challenger: candidate,
      challengerScore: score,
      challengerStreak,
      currentStableRun: prev.currentStableRun + 1,
      longestStableRun: Math.max(prev.longestStableRun, prev.currentStableRun + 1),
    },
    selected: prev.quad,
    switched: false,
    heldIncumbent: true,
  };
};

export const incumbentSwitchesPerSecond = (s: IncumbentState): number | null => {
  if (s.recentSwitchAts.length < 1) return 0;
  return s.recentSwitchAts.length; // already windowed to ~1s
};
