// Group Cardmarket catalogue printings by shared Scryfall artwork.
//
// After a card search the panel lists every printing Cardmarket returned; many
// of those are the same illustration in different frames/sets. Scryfall's
// `illustration_id` is the stable key for that — two products with the same id
// are "any with this art". Matching a catalogue row to a Scryfall printing is
// done with Cardmarket's product id when the thumbnail URL carries it, then set
// code / set name as fallbacks.
//
// Pure data so the grouping can be tested without a browser.

import type { CardPrint } from './prints';
import { normalizeSetName } from './sets';

/** One Cardmarket catalogue row, as search returns it. */
export interface CataloguePrinting {
  expansion?: string;
  href: string;
  imageUrl?: string;
  name: string;
  productId?: string;
  setCode?: string;
}

/** Catalogue printings that share one illustration (or a singleton with no art id). */
export interface CatalogueArtGroup {
  /** Scryfall `illustration_id`, or the product href when art is unknown / unique. */
  key: string;
  lead: CataloguePrinting;
  printings: CataloguePrinting[];
  /** True when two or more catalogue rows share this artwork. */
  sharedArt: boolean;
}

const setKey = (value: string | undefined): string =>
  value ? normalizeSetName(value) : '';

/**
 * Pick the Scryfall printing that corresponds to one catalogue row.
 *
 * Product id wins (same number Cardmarket and Scryfall share). Set code and set
 * name are backups for thumbnails that don't encode an id — Cardmarket's
 * "Extras" / "Promos" names often diverge, so those may stay unmatched and
 * become singleton groups rather than wrongly merging into the parent set.
 */
export const matchCataloguePrint = (
  item: CataloguePrinting,
  prints: readonly CardPrint[],
): CardPrint | undefined => {
  if (item.productId) {
    const byId = prints.find(p => p.cardmarketId != null && String(p.cardmarketId) === item.productId);
    if (byId) return byId;
  }
  if (item.setCode) {
    const code = item.setCode.toLowerCase();
    const byCode = prints.find(p => p.setCode.toLowerCase() === code);
    if (byCode) return byCode;
  }
  const expansion = setKey(item.expansion);
  if (expansion) {
    const byName = prints.find(p => setKey(p.setName) === expansion);
    if (byName) return byName;
  }
  return undefined;
};

/**
 * Fold catalogue printings into one row per distinct artwork.
 *
 * Order follows the first time each art appears in `items` (Cardmarket's own
 * search order). Printings we can't tie to an `illustration_id` each keep their
 * own row — better a few extra edition rows than silently merging different arts.
 */
export const groupCatalogueByArt = (
  items: readonly CataloguePrinting[],
  prints: readonly CardPrint[],
): CatalogueArtGroup[] => {
  const order: string[] = [];
  const byKey = new Map<string, CataloguePrinting[]>();

  for (const item of items) {
    const matched = matchCataloguePrint(item, prints);
    const key = matched?.illustrationId ? `art:${matched.illustrationId}` : `solo:${item.href}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(item);
  }

  return order.map(key => {
    const printings = byKey.get(key)!;
    const lead = printings.find(p => p.imageUrl) ?? printings[0];
    return {
      key,
      lead,
      printings,
      sharedArt: printings.length > 1 && key.startsWith('art:'),
    };
  });
};
