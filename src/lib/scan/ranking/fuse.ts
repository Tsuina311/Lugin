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
  /** True when sticky title disagreed with artwork (art did not win). */
  artConflict?: boolean;
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

/**
 * Sticky title: strong enough that disagreeing weak/moderate art must not flip
 * identity (Samsung Sword → Tovolar regression). Lower than TITLE_ONLY so
 * localized fuzzy hits (~0.83) still stick.
 */
export const TITLE_STICKY_MIN = TITLE_STRONG;
export const TITLE_STICKY_MARGIN = 0.12;

const weightSum =
  FUSION_WEIGHTS.visual +
  FUSION_WEIGHTS.title +
  FUSION_WEIGHTS.text +
  FUSION_WEIGHTS.typeLine +
  FUSION_WEIGHTS.footer +
  FUSION_WEIGHTS.temporal;

/** Best title row that clears sticky / title-only bars (any rank). */
export const findStickyTitle = (
  ranked: readonly RankedCandidate[],
): RankedCandidate | null => {
  const byTitle = ranked
    .filter(r => (r.titleScore ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.titleScore ?? 0) - (a.titleScore ?? 0) || a.name.localeCompare(b.name),
    );
  const best = byTitle[0];
  if (!best?.titleScore) return null;
  const secondTitle = byTitle[1]?.titleScore ?? 0;
  const titleMargin = best.titleScore - secondTitle;
  if (best.titleScore >= TITLE_ONLY_MIN && titleMargin >= Math.min(TITLE_ONLY_MARGIN, 0.08)) {
    return best;
  }
  if (best.titleScore >= TITLE_STICKY_MIN && titleMargin >= TITLE_STICKY_MARGIN) {
    return best;
  }
  return null;
};

const promote = (
  ranked: RankedCandidate[],
  pick: RankedCandidate,
): RankedCandidate[] => {
  if (ranked[0]?.oracleId === pick.oracleId && ranked[0]?.name === pick.name) return ranked;
  return [pick, ...ranked.filter(r => r !== pick)];
};

const acceptCard = (
  ranked: RankedCandidate[],
  pick: RankedCandidate,
  margin: number,
  status: ScanIdentityStatus,
  extras: Partial<FusedResult> = {},
): FusedResult => ({
  candidates: ranked,
  card: {
    confidence: pick.titleScore ?? pick.score,
    name: pick.name,
    oracleId: pick.oracleId,
  },
  margin,
  status:
    status === 'identified' || pick.possiblePrintingIds.length === 1
      ? status === 'card-ambiguous'
        ? 'card-ambiguous'
        : pick.possiblePrintingIds.length === 1
          ? 'identified'
          : 'printing-ambiguous'
      : status,
  ...extras,
});

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

  // Sticky title is already fused leader — accept even when a nearby art-only
  // row shrinks fused margin below ACCEPT_MARGIN (Sword 0.83 vs Tovolar 0.80).
  if (options.allowTitleOnly && !artworkOnly) {
    const sticky = findStickyTitle(ranked);
    if (sticky && sticky.name === top.name && sticky.oracleId === top.oracleId) {
      const byTitle = ranked
        .filter(r => (r.titleScore ?? 0) > 0)
        .sort((a, b) => (b.titleScore ?? 0) - (a.titleScore ?? 0));
      const titleMargin = (sticky.titleScore ?? 0) - (byTitle[1]?.titleScore ?? 0);
      const artDisagree = ranked.some(
        r =>
          r.name !== sticky.name &&
          (r.visualScore ?? 0) >= VISUAL_STRONG * 0.9 &&
          ((r.titleScore ?? 0) < TITLE_STICKY_MIN),
      );
      return acceptCard(ranked, sticky, titleMargin, 'printing-ambiguous', {
        artConflict: artDisagree || undefined,
      });
    }
  }

  // Sticky title vs disagreeing art — never let weak/moderate global art win.
  if (options.allowTitleOnly && !artworkOnly) {
    const sticky = findStickyTitle(ranked);
    if (sticky) {
      const leaderDisagrees =
        top.name !== sticky.name &&
        (top.titleScore == null || (top.titleScore ?? 0) < TITLE_STICKY_MIN);
      const leaderIsArtLed =
        leaderDisagrees &&
        (top.visualScore ?? 0) > 0 &&
        (top.titleScore == null || (top.titleScore ?? 0) < (sticky.titleScore ?? 0));
      if (leaderIsArtLed) {
        const visualMargin = (top.visualScore ?? 0) - (second?.visualScore ?? 0);
        const artVeryStrong =
          (top.visualScore ?? 0) >= VISUAL_STRONG + 0.08 &&
          visualMargin >= ARTWORK_ONLY_VISUAL_MARGIN + 0.04;
        const promoted = promote(ranked, sticky);
        const titleMargin =
          (sticky.titleScore ?? 0) -
          (ranked
            .filter(r => r !== sticky && (r.titleScore ?? 0) > 0)
            .sort((a, b) => (b.titleScore ?? 0) - (a.titleScore ?? 0))[0]?.titleScore ?? 0);
        if (artVeryStrong) {
          // Two strong signals disagree — do not silently flip to art.
          return {
            artConflict: true,
            candidates: promoted,
            card: {
              confidence: sticky.titleScore ?? sticky.score,
              name: sticky.name,
              oracleId: sticky.oracleId,
            },
            margin: titleMargin,
            status: 'card-ambiguous',
          };
        }
        return acceptCard(promoted, sticky, titleMargin, 'printing-ambiguous', {
          artConflict: true,
        });
      }
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
  // Prefer sticky/title-only on *any* row, not only fused #1.
  if (options.allowTitleOnly && !artworkOnly) {
    const sticky = findStickyTitle(ranked);
    if (sticky && (sticky.titleScore ?? 0) >= TITLE_ONLY_MIN) {
      const byTitle = ranked
        .filter(r => (r.titleScore ?? 0) > 0)
        .sort((a, b) => (b.titleScore ?? 0) - (a.titleScore ?? 0));
      const titleMargin = (sticky.titleScore ?? 0) - (byTitle[1]?.titleScore ?? 0);
      if (titleMargin >= TITLE_ONLY_MARGIN) {
        return acceptCard(promote(ranked, sticky), sticky, titleMargin, 'printing-ambiguous');
      }
    }
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

  // Do not ACCEPT a visual-only leader when a sticky title exists elsewhere.
  if (options.allowTitleOnly && !artworkOnly) {
    const sticky = findStickyTitle(ranked);
    if (
      sticky &&
      top.name !== sticky.name &&
      (top.titleScore == null || (top.titleScore ?? 0) < TITLE_STICKY_MIN)
    ) {
      return {
        artConflict: true,
        candidates: promote(ranked, sticky),
        card: {
          confidence: sticky.titleScore ?? sticky.score,
          name: sticky.name,
          oracleId: sticky.oracleId,
        },
        margin: (sticky.titleScore ?? 0) - (top.titleScore ?? 0),
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
