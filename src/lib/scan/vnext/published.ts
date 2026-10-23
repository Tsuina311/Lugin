import type { VNextDecision } from './decide';

export type VNextPublishedHit = {
  oracleId: string;
  name: string;
  score: number;
};

/**
 * Resolve the exact oracle selected by the frozen policy.
 *
 * OCR recovery may select prototype rank 2–5, so prototype Top1 is never a
 * valid fallback for a different decision oracle.
 */
export const selectVNextPublishedHit = (
  decision: VNextDecision,
  prototypeTop: readonly VNextPublishedHit[],
): VNextPublishedHit | null => {
  if (!decision.publish || !decision.oracleId) return null;
  return prototypeTop.find(hit => hit.oracleId === decision.oracleId) ?? null;
};
