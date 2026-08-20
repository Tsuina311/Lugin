/**
 * Cardmarket's own search box, called the way the site calls it.
 *
 * Typing in the header search fires a single POST:
 *
 *   POST /<lang>/Magic/AjaxAction
 *   args=<obfuscated>***<base64 of the search parameters>
 *
 * The half before the `***` is the action name and the session's CSRF token,
 * lightly scrambled — the plaintext is `Product_Search***<64 hex characters>`.
 * That is obfuscation, not encryption: there is no secret, and the token is the
 * same `__cmtkn` every other Cardmarket AJAX call sends in the clear. It exists
 * to make the endpoint tedious to call by hand, so treat it as a wire format to
 * reproduce faithfully rather than a lock to pick. `searchArgs.ts` holds the
 * format and is tested against a real captured request.
 *
 * Why bother, when `/Products/Search?searchString=` is a plain page we could
 * fetch and scrape? Because this returns every *printing* of a match with its
 * expansion, product id and live offer count in one small reply — exactly the
 * shape a picker needs, and what the site itself pays for a keystroke. Scraping
 * the search page would cost a full page render per search.
 *
 * If Cardmarket ever changes the scramble this throws, and the panel falls back
 * to offering the plain search page: the feature degrades, it doesn't break.
 */

import { ajaxBox } from './ajax';
import { findCmToken } from './cart';
import { MIN_SEARCH_LENGTH, buildArgs, productFactsFromImage } from './searchArgs';
import { currentLang } from './wants';

import { replayInPage } from '@/lib/messaging';

export interface ProductSuggestion {
  /** Offers listed for this printing right now, as Cardmarket counts them. */
  available?: number;
  /** Cardmarket's product category — "Singles", "Booster Boxes", … */
  category?: string;
  /** Expansion name, e.g. "Return to Ravnica". */
  expansion?: string;
  /** Product page path, e.g. "/en/Magic/Products/Singles/…?language=1,2,5". */
  href: string;
  imageUrl?: string;
  name: string;
  /** Cardmarket's numeric product id. */
  productId?: string;
  /** Cardmarket's expansion abbreviation, e.g. "RTR". */
  setCode?: string;
}

/** The thumbnail hides its real URL in a tooltip's `<img>` markup. */
const imageFromRow = (row: Element): string | undefined => {
  const tooltip = row.querySelector('[data-bs-title]')?.getAttribute('data-bs-title') ?? '';
  // Live DOM attributes are entity-decoded; ajax HTML sometimes still has &quot;.
  const raw = tooltip.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const src = raw.match(/src=["']([^"']+)["']/)?.[1] ?? raw.match(/src=([^\s>]+)/)?.[1];
  return src?.replace(/^["']|["']$/g, '') || undefined;
};

const nameFromRow = (row: Element): string | undefined => {
  const nameCell = row.querySelector('.autocomplete-cell.name');
  const fromTruncate = nameCell?.querySelector('.text-truncate')?.textContent?.trim();
  if (fromTruncate) return fromTruncate;
  // Fallback: alt on the thumbnail tooltip (same printing the image shows).
  const tip = row.querySelector('[data-bs-title]')?.getAttribute('data-bs-title') ?? '';
  const fromAlt = tip
    .replace(/&quot;/g, '"')
    .match(/alt=["']([^"']+)["']/)?.[1]
    ?.trim();
  return fromAlt || undefined;
};

const countFrom = (text: string | null | undefined): number | undefined => {
  const digits = text?.replace(/\D/g, '') ?? '';
  return digits ? Number(digits) : undefined;
};

/**
 * Turn the decoded autocomplete markup into suggestions.
 *
 * The dropdown ends with two links that look like results but aren't: "Advanced
 * Singles Search" and "Show All (10+ Hits)". Both lack the cell structure a real
 * row has, which is what separates them here — matching on their labels would
 * work in English and nowhere else.
 */
export const parseSuggestions = (root: ParentNode): ProductSuggestion[] => {
  const out: ProductSuggestion[] = [];
  root.querySelectorAll<HTMLAnchorElement>('a.autocomplete-link').forEach(row => {
    const name = nameFromRow(row);
    const href = row.getAttribute('href');
    if (!name || !href || !href.includes('/Products/')) return;

    const nameCell = row.querySelector('.autocomplete-cell.name');
    const imageUrl = imageFromRow(row);
    out.push({
      available: countFrom(nameCell?.querySelector('.text-muted')?.textContent),
      category: row.querySelector('.autocomplete-cell.categoryName')?.textContent?.trim(),
      expansion:
        row.querySelector('.autocomplete-cell.expansion [title]')?.getAttribute('title')?.trim() ||
        undefined,
      href,
      imageUrl,
      name,
      ...productFactsFromImage(imageUrl),
    });
  });
  return out;
};

/** Cardmarket's own "Show All (N Hits)" link, when it truncated the dropdown. */
export const findShowAllHref = (root: ParentNode): string | undefined =>
  root
    .querySelector<HTMLAnchorElement>('a[href*="/Products/Search?searchString="]')
    ?.getAttribute('href') ?? undefined;

export interface SearchReply {
  /** Where to send the user for the full result set, if there is more. */
  showAllHref?: string;
  suggestions: ProductSuggestion[];
}

/**
 * Search Cardmarket's catalogue for a term.
 *
 * Replayed in the page context, like every other call we make on the user's
 * behalf, so it carries the session exactly as the site's search box does.
 */
export const searchProducts = async (
  query: string,
  options: { categoryId?: number | string | null; token?: string | null } = {},
): Promise<SearchReply> => {
  const term = query.trim();
  if (term.length < MIN_SEARCH_LENGTH) return { suggestions: [] };

  // Callers should hand one in — `cmToken()` will borrow a token from another
  // page, and most of Cardmarket carries none. Reading the page in front of us is
  // only the convenience path.
  const token = options.token ?? findCmToken();
  if (!token) throw new Error('No Cardmarket session token — sign in and try again');

  const args = buildArgs(token, {
    productCategoryIds: options.categoryId == null ? null : [options.categoryId],
    searchString: term,
  });

  const res = await replayInPage({
    body: `args=${args}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: `/${currentLang()}/Magic/AjaxAction`,
  });

  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);

  const html = ajaxBox(res.body, 'autocompleteBox');
  // An empty box behind a 200 means the envelope wasn't what we expect — most
  // likely the scramble or the action name moved. Say so, rather than reporting
  // "no results" for a card the user can see on the site.
  if (!html) throw new Error('Cardmarket answered the search in an unfamiliar shape');

  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { showAllHref: findShowAllHref(doc), suggestions: parseSuggestions(doc) };
};
