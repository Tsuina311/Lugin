// Compact TypeIndex — face-aware type-line evidence for recognition.

export const TYPE_INDEX_VERSION = 1;

export interface TypeIndexFace {
  /** Card-type bit mask (indexes into cardTypes[]). */
  cardTypeMask: number;
  faceIndex: number;
  faceName?: string;
  /** Normalized English oracle type line. */
  normalizedTypeLine: string;
  oracleOrdinal: number;
  /** lang → normalized printed_type_line. */
  printed?: Record<string, string>;
  /** Supertype bit mask. */
  supertypeMask: number;
  /** Subtype dictionary ids. */
  subtypeIds: number[];
}

export interface TypeIndexData {
  cardTypes: string[];
  faces: TypeIndexFace[];
  generated?: string;
  /** oracleId by ordinal. */
  oracles: string[];
  /** lang → printed type line → face indexes (compact optional). */
  printedLines?: Record<string, Record<string, number[]>>;
  /** normalized type line → face indexes. */
  signatures: Record<string, number[]>;
  source?: string;
  subtypes: string[];
  /** subtypeId → sorted oracle ordinals. */
  subtypePostings: Record<string, number[]>;
  supertypes: string[];
  version: number;
}

export interface TypeIndex {
  cardTypeId: Map<string, number>;
  data: TypeIndexData;
  oracleIdOf: (ordinal: number) => string | undefined;
  oracleOrdinal: Map<string, number>;
  subtypeId: Map<string, number>;
  supertypeId: Map<string, number>;
}

export interface RankedTypeToken {
  id: number;
  score: number;
  value: string;
}

export interface TypeEvidence {
  cardTypes: RankedTypeToken[];
  candidateOracleIds?: string[];
  confidence: number;
  normalizedText: string;
  rawText: string;
  subtypes: RankedTypeToken[];
  supertypes: RankedTypeToken[];
}
