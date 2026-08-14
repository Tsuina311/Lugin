// What is my collection worth, and what has it done since I bought it?
//
// Both answers are arithmetic over a price table the app already holds — see
// scripts/build-prices.mjs for how that table is made and why it isn't a lookup
// per card. Nothing here touches the network, which is the entire point: a total
// that needs 20,000 requests is a total nobody waits for.
//
// The awkward part isn't the sum, it's being honest about which rows it covers. A
// collection scanned in ManaBox knows its exact printings and prices exactly; one
// imported from a bare list can only be priced by name; some cards have no price
// at all. Reporting one number over all three would be a guess wearing a total's
// clothing, so the result carries what it couldn't do.

import { looseKey } from './cardName';
import type { CollectionCard } from './collection';

/** [eur, eur foil, usd, usd foil], in cents. 0 means "no price", not "free". */
export type PriceRow = readonly [number, number, number, number];

export interface PriceSnapshot {
  /** What each slot of a row means, in order. */
  currency: readonly string[];
  /** When Scryfall's dump was distilled, ISO. */
  generated: string;
  /** looseKey(name) -> the cheapest paper printing of it. */
  names: Record<string, PriceRow>;
  /** "set|collector number" -> that exact printing. */
  printings: Record<string, PriceRow>;
  source: string;
  unit: 'cents';
  version: number;
}

export type Currency = 'eur' | 'usd';

/** How long a snapshot is treated as current. Scryfall rebuilds once a day. */
export const PRICES_MAX_AGE_MS = 20 * 60 * 60 * 1000;

/** What a platform's price loader hands back. */
export interface PriceState {
  /** When *we* fetched it, not when Scryfall built it. Null when we never have. */
  fetchedAt: number | null;
  snapshot: PriceSnapshot | null;
  /** True when this is a kept copy past its age — offline, or the file is gone. */
  stale: boolean;
}

export const NO_PRICES: PriceState = { fetchedAt: null, snapshot: null, stale: false };

export interface CardPrice {
  cents: number;
  /**
   * False when this is the right card but not necessarily the right *copy*: a
   * name matched without a printing, or a foil quoted at its non-foil price
   * because Scryfall has no foil for it. Always an under-estimate rather than an
   * over-estimate, so a total built from these reads as a floor.
   */
  exact: boolean;
}

/** Which slots of a row hold this currency's plain and foil prices. */
const SLOTS: Record<Currency, { foil: number; plain: number }> = {
  eur: { foil: 1, plain: 0 },
  usd: { foil: 3, plain: 2 },
};

type Priceable = Pick<CollectionCard, 'collectorNumber' | 'foil' | 'name' | 'setCode'>;

export const printingKeyOf = (card: Priceable): string | null =>
  card.setCode && card.collectorNumber
    ? `${card.setCode}|${card.collectorNumber}`.toLowerCase()
    : null;

export const priceOf = (
  card: Priceable,
  snapshot: PriceSnapshot,
  currency: Currency = 'eur',
): CardPrice | null => {
  const key = printingKeyOf(card);
  const row = (key && snapshot.printings[key]) || snapshot.names[looseKey(card.name)];
  if (!row) return null;
  const exactPrinting = Boolean(key && snapshot.printings[key]);

  const slot = SLOTS[currency];
  if (card.foil) {
    if (row[slot.foil] > 0) return { cents: row[slot.foil], exact: exactPrinting };
    // No foil price for this printing. The non-foil is wrong but close, and
    // dropping the card would understate the total by more than this does.
    if (row[slot.plain] > 0) return { cents: row[slot.plain], exact: false };
    return null;
  }
  return row[slot.plain] > 0 ? { cents: row[slot.plain], exact: exactPrinting } : null;
};

export interface CollectionValue {
  /** Copies priced, but not by their own printing. */
  approxCopies: number;
  /** Market value in cents, over the copies that could be priced at all. */
  cents: number;
  /** Copies we could put a price on at all. */
  copies: number;
  /** Cents paid, over copies that have both a recorded cost and a price. */
  cost: number;
  costCopies: number;
  /** Market value of exactly the copies `cost` covers, so the delta is like for like. */
  costValue: number;
  /** costValue - cost. Null when nothing has a recorded cost. */
  gain: number | null;
  unpricedCopies: number;
}

const EMPTY: CollectionValue = {
  approxCopies: 0,
  cents: 0,
  copies: 0,
  cost: 0,
  costCopies: 0,
  costValue: 0,
  gain: null,
  unpricedCopies: 0,
};

/**
 * Sum a collection.
 *
 * Quantities are respected (four copies are worth four), and the cost basis is
 * deliberately summed over a *subset*: only copies that have both a price paid
 * and a price now can say anything about a gain. Comparing a full market value
 * against a partial cost would invent a profit out of the cards you never
 * recorded paying for.
 */
export const collectionValue = (
  cards: readonly CollectionCard[],
  snapshot: PriceSnapshot | null,
  currency: Currency = 'eur',
): CollectionValue => {
  if (!snapshot) return EMPTY;
  const out: CollectionValue = { ...EMPTY };

  for (const card of cards) {
    const copies = card.quantity > 0 ? card.quantity : 0;
    if (copies === 0) continue;
    const price = priceOf(card, snapshot, currency);
    if (!price) {
      out.unpricedCopies += copies;
      continue;
    }
    out.cents += price.cents * copies;
    out.copies += copies;
    if (!price.exact) out.approxCopies += copies;

    if (card.purchasePrice !== undefined && card.purchasePrice > 0) {
      out.cost += Math.round(card.purchasePrice * 100) * copies;
      out.costValue += price.cents * copies;
      out.costCopies += copies;
    }
  }

  out.gain = out.costCopies > 0 ? out.costValue - out.cost : null;
  return out;
};

/** Cents as money, in the app's usual continental spelling. */
export const money = (cents: number, currency: Currency = 'eur'): string => {
  const amount = (cents / 100).toFixed(2);
  return currency === 'eur' ? `${amount.replace('.', ',')} €` : `$${amount}`;
};

/** Cents as a signed change, for a gain that has to read as up or down. */
export const signedMoney = (cents: number, currency: Currency = 'eur'): string =>
  `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents), currency)}`;
