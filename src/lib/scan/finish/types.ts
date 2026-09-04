// Finish / foil recognition seam.
//
// Foil is temporal and visual. Do not block card identity on finish.
// Only run visual analysis when the printing metadata lists multiple finishes.

export type CardFinish = 'foil' | 'nonfoil' | 'etched' | 'unknown';

export interface FinishObservation {
  /** Optional preview of specular / highlight metrics for debug. */
  highlightShare?: number;
  /** Wall time of the sample. */
  at: number;
}

export interface FinishResult {
  confidence: number;
  finish: CardFinish;
  /** How many live observations contributed. */
  observations: number;
  /** Finishes allowed by printing metadata (when known). */
  supported?: readonly string[];
}

export interface FinishRecognizer {
  /** Reset when the locked card changes. */
  reset(): void;
  /** Observe one warped card (or finish region) sample. */
  observe(sample: {
    /** Optional precomputed highlight share 0–1. */
    highlightShare?: number;
  }): void;
  result(): FinishResult;
}

/**
 * Metadata-first finish: if the printing only allows one finish, return it.
 * Otherwise return unknown until a visual recognizer is confident.
 */
export const finishFromMetadata = (
  finishes: readonly string[] | null | undefined,
): FinishResult | null => {
  if (!finishes?.length) return null;
  const norm = [...new Set(finishes.map(f => f.toLowerCase()))];
  if (norm.length === 1) {
    const f = norm[0];
    if (f === 'foil' || f === 'nonfoil' || f === 'etched') {
      return { confidence: 1, finish: f, observations: 0, supported: finishes };
    }
  }
  return null;
};

/** Conservative stub — always unknown; ready for temporal foil signals later. */
export const createUnknownFinishRecognizer = (
  supported?: readonly string[],
): FinishRecognizer => {
  let observations = 0;
  return {
    reset() {
      observations = 0;
    },
    observe() {
      observations += 1;
    },
    result() {
      const meta = finishFromMetadata(supported);
      if (meta) return { ...meta, observations };
      return {
        confidence: 0,
        finish: 'unknown',
        observations,
        supported,
      };
    },
  };
};
