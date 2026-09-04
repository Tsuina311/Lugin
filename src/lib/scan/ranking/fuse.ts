import {
  ACCEPT_CARD_SCORE,
  ACCEPT_MARGIN,
  FUSION_WEIGHTS,
  TITLE_STRONG,
  VISUAL_STRONG,
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
  /** Exact printing when local footer lookup uniquely resolved it. */
  printing?: {
    collectorNumber: string;
    confidence: number;
    finishes: string[];
    lang?: string;
    name: string;
    oracleId: string;
    scryfallId: string;
    setCode: string;
  };
  status: ScanIdentityStatus;
}

export interface FuseOptions {
  /**
   * When title/text/footer never fired (native art-only / skipOcr), demand a
   * strong visual leader. Temporal renormalization must not turn a tight
   * 0.70/0.67 art cluster into Identified.
   */
  artworkOnly?: boolean;
  /**
   * Allow a near-exact title match (huge margin) to identify the oracle even
   * when artwork is weak or still processing. Printing stays unresolved.
   */
  allowTitleOnly?: boolean;
  /** Prefer accepting when title and art both strongly agree on one name. */
  allowStrongDual?: boolean;
}

/** Visual margin required in artwork-only mode (before temporal boost). */
export const ARTWORK_ONLY_VISUAL_MARGIN = 0.12;

/** Title-only: absolute score + margin over #2 title. */
export const TITLE_ONLY_MIN = 0.94;
export const TITLE_ONLY_MARGIN = 0.2;

const weightSum =
  FUSION_WEIGHTS.visual +
  FUSION_WEIGHTS.title +
  FUSION_WEIGHTS.text +
  FUSION_WEIGHTS.typeLine +
  FUSION_WEIGHTS.footer +
  FUSION_WEIGHTS.temporal;

export const fuseEvidence = (
  rows: readonly CandidateEvidence[],
  options: FuseOptions = {},
): FusedResult => {
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

  const artworkOnly =
    options.artworkOnly === true ||
    ranked.every(
      r =>
        r.titleScore == null &&
        r.textScore == null &&
        r.typeLineScore == null &&
        r.footerScore == null,
    );

  if (artworkOnly) {
    const visualMargin = (top.visualScore ?? 0) - (second?.visualScore ?? 0);
    const strongVisual =
      (top.visualScore ?? 0) >= VISUAL_STRONG && visualMargin >= ARTWORK_ONLY_VISUAL_MARGIN;
    if (!strongVisual) {
      return { candidates: ranked, margin, status: 'card-ambiguous' };
    }
  }

  // Strong dual: title + art agree — accept even with modest fused margin.
  if (options.allowStrongDual) {
    const title = top.titleScore ?? 0;
    const visual = top.visualScore ?? 0;
    const sameNameArt = ranked.find(
      r => r.name === top.name && (r.visualScore ?? 0) >= VISUAL_STRONG * 0.9,
    );
    if (title >= TITLE_STRONG && visual >= VISUAL_STRONG * 0.9 && sameNameArt) {
      return {
        candidates: ranked,
        card: { confidence: top.score, name: top.name, oracleId: top.oracleId },
        margin,
        status:
          top.possiblePrintingIds.length === 1 ? 'identified' : 'printing-ambiguous',
      };
    }
  }

  // Title-only fast path — oracle identity only; printing stays pending.
  if (options.allowTitleOnly && !artworkOnly) {
    const titleMargin = (top.titleScore ?? 0) - (second?.titleScore ?? 0);
    if ((top.titleScore ?? 0) >= TITLE_ONLY_MIN && titleMargin >= TITLE_ONLY_MARGIN) {
      return {
        candidates: ranked,
        card: { confidence: top.titleScore ?? top.score, name: top.name, oracleId: top.oracleId },
        margin: titleMargin,
        status: 'printing-ambiguous',
      };
    }
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
