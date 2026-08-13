import type { CardListing, CardOffer } from '@/lib/mtg';

/** Which kind of page we think we're on — routes to the right extractor. */
export type PageKind = 'product' | 'productList' | 'search' | 'other';

export interface PageContext {
  host: string;
  kind: PageKind;
  /** Human label for the UI, e.g. "Product page". */
  label: string;
  url: string;
}

/** A single note about what the extractor saw — powers the diagnostics view. */
export interface Diagnostic {
  level: 'info' | 'warn';
  message: string;
}

export interface ExtractionResult {
  context: PageContext;
  diagnostics: Diagnostic[];
  extractedAt: number;
  /** Raw JSON-LD blocks found, surfaced for inspection. */
  jsonLd: unknown[];
  /** The card that is the subject of the page (product pages). */
  listing?: CardListing;
  /** Rows on a search/list page. */
  listings: CardListing[];
  /** Seller offers (product pages). */
  offers: CardOffer[];
}

/**
 * A per-site plugin. Add one of these for each Magic site you want to support
 * (Cardmarket now; card-metadata sites later). All parsing lives behind this
 * interface so the content script stays site-agnostic.
 */
export interface SiteAdapter {
  /** Classify the current page from its URL + document. */
  detect(url: string, doc: Document): PageContext;
  /** Pull structured data out of the (already-rendered) document. */
  extract(ctx: PageContext, doc: Document): ExtractionResult;
  id: string;
  /** True if this adapter handles the given hostname. */
  matchesHost(host: string): boolean;
}
