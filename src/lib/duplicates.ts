// "Do I already own this one?"
//
// Importing a ManaBox scan into a collection that already holds Cardmarket
// purchases asks a question no file can answer: is this row the same physical
// card, counted twice by two apps, or a second copy? Guess "same" and cards
// quietly vanish from the collection; guess "different" and it inflates.
//
// So this module doesn't decide. It pairs up what *might* be the same, grades
// how sure it is and says why, and leaves the answer to the person who owns the
// cards. `applyImport` then does exactly what they said, and nothing else.
//
// Matching is strongest-first and each existing row is claimed at most once: two
// incoming copies of Sol Ring must not both point at the one you already have,
// or unticking either would silently add both.

import { cardKey } from './cardName';
import type { CollectionCard } from './collection';

/**
 * How much of the two rows actually agreed.
 *
 * There is deliberately no tier for "same name, different finish": a foil and a
 * regular copy are two different cards, priced and collected separately, so a
 * pairing across finishes would be offering to delete something real.
 */
export type MatchStrength = 'exact' | 'likely' | 'possible';

export interface DuplicateCandidate {
  /** The row already in the collection. */
  existing: CollectionCard;
  /** The row from the imported file. */
  incoming: CollectionCard;
  /** Position of `incoming` in the imported list — how a decision is recorded. */
  index: number;
  /** Why these were paired, for the review row. */
  reason: string;
  strength: MatchStrength;
}

export interface ImportDiff {
  /** Possible repeats, strongest match first. */
  candidates: DuplicateCandidate[];
  /** Rows nothing matched: new cards, added whatever the user decides above. */
  fresh: CollectionCard[];
}

const RANK: Record<MatchStrength, number> = { exact: 0, likely: 1, possible: 2 };

const norm = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** Same card, same printing, same finish — the row is the same thing twice. */
const printingKey = (card: CollectionCard): string =>
  [cardKey(card.name), norm(card.setCode), norm(card.collectorNumber), card.foil].join('|');

/** Whether the row identifies a printing at all, as opposed to just a card. */
const statesPrinting = (card: CollectionCard): boolean =>
  !!norm(card.setCode) || !!norm(card.collectorNumber);

const editionKey = (card: CollectionCard): string =>
  [cardKey(card.name), norm(card.setCode), card.foil].join('|');

/**
 * Same card, same set, same finish — but keyed on the set's *name*.
 *
 * Cardmarket purchase rows know their edition as a name and never as a code, so
 * a bought card and the same card in a ManaBox export have no set field in
 * common; without this they could only ever pair on name alone, and every
 * purchase would be graded a vague "maybe". Names agree far less reliably than
 * codes do, which is why this ranks below `editionKey` rather than replacing it.
 */
const setNameKey = (card: CollectionCard): string =>
  [cardKey(card.name), norm(card.setName), card.foil].join('|');

const finishKey = (card: CollectionCard): string => [cardKey(card.name), card.foil].join('|');

/**
 * Index rows by a key, keeping the order they appeared in.
 *
 * `skip` drops rows whose key carries no actual evidence. Two rows that both
 * omit a set are not "the same set": they would collide on the empty string and
 * be paired with a confidence, and a reason, that neither row earned. They still
 * meet lower down on name and finish, which is the honest description of them.
 */
const indexBy = (
  cards: CollectionCard[],
  key: (card: CollectionCard) => string,
  skip?: (card: CollectionCard) => boolean,
): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  cards.forEach((card, i) => {
    if (skip?.(card)) return;
    const k = key(card);
    const bucket = out.get(k);
    if (bucket) bucket.push(i);
    else out.set(k, [i]);
  });
  return out;
};

const describe = (card: CollectionCard): string => {
  const printing = [card.setCode?.toUpperCase(), card.collectorNumber].filter(Boolean).join(' ');
  return printing ? `${printing}${card.foil ? ', foil' : ''}` : card.foil ? 'foil' : 'no set given';
};

/**
 * Pair imported rows against the collection, without changing anything.
 *
 * The Scryfall id is checked first because ManaBox writes one and it identifies
 * a printing exactly; everything after it is progressively more of a guess, and
 * the `reason` says which rung the pair came from so the review screen can be
 * honest about it.
 */
export const findDuplicates = (
  incoming: CollectionCard[],
  existing: CollectionCard[],
): ImportDiff => {
  const claimed = new Set<number>();
  const candidates: DuplicateCandidate[] = [];
  const fresh: CollectionCard[] = [];

  // Rows without a Scryfall id must not collide on the empty string, so they are
  // left out of this index entirely rather than filtered later.
  const byScryfall = new Map<string, number[]>();
  existing.forEach((card, position) => {
    if (!card.scryfallId) return;
    const key = `${norm(card.scryfallId)}|${card.foil}`;
    const bucket = byScryfall.get(key);
    if (bucket) bucket.push(position);
    else byScryfall.set(key, [position]);
  });

  const byPrinting = indexBy(existing, printingKey, card => !statesPrinting(card));
  const byEdition = indexBy(existing, editionKey, card => !norm(card.setCode));
  const bySetName = indexBy(existing, setNameKey, card => !norm(card.setName));
  const byFinish = indexBy(existing, finishKey);

  const claim = (positions: number[] | undefined): number | null => {
    for (const position of positions ?? []) if (!claimed.has(position)) return position;
    return null;
  };

  incoming.forEach((card, index) => {
    const attempts: [MatchStrength, number | null, string][] = [
      [
        'exact',
        card.scryfallId ? claim(byScryfall.get(`${norm(card.scryfallId)}|${card.foil}`)) : null,
        'Same printing — the file and your collection agree on the Scryfall id.',
      ],
      [
        'exact',
        statesPrinting(card) ? claim(byPrinting.get(printingKey(card))) : null,
        `Same printing and finish (${describe(card)}).`,
      ],
      [
        'likely',
        norm(card.setCode) ? claim(byEdition.get(editionKey(card))) : null,
        'Same card and set, same finish.',
      ],
      [
        'likely',
        norm(card.setName) ? claim(bySetName.get(setNameKey(card))) : null,
        `Same card and finish, both from ${card.setName}.`,
      ],
      ['possible', claim(byFinish.get(finishKey(card))), 'Same card and finish, but a different or unstated printing.'],
    ];

    for (const [strength, position, reason] of attempts) {
      if (position === null) continue;
      claimed.add(position);
      candidates.push({ existing: existing[position], incoming: card, index, reason, strength });
      return;
    }
    fresh.push(card);
  });

  candidates.sort((a, b) => RANK[a.strength] - RANK[b.strength] || a.index - b.index);
  return { candidates, fresh };
};

/**
 * Fold an import into a collection, treating the given incoming rows as repeats
 * of cards already there.
 *
 * A row the user called a duplicate is dropped, not merged: they have said the
 * collection already accounts for those cards, and adding "just the difference"
 * would be us overruling them with arithmetic.
 *
 * Anything kept is stamped `source: 'import'`, which is what lets a later
 * re-import of the same file replace this batch rather than stack on top of it.
 */
/**
 * The cost of one copy after two lots of the same printing are merged.
 *
 * A weighted average, because the row now stands for both lots: keeping the older
 * price would report a gain on copies bought at a different price, and taking the
 * newer one would rewrite what the first lot cost. When only one side recorded a
 * price it speaks for all the copies — a wrong-but-stated basis beats none, and
 * it's the same assumption as buying more of a stock you already hold.
 */
const blendCost = (into: CollectionCard, incoming: CollectionCard): number | undefined => {
  const paid = [into, incoming].filter(c => c.purchasePrice !== undefined);
  if (paid.length === 0) return undefined;
  if (paid.length === 1) return paid[0].purchasePrice;
  const copies = into.quantity + incoming.quantity;
  if (copies <= 0) return into.purchasePrice;
  const spent =
    (into.purchasePrice ?? 0) * into.quantity + (incoming.purchasePrice ?? 0) * incoming.quantity;
  // Rounded to the cent: a basis carrying six decimals would show up as a gain of
  // 0,003 € on a card nobody touched.
  return Math.round((spent / copies) * 100) / 100;
};

export const applyImport = (
  existing: CollectionCard[],
  incoming: CollectionCard[],
  duplicates: Iterable<number>,
): CollectionCard[] => {
  const skip = new Set(duplicates);
  const out = existing.map(card => ({ ...card }));
  // Only rows we own the bookkeeping for may absorb a quantity: merging into a
  // 'purchases' row would corrupt what the next purchase sync re-derives.
  const mergeable = new Map<string, CollectionCard>();
  for (const card of out) {
    if ((card.source ?? 'import') === 'import') mergeable.set(printingKey(card), card);
  }

  incoming.forEach((card, index) => {
    if (skip.has(index)) return;
    const key = printingKey(card);
    const into = mergeable.get(key);
    if (into) {
      into.purchasePrice = blendCost(into, card);
      into.quantity += card.quantity;
      return;
    }
    const added: CollectionCard = { ...card, source: 'import' };
    out.push(added);
    mergeable.set(key, added);
  });

  return out;
};
