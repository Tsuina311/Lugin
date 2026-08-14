// Where to look on a *standard* frame Magic card.
//
// Fractions of the card rectangle after the user has lined it up in the guide.
// Tuned for the common layout (name top bar; collector number then set code
// stacked at the bottom-left — e.g. CMR's `286/361` over `CMR`). Special
// frames get their own presets later.
//
// Coordinates are { x, y, w, h } in 0–1 of the card frame, origin top-left.

export interface Region {
  h: number;
  w: number;
  x: number;
  y: number;
}

/** Title bar — name sits in the same band on almost every modern frame. */
export const NAME_REGION: Region = { h: 0.085, w: 0.82, x: 0.06, y: 0.035 };

/**
 * Large upper band for name-only zooms: fill the guide with the title and we
 * still read it even when the rest of the card is off-frame.
 */
export const NAME_FOCUS_REGION: Region = { h: 0.4, w: 0.92, x: 0.04, y: 0.05 };

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

/** Crop a region out of a source canvas into a new one (1:1 — OCR enhance upscales). */
export const cropRegion = (
  source: HTMLCanvasElement | OffscreenCanvas,
  region: Region,
): HTMLCanvasElement => {
  const sx = Math.round(region.x * source.width);
  const sy = Math.round(region.y * source.height);
  const sw = Math.max(1, Math.round(region.w * source.width));
  const sh = Math.max(1, Math.round(region.h * source.height));
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not open a 2D canvas for the crop');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
};
