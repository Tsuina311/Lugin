/**
 * Shared single-card capture tick — Geometry Test + Normal Scan geometry-v2.
 *
 * CAPTURE_SAFE (+ optional source-space anti-clip) → short confirmation → lock.
 * Incumbent hysteresis + best-recent-safe pick stabilize still-card lock.
 * No per-card AF. Physical refine only when profile allows.
 */

import {
  evaluateCaptureSafe,
  captureSafeMessage,
  type CaptureUnsafeReason,
} from '../geometryTest/captureSafe';
import {
  evaluateSourceCaptureSafe,
  meanCornerDisplacementPx,
} from '../geometryTest/sourceSafety';
import {
  emptyGeometryLockState,
  tickGeometryLock,
  quadsAgreeForGeometryLock,
  meanNormalizedCornerMove,
} from '../geometryTest/lock';
import { compareQuads } from '../session/postLock';
import { refinePhysicalCardBoundary } from '../geometryTest/physicalRefine';
import type { CardCorners, ScanImage } from '../types';
import type { SingleCardCaptureProfile } from './profiles';
import {
  emptyIncumbentState,
  geometryDelta,
  incumbentSwitchesPerSecond,
  tickIncumbent,
  type IncumbentState,
} from './incumbent';
import {
  emptyRecentSafeWindow,
  pickBestRecentSafe,
  pushRecentSafe,
  scoreSafeSample,
  type RecentSafeWindow,
} from './recentSafe';
import type { ConfirmationResetReason, GeometryTickTelemetry } from './telemetry';
import {
  emptySingleCardCaptureState,
  markFirstCaptureField,
  type SingleCardCaptureState,
} from './types';

export type SingleCardCaptureTickInput = {
  now: number;
  score: number;
  /** Detector / plausible corners (analysis space). */
  corners: CardCorners | null;
  frame: { width: number; height: number };
  /** Analysis image — required only when profile.enablePhysicalRefine. */
  analysisImage?: ScanImage | null;
  /** Detector size for source-margin prediction (defaults to frame). */
  detector?: { width: number; height: number };
  oriented?: { width: number; height: number } | null;
};

export type SingleCardCaptureTickResult = {
  state: SingleCardCaptureState;
  /** Quad for live HUD / capture (selected by profile policy). */
  liveQuad: CardCorners | null;
  /** Outer/detector seed when refine ran. */
  originalQuad: CardCorners | null;
  sleeveQuad: CardCorners | null;
  physicalQuad: CardCorners | null;
  /** Full refine telemetry when profile.enablePhysicalRefine. */
  physicalRefine: import('../geometryTest/physicalRefine').PhysicalRefineResult | null;
  decision: 'none' | 'unsafe' | 'confirming' | 'locked' | 'reset';
  telemetry: GeometryTickTelemetry | null;
};

const userMessageFor = (
  profile: SingleCardCaptureProfile,
  args: {
    hasQuad: boolean;
    captureSafe: boolean;
    reasons: CaptureUnsafeReason[];
    confirming: boolean;
    locked: boolean;
  },
): string => {
  if (profile.simplifyUserMessages) {
    if (!args.hasQuad || args.reasons.includes('out_of_frame') || args.reasons.includes('too_large')) {
      return 'MOVE CARD INTO FRAME';
    }
    if (!args.captureSafe) return 'MOVE CARD INTO FRAME';
    if (args.locked) return 'CAPTURING';
    if (args.confirming) return 'HOLD STEADY';
    return 'HOLD STEADY';
  }
  if (!args.hasQuad) return 'WAITING FOR GEOMETRY';
  if (!args.captureSafe) return captureSafeMessage(args.reasons) || 'WAITING FOR GEOMETRY';
  if (args.locked) return 'CAPTURING';
  return 'HOLD STEADY';
};

const lockResetReason = (args: {
  prev: CardCorners | null;
  next: CardCorners;
  decision: string;
}): ConfirmationResetReason => {
  if (args.decision !== 'confirming' && args.decision !== 'none') return null;
  if (!args.prev) return null;
  const iou = compareQuads(args.prev, args.next).iou;
  const move = meanNormalizedCornerMove(args.prev, args.next);
  if (!quadsAgreeForGeometryLock(args.prev, args.next)) {
    if (iou < 0.75) return 'QUAD_IOU_DISAGREEMENT';
    return 'CORNER_MOTION';
  }
  return null;
};

/**
 * Advance shared acquisition. Caller owns snapshot + recognition after `locked`.
 */
export const tickSingleCardCapture = (
  prev: SingleCardCaptureState,
  input: SingleCardCaptureTickInput,
  profile: SingleCardCaptureProfile,
): SingleCardCaptureTickResult => {
  // Once locked, freeze — recognition owns pixels; live geometry is done.
  if (prev.frozenQuad && prev.lock.locked) {
    return {
      state: {
        ...prev,
        phase: prev.snapshotDone ? 'captured' : prev.snapshotRequested ? 'capturing' : 'locked',
        userMessage: profile.simplifyUserMessages ? 'CAPTURING' : prev.userMessage,
      },
      liveQuad: prev.frozenQuad,
      originalQuad: input.corners,
      sleeveQuad: null,
      physicalQuad: null,
      physicalRefine: null,
      decision: 'locked',
      telemetry: null,
    };
  }

  let timing = prev.timing;
  if (timing.cardSessionStartedAt == null) {
    timing = { ...timing, cardSessionStartedAt: input.now };
  }

  const original = input.corners;
  if (!original) {
    const hadProgress = prev.lock.agreeingStreak > 0 || prev.lock.lastPlausible != null;
    const cleared = emptySingleCardCaptureState(timing.cardSessionStartedAt);
    const state = {
      ...cleared,
      timing,
      lastResetReason: 'NO_GEOMETRY' as ConfirmationResetReason,
      userMessage: userMessageFor(profile, {
        hasQuad: false,
        captureSafe: false,
        reasons: ['no_geometry'],
        confirming: false,
        locked: false,
      }),
    };
    return {
      state: hadProgress || prev.incumbent.quad ? state : {
        ...prev,
        phase: 'searching',
        captureSafe: false,
        captureUnsafeReasons: ['no_geometry'],
        lastResetReason: 'NO_GEOMETRY',
        userMessage: state.userMessage,
        timing,
      },
      liveQuad: null,
      originalQuad: null,
      sleeveQuad: null,
      physicalQuad: null,
      physicalRefine: null,
      decision: hadProgress ? 'reset' : 'none',
      telemetry: {
        at: input.now,
        captureSafe: false,
        unsafeReasons: ['no_geometry'],
        confirmationStreak: 0,
        iouVsPrev: null,
        meanCornerDelta: null,
        centerDelta: null,
        areaRatio: null,
        candidateSwitch: false,
        candidateSwitchCount: prev.incumbent.candidateSwitchCount,
        candidateSwitchesPerSecond: incumbentSwitchesPerSecond(prev.incumbent),
        longestStableCandidateRunFrames: prev.incumbent.longestStableRun,
        resetReason: 'NO_GEOMETRY',
        incumbentHeld: false,
      },
    };
  }

  timing = markFirstCaptureField(timing, 'firstQuadAt', input.now);

  let seed = original;
  let sleeveQuad: CardCorners | null = null;
  let physicalQuad: CardCorners | null = null;
  let physicalRefine: import('../geometryTest/physicalRefine').PhysicalRefineResult | null = null;

  if (profile.enablePhysicalRefine && input.analysisImage) {
    physicalRefine = refinePhysicalCardBoundary({
      image: input.analysisImage,
      corners: original,
      frame: input.frame,
    });
    seed = physicalRefine.selectedQuad;
    sleeveQuad = physicalRefine.sleeveQuad;
    physicalQuad = physicalRefine.physicalCardQuad;
  }

  // Evaluate safety on the detector seed first — never install an unsafe quad
  // as incumbent (that caused lip→good to stay stuck on the lip hypothesis).
  const analysisSafeSeed = evaluateCaptureSafe({
    corners: seed,
    frame: input.frame,
  });

  let reasons: CaptureUnsafeReason[] = [...analysisSafeSeed.reasons];
  let captureSafe = analysisSafeSeed.captureSafe;

  if (profile.enableSourceSafety && captureSafe) {
    const jitter =
      prev.lock.lastPlausible != null
        ? meanCornerDisplacementPx(prev.lock.lastPlausible, seed)
        : null;
    const source = evaluateSourceCaptureSafe({
      corners: seed,
      detector: input.detector ?? input.frame,
      oriented: input.oriented ?? null,
      cornerJitterAnalysisPx: jitter,
    });
    if (!source.sourceSafe) {
      captureSafe = false;
      reasons = [...reasons, 'source_near_edge'];
    }
  }

  let incumbentState = prev.incumbent ?? emptyIncumbentState();
  let selected = seed;
  let switched = false;
  let heldIncumbent = false;
  let lastResetReason: ConfirmationResetReason = null;

  if (captureSafe) {
    // Hysteresis only among SAFE candidates — still-card oscillation fix.
    const inc = tickIncumbent(incumbentState, {
      now: input.now,
      candidate: seed,
      score: input.score,
    });
    incumbentState = inc.state;
    selected = inc.selected;
    switched = inc.switched;
    heldIncumbent = inc.heldIncumbent;
    if (inc.switched) lastResetReason = 'CANDIDATE_SWITCH';
  } else {
    // Do not overwrite a prior safe incumbent with an unsafe flicker.
    if (reasons.includes('out_of_frame')) lastResetReason = 'OUT_OF_FRAME';
    else lastResetReason = 'UNSAFE';
  }

  if (captureSafe) {
    timing = markFirstCaptureField(timing, 'firstCaptureSafeAt', input.now);
  }

  let recentSafe: RecentSafeWindow = prev.recentSafe ?? emptyRecentSafeWindow();
  if (captureSafe) {
    recentSafe = pushRecentSafe(recentSafe, {
      quad: selected,
      score: input.score,
      at: input.now,
      frame: input.frame,
    });
  }

  let lockState = prev.lock;
  let decision: SingleCardCaptureTickResult['decision'] = 'none';
  let unsafeStreak = 0;
  let iouVsPrev: number | null = null;
  let meanCornerDelta: number | null = null;

  if (!captureSafe) {
    const hadProgress = lockState.agreeingStreak > 0 || lockState.lastPlausible != null;
    if (hadProgress) {
      unsafeStreak = (prev.unsafeStreak ?? 0) + 1;
      if (unsafeStreak >= 2) {
        lockState = emptyGeometryLockState();
        unsafeStreak = 0;
        recentSafe = emptyRecentSafeWindow();
        // Drop unsafe-contaminated incumbent after sustained unsafe.
        incumbentState = emptyIncumbentState();
        lastResetReason = 'SECOND_CONSECUTIVE_UNSAFE';
        decision = 'unsafe';
      } else {
        decision = 'unsafe';
      }
    } else {
      decision = 'unsafe';
      unsafeStreak = 0;
    }
  } else {
    unsafeStreak = 0;
    const lockResult = tickGeometryLock(lockState, {
      now: input.now,
      score: input.score,
      plausible: selected,
    });
    iouVsPrev = lockResult.iouVsPrev;
    meanCornerDelta = lockResult.cornerMovement;
    if (
      lockState.lastPlausible &&
      lockResult.decision === 'confirming' &&
      lockResult.state.agreeingStreak === 1 &&
      lockState.agreeingStreak > 0
    ) {
      lastResetReason =
        lockResetReason({
          prev: lockState.lastPlausible,
          next: selected,
          decision: 'confirming',
        }) ?? 'QUAD_IOU_DISAGREEMENT';
    }
    if (lockResult.decision === 'reset') {
      lastResetReason = 'SCORE_FLOOR';
    }
    lockState = lockResult.state;
    decision =
      lockResult.decision === 'locked'
        ? 'locked'
        : lockResult.decision === 'reset'
          ? 'reset'
          : lockResult.decision === 'confirming'
            ? 'confirming'
            : 'none';
  }

  let frozenQuad = prev.frozenQuad;
  let quadSelectionSource = prev.quadSelectionSource;
  let quadSelectionScore = prev.quadSelectionScore;
  let phase: SingleCardCaptureState['phase'] = 'searching';
  if (!captureSafe) phase = 'detected_not_safe';
  else if (lockState.locked) {
    phase = 'locked';
    // Prefer best recent safe quad over the transitional last frame.
    // Once frozen for this lock, do not retag from live detector.
    if (!frozenQuad) {
      const best = pickBestRecentSafe(recentSafe);
      if (best) {
        frozenQuad = best.quad;
        quadSelectionSource = 'BEST_RECENT_SAFE';
        quadSelectionScore = scoreSafeSample(best);
      } else if (heldIncumbent && incumbentState.quad) {
        frozenQuad = incumbentState.quad;
        quadSelectionSource = 'HYSTERESIS_INCUMBENT';
        quadSelectionScore = null;
      } else {
        frozenQuad = lockState.locked;
        quadSelectionSource = 'FINAL_CONFIRM_FRAME';
        quadSelectionScore = input.score;
      }
      lockState = { ...lockState, locked: frozenQuad };
    }
    timing = markFirstCaptureField(timing, 'captureLockedAt', lockState.lockedAt ?? input.now);
  } else if (lockState.agreeingStreak > 0) {
    phase = 'confirming';
    // Lost lock — clear freeze so the next lock can choose a fresh quad.
    frozenQuad = null;
    quadSelectionSource = null;
    quadSelectionScore = null;
  } else {
    phase = 'detected_not_safe';
    frozenQuad = null;
    quadSelectionSource = null;
    quadSelectionScore = null;
  }

  const confirming = phase === 'confirming';
  const locked = phase === 'locked';
  const delta = geometryDelta(prev.incumbent.quad, selected);

  const telemetry: GeometryTickTelemetry = {
    at: input.now,
    captureSafe,
    unsafeReasons: reasons,
    confirmationStreak: lockState.agreeingStreak,
    iouVsPrev: iouVsPrev ?? delta.iou,
    meanCornerDelta: meanCornerDelta ?? delta.meanCornerDelta,
    centerDelta: delta.centerDelta,
    areaRatio: delta.areaRatio,
    candidateSwitch: switched,
    candidateSwitchCount: incumbentState.candidateSwitchCount,
    candidateSwitchesPerSecond: incumbentSwitchesPerSecond(incumbentState),
    longestStableCandidateRunFrames: incumbentState.longestStableRun,
    resetReason: lastResetReason,
    incumbentHeld: heldIncumbent,
  };

  const state: SingleCardCaptureState = {
    phase,
    lock: lockState,
    timing,
    frozenQuad,
    quadSelectionSource,
    quadSelectionScore,
    captureSafe,
    captureUnsafeReasons: reasons,
    unsafeStreak,
    incumbent: incumbentState,
    recentSafe,
    lastResetReason,
    lastTelemetry: telemetry,
    userMessage: userMessageFor(profile, {
      hasQuad: true,
      captureSafe,
      reasons,
      confirming,
      locked,
    }),
    snapshotRequested: prev.snapshotRequested,
    snapshotDone: prev.snapshotDone,
  };

  return {
    state,
    liveQuad: locked ? frozenQuad : selected,
    originalQuad: original,
    sleeveQuad,
    physicalQuad,
    physicalRefine,
    decision,
    telemetry,
  };
};

export const resetSingleCardCapture = (
  sessionStartedAt: number | null = null,
): SingleCardCaptureState => emptySingleCardCaptureState(sessionStartedAt);
