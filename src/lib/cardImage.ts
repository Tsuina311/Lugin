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

/**
 * Direct Scryfall image-CDN URL for a printing id. Scryfall lays images out at
 * `/normal/front/<a>/<b>/<id>.jpg` (a/b = first two id chars). Hitting the CDN
 * directly means the browser caches the file and repeat views make no request —
 * unlike `api.scryfall.com/cards/...?format=image`, which is an API call
 * (redirect) every time and is what Scryfall asks us not to hammer.
 */
export const cdnImageFromId = (scryfallId?: string): string | undefined => {
  if (!scryfallId || !/^[0-9a-f-]{36}$/i.test(scryfallId)) return undefined;
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
 * Best image for a row, most exact source first.
 *
 * The name-only fallback at the bottom always resolves for a real card, so
 * anything that should outrank a guess has to sit above it — callers with extra
 * sources of their own (a printing the user picked by hand, an image scraped
 * from a Cardmarket page) should consult those before falling back to this.
 */
export const cardImageUrl = (card: ImageableCard): string | undefined =>
  cdnImageFromId(card.scryfallId) ??
  imageFromProductId(card.productId) ??
  card.imageUrl ??
  imageUrlForPrinting(card.setCode, card.collectorNumber) ??
  imageUrlFor(undefined, card.name);
