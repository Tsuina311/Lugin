// Lightweight text-box evidence.
//
// OCR of the rules box is secondary: distinctive tokens raise confidence in a
// candidate already suggested by art/title. Generic Magic vocabulary is almost
// worthless, and disagreement must never hard-reject (old frames / translations
// diverge from Scryfall oracle_text).

import { foldName } from '../matchName';

/** Tokens that appear on nearly every spell — ignore them. */
const STOP = new Set(
  [
    'a',
    'an',
    'and',
    'as',
    'at',
    'be',
    'card',
    'creature',
    'enchantment',
    'for',
    'from',
    'instant',
    'into',
    'it',
    'may',
    'of',
    'on',
    'or',
    'permanent',
    'player',
    'sorcery',
    'target',
    'the',
    'this',
    'to',
    'you',
    'your',
    'battlefield',
    'control',
    'controls',
    'draw',
    'card',
    'cards',
    'mana',
    'add',
    'cast',
    'spell',
    'spells',
    'enters',
    'enter',
    'end',
    'turn',
    'until',
  ].map(foldName),
);

export const tokenizeScanText = (raw: string): string[] => {
  // Split on whitespace/punctuation *before* foldName — foldName drops spaces,
  // which would glue "Investigate Create" into one unusable token.
  const out: string[] = [];
  for (const piece of raw.split(/[^\p{Letter}\p{Number}]+/u)) {
    const t = foldName(piece);
    if (t.length >= 3 && !STOP.has(t)) out.push(t);
  }
  return out;
};

export interface TextIndexEntry {
  name: string;
  oracleId: string;
  /** Distinctive tokens from printed/oracle text. */
  tokens: string[];
}

export interface TextIndexData {
  entries: TextIndexEntry[];
  version: number;
}

/**
 * Score how well OCR tokens support a candidate. Rare tokens weigh more via a
 * simple IDF over the (small) candidate set — not the whole catalogue — so this
 * is a *reranker*, not a global search.
 */
export const textEvidenceScore = (
  ocrTokens: readonly string[],
  candidateTokens: readonly string[],
  idf: Map<string, number>,
): number => {
  if (!ocrTokens.length || !candidateTokens.length) return 0;
  const have = new Set(candidateTokens);
  let hit = 0;
  let weight = 0;
  for (const t of ocrTokens) {
    const w = idf.get(t) ?? 1;
    weight += w;
    if (have.has(t)) hit += w;
  }
  return weight ? hit / weight : 0;
};

/** Build IDF over a candidate pool (higher = rarer in the pool). */
export const idfForPool = (pool: readonly TextIndexEntry[]): Map<string, number> => {
  const df = new Map<string, number>();
  for (const e of pool) {
    for (const t of new Set(e.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(1, pool.length);
  const out = new Map<string, number>();
  for (const [t, c] of df) out.set(t, Math.log(1 + n / c));
  return out;
};

export const lookupTextEntry = (
  index: TextIndexData | null,
  oracleId: string,
): TextIndexEntry | undefined => index?.entries.find(e => e.oracleId === oracleId);
