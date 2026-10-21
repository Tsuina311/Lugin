import { cardImageCandidates, printingRank } from './cardImage';
import { cardKey, stripVersion } from './cardName';
import type { Collection, CollectionCard } from './collection';
import { printingIdentity } from './collectionEdit';

export interface CollectionPrintingLine {
  candidates: string[];
  card: CollectionCard;
  edition: string;
  foil: boolean;
  identity: string;
  quantity: number;
}

export interface CollectionViewRow {
  candidates: string[];
  foil: number;
  key: string;
  name: string;
  printings: CollectionPrintingLine[];
  representative: CollectionCard;
  total: number;
}

export const collectionEditionLabel = (card: CollectionCard): string => {
  const set = card.setName || card.setCode;
  const num = card.collectorNumber ? `#${card.collectorNumber}` : null;
  if (set && num) return `${set} ${num}`;
  if (set) return set;
  if (num) return num;
  if (card.productId) return `CM ${card.productId}`;
  return 'Unknown edition';
};

/** The grouped, alphabetical collection model shared by web and phone. */
export const collectionViewRows = (
  collection: Pick<Collection, 'cards'>,
): CollectionViewRow[] => {
  const map = new Map<string, CollectionViewRow & { rank: number }>();
  const printingsByKey = new Map<string, Map<string, CollectionPrintingLine>>();

  for (const card of collection.cards) {
    const key = cardKey(card.name);
    if (!key) continue;
    let row = map.get(key);
    if (!row) {
      row = {
        candidates: [],
        foil: 0,
        key,
        name: stripVersion(card.name),
        printings: [],
        rank: -1,
        representative: card,
        total: 0,
      };
      map.set(key, row);
      printingsByKey.set(key, new Map());
    }

    const quantity = Math.max(0, card.quantity || 0);
    row.total += quantity;
    if (card.foil) row.foil += quantity;

    const rank = printingRank(card);
    if (rank > row.rank || row.candidates.length === 0) {
      const candidates = cardImageCandidates(card);
      if (candidates.length) {
        row.candidates = candidates;
        row.rank = rank;
        row.representative = card;
      }
    }

    const identity = printingIdentity(card);
    const byPrinting = printingsByKey.get(key)!;
    const existing = byPrinting.get(identity);
    if (existing) {
      existing.quantity += quantity;
    } else {
      byPrinting.set(identity, {
        candidates: cardImageCandidates(card),
        card,
        edition: collectionEditionLabel(card),
        foil: card.foil,
        identity,
        quantity,
      });
    }
  }

  return [...map.values()]
    .map(({ rank: _rank, ...row }) => ({
      ...row,
      printings: [...(printingsByKey.get(row.key)?.values() ?? [])].sort((a, b) =>
        a.edition.localeCompare(b.edition),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
