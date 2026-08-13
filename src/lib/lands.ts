// Basic-land maths for the deck builder's "auto balance lands" mode.
//
// The deck runs the number of lands its format calls for — 37 in Commander, 24
// in a 60-card deck — at every stage of building, not just when the deck is
// full. A skeleton of five spells plus its 37 lands reads as 42/100, which says
// exactly how much deck is left to find; filling the other 58 slots with basics
// would say nothing at all.
//
// Lands the user picked themselves (Command Tower, duals, snow basics) count
// towards that number, and basics make up the difference. The split between
// basics follows the deck's colored mana requirements — count the pips in every
// nonland card's mana cost, then hand out the basics in that ratio.
//
// Only the six plain basics are managed, so auto-balancing never removes a card
// the user chose on purpose.

import { cardKey } from './cardName';
import type { DeckCard } from './deck';
import { WUBRG, isLandType, sortWubrg, type CardMetadata } from './mtg';

/** The basic land that produces each color; colorless decks get Wastes. */
export const BASIC_LANDS: Record<string, string> = {
  B: 'Swamp',
  C: 'Wastes',
  G: 'Forest',
  R: 'Mountain',
  U: 'Island',
  W: 'Plains',
};

const BASIC_KEYS = new Set(Object.values(BASIC_LANDS).map(n => cardKey(n)));

/** True for the six plain basics only — not snow basics or other lands. */
export const isBasicLand = (name: string): boolean => BASIC_KEYS.has(cardKey(name));

/** How many basics a plan wants, by card name. */
export type BasicPlan = Record<string, number>;

const SYMBOL_RE = /\{([^}]+)\}/g;

/**
 * Add a mana cost's colored pips into `into`, counted `times` over. Hybrid and
 * Phyrexian symbols split their credit between the colors they offer, so
 * "{G/U}" nudges both rather than committing to either.
 */
const addPips = (manaCost: string | undefined, times: number, into: Record<string, number>) => {
  if (!manaCost) return;
  for (const [, body] of manaCost.matchAll(SYMBOL_RE)) {
    const colors = body
      .toUpperCase()
      .split('/')
      .filter(part => WUBRG.includes(part));
    if (colors.length === 0) continue;
    const weight = times / colors.length;
    for (const c of colors) into[c] = (into[c] ?? 0) + weight;
  }
};

/**
 * Split `total` lands across `colors` in proportion to `weights`, using the
 * largest-remainder method so the parts always add up to exactly `total`.
 * Colors with no pips still get an even share when nothing has weight.
 */
export const distributeLands = (
  total: number,
  colors: string[],
  weights: Record<string, number>,
): Record<string, number> => {
  if (total <= 0) return {};
  const keys = colors.length > 0 ? sortWubrg(colors) : ['C'];

  const w = keys.map(k => Math.max(0, weights[k] ?? 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const exact = sum > 0 ? w.map(x => (x / sum) * total) : keys.map(() => total / keys.length);

  const counts = exact.map(Math.floor);
  const remaining = total - counts.reduce((a, b) => a + b, 0);
  // Hand out what rounding left over, biggest fraction first (WUBRG breaks ties).
  const byFraction = exact
    .map((value, i) => ({ frac: value - Math.floor(value), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let n = 0; n < remaining; n++) counts[byFraction[n % byFraction.length].i]++;

  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    if (counts[i] > 0) out[k] = counts[i];
  });
  return out;
};

/**
 * The basics a deck should run to reach `landTarget` lands in total, split by
 * what its spells cost. Lands the user added themselves fill part of the target;
 * the sideboard is left out of both counts.
 */
export const planBasicLands = ({
  cards,
  colors,
  landTarget,
  metaByKey,
}: {
  cards: DeckCard[];
  /** Colors to draw basics from — the commander's identity, or the deck's. */
  colors: string[];
  /** Lands the finished deck should run, basics included. */
  landTarget: number;
  metaByKey: Record<string, CardMetadata>;
}): BasicPlan => {
  let chosenLands = 0;
  const pips: Record<string, number> = {};

  for (const card of cards) {
    if (card.section === 'sideboard' || isBasicLand(card.name)) continue;
    const meta = metaByKey[cardKey(card.name)];
    if (isLandType(meta)) {
      // A land's own activation costs shouldn't sway the color split.
      chosenLands += card.quantity;
      continue;
    }
    addPips(meta?.manaCost, card.quantity, pips);
  }

  const counts = distributeLands(Math.max(0, landTarget - chosenLands), colors, pips);
  const plan: BasicPlan = {};
  for (const [color, n] of Object.entries(counts)) plan[BASIC_LANDS[color]] = n;
  return plan;
};

/** Basics currently in the main deck, keyed by card key. */
export const currentBasicLands = (cards: DeckCard[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const c of cards) {
    if (c.section !== 'main' || !isBasicLand(c.name)) continue;
    const key = cardKey(c.name);
    counts.set(key, (counts.get(key) ?? 0) + c.quantity);
  }
  return counts;
};

/** Whether the deck's basics already match a plan (so we can skip a write). */
export const basicsMatchPlan = (cards: DeckCard[], plan: BasicPlan): boolean => {
  const current = currentBasicLands(cards);
  const want = new Map(
    Object.entries(plan)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => [cardKey(name), n]),
  );
  if (current.size !== want.size) return false;
  for (const [key, n] of want) if (current.get(key) !== n) return false;
  return true;
};
