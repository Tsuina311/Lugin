// Domain model for the data we pull off Magic marketplace pages.
// Kept deliberately loose (most fields optional) because SSR markup varies by
// page type and changes over time — extractors fill in what they can find.

import { cardKey } from './cardName';

/** A single seller's offer for a card (a row in Cardmarket's article table). */
export interface CardOffer {
  comment?: string;
  condition?: string;
  currency?: string;
  /** Link to the offer/seller if present. */
  href?: string;
  isFoil?: boolean;
  language?: string;
  /** Numeric price in the page's currency, if we could parse it. */
  price?: number;
  /** Raw price string as shown, e.g. "1,49 €". */
  priceText?: string;
  /** Units available from this seller. */
  quantity?: number;
  seller?: string;
  sellerType?: string;
}

/**
 * Gameplay metadata for a card, sourced from Scryfall by name. Cardmarket
 * doesn't expose this in a filterable way, so we cross-reference to enable
 * filtering by type, creature type, color, mana value, etc. These attributes
 * are identical across printings, so the card name alone is enough to look up.
 */
/** Mana-value filter buckets (7 stands for "7 or more"). */
export const MANA_VALUE_BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** Map a card's mana value to its filter bucket (everything ≥7 collapses to 7). */
export const manaValueBucket = (cmc: number): number => (cmc >= 7 ? 7 : Math.floor(cmc));

/** Human label for a mana-value bucket. */
export const manaValueLabel = (bucket: number): string => (bucket >= 7 ? '7+' : String(bucket));

/**
 * The partner-style abilities that let a Commander deck run two commanders
 * (rule 702.124a), plus the two "other half" roles those abilities pair with.
 * `partnerWith` carries the specific named partner. These variants are NOT
 * cross-compatible — a "friends forever" card can't pair with a "partner" one.
 */
export type CommanderPairing =
  | 'partner' // any two "Partner" cards
  | 'partnerWith' // "Partner with <name>" — the named pair only
  | 'friendsForever' // any two "Friends forever" cards
  | 'chooseBackground' // legendary creature that takes a Background
  | 'background' // a legendary Background enchantment (second commander only)
  | 'doctorsCompanion' // pairs with a Time Lord Doctor
  | 'doctor'; // a Time Lord Doctor (pairs with a Doctor's companion)

/** How (if at all) a card can serve as a commander and take a partner. */
export interface CommanderInfo {
  /** Valid as a sole / first commander (legendary creature or "can be your commander"). */
  canBeCommander: boolean;
  /** The pairing abilities this card has (a card can have more than one). */
  pairings: CommanderPairing[];
  /** For grouped "Partner — <group>", the group text (pairs only within a group). */
  partnerGroup?: string;
  /** For "Partner with <name>", the front-face name of the designated partner. */
  partnerWith?: string;
}

// Named partners are compared with the same key as everywhere else, so a "’" in
// a decklist still matches the "'" the oracle text spells the name with.
const norm = cardKey;

/**
 * Whether two cards may be designated together as commanders. Both must share a
 * compatible partner variant per rule 702.124: two Partners, two Friends
 * forever, a named Partner-with match, a "choose a Background" creature with a
 * Background, or a Doctor's companion with a Time Lord Doctor.
 */
export const canPairCommanders = (
  a: CommanderInfo | undefined,
  aName: string,
  b: CommanderInfo | undefined,
  bName: string,
): boolean => {
  if (!a || !b) return false;
  const ap = new Set(a.pairings);
  const bp = new Set(b.pairings);

  if (ap.has('partner') && bp.has('partner')) {
    // Grouped partners ("Partner — Blaze Commando") only pair within a group.
    if (a.partnerGroup || b.partnerGroup) return a.partnerGroup === b.partnerGroup;
    return true;
  }
  if (ap.has('friendsForever') && bp.has('friendsForever')) return true;
  if (ap.has('partnerWith') && norm(a.partnerWith ?? '') === norm(bName)) return true;
  if (bp.has('partnerWith') && norm(b.partnerWith ?? '') === norm(aName)) return true;
  if (ap.has('chooseBackground') && bp.has('background')) return true;
  if (bp.has('chooseBackground') && ap.has('background')) return true;
  if (ap.has('doctorsCompanion') && bp.has('doctor')) return true;
  if (bp.has('doctorsCompanion') && ap.has('doctor')) return true;
  return false;
};

/**
 * True when a card can take a second commander at all. Every `CommanderPairing`
 * is one half of a pair — including the "other half" roles, since a Time Lord
 * Doctor still wants its companion and a Background is useless without the
 * creature that chooses it — so having any of them is enough.
 */
export const allowsSecondCommander = (info?: CommanderInfo): boolean =>
  !!info && info.pairings.length > 0;

/**
 * The card types of a card's front face. Two-sided cards are judged by that face
 * alone — "Bala Ged Recovery // Bala Ged Sanctuary" is a sorcery you may play as
 * a land, not a land — so it counts as a spell on the curve and towards the mana
 * a deck needs, not towards its land count.
 */
export const frontTypes = (meta?: CardMetadata): Set<string> => {
  if (!meta) return new Set();
  const front = meta.typeLine?.split('//')[0];
  // An em dash separates types from subtypes; only the left side interests us.
  const words = front ? front.split('—')[0].split(/\s+/) : meta.types;
  return new Set(words.filter(Boolean));
};

/** Whether a card is a land, going by its front face (see `frontTypes`). */
export const isLandType = (meta?: CardMetadata): boolean => frontTypes(meta).has('Land');

/** WUBRG order, the way Magic always prints colors and color identities. */
export const WUBRG = ['W', 'U', 'B', 'R', 'G'];

export const sortWubrg = (colors: string[]): string[] =>
  [...colors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));

export interface CardMetadata {
  /**
   * Cardmarket's `idProduct` for this printing, as Scryfall records it.
   *
   * The one dependable way to name a card to Cardmarket. Its own pages are
   * reached by a slug we can only guess from the name, and its search answers a
   * name it doesn't know with the closest thing it does — which is how a want
   * list ends up holding "Witchstalker Frenzy" for "Witchstalker".
   */
  cardmarketId?: number;
  /** Mana value (converted mana cost). */
  cmc?: number;
  colorIdentity: string[];
  /** Colors of the card face(s): subset of W U B R G. */
  colors: string[];
  /**
   * Commander-format info (whether it can be a commander and how it partners),
   * derived from the oracle text / type line at fetch time. Absent for cards we
   * cached before this existed or that Scryfall didn't recognize.
   */
  commander?: CommanderInfo;
  /**
   * Per-face images for physically two-sided cards (transform / modal DFC /
   * reversible). Present with length >= 2 only when each face has its own art;
   * split/adventure/aftermath cards share a single image and are omitted here.
   */
  faceImages?: string[];
  found: boolean;
  imageUrl?: string;
  keywords: string[];
  manaCost?: string;
  /** Name we looked up (normalized request key echoes back even if not found). */
  name: string;
  oracleText?: string;
  rarity?: string;
  scryfallUri?: string;
  /** Subtypes — includes creature types (Elf, Goblin…), land types, etc. */
  subtypes: string[];
  supertypes: string[];
  typeLine?: string;
  types: string[];
}

/** A card/product, typically the subject of a product page or a search row. */
export interface CardListing {
  availableItems?: number;
  /** Lowest price shown for the card, if surfaced. */
  fromPrice?: number;
  fromPriceText?: string;
  href?: string;
  imageUrl?: string;
  name?: string;
  number?: string;
  rarity?: string;
  setCode?: string;
  setName?: string;
  /** 30-day average / trend if the page exposes it. */
  trendPrice?: number;
}
