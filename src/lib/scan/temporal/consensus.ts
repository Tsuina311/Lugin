// Temporal consensus across good recognition frames of the same tracked card.

import { TEMPORAL_AGREE_FRAMES } from '../params';
import type { FusedResult, RankedCandidate } from '../ranking/fuse';

export interface TemporalObservation {
  candidates: RankedCandidate[];
  topOracleId?: string;
  topScore: number;
}

export interface TemporalState {
  observations: TemporalObservation[];
}

export const emptyTemporal = (): TemporalState => ({ observations: [] });

export const pushTemporal = (
  state: TemporalState,
  result: FusedResult,
  limit = 5,
): TemporalState => {
  const top = result.candidates[0];
  const obs: TemporalObservation = {
    candidates: result.candidates.slice(0, 5),
    topOracleId: top?.oracleId,
    topScore: top?.score ?? 0,
  };
  return { observations: [...state.observations, obs].slice(-limit) };
};

/**
 * Boost evidence rows that repeatedly win across recent frames.
 * Returns a 0–1 temporalSupport for the current top oracle id.
 */
export const temporalSupportFor = (
  state: TemporalState,
  oracleId: string,
  need = TEMPORAL_AGREE_FRAMES,
): number => {
  if (!state.observations.length) return 0;
  let hits = 0;
  let considered = 0;
  for (const o of state.observations) {
    considered += 1;
    if (o.topOracleId === oracleId) hits += 1;
  }
  if (hits < need) return hits / Math.max(need, 1) * 0.5;
  return Math.min(1, hits / considered);
};

/** True when recent frames disagree on the top card. */
export const temporalUnstable = (state: TemporalState): boolean => {
  const ids = state.observations.map(o => o.topOracleId).filter(Boolean);
  if (ids.length < 2) return false;
  return new Set(ids).size > 1;
};
