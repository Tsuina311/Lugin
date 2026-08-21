// Adjusting a collection by card identity — the phone rolls printings up per
// name, so edits set the total copies rather than picking a printing. When a
// row is unfolded, quantity can also be set per printing.

import { cardKey } from './cardName';
import type { CollectionCard } from './collection';

const printingScore = (card: CollectionCard): number =>
  (card.scryfallId ? 4 : 0) +
  (card.productId ? 3 : 0) +
  (card.setCode ? 2 : 0) +
  (card.imageUrl ? 1 : 0);

/** Stable id for one printing+finish of a card (used for per-row edits). */
export const printingIdentity = (card: CollectionCard): string =>
  [
    cardKey(card.name),
    card.setCode ?? '',
    card.collectorNumber ?? '',
    card.productId ?? '',
    card.scryfallId ?? '',
    card.foil ? 'f' : 'n',
    card.imageUrl ?? '',
  ].join('|');

/** Every row that shares a card identity key. */
export const cardsForKey = (cards: readonly CollectionCard[], key: string): CollectionCard[] =>
  cards.filter(card => cardKey(card.name) === key);

/** The printing worth keeping when several rows collapse to one total. */
export const representativePrinting = (
  rows: readonly CollectionCard[],
): CollectionCard | undefined => {
  if (rows.length === 0) return undefined;
  return rows.reduce((best, card) =>
    printingScore(card) > printingScore(best) ? card : best,
  );
};

/**
 * Set how many copies of a card identity the collection holds. Consolidates
 * every printing of that name into one row; quantity 0 drops the card entirely.
 */
export const adjustCollectionQuantity = (
  cards: readonly CollectionCard[],
  key: string,
  quantity: number,
  displayName?: string,
): CollectionCard[] => {
  const other = cards.filter(card => cardKey(card.name) !== key);
  if (quantity <= 0) return other;

  const matching = cardsForKey(cards, key);
  const rep = representativePrinting(matching);
  const name = rep?.name ?? displayName;
  if (!name) return [...cards];

  return [
    ...other,
    {
      collectorNumber: rep?.collectorNumber,
      foil: rep?.foil ?? false,
      imageUrl: rep?.imageUrl,
      name,
      productId: rep?.productId,
      quantity,
      scryfallId: rep?.scryfallId,
      setCode: rep?.setCode,
      setName: rep?.setName,
      source: rep?.source ?? 'import',
    },
  ];
};

/**
 * Set quantity on one printing. Quantity 0 removes that printing only; other
 * printings of the same card stay.
 */
export const adjustPrintingQuantity = (
  cards: readonly CollectionCard[],
  identity: string,
  quantity: number,
): CollectionCard[] => {
  let touched = false;
  const next: CollectionCard[] = [];
  for (const card of cards) {
    if (printingIdentity(card) !== identity) {
      next.push(card);
      continue;
    }
    touched = true;
    if (quantity > 0) next.push({ ...card, quantity });
  }
  return touched ? next : [...cards];
};
