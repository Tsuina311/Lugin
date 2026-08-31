// Multi-signal candidate fusion.
//
// Generation and ranking are separate: art and title each produce candidates;
// fusion scores the union. No single weak signal can veto a strong pair of
// others — missing evidence is zero contribution, not a penalty.

import {
  ACCEPT_CARD_SCORE,
  ACCEPT_MARGIN,
  FUSION_WEIGHTS,
} from '../params';

export interface CandidateEvidence {
  footerScore?: number;
  name: string;
  oracleId: string;
  possiblePrintingIds: string[];
  temporalSupport?: number;
  textScore?: number;
  titleScore?: number;
  typeLineScore?: number;
  visualScore?: number;
}

export interface RankedCandidate extends CandidateEvidence {
  /** Fused 0–1 score after weighting. */
  score: number;
}

export type ScanIdentityStatus =
  | 'identified'
  | 'printing-ambiguous'
  | 'card-ambiguous'
  | 'insufficient-confidence';

export interface FusedResult {
  candidates: RankedCandidate[];
  /** Best card-level identity when confident enough. */
  card?: { confidence: number; name: string; oracleId: string };
  margin: number;
  status: ScanIdentityStatus;
}

const weightSum =
  FUSION_WEIGHTS.visual +
  FUSION_WEIGHTS.title +
  FUSION_WEIGHTS.text +
  FUSION_WEIGHTS.typeLine +
  FUSION_WEIGHTS.footer +
  FUSION_WEIGHTS.temporal;

export const fuseEvidence = (rows: readonly CandidateEvidence[]): FusedResult => {
  const ranked: RankedCandidate[] = rows
    .map(r => {
      const parts: Array<[number, number | undefined]> = [
        [FUSION_WEIGHTS.visual, r.visualScore],
        [FUSION_WEIGHTS.title, r.titleScore],
        [FUSION_WEIGHTS.text, r.textScore],
        [FUSION_WEIGHTS.typeLine, r.typeLineScore],
        [FUSION_WEIGHTS.footer, r.footerScore],
        [FUSION_WEIGHTS.temporal, r.temporalSupport],
      ];
      let num = 0;
      let den = 0;
      for (const [w, v] of parts) {
        if (v == null || !Number.isFinite(v)) continue;
        num += w * Math.max(0, Math.min(1, v));
        den += w;
      }
      // Renormalize over signals that actually fired so a title-only hit is not
      // crushed by missing artwork.
      const score = den > 0 ? num / den : 0;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const top = ranked[0];
  const second = ranked[1];
  const margin = top ? top.score - (second?.score ?? 0) : 0;

  if (!top || top.score < ACCEPT_CARD_SCORE * 0.7) {
    return { candidates: ranked, margin, status: 'insufficient-confidence' };
  }
  if (top.score >= ACCEPT_CARD_SCORE && margin >= ACCEPT_MARGIN) {
    return {
      candidates: ranked,
      card: { confidence: top.score, name: top.name, oracleId: top.oracleId },
      margin,
      status:
        top.possiblePrintingIds.length === 1 ? 'identified' : 'printing-ambiguous',
    };
  }
  return { candidates: ranked, margin, status: 'card-ambiguous' };
};

/** Exported for tests that assert weight tables stay intentional. */
export const fusionWeightSum = weightSum;
