// Writing decks and collections back out, in the shapes ManaBox reads.
//
// The importer's mirror, and deliberately its exact mirror: everything written
// here is parsed by `inspectImport`, which is what the round-trip tests check. A
// format we can read but not write would leave the phone a one-way door — cards
// scanned into ManaBox can reach Lugin, but a deck built in Lugin could never go
// back to the app that does the shopping and the scanning.
//
// ManaBox has no API (import and export are the whole of its interoperability),
// so a file handed to the share sheet is the only way across. That shapes what
// these functions optimise for: being read by *another* program, not by us. Hence
// ManaBox's own column names and its commented section headers rather than
// anything of our own invention.

import type { CollectionCard, Collection } from './collection';
import type { Deck, DeckCard, DeckSection } from './deck';

/** A file ready for the share sheet or a download. */
export interface ExportFile {
  mime: string;
  name: string;
  text: string;
}

/**
 * ManaBox's deck export shape: a commented COMMANDER block, a blank line, then
 * the main deck under no header of its own, then SIDEBOARD.
 *
 * Printing and finish are dropped because a deck doesn't carry them — a deck
 * names cards, and which copy gets sleeved is a collection question. ManaBox
 * resolves a bare name to a default printing, which is the same answer we'd be
 * guessing at.
 */
const SECTION_ORDER: readonly { header: string | null; id: DeckSection }[] = [
  { header: '// COMMANDER', id: 'commander' },
  { header: null, id: 'main' },
  { header: '// SIDEBOARD', id: 'sideboard' },
];

const line = (card: DeckCard): string => `${card.quantity} ${card.name}`;

export const deckToText = (deck: Pick<Deck, 'cards'>): string => {
  const blocks: string[] = [];
  for (const { header, id } of SECTION_ORDER) {
    const cards = deck.cards.filter(card => card.section === id && card.quantity > 0);
    if (cards.length === 0) continue;
    blocks.push([...(header ? [header] : []), ...cards.map(line)].join('\n'));
  }
  // A blank line between blocks is what ends the commander block on the way
  // back in, so it is structural here, not spacing.
  return `${blocks.join('\n\n')}\n`;
};

/** MTGA-style text, for a collection we only know the names of. */
export const collectionToText = (cards: readonly CollectionCard[]): string => {
  const rows = cards
    .filter(card => card.quantity > 0)
    .map(card => {
      const printing = card.setCode
        ? ` (${card.setCode.toUpperCase()})${card.collectorNumber ? ` ${card.collectorNumber}` : ''}`
        : '';
      return `${card.quantity} ${card.name}${printing}${card.foil ? ' *F*' : ''}`;
    });
  return `${rows.join('\n')}\n`;
};

// ManaBox's own column names, in its own order. Each says how to read one card
// off a row of ours; a column every row leaves empty is dropped rather than
// exported as a stripe of commas.
const COLUMNS: readonly { of: (card: CollectionCard) => string | undefined; title: string }[] = [
  { of: card => card.name, title: 'Name' },
  { of: card => card.setCode, title: 'Set code' },
  { of: card => card.setName, title: 'Set name' },
  { of: card => card.collectorNumber, title: 'Collector number' },
  { of: card => (card.foil ? 'foil' : 'normal'), title: 'Foil' },
  { of: card => card.rarity, title: 'Rarity' },
  { of: card => String(card.quantity), title: 'Quantity' },
  { of: card => card.scryfallId, title: 'Scryfall ID' },
  // Under ManaBox's own header, so a collection that leaves and comes back keeps
  // its cost basis instead of forgetting what everything cost.
  { of: card => card.purchasePrice?.toFixed(2), title: 'Purchase price' },
  { of: card => card.condition, title: 'Condition' },
  { of: card => card.language, title: 'Language' },
];

/** Quote only when a field would otherwise break the row. */
const csvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const collectionToCsv = (cards: readonly CollectionCard[]): string => {
  const rows = cards.filter(card => card.quantity > 0);
  const columns = COLUMNS.filter(column => rows.some(card => (column.of(card) ?? '') !== ''));
  const out = [columns.map(column => column.title).join(',')];
  for (const card of rows) out.push(columns.map(column => csvCell(column.of(card) ?? '')).join(','));
  return `${out.join('\n')}\n`;
};

/** A filename that survives a phone's Downloads folder and a share sheet. */
const slug = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'lugin';

const today = (at: number): string => new Date(at).toISOString().slice(0, 10);

export const deckFile = (deck: Deck): ExportFile => ({
  mime: 'text/plain',
  name: `${slug(deck.name)}.txt`,
  text: deckToText(deck),
});

/**
 * The collection as a file — CSV when we know which printings these are, a plain
 * list when we don't.
 *
 * ManaBox's CSV import needs a set code or a Scryfall id to place a row, so a
 * collection that came from a bare name list has nothing to put in either column
 * and would import as a spreadsheet of nothing. Text import asks for less, and
 * asking for less is the whole point when this is the fallback.
 */
export const collectionFile = (collection: Pick<Collection, 'cards'>, at = Date.now()): ExportFile => {
  const identified = collection.cards.some(card => card.setCode || card.scryfallId);
  return identified
    ? {
        mime: 'text/csv',
        name: `lugin-collection-${today(at)}.csv`,
        text: collectionToCsv(collection.cards),
      }
    : {
        mime: 'text/plain',
        name: `lugin-collection-${today(at)}.txt`,
        text: collectionToText(collection.cards),
      };
};
