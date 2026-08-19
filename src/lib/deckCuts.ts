// Suggested cuts for commander decks: cards in the main deck that EDHREC sees
// in fewer than a threshold share of decks with the same commander.

import { cardKey } from './cardName';
import type { DeckCard } from './deck';
import type { EdhrecData } from './edhrec';
import { isBasicLand } from './lands';

export const CUT_THRESHOLD_KEY = 'lugin:deckCutThreshold';
export const DEFAULT_CUT_THRESHOLD = 10;

export interface CutCandidate {
  card: DeckCard;
  /** Share of decks playing it, 0..1. Undefined when EDHREC doesn't list it. */
  inclusion?: number;
  numDecks?: number;
}

export interface EdhrecPlayRates {
  byKey: Map<string, { inclusion?: number; numDecks?: number }>;
  /** Inclusion of the least-played card EDHREC lists — ceiling for unlisted cards. */
  floor: number;
}

export const readCutThreshold = (): number => {
  try {
    const raw = Number(localStorage.getItem(CUT_THRESHOLD_KEY));
    return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : DEFAULT_CUT_THRESHOLD;
  } catch {
    return DEFAULT_CUT_THRESHOLD;
  }
};

export const writeCutThreshold = (value: number): void => {
  try {
    localStorage.setItem(CUT_THRESHOLD_KEY, String(value));
  } catch {
    // ignore storage failures
  }
};

/** How often EDHREC sees each card on the commander's page. */
export const edhrecPlayRates = (data: EdhrecData | null | undefined): EdhrecPlayRates => {
  const byKey = new Map<string, { inclusion?: number; numDecks?: number }>();
  let floor = 1;
  for (const list of data?.lists ?? []) {
    for (const c of list.cards) {
      const key = cardKey(c.name);
      const prev = byKey.get(key);
      // A card can appear in several lists; keep the highest reading.
      if (!prev || (c.inclusion ?? 0) > (prev.inclusion ?? 0)) {
        byKey.set(key, { inclusion: c.inclusion, numDecks: c.numDecks });
      }
      if (c.inclusion != null) floor = Math.min(floor, c.inclusion);
    }
  }
  return { byKey, floor };
};

/**
 * Main-deck cards played in under `thresholdPct`% of EDHREC decks, weakest first.
 * Basics and the commander zone are never cut candidates.
 */
export const suggestCuts = (
  cards: readonly DeckCard[],
  played: EdhrecPlayRates,
  thresholdPct: number,
): { candidates: number; cuts: CutCandidate[] } => {
  const limit = thresholdPct / 100;
  const out: CutCandidate[] = [];
  let candidates = 0;
  for (const card of cards) {
    if (card.section !== 'main' || isBasicLand(card.name)) continue;
    candidates += 1;
    const hit = played.byKey.get(cardKey(card.name));
    if ((hit?.inclusion ?? 0) >= limit) continue;
    out.push({
      card,
      inclusion: hit?.inclusion,
      numDecks: hit?.numDecks,
    });
  }
  out.sort(
    (a, b) => (a.inclusion ?? -1) - (b.inclusion ?? -1) || a.card.name.localeCompare(b.card.name),
  );
  return { candidates, cuts: out };
};
