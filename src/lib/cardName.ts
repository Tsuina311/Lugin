// Helpers for reconciling Cardmarket card names with Scryfall.
//
// Cardmarket names double-faced / split cards as "Front // Back"
// (e.g. "Emeritus of Woe // Demonic Tutor"), but Scryfall matches on the FRONT
// face ("Emeritus of Woe") and then returns metadata for the whole card. So we
// key lookups, cache, and matching by the front-face name.

/** The front-face portion of a card name (text before "//"), trimmed. */
export const frontFaceName = (name: string): string => {
  const idx = name.indexOf('//');
  return (idx === -1 ? name : name.slice(0, idx)).trim();
};

/**
 * Strip Cardmarket's printing marker — " (V.1)", "(V.2)", "(V1)"… — that it
 * appends to alternate-art printings. For card *identity* every printing is the
 * same card, so we drop it. Real MTG names don't otherwise end in "(V.n)".
 */
export const stripVersion = (name: string): string =>
  name.replace(/\s*\(v\.?\s*\d+\)\s*$/i, '').trim();

/**
 * Fold typographic quotes onto the ASCII apostrophe. Scryfall spells names with
 * "'" ("Rider's Chaplain") while pages, feeds and decklists often carry "’" —
 * the same card either way, so identity keys shouldn't tell them apart.
 */
export const straightenQuotes = (name: string): string => name.replace(/[’‘‛`´]/g, '\'');

/**
 * Stable lookup/cache key for a card: front face, version-stripped, lowercased,
 * with quotes normalized. Every printing of a card (base art, "(V.2)", …)
 * collapses to one key so a want list, offers, purchases and cart all treat them
 * as the same card.
 */
export const cardKey = (name: string): string =>
  straightenQuotes(stripVersion(frontFaceName(name))).toLowerCase();

/**
 * A card key reduced to letters and digits, for matching a name against the
 * spelling Scryfall answers with. It differs in punctuation and accents more
 * often than you'd hope ("Lim-Dûl's Vault" vs "Lim-Dul's Vault"), and a name we
 * can't match to the card we just fetched looks exactly like a card that doesn't
 * exist — so it gets fetched again, forever.
 */
export const looseKey = (name: string): string =>
  cardKey(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]/gu, '');
