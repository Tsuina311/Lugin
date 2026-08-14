// Working out what someone just handed us.
//
// A file of card names is one of two very different things — a deck, or part of
// a collection — and nothing in the file is obliged to say which. ManaBox is the
// motivating case: it exports a deck as a text list with `// COMMANDER` headers,
// exports one binder as a CSV, and exports a whole collection as a CSV in which
// a "Binder Type" column marks some rows as decks and others as cards you own.
// One app, three shapes, and the user shouldn't have to know which they picked.
//
// Two rules keep this honest rather than clever:
//
//   1. Every part carries a `reason` in plain language. A guess the user can't
//      see is a guess they can't correct.
//   2. Every part is parsed *both* ways — as collection rows and as deck rows —
//      so overruling the guess costs nothing and can lose nothing. Detection
//      picks the default; it never limits the choice.

import { cardKey } from './cardName';
import type { CollectionCard } from './collection';
import { type DeckCard, type DeckSection, parseCardLine, parseDeckList, sectionHeader } from './deck';
import { isBasicLand } from './lands';
import { cell, columnIndex, parseTable, stripBom } from './table';

export type ImportKind = 'collection' | 'deck';

export type ImportFormat =
  /** Nothing usable in the file. */
  | 'empty'
  /** A delimited table carrying ManaBox's own columns. */
  | 'manabox-csv'
  /** A text list with section headers — ManaBox, Arena, MTGO, most sites. */
  | 'decklist'
  /** Names, one per line, with no structure to go on. */
  | 'plain-list'
  /** Some other spreadsheet with a card-name column. */
  | 'table';

/** One importable chunk of a file: a deck, or a pile of collection rows. */
export interface ImportPart {
  /** The rows read as collection lines, keeping set, finish and condition. */
  cards: CollectionCard[];
  /** The same rows read as deck lines, with sections resolved. */
  deck: DeckCard[];
  kind: ImportKind;
  /** Binder or deck name, when the file named one. */
  label?: string;
  /** Why we chose `kind`, in words meant for the person importing. */
  reason: string;
  /** True when `kind` is inference rather than something the file stated. */
  uncertain: boolean;
}

export interface ImportInspection {
  /** What separated the columns, for a table — worth showing when it surprises. */
  delimiter?: string;
  format: ImportFormat;
  /** Empty when nothing could be read; never partially valid. */
  parts: ImportPart[];
}

/**
 * What the user settled on for one part, once they've seen the review.
 *
 * Lives here rather than beside the review component because it is the contract
 * between that screen and whatever applies it, and the two platforms apply it in
 * entirely different ways — through the extension's stores, or into the phone's
 * synced document.
 */
export interface ImportDecision {
  cards: CollectionCard[];
  deck: DeckCard[];
  /** Indexes into `cards` the user confirmed they already own. */
  duplicates: number[];
  kind: ImportKind;
  label?: string;
}

// Deck-shaped is a range, not a number: 40 is the smallest legal constructed
// deck, and 250 clears a 100-card Commander deck plus a maybeboard while
// staying far below anyone's collection.
const DECK_MIN_CARDS = 40;
const DECK_MAX_CARDS = 250;

// Above this, the "it might be a deck" question stops being interesting.
const CERTAINLY_COLLECTION = 400;

/** Copies of any one card a constructed deck may hold, basics excepted. */
const MAX_COPIES = 4;

const total = (cards: { quantity: number }[]): number =>
  cards.reduce((n, c) => n + c.quantity, 0);

const toDeckCards = (cards: CollectionCard[], section: DeckSection = 'main'): DeckCard[] => {
  const merged = new Map<string, DeckCard>();
  for (const card of cards) {
    const key = `${section}|${cardKey(card.name)}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += card.quantity;
    else merged.set(key, { name: card.name, quantity: card.quantity, section });
  }
  return [...merged.values()];
};

/**
 * Could this be a deck? Only asked of files that didn't say.
 *
 * Deliberately conservative: a deck's signature is being small *and* holding no
 * more than a playset of anything, and a stack of duplicates from a binder fails
 * the second test even when it passes the first.
 */
const deckShaped = (cards: CollectionCard[]): boolean => {
  const count = total(cards);
  if (count < DECK_MIN_CARDS || count > DECK_MAX_CARDS) return false;
  return cards.every(c => c.quantity <= MAX_COPIES || isBasicLand(c.name));
};

// --- tables ------------------------------------------------------------------

const sectionOf = (value: string | undefined): DeckSection => {
  if (!value) return 'main';
  if (/commander|general/i.test(value)) return 'commander';
  if (/side|maybe/i.test(value)) return 'sideboard';
  return 'main';
};

const readTable = (text: string): ImportInspection | null => {
  const table = parseTable(text);
  if (!table) return null;

  const { header, rows } = table;
  const iName = columnIndex(header, 'name', 'card name', 'card');
  // No name column means this isn't a table of cards — and, more often, that it
  // isn't a table at all: "1 Erayo, Soratami Ascendant" is a decklist line that
  // splits neatly into two columns and must be allowed to fall through to the
  // list reader rather than be read as a spreadsheet with an odd header.
  if (iName < 0) return null;

  const iBinder = columnIndex(header, 'binder name', 'binder', 'list name', 'folder');
  const iBinderType = columnIndex(header, 'binder type', 'list type');
  const iCondition = columnIndex(header, 'condition');
  const iLanguage = columnIndex(header, 'language', 'lang');
  const iNumber = columnIndex(header, 'collector number', 'card number', 'collectornumber', 'number');
  const iFoil = columnIndex(header, 'foil', 'finish', 'printing');
  const iQuantity = columnIndex(header, 'quantity', 'count', 'qty', 'amount');
  const iRarity = columnIndex(header, 'rarity');
  const iScryfall = columnIndex(header, 'scryfall id', 'scryfall_id', 'scryfallid');
  const iSection = columnIndex(header, 'section', 'board', 'category');
  const iSetCode = columnIndex(header, 'set code', 'setcode', 'set', 'edition');
  const iSetName = columnIndex(header, 'set name', 'setname');

  // ManaBox's own exports are worth naming, because recognising them is what
  // lets us trust the binder columns rather than guess from card counts.
  const isManaBox =
    columnIndex(header, 'manabox id') >= 0 || (iBinder >= 0 && iScryfall >= 0) || iBinderType >= 0;

  /** Rows grouped by the binder they came from; one group when there are none. */
  const groups = new Map<string, { cards: CollectionCard[]; kind: ImportKind; label?: string }>();

  for (const fields of rows) {
    const name = cell(fields, iName);
    if (!name) continue;

    const quantity = Number.parseInt(cell(fields, iQuantity) ?? '', 10);
    const foil = (cell(fields, iFoil) ?? '').toLowerCase();
    const card: CollectionCard = {
      collectorNumber: cell(fields, iNumber),
      condition: cell(fields, iCondition),
      foil: foil === 'foil' || foil === 'etched' || foil === 'true' || foil === 'yes',
      language: cell(fields, iLanguage),
      name,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      rarity: cell(fields, iRarity),
      scryfallId: cell(fields, iScryfall),
      setCode: cell(fields, iSetCode),
      setName: cell(fields, iSetName),
    };

    const label = cell(fields, iBinder);
    const binderType = cell(fields, iBinderType);
    const key = label ?? '';
    const group = groups.get(key) ?? {
      cards: [],
      kind: /deck/i.test(binderType ?? '') ? 'deck' : 'collection',
      label,
    };
    group.cards.push(card);
    groups.set(key, group);
  }

  const sectioned = iSection >= 0;
  const parts: ImportPart[] = [...groups.values()].map(group => {
    // A section column is the file saying "this is a deck" outright.
    const kind: ImportKind = sectioned ? 'deck' : group.kind;
    const deck = sectioned
      ? rowsToSectionedDeck(rows, iName, iQuantity, iSection, group.label, iBinder)
      : toDeckCards(group.cards);

    return {
      cards: group.cards,
      deck,
      kind,
      label: group.label,
      reason: reasonForTable({ isManaBox, kind, label: group.label, sectioned }),
      uncertain: !sectioned && !(isManaBox && iBinderType >= 0),
    };
  });

  return {
    delimiter: table.delimiter,
    format: isManaBox ? 'manabox-csv' : 'table',
    parts,
  };
};

const rowsToSectionedDeck = (
  rows: string[][],
  iName: number,
  iQuantity: number,
  iSection: number,
  label: string | undefined,
  iBinder: number,
): DeckCard[] => {
  const merged = new Map<string, DeckCard>();
  for (const fields of rows) {
    const name = cell(fields, iName);
    if (!name) continue;
    if (label !== undefined && cell(fields, iBinder) !== label) continue;
    const section = sectionOf(cell(fields, iSection));
    const parsed = Number.parseInt(cell(fields, iQuantity) ?? '', 10);
    const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const key = `${section}|${cardKey(name)}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += quantity;
    else merged.set(key, { name, quantity, section });
  }
  return [...merged.values()];
};

const reasonForTable = (o: {
  isManaBox: boolean;
  kind: ImportKind;
  label?: string;
  sectioned: boolean;
}): string => {
  if (o.sectioned) return 'The file has a section column, so it is laid out as a deck.';
  if (o.kind === 'deck') return `ManaBox marks "${o.label ?? 'this binder'}" as a deck.`;
  if (o.label) return `Cards from your "${o.label}" binder.`;
  return o.isManaBox
    ? 'A ManaBox export with no deck markings — cards you own.'
    : 'A spreadsheet of cards, with nothing marking it as a deck.';
};

// --- text lists --------------------------------------------------------------

const readList = (text: string): ImportInspection => {
  const lines = stripBom(text).split(/\r?\n/);
  const { cards: deck, name: label } = parseDeckList(text);

  let sawHeader = false;
  let inAbout = false;
  const merged = new Map<string, CollectionCard>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (sectionHeader(line)) {
      sawHeader = true;
      inAbout = false;
      continue;
    }
    // Arena's "About / Name <deck>" preamble is metadata, not cards.
    if (/^about\s*$/i.test(line)) {
      inAbout = true;
      continue;
    }
    if (inAbout) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;

    const parsed = parseCardLine(line);
    if (!parsed) continue;

    const key = [cardKey(parsed.name), parsed.setCode ?? '', parsed.collectorNumber ?? '', parsed.foil]
      .join('|')
      .toLowerCase();
    const prev = merged.get(key);
    if (prev) {
      prev.quantity += parsed.quantity;
      continue;
    }
    merged.set(key, {
      collectorNumber: parsed.collectorNumber,
      foil: parsed.foil,
      name: parsed.name,
      quantity: parsed.quantity,
      setCode: parsed.setCode,
    });
  }

  const cards = [...merged.values()];
  if (cards.length === 0) return { format: 'empty', parts: [] };

  const zoned = deck.some(c => c.section !== 'main');
  const count = total(cards);

  let kind: ImportKind;
  let reason: string;
  let uncertain: boolean;

  if (zoned) {
    kind = 'deck';
    reason = 'It names a commander or sideboard, so it is a deck.';
    uncertain = false;
  } else if (sawHeader) {
    kind = 'deck';
    reason = 'It is laid out with deck section headers.';
    uncertain = false;
  } else if (deckShaped(cards)) {
    kind = 'deck';
    reason = `${count} cards and no more than ${MAX_COPIES} of anything — deck-shaped, though a list of cards this size looks the same.`;
    uncertain = true;
  } else {
    kind = 'collection';
    reason =
      count > CERTAINLY_COLLECTION
        ? `${count} cards — far too many for a deck.`
        : 'Just names, with nothing marking it as a deck.';
    uncertain = count <= CERTAINLY_COLLECTION;
  }

  return {
    format: sawHeader || zoned ? 'decklist' : 'plain-list',
    parts: [{ cards, deck, kind, label, reason, uncertain }],
  };
};

/**
 * Read a pasted or uploaded file and describe what importing it would do.
 *
 * Never throws and never partially fails: an unreadable file comes back as zero
 * parts, which the caller can report as "nothing here" without a try/catch.
 */
export const inspectImport = (text: string): ImportInspection => {
  if (!stripBom(text).trim()) return { format: 'empty', parts: [] };
  return readTable(text) ?? readList(text);
};
