/** Shared single-card capture timing + result types (Geometry + Normal). */

import type { CardCorners, ScanImage } from '../types';
import type { GeometryLockState } from '../geometryTest/lock';
import type { CaptureUnsafeReason } from '../geometryTest/captureSafe';
import type { SingleCardCaptureProfileId } from './profiles';
import { emptyIncumbentState, type IncumbentState } from './incumbent';
import { emptyRecentSafeWindow, type RecentSafeWindow } from './recentSafe';
import type { ConfirmationResetReason, GeometryTickTelemetry } from './telemetry';
import type { QuadSelectionSource } from '../verifiedScan/forensics';

export type SingleCardCapturePhase =
  | 'searching'
  | 'detected_not_safe'
  | 'confirming'
  | 'locked'
  | 'capturing'
  | 'captured';

export type SingleCardCaptureTiming = {
  cardSessionStartedAt: number | null;
  firstQuadAt: number | null;
  firstCaptureSafeAt: number | null;
  captureLockedAt: number | null;
  captureRequestedAt: number | null;
  captureDoneAt: number | null;
  warpDoneAt: number | null;
  recognitionStartedAt: number | null;
  titleOcrStartedAt: number | null;
  titleOcrDoneAt: number | null;
  foundAt: number | null;
};

export type SingleCardCaptureDerivedMs = {
  sessionToFirstQuadMs: number | null;
  firstQuadToSafeMs: number | null;
  safeToLockMs: number | null;
  lockToCaptureDoneMs: number | null;
  captureDoneToWarpMs: number | null;
  warpToRecognitionStartMs: number | null;
  recognitionStartToIdentityMs: number | null;
  sessionToIdentityMs: number | null;
};

export const emptySingleCardCaptureTiming = (): SingleCardCaptureTiming => ({
  cardSessionStartedAt: null,
  firstQuadAt: null,
  firstCaptureSafeAt: null,
  captureLockedAt: null,
  captureRequestedAt: null,
  captureDoneAt: null,
  warpDoneAt: null,
  recognitionStartedAt: null,
  titleOcrStartedAt: null,
  titleOcrDoneAt: null,
  foundAt: null,
});

const delta = (a: number | null, b: number | null): number | null =>
  a != null && b != null ? Math.max(0, b - a) : null;

export const deriveSingleCardCaptureMs = (
  t: SingleCardCaptureTiming,
): SingleCardCaptureDerivedMs => ({
  sessionToFirstQuadMs: delta(t.cardSessionStartedAt, t.firstQuadAt),
  firstQuadToSafeMs: delta(t.firstQuadAt, t.firstCaptureSafeAt),
  safeToLockMs: delta(t.firstCaptureSafeAt, t.captureLockedAt),
  lockToCaptureDoneMs: delta(t.captureLockedAt, t.captureDoneAt),
  captureDoneToWarpMs: delta(t.captureDoneAt, t.warpDoneAt),
  warpToRecognitionStartMs: delta(t.warpDoneAt, t.recognitionStartedAt),
  recognitionStartToIdentityMs: delta(t.recognitionStartedAt, t.foundAt),
  sessionToIdentityMs: delta(t.cardSessionStartedAt, t.foundAt),
});

export const markFirstCaptureField = <T extends Record<string, unknown>>(
  t: T,
  key: keyof T,
  at: number,
): T => {
  if (t[key] != null) return t;
  return { ...t, [key]: at };
};

export type SingleCardCaptureState = {
  phase: SingleCardCapturePhase;
  lock: GeometryLockState;
  timing: SingleCardCaptureTiming;
  /** Frozen analysis-space quad after short confirmation. */
  frozenQuad: CardCorners | null;
  /** Why frozenQuad won at lock — immutable telemetry for forensics. */
  quadSelectionSource: QuadSelectionSource | null;
  /** Rank/score of the winning sample when BEST_RECENT_SAFE. */
  quadSelectionScore: number | null;
  captureSafe: boolean;
  captureUnsafeReasons: CaptureUnsafeReason[];
  /**
   * Consecutive unsafe frames while a confirmation streak existed.
   * One blip must not wipe agreeing progress (still-phone detector flicker).
   */
  unsafeStreak: number;
  /** Short-lived incumbent hypothesis — reset on new cardSession / NEXT. */
  incumbent: IncumbentState;
  /** Tiny ring of recent SAFE quads for lock pick. */
  recentSafe: RecentSafeWindow;
  lastResetReason: ConfirmationResetReason;
  lastTelemetry: GeometryTickTelemetry | null;
  userMessage: string;
  snapshotRequested: boolean;
  snapshotDone: boolean;
};

export const emptySingleCardCaptureState = (
  sessionStartedAt: number | null = null,
): SingleCardCaptureState => ({
  phase: 'searching',
  lock: {
    agreeingStreak: 0,
    lastPlausible: null,
    locked: null,
    confirmationStartedAt: null,
    lockedAt: null,
  },
  timing: {
    ...emptySingleCardCaptureTiming(),
    cardSessionStartedAt: sessionStartedAt,
  },
  frozenQuad: null,
  quadSelectionSource: null,
  quadSelectionScore: null,
  captureSafe: false,
  captureUnsafeReasons: [],
  unsafeStreak: 0,
  incumbent: emptyIncumbentState(),
  recentSafe: emptyRecentSafeWindow(),
  lastResetReason: null,
  lastTelemetry: null,
  userMessage: '',
  snapshotRequested: false,
  snapshotDone: false,
});

/** Portable capture handoff into canonical recognition. */
export type SingleCardCaptureResult = {
  cardSessionId: number;
  geometryTrackId: number | null;
  captureId: number;
  sourceImage: ScanImage | null;
  frozenQuad: CardCorners | null;
  /** Optional precomputed 744×1039; recognizer may warp from source+quad instead. */
  canonicalCardImage: ScanImage | null;
  timing: SingleCardCaptureTiming;
  derivedMs: SingleCardCaptureDerivedMs;
  profileId: SingleCardCaptureProfileId;
  geometryProvenance: {
    selectedForCapture: 'ORIGINAL' | 'PHYSICAL_CARD';
    pipeline: 'geometry-v2';
  };
};
