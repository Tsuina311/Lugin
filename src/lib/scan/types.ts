// Core scanner value types.
//
// Deliberately free of DOM and platform APIs: the whole recognition pipeline
// (detect → warp → crop → preprocess → match) has to run under Node in the
// evaluation harness, not just in a browser tab. Canvas glue lives in
// `src/web/scan/canvasBridge.ts` and nowhere else.

/** Raw RGBA pixels — the same memory layout as `ImageData`, without the DOM. */
export interface ScanImage {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

/** Pixel rectangle inside a specific image. */
export interface Rect {
  h: number;
  w: number;
  x: number;
  y: number;
}

/**
 * Rectangle in 0–1 fractions of the *normalized card*, origin top-left.
 *
 * Regions are relative because the title band is a property of the card, not of
 * the phone screen — once the card is perspective-corrected the same fractions
 * work at any camera distance or angle.
 */
export interface RelativeRegion {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The four visible card corners, named so callers cannot mix up the order. */
export interface CardCorners {
  bottomLeft: Point;
  bottomRight: Point;
  topLeft: Point;
  topRight: Point;
}

/** Allocate an opaque black image. */
export const blankImage = (width: number, height: number): ScanImage => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, height, width };
};

/** Convert a relative region to pixels within `image`, clamped to its bounds. */
export const regionToRect = (image: ScanImage, region: RelativeRegion): Rect => {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(region.x * image.width)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(region.y * image.height)));
  return {
    h: Math.max(1, Math.min(image.height - y, Math.round(region.h * image.height))),
    w: Math.max(1, Math.min(image.width - x, Math.round(region.w * image.width))),
    x,
    y,
  };
};

/** Copy a pixel rectangle out into its own image. */
export const cropRect = (image: ScanImage, rect: Rect): ScanImage => {
  const out = blankImage(rect.w, rect.h);
  for (let row = 0; row < rect.h; row++) {
    const from = ((rect.y + row) * image.width + rect.x) * 4;
    out.data.set(image.data.subarray(from, from + rect.w * 4), row * rect.w * 4);
  }
  return out;
};

/** Copy a relative region of `image` out into its own image. */
export const cropImage = (image: ScanImage, region: RelativeRegion): ScanImage =>
  cropRect(image, regionToRect(image, region));
