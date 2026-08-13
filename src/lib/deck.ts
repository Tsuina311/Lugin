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
  updatedAt: number;
}

// Section headers commonly seen in exported decklists. Anything matching flips
// the current section (or is skipped) rather than being read as a card.
const SIDEBOARD_HEADERS = /^(sideboard|maybeboard|sideboard:|maybe board)\b/i;
const COMMANDER_HEADERS = /^(commander|commanders)\b\s*:?\s*$/i;
const MAIN_HEADERS = /^(deck|maindeck|main deck|companion|tokens?)\b\s*:?\s*$/i;
const ABOUT_HEADER = /^about\b/i;
const NAME_LINE = /^name\s+(.+)$/i;

/**
 * Strip trailing set/collector annotations Arena appends ("(2XM) 123"), foil
 * markers ("*F*") and stray whitespace, leaving just the card name.
 */
const cleanCardName = (raw: string): string =>
  raw
    .replace(/\s*\*[a-z]\*\s*$/i, '') // "*F*" / "*E*" foil markers
    .replace(/\s+\([A-Za-z0-9]{2,6}\)\s+[A-Za-z0-9-]+\s*$/, '') // "(SET) 123"
    .replace(/\s+\([A-Za-z0-9]{2,6}\)\s*$/, '') // trailing "(SET)"
    .trim();

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
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    if (ABOUT_HEADER.test(line)) {
      inAbout = true;
      continue;
    }
    const isHeader = (l: string): boolean =>
      MAIN_HEADERS.test(l) || SIDEBOARD_HEADERS.test(l) || COMMANDER_HEADERS.test(l);
    if (inAbout) {
      const nm = line.match(NAME_LINE);
      if (nm) name = nm[1].trim();
      // The About block ends once the real deck starts.
      if (isHeader(line)) inAbout = false;
      else continue;
    }
    if (COMMANDER_HEADERS.test(line)) {
      section = 'commander';
      continue;
    }
    if (SIDEBOARD_HEADERS.test(line)) {
      section = 'sideboard';
      continue;
    }
    if (MAIN_HEADERS.test(line)) {
      section = 'main';
      continue;
    }

    const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    const quantity = m ? Number.parseInt(m[1], 10) || 1 : 1;
    const cardName = cleanCardName(m ? m[2] : line);
    if (!cardName || cardKey(cardName).length === 0) continue;

    const key = `${section}|${cardKey(cardName)}`;
    const prev = merged.get(key);
    if (prev) prev.quantity += quantity;
    else merged.set(key, { name: cardName, quantity, section });
  }

  return { cards: [...merged.values()], name };
};

/** A stable id for a new deck. */
export const newDeckId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Total copies across a set of deck cards (optionally one section). */
export const countCards = (cards: DeckCard[], section?: DeckSection): number =>
  cards.reduce((n, c) => (section && c.section !== section ? n : n + c.quantity), 0);

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
