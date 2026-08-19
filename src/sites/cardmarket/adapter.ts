import type { Diagnostic, ExtractionResult, PageContext, SiteAdapter } from '../types';

import { languageOfRow } from './language';
import { expansionFromProductUrl } from './productUrl';
import { SELECTORS } from './selectors';

import { attrOf, collectJsonLd, jsonLdType, parseMoney, textOf } from '@/lib/extract';
import type { CardListing, CardOffer } from '@/lib/mtg';

const detect = (url: string, _doc: Document): PageContext => {
  const u = new URL(url);
  const path = u.pathname;
  let kind: PageContext['kind'] = 'other';
  let label = 'Other Magic page';

  if (/\/Users\/[^/]+\/Offers/i.test(path)) {
    // .../Users/<name>/Offers/Singles — another user's cards for sale.
    kind = 'productList';
    label = 'User offers';
  } else if (/\/Products\/Search/i.test(path) || u.searchParams.has('searchString')) {
    kind = 'search';
    label = 'Search results';
  } else if (/\/Products\/Singles\/[^/]+\/[^/]+/i.test(path)) {
    // .../Singles/<Set>/<Card-Name> — an individual product.
    kind = 'product';
    label = 'Product page';
  } else if (/\/Products\/Singles\/[^/]+\/?$/i.test(path)) {
    // .../Singles/<Set> — the list of singles in an expansion.
    kind = 'productList';
    label = 'Expansion singles list';
  }

  return { host: u.host, kind, label, url };
};

/** Pull a card + price range out of a schema.org Product node, if present. */
const listingFromJsonLd = (jsonLd: unknown[]): CardListing | undefined => {
  const product = jsonLd.find(n => jsonLdType(n) === 'product') as
    Record<string, unknown> | undefined;
  if (!product) return undefined;

  const listing: CardListing = {};
  if (typeof product.name === 'string') listing.name = product.name;
  if (typeof product.image === 'string') listing.imageUrl = product.image;

  const offers = product.offers as Record<string, unknown> | undefined;
  if (offers) {
    const low = offers.lowPrice ?? offers.price;
    const priceCurrency = offers.priceCurrency;
    if (low != null) {
      const parsed = parseMoney(String(low));
      listing.fromPrice = parsed.value ?? Number(low);
      listing.fromPriceText =
        typeof priceCurrency === 'string' ? `${low} ${priceCurrency}` : String(low);
    }
  }
  return Object.keys(listing).length ? listing : undefined;
};

const extractOffers = (doc: Document, diagnostics: Diagnostic[]): CardOffer[] => {
  const rows = Array.from(doc.querySelectorAll(SELECTORS.product.offerRow));
  diagnostics.push({
    level: rows.length ? 'info' : 'warn',
    message: `Offer rows matched: ${rows.length} (selector: ${SELECTORS.product.offerRow})`,
  });

  return rows.map(row => {
    const priceText = textOf(row, SELECTORS.product.offerPrice);
    const money = parseMoney(priceText);
    const offer: CardOffer = {
      comment: textOf(row, SELECTORS.product.offerComment),
      condition: textOf(row, SELECTORS.product.offerCondition),
      currency: money.currency,
      href: attrOf(row, 'a[href]', 'href'),
      isFoil: row.querySelector(SELECTORS.product.offerFoil) != null,
      price: money.value,
      priceText,
      seller: textOf(row, SELECTORS.product.offerSeller),
    };
    // `CardOffer` has carried a `language` field all along and nothing filled it
    // in, so every consumer saw an offer with no language — including the price
    // breakdown, which is the one place people most want it.
    const language = languageOfRow(row);
    if (language) offer.language = language;

    const amount = textOf(row, SELECTORS.product.offerAmount);
    if (amount) {
      const n = Number.parseInt(amount.replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) offer.quantity = n;
    }
    return offer;
  });
};

// Every card on a list/search/user-offers page links to its product page via
// `/Products/Singles/...`, with the card name as the link text. Harvesting those
// anchors is far more robust than guessing table-row markup, and works across
// all Cardmarket list layouts.
const extractList = (doc: Document, diagnostics: Diagnostic[]): CardListing[] => {
  const anchors = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('a[href*="/Products/Singles/"]'),
  );

  const seen = new Set<string>();
  const listings: CardListing[] = [];
  for (const a of anchors) {
    const name = a.textContent?.trim();
    if (!name || name.length < 2) continue; // skip image-only / icon links
    const href = a.getAttribute('href') ?? undefined;
    // The URL names the expansion, which is what lets the overlay offer an
    // edition filter on a search page spanning a dozen sets.
    const setName = expansionFromProductUrl(href);
    // Keyed on the set too: a search for "Abrupt Decay" lists one row per
    // expansion, and those are different printings, not a repeat of one.
    const key = `${name.toLowerCase()}|${setName?.toLowerCase() ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push({ href, name, ...(setName ? { setName } : {}) });
  }

  diagnostics.push({
    level: listings.length ? 'info' : 'warn',
    message: `Product links matched: ${listings.length} (a[href*="/Products/Singles/"])`,
  });
  return listings;
};

const extract = (ctx: PageContext, doc: Document): ExtractionResult => {
  const diagnostics: Diagnostic[] = [];
  const jsonLd = collectJsonLd(doc);

  const ldTypes = jsonLd.map(jsonLdType).filter(Boolean);
  diagnostics.push({
    level: jsonLd.length ? 'info' : 'warn',
    message: jsonLd.length
      ? `JSON-LD blocks: ${jsonLd.length} [${ldTypes.join(', ') || 'untyped'}]`
      : 'No JSON-LD blocks found on this page.',
  });

  const result: ExtractionResult = {
    context: ctx,
    diagnostics,
    extractedAt: Date.now(),
    jsonLd,
    listings: [],
    offers: [],
  };

  if (ctx.kind === 'product') {
    result.listing = listingFromJsonLd(jsonLd) ?? {
      imageUrl: attrOf(doc, SELECTORS.product.image, 'src'),
      name: textOf(doc, SELECTORS.product.title),
      setName: textOf(doc, SELECTORS.product.setName),
    };
    result.offers = extractOffers(doc, diagnostics);
  } else if (ctx.kind === 'search' || ctx.kind === 'productList') {
    result.listings = extractList(doc, diagnostics);
  } else {
    diagnostics.push({
      level: 'info',
      message: 'Unrecognized page type — only JSON-LD was collected.',
    });
  }

  return result;
};

export const cardmarketAdapter: SiteAdapter = {
  detect,
  extract,
  id: 'cardmarket',
  matchesHost: host => /(^|\.)cardmarket\.com$/i.test(host),
};
