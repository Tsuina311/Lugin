/**
 * RESEARCH PRIORS for modern-frame structural boundaries.
 *
 * These are search windows, not detected geometry and not ground truth.
 * They are seeded from the scanner's measured standard-frame crops in
 * src/lib/scan/regions.ts (NAME_REGION, ARTWORK_REGION, TYPE_LINE_REGION,
 * TEXT_BOX_REGION, COLLECTOR_REGION, SET_REGION). Those crops are OCR/art
 * rectangles, not the frame lines themselves, so each prior sits on the
 * shared edge between two of them and the window is intentionally wide.
 *
 * Do not treat a hit on the prior as a successful detection. Image evidence
 * inside the window has to carry the boundary.
 */

export const PRIOR_SOURCE = 'src/lib/scan/regions.ts STANDARD_PROFILE crops';

/** Normalized fractions of the canonical card. y grows downward. */
export const RESEARCH_PRIORS = {
  horizontal: {
    // NAME_REGION starts at y=0.038. The title bar's top edge sits a little above the glyphs.
    titleTop: { prior: 0.03, lo: 0.006, hi: 0.07 },
    // NAME_REGION ends at 0.110; ARTWORK_REGION starts at 0.12.
    titleArt: { prior: 0.115, lo: 0.07, hi: 0.18 },
    // ARTWORK_REGION ends at 0.54; TYPE_LINE_REGION starts at 0.545.
    // The high side stops short of the type/text prior so that stronger edge cannot steal this window.
    artType: { prior: 0.542, lo: 0.47, hi: 0.575 },
    // TYPE_LINE_REGION ends at 0.590; TEXT_BOX_REGION starts at 0.58 (the crops overlap).
    typeText: { prior: 0.59, lo: 0.555, hi: 0.68 },
    // TEXT_BOX_REGION ends at 0.86; COLLECTOR_REGION starts at 0.885.
    textFooter: { prior: 0.872, lo: 0.78, hi: 0.94 },
    // SET_REGION ends at 0.958, just inside the physical card edge.
    footerBottom: { prior: 0.962, lo: 0.9, hi: 0.994 },
  },
  vertical: {
    // ARTWORK_REGION.x = 0.08. The inner frame line is just outside that crop.
    innerLeft: { prior: 0.075, lo: 0.02, hi: 0.16 },
    // ARTWORK_REGION ends at x=0.92.
    innerRight: { prior: 0.925, lo: 0.84, hi: 0.98 },
  },
};

/**
 * Regions are the rectangles formed by a pair of horizontal boundaries and the
 * shared inner-frame verticals. A region is emitted only when every edge was
 * actually detected.
 */
export const REGION_EDGES = {
  titleBand: { top: 'titleTop', bottom: 'titleArt', left: 'innerLeft', right: 'innerRight' },
  artBox: { top: 'titleArt', bottom: 'artType', left: 'innerLeft', right: 'innerRight' },
  typeLine: { top: 'artType', bottom: 'typeText', left: 'innerLeft', right: 'innerRight' },
  textBox: { top: 'typeText', bottom: 'textFooter', left: 'innerLeft', right: 'innerRight' },
  footer: { top: 'textFooter', bottom: 'footerBottom', left: 'innerLeft', right: 'innerRight' },
};
