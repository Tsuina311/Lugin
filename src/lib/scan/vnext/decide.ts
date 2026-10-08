/**
 * Frozen challenger rec-71078c38c736. Not a production default.
 *
 * Publish the prototype Top1 when prototype margin >= 0.05 and the clean
 * gallery's Top1 oracle is the same identity. The clean margin is not an input.
 *
 * Otherwise publish only a unique exact title whose oracle is already inside
 * the prototype Top 5. Fuzzy titles, ambiguous names, and titles outside that
 * Top 5 stay withheld. A visual publish is never replaced by OCR.
 */

export const VNEXT_PUBLISH_MARGIN = 0.05;

export type VNextDecisionSource = 'VISUAL_AGREEMENT' | 'OCR_EXACT_TOP5_RECOVERY' | 'WITHHELD';

export type VNextDecisionInput = {
  cleanTop1OracleId: string | null;
  prototypeTop1OracleId: string | null;
  /** Stored or measured prototype Top1 − Top2. Null when Top2 does not exist. */
  prototypeMargin: number | null;
  prototypeTop5OracleIds: readonly string[];
  /**
   * Set only when title OCR resolved to one exact card name and that name
   * maps to exactly one gallery oracle. Fuzzy, empty, and multi-oracle
   * names stay null.
   */
  exactUniqueOracleId: string | null;
};

export type VNextDecision = {
  source: VNextDecisionSource;
  publish: boolean;
  oracleId: string | null;
  agreement: boolean;
  prototypeMargin: number | null;
};

export const decideVNext = (input: VNextDecisionInput): VNextDecision => {
  const agreement =
    input.cleanTop1OracleId != null &&
    input.prototypeTop1OracleId != null &&
    input.cleanTop1OracleId === input.prototypeTop1OracleId;
  const margin = input.prototypeMargin;
  if (
    margin != null &&
    margin >= VNEXT_PUBLISH_MARGIN &&
    agreement &&
    input.prototypeTop1OracleId != null
  ) {
    return {
      source: 'VISUAL_AGREEMENT',
      publish: true,
      oracleId: input.prototypeTop1OracleId,
      agreement: true,
      prototypeMargin: margin,
    };
  }
  const exact = input.exactUniqueOracleId;
  if (exact != null && input.prototypeTop5OracleIds.includes(exact)) {
    return {
      source: 'OCR_EXACT_TOP5_RECOVERY',
      publish: true,
      oracleId: exact,
      agreement,
      prototypeMargin: margin,
    };
  }
  return {
    source: 'WITHHELD',
    publish: false,
    oracleId: null,
    agreement,
    prototypeMargin: margin,
  };
};
