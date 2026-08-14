// Where to look on a *standard* frame Magic card.
//
// Fractions of the card rectangle after the user has lined it up in the guide.
// Tuned for the common layout (name top bar; collector number then set code
// stacked at the bottom-left — e.g. CMR's `286/361` over `CMR`). Special
// frames get their own presets later.
//
// Coordinates are { x, y, w, h } in 0–1 of the card frame, origin top-left.

import type { RelativeRegion } from './types';

/**
 * Regions are fractions of the *normalized* card, so they survive any camera
 * angle or distance once `prepareCard` has straightened the card.
 */
export type Region = RelativeRegion;

/**
 * Large centre band for step 1 when the user fills the guide with only the
 * title (name zoom). Nearly the whole frame — not the tiny top strip.
 */
export const TITLE_ZOOM_REGION: Region = { h: 0.7, w: 0.96, x: 0.02, y: 0.15 };

/** Mid-frame title line when the name bar alone is held across the guide. */
export const TITLE_LINE_REGION: Region = { h: 0.28, w: 0.96, x: 0.02, y: 0.36 };

/** Title bar — name sits in the same band on almost every modern frame. */
export const NAME_REGION: Region = { h: 0.085, w: 0.82, x: 0.06, y: 0.035 };

/**
 * Expansion symbol on the type line (right). Core sets like M11 print the code
 * inside the icon — OCR here when the bottom set text is missing or tiny.
 * Abstract symbols won't yield letters; those still need name + number.
 */
export const SET_SYMBOL_REGION: Region = { h: 0.055, w: 0.2, x: 0.74, y: 0.545 };

/**
 * Collector number line (bottom-left): modern `0123 •` or post-2015 `286/361`.
 */
export const NUMBER_REGION: Region = { h: 0.04, w: 0.42, x: 0.035, y: 0.885 };

/**
 * Older frames (e.g. M11) put `134/249` toward the bottom-right of the border,
 * not under the artist credit on the left.
 */
export const CLASSIC_NUMBER_REGION: Region = { h: 0.04, w: 0.38, x: 0.55, y: 0.915 };

/** Three-letter set code under the number — `CMR`, `DMU`, … (modern frames). */
export const SET_REGION: Region = { h: 0.035, w: 0.28, x: 0.035, y: 0.928 };

/**
 * Wider strip covering both number and set, used as a fallback OCR pass when
 * the split crops miss (phone tilt, older frames, modern one-line prints).
 */
export const COLLECTOR_REGION: Region = { h: 0.085, w: 0.94, x: 0.03, y: 0.875 };

/**
 * Every region the scanner reads, in the order the debug view lists them.
 * Named so diagnostics can label a crop without a second lookup table.
 */
export const NAMED_REGIONS: ReadonlyArray<{ name: string; region: Region }> = [
  { name: 'title-bar', region: NAME_REGION },
  { name: 'title-line', region: TITLE_LINE_REGION },
  { name: 'title-zoom', region: TITLE_ZOOM_REGION },
  { name: 'set-symbol', region: SET_SYMBOL_REGION },
  { name: 'number', region: NUMBER_REGION },
  { name: 'number-classic', region: CLASSIC_NUMBER_REGION },
  { name: 'set', region: SET_REGION },
  { name: 'collector', region: COLLECTOR_REGION },
];
