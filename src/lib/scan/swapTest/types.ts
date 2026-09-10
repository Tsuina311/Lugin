import type { CardSessionResetReason, CardVisualClass } from '../session/cardSession';

export const SWAP_TEST_COUNTS = [5, 10] as const;
export type SwapTestCount = (typeof SWAP_TEST_COUNTS)[number];

export type SwapTestPhase =
  | 'idle'
  | 'config'
  | 'waiting-stable'
  | 'capturing'
  | 'swap-now'
  | 'waiting-next'
  | 'done'
  | 'cancelled';

export interface SwapTestGateSnapshot {
  cardSessionId: number | null;
  focusAttemptId: number | null;
  focusCardSessionId: number | null;
  geometryTrackId: number | null;
  recognizeAttemptsForTrack: number | null;
  sessionResetReason: CardSessionResetReason | string | null;
  visualChange: CardVisualClass | string | null;
  fingerprintDelta: number | null;
  changeWatchBand: string | null;
  changeWatchDelta: number | null;
  changeWatchState: string | null;
  changeWatchConfirmCount: number | null;
}

export interface SwapTestCaptureRecord {
  actualDelayFromFocusRequestMs: number | null;
  cardSessionId: number | null;
  expectedLabel: string | null;
  focusAttemptId: number | null;
  geometryTrackId: number | null;
  identity: string | null;
  index: number;
  label: string;
  recognizeAttemptsForTrack: number | null;
  recognitionDecision: string | null;
  recognitionStatus: string | null;
  sessionResetReason: string | null;
  sourceHeight: number;
  sourceWidth: number;
  swapId: string;
  titleSharpness: number | null;
  cardSharpness: number | null;
  visualFingerprintDelta: number | null;
  changeWatchBand: string | null;
  changeWatchDelta: number | null;
  changeWatchState: string | null;
}

export interface SwapTestTransition {
  detection: 'auto-visual' | 'auto-session' | 'auto-gone' | 'manual';
  focusAttemptAfter: number | null;
  focusAttemptBefore: number | null;
  fromIndex: number;
  fromSwapId: string;
  newCardSessionId: number | null;
  newGeometryTrackId: number | null;
  newIdentity: string | null;
  previousCardSessionId: number | null;
  previousGeometryTrackId: number | null;
  previousIdentity: string | null;
  retryBudgetAfter: number | null;
  retryBudgetBefore: number | null;
  sessionResetReason: string | null;
  timeToDetectSwapMs: number | null;
  toIndex: number;
  toSwapId: string;
  visualConfirmCount: number;
  visualFingerprintDelta: number | null;
  changeWatchBand: string | null;
  changeWatchState: string | null;
}

export interface SwapTestBundle {
  capturedAt: string;
  expectedLabels: string[];
  fixtureId: string;
  phase: SwapTestPhase;
  swaps: SwapTestCaptureRecord[];
  targetCount: number;
  transitions: SwapTestTransition[];
}

export const swapIdForIndex = (index: number): string =>
  `swap-${String(index + 1).padStart(2, '0')}`;

export const swapFilePrefix = (index: number): string => swapIdForIndex(index);
