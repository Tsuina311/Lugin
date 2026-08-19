/**
 * The expansion hiding in a Cardmarket product URL.
 *
 * Every single links to `/en/Magic/Products/Singles/<Expansion>/<Card>`, so a
 * list page names the set of each row it shows without us having to find and
 * read an expansion icon. Sturdier than the markup, too: the path has kept this
 * shape across every layout change, while the icon has moved between an anchor,
 * a span and a tooltip.
 *
 * Pure, so it can be tested in Node — see scripts/import-test.mjs.
 */

/** Requires a card segment after the expansion, so a bare expansion page (which
 * has no second segment) is not mistaken for a card in a set named after it. */
const PRODUCT_PATH = /\/Products\/Singles\/([^/?#]+)\/[^/?#]/;

/**
 * "…/Singles/Return-to-Ravnica/Abrupt-Decay" -> "Return to Ravnica".
 *
 * De-hyphenated rather than properly title-cased, because the only consumer
 * folds it through `normalizeSetName` before matching Scryfall anyway.
 */
export const expansionFromProductUrl = (href: string | undefined): string | undefined => {
  const slug = href ? PRODUCT_PATH.exec(href)?.[1] : undefined;
  if (!slug) return undefined;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // A stray '%' in a slug — use it as-is rather than losing the set entirely.
  }
  return decoded.replace(/-+/g, ' ').trim() || undefined;
};
