// Turn a raw camera/photo frame into an upright, normalized card canvas.

import { detectCardQuad } from './detectCard';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  rectQuad,
  warpQuadToCard,
  type Quad,
} from './geometry';

export interface PreparedCard {
  canvas: HTMLCanvasElement;
  /** True when a perspective quad was found and warped. */
  detected: boolean;
  score: number;
}

/**
 * Detect the card quad (if possible), perspective-correct it, and emit a
 * standard CARD_WIDTH × CARD_HEIGHT raster for region crops + OCR.
 *
 * Falls back to a simple centre/letterbox scale when detection fails.
 */
export const prepareCard = (source: HTMLCanvasElement): PreparedCard => {
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('Could not read the capture for card prep');
  const { width, height } = source;
  const { data } = ctx.getImageData(0, 0, width, height);

  const { quad, score } = detectCardQuad(data, width, height);
  if (quad) {
    return {
      canvas: imageToCanvas(warpQuadToCard({ data, height, width }, quad)),
      detected: true,
      score,
    };
  }

  // Fallback: treat the whole capture as an already-framed card.
  const fallback = rectQuad(0, 0, width - 1, height - 1);
  return {
    canvas: imageToCanvas(warpQuadToCard({ data, height, width }, fallback)),
    detected: false,
    score: 0,
  };
};

/**
 * Same as prepareCard, but when detection fails, crop to an inner guide
 * rectangle expressed as fractions of the padded capture (0–1).
 */
export const prepareCardWithGuideFallback = (
  source: HTMLCanvasElement,
  guideFrac: { h: number; w: number; x: number; y: number },
): PreparedCard => {
  const ctx = source.getContext('2d');
  if (!ctx) throw new Error('Could not read the capture for card prep');
  const { width, height } = source;
  const { data } = ctx.getImageData(0, 0, width, height);

  const { quad, score } = detectCardQuad(data, width, height);
  if (quad && score >= 0.35) {
    return {
      canvas: imageToCanvas(warpQuadToCard({ data, height, width }, quad)),
      detected: true,
      score,
    };
  }

  const gx = guideFrac.x * width;
  const gy = guideFrac.y * height;
  const gw = guideFrac.w * width;
  const gh = guideFrac.h * height;
  const fallback: Quad = rectQuad(gx, gy, Math.max(1, gw - 1), Math.max(1, gh - 1));
  return {
    canvas: imageToCanvas(warpQuadToCard({ data, height, width }, fallback)),
    detected: false,
    score: 0,
  };
};

const imageToCanvas = (img: {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width || CARD_WIDTH;
  canvas.height = img.height || CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a canvas for the warped card');
  // Copy into a fresh buffer — TS DOM typings reject SharedArrayBuffer-backed views.
  const pixels = new Uint8ClampedArray(img.data);
  ctx.putImageData(new ImageData(pixels, img.width, img.height), 0, 0);
  return canvas;
};
