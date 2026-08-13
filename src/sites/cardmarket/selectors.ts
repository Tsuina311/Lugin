// ---------------------------------------------------------------------------
// Cardmarket CSS selectors — the ONE place to fix when their markup changes.
// ---------------------------------------------------------------------------
// These are best-effort starting points. The adapter guards every lookup and
// reports hit counts in the diagnostics view, so load a real page, open the
// "Cards" tab, and tune anything that reads 0. Prefer the JSON-LD path (handled
// in the adapter) over these whenever the data is available there.

export const SELECTORS = {
  // --- Product list / search results ---------------------------------------
  list: {
    available: '.col-availability, .amount',

    fromPrice: '.col-price, .price, td.price',

    link: 'a[href*="/Products/Singles/"]',

    name: 'a[href*="/Products/Singles/"], .col-name a',
    /** Each product row in a results/expansion table. */
    row: '.table-body .row, table tbody tr',
  },

  // --- Product page (single card) -----------------------------------------
  product: {
    image: '.image img, img.card-image, #image img',

    offerAmount: '.item-count, .amount, .col-amount',

    offerComment: '.article-comments, .product-comments',

    offerCondition: '.article-condition span, .badge.condition, .article-condition .badge',

    offerFoil: '.icon.st_SpecialIcon.foil, [aria-label*="Foil" i]',

    offerLanguage: '.article-language, [data-original-title][aria-label], .icon[aria-label]',

    offerPrice: '.price-container .color-primary, .col-offer .price, .color-primary',

    /** The seller offer rows. */
    offerRow: '.article-row, .table-body .row.article-row',

    // Within an offer row:
    offerSeller: '.seller-info .seller-name a, .seller-name a, span.seller-name',

    // Price guide (definition list of dt/dd pairs).
    priceGuideRow: 'dl.labeled dt, .info-list-container dt',

    /** Set/expansion name near the title. */
    setName: 'h1 .expansion-symbol + span, .expansion-name, span[data-original-title]',

    /** Page heading holding the card name. */
    title: 'h1',
  },
} as const;
