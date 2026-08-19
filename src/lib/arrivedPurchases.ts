// Which purchases count as owned.
//
// A card you paid for on Tuesday is not in your collection on Tuesday; it is in a
// padded envelope somewhere. Folding every purchase in the moment it is paid for
// makes the collection a record of intent rather than of what is in the binder,
// and it shows up as cards you cannot find when you go looking for them.
//
// So the fold-in waits for Cardmarket's own "Arrived" state, which is recorded per
// order by the purchase sync. Pure and structurally typed, like `sellerStats`, so
// the rule is tested rather than asserted.

export interface ArrivalLine {
  orderId: string;
  qty?: number;
}

export interface ArrivalCard {
  count: number;
  name: string;
  purchases?: ArrivalLine[];
}

export interface ArrivalIndex {
  cards: Record<string, ArrivalCard>;
  orders?: Record<string, { state?: string }>;
}

/**
 * Whether an order's cards should be treated as in hand.
 *
 * An order with no recorded state counts as arrived. Unknown states are almost
 * entirely old orders — indexed before states were captured, and too deep in the
 * history for an incremental sync to walk past again — so reading "unknown" as
 * "not yet delivered" would quietly empty someone's collection. Being wrong about
 * a parcel that is genuinely still in transit is a much smaller error.
 */
export const hasArrived = (state?: string): boolean =>
  state === undefined || state === '' || state === 'Arrived';

/**
 * The same index with only the copies that have arrived.
 *
 * Counts are recomputed from the surviving lines rather than carried over —
 * `count` is the total ever bought, and using it here would credit a card with
 * copies that are still in the post.
 */
export const arrivedOnly = <T extends ArrivalIndex>(index: T): T => {
  const orders = index.orders ?? {};
  const cards: Record<string, ArrivalCard> = {};

  for (const [key, card] of Object.entries(index.cards ?? {})) {
    const lines = card.purchases ?? [];
    // A card with no order lines at all can only be judged by its total, and it
    // predates order tracking entirely — keep it rather than lose it.
    if (lines.length === 0) {
      if (card.count > 0) cards[key] = card;
      continue;
    }
    const kept = lines.filter(line => hasArrived(orders[line.orderId]?.state));
    if (kept.length === 0) continue;
    const count = kept.reduce((n, line) => n + (line.qty ?? 1), 0);
    if (count <= 0) continue;
    cards[key] = { ...card, count, purchases: kept };
  }

  return { ...index, cards };
};

/** Copies bought but not yet arrived, so the UI can say so instead of just omitting them. */
export const inTransitCopies = (index: ArrivalIndex): number => {
  const orders = index.orders ?? {};
  let copies = 0;
  for (const card of Object.values(index.cards ?? {})) {
    for (const line of card.purchases ?? []) {
      if (!hasArrived(orders[line.orderId]?.state)) copies += line.qty ?? 1;
    }
  }
  return copies;
};
