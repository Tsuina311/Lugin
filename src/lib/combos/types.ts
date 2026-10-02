// Two-card Commander combos, shaped from Commander Spellbook API 7.1.3.
//
// The stored records are the compact asset. The domain object is built from
// those records when a pair is actually in a deck, so editing a list does not
// reparse the whole database.

/** Spellbook `BracketTagEnum`, current as of API 7.1.3. */
export type SpellbookBracketTag = 'B' | 'C' | 'E' | 'O' | 'P' | 'R' | 'S';

export interface StoredComboCard {
  commander: boolean;
  name: string;
  oracleId: string;
  qty: number;
  zones: string[];
}

export interface StoredComboRequire {
  commander: boolean;
  name: string;
}

/** One Spellbook variant whose `uses` list is exactly two distinct cards. */
export interface StoredCombo {
  cards: [StoredComboCard, StoredComboCard];
  desc: string;
  easy: string;
  id: string;
  legal: boolean;
  mana: string;
  mv: number;
  notable: string;
  req: StoredComboRequire[];
  results: string[];
  status: string;
  tag: SpellbookBracketTag;
}

export interface ComboIndexMetadata {
  comboCount: number;
  generatedAt: string;
  pairCount: number;
  productionBundle: false;
  provider: 'Commander Spellbook';
  /** MIT on the software repo was not verified as a right to redistribute the combo dataset. */
  redistribution: 'not-cleared';
  schema: 1;
  sha256: { combos: string; pairs: string; runtime: string };
  sourceUrl: string;
  sourceVersion: string;
}

export interface ComboBundle {
  combos: Record<string, StoredCombo>;
  metadata: ComboIndexMetadata;
  names: Record<string, string>;
  pairs: Record<string, string[]>;
}

export type ComboDependency = 'COMMANDER_DEPENDENT' | 'CONDITIONAL' | 'SELF_CONTAINED';

/** Booleans Lugin derives from Spellbook feature names. Absent means "not derived", not "false". */
export interface LuginDerivedResults {
  drawsLibrary?: true;
  extraTurns?: true;
  isInfinite?: true;
  producesInfiniteDamage?: true;
  producesInfiniteMana?: true;
  producesInfiniteTokens?: true;
  winsGame?: true;
}

export interface ComboLine {
  dependency: ComboDependency;
  derived: LuginDerivedResults;
  description: string;
  id: string;
  mana: string;
  prerequisites: string[];
  requiresCommander: boolean;
  results: string[];
  tag: SpellbookBracketTag;
  url: string;
}

export interface ComboCardRef {
  name: string;
  oracleId: string;
}

export interface DetectedPair {
  cards: [ComboCardRef, ComboCardRef];
  lead: ComboLine;
  lines: ComboLine[];
  pairKey: string;
  usesCommander: boolean;
}

export interface ComboAnalysis {
  pairs: DetectedPair[];
  pending: number;
  resolved: number;
  total: number;
  unresolved: number;
}

export interface DeckComboCard {
  name: string;
  oracleId?: string;
  quantity: number;
  section: 'commander' | 'main' | 'sideboard';
  /** Scryfall was asked and does not know this name. */
  unresolved?: boolean;
}
