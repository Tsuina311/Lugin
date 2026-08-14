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
export const NAME_REGION: Region = { h: 0.075, w: 0.78, x: 0.08, y: 0.042 };

/**
 * Collector number line (bottom-left): `286/361 R` or modern `0123 •`.
 * Sits just above the set code on classic frames.
 */
export const NUMBER_REGION: Region = { h: 0.04, w: 0.42, x: 0.035, y: 0.885 };

/** Three-letter set code under the number — `CMR`, `DMU`, … */
export const SET_REGION: Region = { h: 0.035, w: 0.28, x: 0.035, y: 0.928 };

/**
 * Wider strip covering both number and set, used as a fallback OCR pass when
 * the split crops miss (phone tilt, older frames, modern one-line prints).
 */
export const COLLECTOR_REGION: Region = { h: 0.085, w: 0.55, x: 0.03, y: 0.875 };

/** Crop a region out of a source canvas into a new one. */
export const cropRegion = (
  source: HTMLCanvasElement | OffscreenCanvas,
  region: Region,
): HTMLCanvasElement => {
  const sx = Math.round(region.x * source.width);
  const sy = Math.round(region.y * source.height);
  const sw = Math.max(1, Math.round(region.w * source.width));
  const sh = Math.max(1, Math.round(region.h * source.height));
  const out = document.createElement('canvas');
  // Upscale small strips — Tesseract likes letters a few dozen pixels tall.
  const scale = Math.max(1, Math.ceil(48 / sh));
  out.width = sw * scale;
  out.height = sh * scale;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not open a 2D canvas for the crop');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
};
