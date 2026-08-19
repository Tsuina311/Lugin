// Where to find the picture of a card you own.
//
// A collection row is whatever the thing that produced it happened to know: a
// ManaBox export brings a Scryfall id, a Cardmarket purchase brings a product id
// and its own image, a typed list brings a name and nothing else. So this is a
// ladder rather than a lookup, ordered by how exactly each source pins down the
// *printing* — getting Core Set 2021 #279 instead of Scryfall's default #1 is the
// difference between a picture of your card and a picture of some other card with
// the same name.
//
// Portable on purpose: the extension and the phone build show the same cards, and
// a rule about which image is the right one has no business existing twice.

import { cardKey } from './cardName';

const SCRYFALL_ID_RE = /^[0-9a-f-]{36}$/i;

/** Normalize Cardmarket image URLs scraped from purchase rows. */
export const normalizeCardmarketImageUrl = (raw?: string): string | undefined => {
  if (!raw?.trim()) return undefined;
  const cleaned = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  // Cardmarket stores bare `/1/SET/id/id.jpg` paths as well as full S3 URLs.
  if (/^\/\d+\/[A-Za-z0-9]/i.test(cleaned) || /product-images/i.test(cleaned)) {
    const path = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
    return `https://product-images.s3.cardmarket.com${path}`;
  }
  return cleaned;
};

const pushUnique = (out: string[], url?: string): void => {
  if (!url || out.includes(url)) return;
  out.push(url);
};

/**
 * Direct Scryfall image-CDN URL for a printing id. Scryfall lays images out at
 * `/normal/front/<a>/<b>/<id>.jpg` (a/b = first two id chars). Hitting the CDN
 * directly means the browser caches the file and repeat views make no request —
 * unlike `api.scryfall.com/cards/...?format=image`, which is an API call
 * (redirect) every time and is what Scryfall asks us not to hammer.
 */
export const cdnImageFromId = (scryfallId?: string): string | undefined => {
  if (!scryfallId || !SCRYFALL_ID_RE.test(scryfallId)) return undefined;
  return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
};

/** Last-resort image URL via the Scryfall API (only when no CDN url is known). */
export const imageUrlFor = (scryfallId?: string, name?: string): string | undefined => {
  if (scryfallId) return `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
  if (name)
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
  return undefined;
};

/**
 * Scryfall API image URL for an *exact* printing, keyed by set code + collector
 * number (`/cards/{set}/{number}`). This is what makes the picture match the
 * printing you actually own instead of Scryfall's default one, which is all a
 * name-only lookup can return. Used when the row has a set + number but no
 * Scryfall id (plain-list / purchase imports).
 */
export const imageUrlForPrinting = (
  setCode?: string,
  collectorNumber?: string,
): string | undefined => {
  const set = setCode?.trim().toLowerCase();
  const num = collectorNumber?.trim();
  if (!set || !num) return undefined;
  return `https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(
    num,
  )}?format=image&version=normal`;
};

/**
 * Scryfall image URL for the *exact* printing identified by its Cardmarket
 * product id (`/cards/cardmarket/{id}`). Purchases carry this id, so it pins the
 * precise edition you bought — the most reliable source when we have no Scryfall
 * id or set + collector number.
 */
export const imageFromProductId = (productId?: string): string | undefined => {
  if (!productId || !/^\d+$/.test(productId)) return undefined;
  return `https://api.scryfall.com/cards/cardmarket/${productId}?format=image&version=normal`;
};

/** The fields any row needs to carry for its picture to be findable. */
export interface ImageableCard {
  collectorNumber?: string;
  imageUrl?: string;
  name?: string;
  productId?: string;
  scryfallId?: string;
  setCode?: string;
}

/**
 * Ordered image URLs for a row, best printing first, with fallbacks when the
 * preferred URL fails to load (CDN 404, Cardmarket hotlink block, …).
 */
export const cardImageCandidates = (card: ImageableCard): string[] => {
  const out: string[] = [];
  if (card.scryfallId && SCRYFALL_ID_RE.test(card.scryfallId)) {
    pushUnique(out, cdnImageFromId(card.scryfallId));
    pushUnique(out, imageUrlFor(card.scryfallId));
  }
  pushUnique(out, imageFromProductId(card.productId));
  pushUnique(out, normalizeCardmarketImageUrl(card.imageUrl));
  pushUnique(out, imageUrlForPrinting(card.setCode, card.collectorNumber));
  pushUnique(out, imageUrlFor(undefined, card.name));
  return out;
};

/**
 * Best image for a row, most exact source first.
 *
 * The name-only fallback at the bottom always resolves for a real card, so
 * anything that should outrank a guess has to sit above it — callers with extra
 * sources of their own (a printing the user picked by hand, an image scraped
 * from a Cardmarket page) should consult those before falling back to this.
 */
export const cardImageUrl = (card: ImageableCard): string | undefined => cardImageCandidates(card)[0];

/**
 * How hard a row pins down *which* printing it is. Higher wins.
 *
 * Deliberately the same ladder as `cardImageUrl`, rung for rung, so a row can
 * never outrank another and then hand back a worse picture. A set code on its own
 * scores nothing, because on its own it resolves to nothing: `imageUrlForPrinting`
 * needs the collector number too, and without it the row falls all the way
 * through to a lookup by name.
 */
export const printingRank = (card: ImageableCard): number => {
  if (card.scryfallId) return 4;
  if (card.productId) return 3;
  if (card.imageUrl) return 2;
  if (card.setCode && card.collectorNumber) return 1;
  return 0;
};

/**
 * The best picture of each card named in a set of rows, keyed by `cardKey`.
 *
 * For when something knows a card only by name — a deck list — and a collection
 * is sitting there that knows the exact copy you own. Four copies from four sets
 * collapse to the one that pins its printing down hardest, so the picture is of
 * a card in your binder rather than Scryfall's default printing of that name.
 */
export const imagesByName = (cards: readonly ImageableCard[]): Map<string, string> => {
  const best = new Map<string, { rank: number; src: string }>();
  for (const card of cards) {
    const key = cardKey(card.name ?? '');
    if (!key) continue;
    const rank = printingRank(card);
    if ((best.get(key)?.rank ?? -1) >= rank) continue;
    const src = cardImageUrl(card);
    if (src) best.set(key, { rank, src });
  }
  return new Map([...best].map(([key, { src }]) => [key, src]));
};

/** Best image URL list per card name — same printing preference as `imagesByName`. */
export const candidatesByName = (
  cards: readonly ImageableCard[],
): Map<string, readonly string[]> => {
  const best = new Map<string, { rank: number; candidates: readonly string[] }>();
  for (const card of cards) {
    const key = cardKey(card.name ?? '');
    if (!key) continue;
    const rank = printingRank(card);
    if ((best.get(key)?.rank ?? -1) >= rank) continue;
    const candidates = cardImageCandidates(card);
    if (candidates.length) best.set(key, { rank, candidates });
  }
  return new Map([...best].map(([key, { candidates }]) => [key, candidates]));
};

/** Image candidates for a deck row: your copy first, then Scryfall's default. */
export const deckCardCandidates = (
  name: string,
  fromCollection: Map<string, readonly string[]>,
): readonly string[] => {
  const owned = fromCollection.get(cardKey(name));
  if (owned?.length) return owned;
  const fallback = imageUrlFor(undefined, name);
  return fallback ? [fallback] : [];
};
