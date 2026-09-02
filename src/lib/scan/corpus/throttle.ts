// Throttle / dedupe helpers for automatic corpus sampling (portable).

import { corpusPolicyFor, PRIORITY_RANK } from './policy';
import type { CorpusPriority, ScanCorpusEventType } from './types';

export interface ThrottleState {
  counts: Record<string, number>;
  lastAt: Record<string, number>;
  /** Last success sample fingerprint for this tracked card. */
  lastTrackKey: string | null;
}

export const emptyThrottle = (): ThrottleState => ({
  counts: {},
  lastAt: {},
  lastTrackKey: null,
});

export const allowAutomaticSample = (
  state: ThrottleState,
  event: ScanCorpusEventType,
  now = Date.now(),
  rand: () => number = Math.random,
): { next: ThrottleState; ok: boolean } => {
  const policy = corpusPolicyFor(event);
  const count = state.counts[event] ?? 0;
  if (count >= policy.maxPerSession) return { next: state, ok: false };
  const last = state.lastAt[event];
  if (last != null && now - last < policy.minIntervalMs) return { next: state, ok: false };
  if (policy.sampleProbability != null && rand() > policy.sampleProbability) {
    return { next: state, ok: false };
  }
  return {
    next: {
      ...state,
      counts: { ...state.counts, [event]: count + 1 },
      lastAt: { ...state.lastAt, [event]: now },
    },
    ok: true,
  };
};

/** Prefer discarding low-priority samples when over capacity. */
export const pickEvictionIndex = (
  priorities: readonly CorpusPriority[],
): number => {
  let best = -1;
  let bestRank = Infinity;
  for (let i = 0; i < priorities.length; i++) {
    const rank = PRIORITY_RANK[priorities[i]];
    if (rank < bestRank) {
      bestRank = rank;
      best = i;
    }
  }
  return best;
};
