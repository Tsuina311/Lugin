// "You bought this — but is it the one already in your binder?"
//
// The file-import path has always asked this (see `duplicates`), because a
// ManaBox scan landing on top of Cardmarket purchases can't tell a card counted
// twice from a second copy. The purchase path had the same problem in the other
// direction and never asked: it derived rows from the order history, appended
// them to whatever was already there, and a card you had both scanned and bought
// ended up counted twice.
//
// The complication that kept it from simply reusing the import review: the
// purchase fold-in rebuilds *all* of its rows on every sync, which is what makes
// re-syncing idempotent. An answer that lived in the rows would be thrown away
// and asked again every time. So answers are recorded against a key that
// survives the rebuild, and this module applies them.

import { cardKey } from './cardName';
import type { CollectionCard } from './collection';
import { findDuplicates, type DuplicateCandidate } from './duplicates';

/** What the owner said about a purchase that resembled a card they already had. */
export type PurchaseVerdict =
  /** Already accounted for by the existing row — don't add it. */
  | 'own'
  /** A genuinely different copy — add it, and stop asking. */
  | 'separate';

export type PurchaseVerdicts = Readonly<Record<string, PurchaseVerdict>>;

export interface HeldPurchase extends DuplicateCandidate {
  /** How the answer is recorded, stable across re-derivation. */
  key: string;
}

export interface PurchaseSplit {
  /** Rows to write into the collection. */
  add: CollectionCard[];
  /** Rows withheld pending an answer. */
  held: HeldPurchase[];
}

/**
 * Identity of a purchased printing, stable across syncs.
 *
 * Mirrors how the fold-in groups order lines into rows — Cardmarket product id
 * when known, else the edition name, split by finish — so one key means one row
 * for as long as the purchase is in the history. Quantity is deliberately absent:
 * buying a third copy of something you already answered about shouldn't reopen a
 * settled question.
 */
export const purchaseKey = (card: CollectionCard): string =>
  [
    cardKey(card.name),
    card.productId ?? (card.setName ?? '').trim().toLowerCase(),
    card.foil ? 'f' : 'n',
  ].join('|');

/**
 * Split freshly derived purchase rows into what can be added now and what needs
 * an answer first.
 *
 * Withholding rather than adding-and-flagging is the same bet the import review
 * makes: ask before the collection grows, because an inflated count looks exactly
 * like a correct one and nobody recounts a binder to check.
 *
 * `owned` should be the rows the fold-in isn't about to replace — purchase rows
 * are re-derived wholesale, so matching against them would pair every card with
 * its own previous self.
 */
export const splitPurchases = (
  purchases: readonly CollectionCard[],
  owned: readonly CollectionCard[],
  decided: PurchaseVerdicts = {},
): PurchaseSplit => {
  const rows = [...purchases];
  const { candidates } = findDuplicates(rows, [...owned]);
  const byIndex = new Map(candidates.map(c => [c.index, c]));

  const add: CollectionCard[] = [];
  const held: HeldPurchase[] = [];

  rows.forEach((row, index) => {
    const candidate = byIndex.get(index);
    if (!candidate) {
      add.push(row);
      return;
    }
    const verdict = decided[purchaseKey(row)];
    if (verdict === 'own') return;
    if (verdict === 'separate') add.push(row);
    else held.push({ ...candidate, key: purchaseKey(row) });
  });

  return { add, held };
};

/**
 * Drop answers about purchases that are no longer in the history.
 *
 * Without this the record grows forever, and — worse — a key that comes back
 * (an order re-appearing after a full re-sync) would be silently suppressed by a
 * verdict given about a different card years earlier.
 */
export const pruneVerdicts = (
  decided: PurchaseVerdicts,
  purchases: readonly CollectionCard[],
): Record<string, PurchaseVerdict> => {
  const live = new Set(purchases.map(purchaseKey));
  const out: Record<string, PurchaseVerdict> = {};
  for (const [key, verdict] of Object.entries(decided)) if (live.has(key)) out[key] = verdict;
  return out;
};
