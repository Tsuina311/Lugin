// A user's decks: an ordered list of cards (with quantities), split into the
// main deck and an optional sideboard. Decks are uploaded from a plain text
// decklist (the format Arena / MTGO / most sites export) or built card-by-card
// in the UI. We keep a light, portable row model so re-export stays trivial.

import { cardKey } from './cardName';
import { isBasicLand } from './lands';
import {
  MANA_VALUE_BUCKETS,
  frontTypes,
  isLandType,
  manaValueBucket,
  manaValueLabel,
  type CardMetadata,
} from './mtg';

/** Which zone a card belongs to. */
export type DeckSection = 'commander' | 'main' | 'sideboard';

/** Deck formats we let the user pick. 'freeform' imposes no size/zone rules. */
export type DeckFormat =
  'commander' | 'standard' | 'pioneer' | 'modern' | 'legacy' | 'vintage' | 'pauper' | 'freeform';

export interface DeckFormatInfo {
  /** Whether the format uses a Commander command zone. */
  commanderZone: boolean;
  id: DeckFormat;
  label: string;
  /**
   * Lands a deck of this format conventionally runs, as the starting point for
   * auto-balancing (a deck can override it). Undefined when the format has no
   * usual shape to assume.
   */
  landCount?: number;
  /** Target deck size (excluding sideboard); undefined = no fixed size. */
  targetSize?: number;
}

/**
 * Ordered list for the format picker. Commander first (the current focus).
 * The land counts are the conventional starting points: 37 of 100 in Commander,
 * 24 of 60 elsewhere.
 */
export const DECK_FORMATS: DeckFormatInfo[] = [
  { commanderZone: true, id: 'commander', label: 'Commander', landCount: 37, targetSize: 100 },
  { commanderZone: false, id: 'standard', label: 'Standard', landCount: 24, targetSize: 60 },
  { commanderZone: false, id: 'pioneer', label: 'Pioneer', landCount: 24, targetSize: 60 },
  { commanderZone: false, id: 'modern', label: 'Modern', landCount: 24, targetSize: 60 },
  { commanderZone: false, id: 'legacy', label: 'Legacy', landCount: 24, targetSize: 60 },
  { commanderZone: false, id: 'vintage', label: 'Vintage', landCount: 24, targetSize: 60 },
  { commanderZone: false, id: 'pauper', label: 'Pauper', landCount: 24, targetSize: 60 },
  { commanderZone: false, id: 'freeform', label: 'Freeform' },
];

export const formatInfo = (format?: DeckFormat): DeckFormatInfo =>
  DECK_FORMATS.find(f => f.id === format) ?? DECK_FORMATS[DECK_FORMATS.length - 1];

/** One deck line: a card name + how many copies, in a given section. */
export interface DeckCard {
  name: string;
  quantity: number;
  section: DeckSection;
}

export interface Deck {
  /**
   * Keep the deck's basics balanced so it always runs its land count. The lands
   * stay put when this is switched off, so they can be tweaked by hand.
   */
  autoLands?: boolean;
  cards: DeckCard[];
  createdAt: number;
  /** The deck's format; drives zones (Commander) and target size. */
  format: DeckFormat;
  id: string;
  /** Lands this deck should run; falls back to the format's usual count. */
  landTarget?: number;
  name: string;
  /** Where it came from: an uploaded filename, or 'manual'. */
  source: string;
  /**
   * Overview sections that auto-bucket main-deck cards by deck-building tags
   * (ids from `DECK_TAGS`). Order is priority — a card lands in the first
   * matching section. Empty / absent = no tag sections.
   */
  tagSections?: string[];
  updatedAt: number;
}

// Section headers commonly seen in exported decklists. Anything matching flips
// the current section (or is skipped) rather than being read as a card.
const SIDEBOARD_HEADERS = /^(sideboard|maybeboard|sideboard:|maybe board)\b/i;
const COMMANDER_HEADERS = /^(commander|commanders)\b\s*:?\s*$/i;
const MAIN_HEADERS = /^(deck|maindeck|main deck|mainboard|companion|tokens?)\b\s*:?\s*$/i;
// Anchored, unlike the others: Arena writes "About" alone above the deck name,
// and `\b` would also match the card About Face sitting on a line of its own.
const ABOUT_HEADER = /^about\s*$/i;
const NAME_LINE = /^name\s+(.+)$/i;

/**
 * Take the decoration off a would-be header: "// COMMANDER", "== Sideboard ==",
 * "**Deck**" all name a section, and only the words in the middle say which.
 *
 * This is why comments can't simply be skipped on sight. ManaBox writes its
 * section headers *as* comments — `// COMMANDER`, `// SIDEBOARD` — so a parser
 * that drops every `//` line before looking at it files the commander in the
 * main deck and loses the sideboard entirely.
 */
const undecorate = (line: string): string => line.replace(/^[/#=*\s]+/, '').replace(/[=:*\s]+$/, '');

/** The section a header line names, or null if it isn't one. */
export const sectionHeader = (line: string): DeckSection | null => {
  const bare = undecorate(line);
  if (COMMANDER_HEADERS.test(bare)) return 'commander';
  if (SIDEBOARD_HEADERS.test(bare)) return 'sideboard';
  if (MAIN_HEADERS.test(bare)) return 'main';
  return null;
};

/** One parsed decklist line: the card, and whatever printing detail it carried. */
export interface CardLine {
  collectorNumber?: string;
  foil: boolean;
  name: string;
  quantity: number;
  setCode?: string;
}

/**
 * Parse "2 Lightning Bolt (M10) 146 *F*" into its parts, or null for a line
 * with no card in it.
 *
 * The printing detail is returned rather than discarded because the same line
 * format arrives from two directions: a decklist, which only wants the name and
 * count, and a ManaBox export being filed into a collection, where the set and
 * finish are exactly what makes the row worth keeping.
 */
export const parseCardLine = (line: string): CardLine | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const counted = trimmed.match(/^(\d+)\s*[xX]?\s+(.+)$/);
  const quantity = counted ? Number.parseInt(counted[1], 10) || 1 : 1;
  let rest = counted ? counted[2] : trimmed;

  // "*F*" (foil) and "*E*" (etched); both mean "not a plain copy" to us.
  let foil = false;
  rest = rest.replace(/\s*\*([a-z])\*\s*$/i, (_all, marker: string) => {
    foil = /[fe]/i.test(marker);
    return '';
  });

  let collectorNumber: string | undefined;
  let setCode: string | undefined;
  // "(SET) 123" and "[SET] #123" — same annotation, two houses' punctuation.
  const printing = rest.match(/\s+[([]([A-Za-z0-9]{2,6})[)\]]\s+#?([A-Za-z0-9-]+)\s*$/);
  if (printing) {
    setCode = printing[1];
    collectorNumber = printing[2];
    rest = rest.slice(0, printing.index);
  } else {
    const setOnly = rest.match(/\s+[([]([A-Za-z0-9]{2,6})[)\]]\s*$/);
    if (setOnly) {
      setCode = setOnly[1];
      rest = rest.slice(0, setOnly.index);
    }
  }

  const name = rest.trim();
  if (!name || cardKey(name).length === 0) return null;

  return { collectorNumber, foil, name, quantity, setCode };
};

/**
 * Parse a plain-text decklist. Understands quantities ("4 Bolt", "4x Bolt"),
 * bare names, section headers (Deck / Sideboard / Commander…) and Arena's
 * per-line set annotations. Duplicate lines in the same section are merged.
 * Returns the parsed cards plus an optional deck name (from an Arena "About"
 * block) so callers can seed the deck title.
 */
export const parseDeckList = (text: string): { cards: DeckCard[]; name?: string } => {
  const lines = text.split(/\r?\n/);
  const merged = new Map<string, DeckCard>(); // `${section}|${cardKey}` -> row
  let section: DeckSection = 'main';
  let inAbout = false;
  let name: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // ManaBox closes its commander block with a blank line and gives the main
      // deck no header of its own, so the blank is the only thing separating one
      // commander from the other ninety-nine cards.
      if (section === 'commander') section = 'main';
      continue;
    }

    const header = sectionHeader(line);
    if (ABOUT_HEADER.test(line)) {
      inAbout = true;
      continue;
    }
    if (inAbout) {
      const nm = line.match(NAME_LINE);
      if (nm) name = nm[1].trim();
      // The About block ends once the real deck starts.
      if (header) inAbout = false;
      else continue;
    }
    if (header) {
      section = header;
      continue;
    }
    // A comment that names no section really is just a comment.
    if (line.startsWith('//') || line.startsWith('#')) continue;

    const card = parseCardLine(line);
    if (!card) continue;

    const key = `${section}|${cardKey(card.name)}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += card.quantity;
    else merged.set(key, { name: card.name, quantity: card.quantity, section });
  }

  return { cards: [...merged.values()], name };
};

/**
 * Build a deck from imported rows, or null when there were none.
 *
 * Shared rather than reimplemented per platform: the phone is expected to be
 * where most imports actually happen, and a deck it created differing from a
 * desktop one — a different format guess, a different fallback name — would show
 * up as a mystery days later, on whichever device didn't make it.
 */
export const deckFromImport = (
  cards: DeckCard[],
  options: { at?: number; name?: string; source: string },
): Deck | null => {
  if (cards.length === 0) return null;
  const { at = Date.now(), name, source } = options;
  return {
    cards,
    createdAt: at,
    // Guess Commander when the list carried a Commander section; otherwise leave
    // it freeform (the user can switch formats in the editor).
    format: cards.some(c => c.section === 'commander') ? 'commander' : 'freeform',
    id: newDeckId(),
    // A filename is a better name than "Imported deck", minus its extension.
    name: (name ?? source.replace(/\.[^.]+$/, '')).trim() || 'Imported deck',
    source,
    updatedAt: at,
  };
};

/**
 * An empty deck, ready to be filled card by card.
 *
 * Shared for the same reason `deckFromImport` is: "New deck" exists on both the
 * desktop and the phone, and if the two disagreed about the default format, the
 * fallback name or the shape of the object, it would surface days later on
 * whichever device didn't make the deck.
 */
export const newDeck = (
  options: { at?: number; format?: DeckFormat; name?: string } = {},
): Deck => {
  const { at = Date.now(), format = 'commander', name } = options;
  return {
    cards: [],
    createdAt: at,
    format,
    id: newDeckId(),
    name: name?.trim() || 'New deck',
    source: 'manual',
    updatedAt: at,
  };
};

/** A stable id for a new deck. */
export const newDeckId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Total copies across a set of deck cards (optionally one section). */
export const countCards = (cards: DeckCard[], section?: DeckSection): number =>
  cards.reduce((n, c) => (section && c.section !== section ? n : n + c.quantity), 0);

/**
 * Fold cards into a deck's list, adding to a matching row rather than repeating
 * it.
 *
 * Matched on section plus the loose name key, so typing "Lightning Bolt" into a
 * deck that already runs three makes four — not a second row of one, which is
 * what a decklist exported afterwards would otherwise say.
 */
export const mergeDeckCards = (
  into: readonly DeckCard[],
  add: readonly DeckCard[],
): DeckCard[] => {
  const out = into.map(card => ({ ...card }));
  for (const card of add) {
    const key = cardKey(card.name);
    if (!key) continue;
    const found = out.find(c => c.section === card.section && cardKey(c.name) === key);
    if (found) found.quantity += card.quantity;
    else out.push({ ...card });
  }
  return out;
};

/**
 * Change a deck's format, rescuing anything in the command zone if that zone is
 * about to stop existing — otherwise those cards are still in the deck, still
 * counted, and nowhere on screen.
 */
export const withFormat = (deck: Deck, format: DeckFormat): Deck => ({
  ...deck,
  cards: formatInfo(format).commanderZone
    ? deck.cards
    : deck.cards.map(c => (c.section === 'commander' ? { ...c, section: 'main' as const } : c)),
  format,
});

/** A card the deck is short of, and by how many copies. */
export interface DeckShortfall {
  name: string;
  /** Copies still to find: quantity minus what you own. */
  need: number;
  /** Copies you already have, for explaining a partial hit. */
  owned: number;
}

/**
 * What the deck is missing from a collection, one entry per card, in deck order.
 *
 * Basics are left out: nobody lists their Islands, they're free to come by, and
 * counting them would turn every deck into a shopping list. The comparison is by
 * name — printing and finish don't matter for "can I build this".
 *
 * A card can sit in more than one section — main and sideboard, say — and you'd
 * still buy it once, so those rows are added together first. Weighing each row
 * separately would credit the copies you own to every one of them and then ask
 * the buyer for the same card twice.
 */
export const deckShortfall = (
  cards: DeckCard[],
  ownedByKey: Record<string, { total: number }>,
): DeckShortfall[] => {
  const wanted = new Map<string, { copies: number; name: string }>();
  for (const card of cards) {
    if (isBasicLand(card.name)) continue;
    const key = cardKey(card.name);
    if (!key) continue;
    const row = wanted.get(key);
    if (row) row.copies += card.quantity;
    else wanted.set(key, { copies: card.quantity, name: card.name });
  }

  const out: DeckShortfall[] = [];
  for (const [key, { copies, name }] of wanted) {
    const owned = ownedByKey[key]?.total ?? 0;
    const need = Math.max(0, copies - owned);
    if (need > 0) out.push({ name, need, owned });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Breaking the list into groups
// ---------------------------------------------------------------------------

/** How to break a section up. Asking for both nests cost inside type. */
export interface DeckSplit {
  cost: boolean;
  type: boolean;
}

export interface DeckCardGroup {
  cards: DeckCard[];
  /** Stable id for React keys. */
  key: string;
  /** Header to show, or null when the group holds everything (no split). */
  label: string | null;
  /** Groups within this one, or null when there's nothing to nest. */
  sub: DeckCardGroup[] | null;
}

/** Type groups in the order decklists conventionally print them. */
const TYPE_ORDER = [
  'Creatures',
  'Planeswalkers',
  'Battles',
  'Instants',
  'Sorceries',
  'Artifacts',
  'Enchantments',
  'Lands',
  'Other',
];

/**
 * Type -> group, tried in this order so cards with several types land where
 * they're most useful: Dryad Arbor counts towards the lands, an artifact
 * creature towards the creatures.
 */
const TYPE_MATCHERS: Array<[label: string, type: string]> = [
  ['Lands', 'Land'],
  ['Creatures', 'Creature'],
  ['Planeswalkers', 'Planeswalker'],
  ['Battles', 'Battle'],
  ['Instants', 'Instant'],
  ['Sorceries', 'Sorcery'],
  ['Artifacts', 'Artifact'],
  ['Enchantments', 'Enchantment'],
];

const typeGroup = (meta?: CardMetadata): string => {
  const types = frontTypes(meta);
  for (const [label, type] of TYPE_MATCHERS) if (types.has(type)) return label;
  return 'Other';
};

/**
 * Whether a card is a land, and so sits outside the mana curve. Basics are
 * recognized by name too, so the 37 of them in a Commander deck don't count as
 * unknowns for the moment before their metadata arrives.
 */
const isLandCard = (name: string, meta?: CardMetadata): boolean =>
  isBasicLand(name) || isLandType(meta);

/** A group a card falls into, plus where that group sorts. */
interface Bucket {
  key: string;
  label: string;
  order: number;
}

const typeBucket = (name: string, meta?: CardMetadata): Bucket => {
  const label = isLandCard(name, meta) ? 'Lands' : typeGroup(meta);
  return { key: `type:${label}`, label, order: TYPE_ORDER.indexOf(label) };
};

const costBucket = (name: string, meta?: CardMetadata): Bucket => {
  // Lands don't have a place on the mana curve, so they get their own group at
  // the end instead of piling up under "MV 0".
  if (isLandCard(name, meta)) return { key: 'cost:land', label: 'Lands', order: 90 };
  if (meta?.cmc == null) return { key: 'cost:?', label: 'Unknown cost', order: 91 };
  const bucket = manaValueBucket(meta.cmc);
  return { key: `cost:${bucket}`, label: `MV ${manaValueLabel(bucket)}`, order: bucket };
};

const bucketize = (
  cards: DeckCard[],
  metaByKey: Record<string, CardMetadata>,
  bucketOf: (name: string, meta?: CardMetadata) => Bucket,
): DeckCardGroup[] => {
  const groups = new Map<string, DeckCardGroup & Bucket>();
  for (const card of cards) {
    const bucket = bucketOf(card.name, metaByKey[cardKey(card.name)]);
    const group = groups.get(bucket.key) ?? { ...bucket, cards: [], sub: null };
    group.cards.push(card);
    groups.set(bucket.key, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map(g => ({ cards: g.cards, key: g.key, label: g.label, sub: g.sub }));
};

/**
 * Break a section's cards into the groups the deck list should show. Cards
 * whose metadata hasn't loaded yet group by what we know (they end up under
 * "Other" / "Unknown cost" until it arrives).
 */
export const groupDeckCards = (
  cards: DeckCard[],
  metaByKey: Record<string, CardMetadata>,
  split: DeckSplit,
): DeckCardGroup[] => {
  if (!split.type && !split.cost) return [{ cards, key: 'all', label: null, sub: null }];
  if (!split.type || !split.cost) {
    return bucketize(cards, metaByKey, split.type ? typeBucket : costBucket);
  }
  return bucketize(cards, metaByKey, typeBucket).map(group => {
    const sub = bucketize(group.cards, metaByKey, costBucket);
    // One subgroup would only repeat what the type header already says.
    return { ...group, sub: sub.length > 1 ? sub : null };
  });
};

// ---------------------------------------------------------------------------
// Mana curve
// ---------------------------------------------------------------------------

export interface ManaCurveBar {
  /** Mana value, where 7 stands for "7 or more". */
  bucket: number;
  /** Copies in this bucket, not distinct cards. */
  count: number;
  label: string;
}

export interface ManaCurve {
  /** Mean mana value of the counted copies; null while there are none. */
  average: number | null;
  bars: ManaCurveBar[];
  /** Lands, which sit outside the curve. */
  lands: number;
  /** The tallest bar, to scale the chart against. */
  peak: number;
  /** Copies still waiting on metadata, so not yet in a bar. */
  pending: number;
  /** Copies the curve covers (everything but lands and pending). */
  total: number;
}

/**
 * The deck's mana curve: copies per mana value, counting the command zone and
 * skipping the sideboard. Lands are left out — they're what pays for the curve,
 * not part of it — and so are cards whose metadata hasn't arrived, so a
 * half-loaded deck reports an honest curve rather than a lopsided one.
 */
export const manaCurve = (
  cards: DeckCard[],
  metaByKey: Record<string, CardMetadata>,
): ManaCurve => {
  const counts = new Map<number, number>(MANA_VALUE_BUCKETS.map(b => [b, 0]));
  let lands = 0;
  let pending = 0;
  let total = 0;
  let manaSum = 0;

  for (const card of cards) {
    if (card.section === 'sideboard') continue;
    const meta = metaByKey[cardKey(card.name)];
    if (isLandCard(card.name, meta)) {
      lands += card.quantity;
      continue;
    }
    if (meta?.cmc == null) {
      pending += card.quantity;
      continue;
    }
    const bucket = manaValueBucket(meta.cmc);
    counts.set(bucket, (counts.get(bucket) ?? 0) + card.quantity);
    manaSum += meta.cmc * card.quantity;
    total += card.quantity;
  }

  const bars = MANA_VALUE_BUCKETS.map(bucket => ({
    bucket,
    count: counts.get(bucket) ?? 0,
    label: manaValueLabel(bucket),
  }));

  return {
    average: total > 0 ? manaSum / total : null,
    bars,
    lands,
    peak: Math.max(...bars.map(b => b.count)),
    pending,
    total,
  };
};
