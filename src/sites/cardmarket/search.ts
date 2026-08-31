/**
 * Cardmarket catalogue search — autocomplete AJAX and the Search 2.0 results page.
 *
 * The header box POSTs to AjaxAction for keystroke suggestions. That endpoint is
 * fragile (obfuscated args + CSRF), so the reliable path for "show me printings"
 * is the same HTML page the site navigates to on Enter:
 *
 *   GET /<lang>/Magic/Products/Search?category=-1&searchMode=v2&searchString=…
 *
 * Lugin fetches that page in-session and scrapes the gallery/list links, so the
 * panel can stay fullscreen without sending the user to Cardmarket's UI.
 */

import { ajaxBox } from './ajax';
import { extractCmToken, findCmToken } from './cart';
import { isChallengeResponse } from './challenge';
import { expansionFromProductUrl } from './productUrl';
import {
  MIN_SEARCH_LENGTH,
  buildArgs,
  cardmarketSearchUrl,
  productFactsFromImage,
} from './searchArgs';
import { currentLang, fetchDoc } from './wants';

import { rememberCmToken } from '@/content/session';
import { replayInPage } from '@/lib/messaging';

export interface ProductSuggestion {
  /** Offers listed for this printing right now, as Cardmarket counts them. */
  available?: number;
  /** Cardmarket's product category — "Singles", "Booster Boxes", … */
  category?: string;
  /** Expansion name, e.g. "Return to Ravnica". */
  expansion?: string;
  /** Lowest price text from a gallery card, e.g. "0,15 €". */
  fromPrice?: string;
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
 * Printings listed on a Search 2.0 results page (gallery or list).
 *
 * Gallery cards bury the name in `img[alt]` and the set in the expansion icon
 * title; list view puts both in the link text. Either way the product href is
 * the stable identity.
 */
export const parseCatalogueResults = (root: ParentNode): ProductSuggestion[] => {
  const out: ProductSuggestion[] = [];
  const seen = new Set<string>();

  root.querySelectorAll<HTMLAnchorElement>('a[href*="/Products/Singles/"]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || /\/Products\/Singles\/?(\?|$)/i.test(href)) return;

    const img = a.querySelector<HTMLImageElement>('img[alt], img[data-echo], img[src]');
    const altName = img?.getAttribute('alt')?.trim();
    const titleText = a.querySelector('.card-title, h2, .col-10')?.textContent ?? '';
    const rawName = (altName || titleText || a.textContent || '').replace(/\s+/g, ' ').trim();
    const name = rawName.replace(/\s*(?:from\b\s*)?\d[\d.,\s]*\s*€.*$/i, '').trim();
    if (!name || name.length < 2) return;

    const expansion =
      a.querySelector<HTMLElement>('.expansion-symbol[title]')?.getAttribute('title')?.trim() ||
      expansionFromProductUrl(href);

    const echo = img?.getAttribute('data-echo')?.trim();
    const src = img?.getAttribute('src')?.trim();
    const imageUrl =
      (echo && !/transparent/i.test(echo) ? echo : undefined) ||
      (src && !/transparent/i.test(src) ? src : undefined);

    const priceText = a.querySelector('.card-text.text-muted, .price-container')?.textContent ?? '';
    const fromPrice = priceText.match(/[\d.,]+\s*€/)?.[0];

    if (seen.has(href)) return;
    seen.add(href);

    out.push({
      expansion,
      fromPrice,
      href,
      imageUrl,
      name,
      ...productFactsFromImage(imageUrl),
    });
  });

  return out;
};

/**
 * Fetch Cardmarket's Search 2.0 page for a term and return its printings.
 *
 * This is the path that matches pressing Enter in the site's own search box —
 * same URL, same session cookies — so it works when the autocomplete Ajax call
 * returns an empty envelope.
 */
export const searchCatalogue = async (
  query: string,
  signal?: AbortSignal,
): Promise<ProductSuggestion[]> => {
  const term = query.trim();
  if (term.length < MIN_SEARCH_LENGTH) return [];
  const { doc, html } = await fetchDoc(cardmarketSearchUrl(term, currentLang()), signal);
  rememberCmToken(extractCmToken(html));
  return parseCatalogueResults(doc);
};

/**
 * Search Cardmarket's catalogue for a term via the header autocomplete Ajax.
 *
 * Prefer {@link searchCatalogue} when you need a reliable full result set; this
 * stays for callers that want the lighter keystroke response when it works.
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

  if (isChallengeResponse(res.status, res.body)) {
    throw new Error(`CHALLENGE: search HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);

  const html = ajaxBox(res.body, 'autocompleteBox');
  // An empty box behind a 200 means the envelope wasn't what we expect — most
  // likely the scramble or the action name moved. Say so, rather than reporting
  // "no results" for a card the user can see on the site.
  if (!html) throw new Error('Cardmarket answered the search in an unfamiliar shape');

  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { showAllHref: findShowAllHref(doc), suggestions: parseSuggestions(doc) };
};
