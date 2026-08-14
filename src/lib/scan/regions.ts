// Where to look on a *standard* frame Magic card.
//
// Fractions of the card rectangle after the user has lined it up in the guide.
// Special layouts (showcase, textless, adventure, DFCs) will need their own
// presets later — this is the common case the camera guide is drawn for.
//
// Coordinates are { x, y, w, h } in 0–1 of the card frame, origin top-left.

export interface Region {
  h: number;
  w: number;
  x: number;
  y: number;
}

/** Title bar — name sits in the same band on almost every modern frame. */
export const NAME_REGION: Region = { h: 0.08, w: 0.84, x: 0.08, y: 0.045 };

/**
 * Bottom-left strip under the text box: collector number, set code, language,
 * and the foil/non-foil marker (• vs ★). Printed in English on every language.
 */
export const COLLECTOR_REGION: Region = { h: 0.055, w: 0.55, x: 0.04, y: 0.905 };

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
