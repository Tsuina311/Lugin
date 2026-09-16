/** Pure Deck Benchmark observing-tick helpers (no React / no camera). */

import type { DeckBenchmarkPhase, DeckCardTerminal } from './types';

/** Deck Benchmark must never freeze production SessionController for the run. */
export const DECK_BENCHMARK_USES_GLOBAL_LAB_HOLD = false as const;

export const DECK_CARD_TIMEOUT_MS = 18_000;
export const DECK_NEXT_TIMEOUT_MS = 14_000;

export type DeckLiveSignals = {
  phase: string | null;
  recognitionStatus: string | null;
  recognitionDecision: string | null;
  identity: string | null;
  cardSessionId: number | null;
  resultCardSessionId: number | null;
  resultAttemptId?: number | null;
  resultPublishedAt?: number | null;
  identityOwnedByCurrentSession?: boolean;
  /** Recognition attempts attributed to this card session (not prior). */
  freshEvidenceCountForSession?: number | null;
  geometryDetected: boolean | null;
  geometryTrackId: number | null;
  focusAttemptId: number | null;
  titlePresent: boolean;
  recognizeAttempts?: number | null;
  recognitionAttemptIdsForSession?: number[];
};

export const isFreshSessionIdentity = (live: {
  cardSessionId?: number | null;
  resultCardSessionId?: number | null;
  identity?: string | null;
  identityOwnedByCurrentSession?: boolean;
  freshEvidenceCountForSession?: number | null;
  recognizeAttempts?: number | null;
}): boolean => {
  const owned =
    live.identityOwnedByCurrentSession === true ||
    (live.cardSessionId != null &&
      live.resultCardSessionId != null &&
      live.cardSessionId === live.resultCardSessionId &&
      Boolean(live.identity));
  if (!owned || !live.identity) return false;
  // Zero fresh evidence + IDENTIFIED must be impossible (OCR or future art).
  const evidence =
    live.freshEvidenceCountForSession ??
    (typeof live.recognizeAttempts === 'number' ? live.recognizeAttempts : null);
  if (evidence != null && evidence <= 0) return false;
  return true;
};

export const classifyDeckTerminal = (live: {
  recognitionStatus?: string | null;
  phase?: string | null;
  recognitionDecision?: string | null;
}): DeckCardTerminal | null => {
  // Prefer recognitionStatus; do not let a lagging phase invent FOUND alone when status is cleared.
  const status = (live.recognitionStatus || '').toLowerCase();
  const phase = (live.phase || '').toLowerCase();
  if (status === 'found' || status === 'identified') return 'identified';
  if (status === 'ambiguous') return 'ambiguous';
  if (status.includes('empty') || live.recognitionDecision === 'empty') return 'ocr-empty';
  if (status.includes('exhausted') || status.includes('budget')) return 'budget-exhausted';
  if (status === 'failed' || status === 'error') return 'failed';
  // Phase fallback only when status absent AND phase is terminal — callers must pass
  // ownership-gated phase (never a stale React snapshot).
  if (!status) {
    if (phase === 'found' || phase === 'identified') return 'identified';
    if (phase === 'ambiguous') return 'ambiguous';
  }
  return null;
};

export const slotKeyFor = (sessionId: number | null, cardStartedAt: number): string =>
  sessionId != null ? `s:${sessionId}` : `t:${cardStartedAt}`;

export const recordedSlotKeysFromCards = (
  cards: Array<{ cardSessionId: number | null; benchmarkIndex: number }>,
): Set<string> =>
  new Set(
    cards.map(c =>
      c.cardSessionId != null ? `s:${c.cardSessionId}` : `i:${c.benchmarkIndex}`,
    ),
  );

export const resolveObservingPhase = (
  runPhase: DeckBenchmarkPhase,
  livePhase: string | null,
): DeckBenchmarkPhase => {
  if (runPhase !== 'detecting' && runPhase !== 'focusing' && runPhase !== 'recognizing') {
    return runPhase;
  }
  const p = (livePhase || '').toLowerCase();
  if (p.includes('focus')) return 'focusing';
  if (p.includes('recog') || p.includes('lock')) return 'recognizing';
  return 'detecting';
};

export type DeckSaveDecision = {
  shouldSave: boolean;
  terminal: DeckCardTerminal | null;
  timedOut: boolean;
  slotKey: string;
  staleIdentityRejected: boolean;
  terminalSource:
    | 'fresh-result'
    | 'empty'
    | 'timeout'
    | 'stale-rejected'
    | 'other'
    | null;
};

/** Decide whether the current observing card should be recorded. */
export const decideDeckCardSave = (args: {
  recordedSlots: Set<string>;
  cardStartedAt: number;
  now: number;
  timeoutMs?: number;
  live: DeckLiveSignals;
}): DeckSaveDecision => {
  const timeoutMs = args.timeoutMs ?? DECK_CARD_TIMEOUT_MS;
  const rawTerminal = classifyDeckTerminal(args.live);
  const sessionId = args.live.cardSessionId;
  const timedOut = args.now - args.cardStartedAt >= timeoutMs;
  const slotKey = slotKeyFor(sessionId, args.cardStartedAt);
  const fresh = isFreshSessionIdentity(args.live);
  const successTerminal = rawTerminal === 'identified' || rawTerminal === 'ambiguous';
  const staleIdentityRejected = Boolean(successTerminal && !fresh);
  const terminal = successTerminal && !fresh ? null : rawTerminal;
  let terminalSource: DeckSaveDecision['terminalSource'] = null;
  if (staleIdentityRejected) terminalSource = 'stale-rejected';
  else if (terminal === 'identified' || terminal === 'ambiguous') terminalSource = 'fresh-result';
  else if (terminal === 'ocr-empty') terminalSource = 'empty';
  else if (timedOut && !terminal) terminalSource = 'timeout';
  else if (terminal) terminalSource = 'other';
  const shouldSave =
    !args.recordedSlots.has(slotKey) &&
    (Boolean(terminal) || timedOut) &&
    (Boolean(terminal) ? sessionId != null : true);
  return { shouldSave, terminal, timedOut, slotKey, staleIdentityRejected, terminalSource };
};

export type DeckAdvanceDecision = {
  advance: boolean;
  showManualNext: boolean;
  reason: 'manual' | 'session-changed' | 'first-session-after-timeout' | null;
};

export const decideDeckAdvance = (args: {
  armedSessionId: number | null;
  cardSessionId: number | null;
  geometryDetected: boolean | null;
  elapsedSinceNextPromptMs: number;
  manualArmed: boolean;
  nextTimeoutMs?: number;
}): DeckAdvanceDecision => {
  const nextTimeoutMs = args.nextTimeoutMs ?? DECK_NEXT_TIMEOUT_MS;
  const showManualNext = args.elapsedSinceNextPromptMs >= nextTimeoutMs && !args.manualArmed;
  const sessionChanged =
    args.armedSessionId != null && args.cardSessionId !== args.armedSessionId;
  const firstSessionAfterTimeout =
    args.armedSessionId == null &&
    args.cardSessionId != null &&
    args.elapsedSinceNextPromptMs > 350;
  if (args.manualArmed) {
    return { advance: true, showManualNext: false, reason: 'manual' };
  }
  if (sessionChanged) {
    return { advance: true, showManualNext, reason: 'session-changed' };
  }
  if (firstSessionAfterTimeout) {
    return { advance: true, showManualNext, reason: 'first-session-after-timeout' };
  }
  return { advance: false, showManualNext, reason: null };
};

export type DeckObservabilityLine = {
  benchmarkIndex: number;
  geometryTrackId: number | null;
  cardSessionId: number | null;
  phase: string | null;
  focusAttemptId: number | null;
  recognitionStatus: string | null;
  identity: string | null;
  labHold: boolean;
  timeoutAgeMs: number;
  titlePresent: boolean;
  timedOut?: boolean;
  resultCardSessionId?: number | null;
  staleIdentityRejected?: boolean;
};

export type DeckObservabilityKey = Omit<DeckObservabilityLine, 'timeoutAgeMs'>;

export const deckObservabilityChanged = (
  prev: DeckObservabilityKey | null,
  next: DeckObservabilityKey,
): boolean => {
  if (!prev) return true;
  return (
    prev.benchmarkIndex !== next.benchmarkIndex ||
    prev.geometryTrackId !== next.geometryTrackId ||
    prev.cardSessionId !== next.cardSessionId ||
    prev.phase !== next.phase ||
    prev.focusAttemptId !== next.focusAttemptId ||
    prev.recognitionStatus !== next.recognitionStatus ||
    prev.identity !== next.identity ||
    prev.labHold !== next.labHold ||
    prev.titlePresent !== next.titlePresent ||
    Boolean(prev.timedOut) !== Boolean(next.timedOut) ||
    prev.resultCardSessionId !== next.resultCardSessionId ||
    Boolean(prev.staleIdentityRejected) !== Boolean(next.staleIdentityRejected)
  );
};

export const formatDeckObservability = (line: DeckObservabilityLine): string =>
  `[deck-bench] card=${line.benchmarkIndex}` +
  ` geom=${line.geometryTrackId ?? '—'}` +
  ` session=${line.cardSessionId ?? '—'}` +
  ` resultSession=${line.resultCardSessionId ?? '—'}` +
  ` phase=${line.phase ?? '—'}` +
  ` focus=${line.focusAttemptId ?? '—'}` +
  ` status=${line.recognitionStatus ?? '—'}` +
  ` id=${line.identity ?? '—'}` +
  ` labHold=${line.labHold}` +
  ` timeoutAgeMs=${Math.round(line.timeoutAgeMs)}` +
  ` timedOut=${Boolean(line.timedOut)}` +
  ` stale=${Boolean(line.staleIdentityRejected)}` +
  ` title=${line.titlePresent ? 'yes' : 'no'}`;
