// The only place canvas meets the pure scanner core.
//
// Keeping the conversion in one file is what lets `src/lib/scan/**` stay free of
// DOM types, which in turn is what lets `scripts/scan-eval.mjs` run the real
// pipeline over PNG fixtures instead of a reimplementation of it.

import type { Rect, ScanImage } from '@/lib/scan/types';

export const toScanImage = (canvas: HTMLCanvasElement): ScanImage => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not read pixels from the capture');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, height: canvas.height, width: canvas.width };
};

export const toCanvas = (image: ScanImage): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a canvas for the image');
  // Copy into a fresh buffer — DOM typings reject SharedArrayBuffer-backed views.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas;
};

/** Snapshot a source rectangle of a video (or canvas) straight into pixels. */
export const drawToScanImage = (
  source: CanvasImageSource,
  rect: Rect,
): ScanImage => {
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not open a canvas for the capture');
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const { data } = ctx.getImageData(0, 0, rect.w, rect.h);
  return { data, height: rect.h, width: rect.w };
};

/** Data URL for the debug view. Development only — never leaves the device. */
export const toDataUrl = (image: ScanImage): string => toCanvas(image).toDataURL('image/png');
