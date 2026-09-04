// Compact local printing index — set + collector → candidate printings.
// Built centrally from Scryfall bulk; consumed offline on the phone.

export const PRINTING_INDEX_VERSION = 1;

/** One physical printing row (language-specific). */
export interface PrintingIndexEntry {
  /** Scryfall collector_number — string, never parsed as int. */
  collectorNumber: string;
  finishes: string[];
  /** illustration_id when present — for restricted art confirm. */
  illustrationId?: string;
  lang: string;
  layout?: string;
  name: string;
  oracleId: string;
  /** Scryfall card id. */
  scryfallId: string;
  setCode: string;
  setName?: string;
}

/** Compact JSON on disk / Pages. */
export interface PrintingIndexData {
  entries: PrintingIndexEntry[];
  generated?: string;
  source?: string;
  version: number;
}

export interface PrintingLookupHit {
  candidates: PrintingIndexEntry[];
  /** Canonical key used (set|number). */
  key: string;
  /** How many OCR-normalized variants were tried. */
  variantsTried: number;
}

export interface PrintingIndex {
  /** set|collector (lower) → entry indexes into `entries`. */
  byKey: Map<string, number[]>;
  entries: PrintingIndexEntry[];
  generated: string | null;
  recordCount: number;
  version: number;
}
