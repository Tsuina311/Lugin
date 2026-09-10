import type { CardCorners, ScanImage } from './sharedCore';

type Rgb = readonly [number, number, number];

export const QUAD_BLUE: Rgb = [40, 120, 255];
export const QUAD_YELLOW: Rgb = [255, 220, 40];
export const QUAD_MAGENTA: Rgb = [220, 60, 220];
export const QUAD_GREEN: Rgb = [80, 255, 140];

export const cloneScanImage = (image: ScanImage): ScanImage => ({
  data: new Uint8ClampedArray(image.data),
  height: image.height,
  width: image.width,
});

const setPixel = (image: ScanImage, x: number, y: number, rgb: Rgb) => {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const i = (y * image.width + x) * 4;
  image.data[i] = rgb[0];
  image.data[i + 1] = rgb[1];
  image.data[i + 2] = rgb[2];
  image.data[i + 3] = 255;
};

const strokeSegment = (image: ScanImage, ax: number, ay: number, bx: number, by: number, rgb: Rgb) => {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(ax + dx * t);
    const y = Math.round(ay + dy * t);
    setPixel(image, x, y, rgb);
    setPixel(image, x + 1, y, rgb);
    setPixel(image, x, y + 1, rgb);
  }
};

const strokeQuad = (image: ScanImage, corners: CardCorners, rgb: Rgb) => {
  const ring = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  for (let i = 0; i < 4; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % 4];
    strokeSegment(image, a.x, a.y, b.x, b.y, rgb);
  }
};

/** Draw raw (blue), tracked (yellow), recognition (magenta), presented (green). */
export const annotateGeometryImage = (
  source: ScanImage,
  quads: {
    presented?: CardCorners | null;
    previous?: CardCorners | null;
    raw?: CardCorners | null;
    recognition?: CardCorners | null;
    tracked?: CardCorners | null;
  },
): ScanImage => {
  const out = cloneScanImage(source);
  if (quads.raw) strokeQuad(out, quads.raw, QUAD_BLUE);
  if (quads.tracked ?? quads.previous) strokeQuad(out, (quads.tracked ?? quads.previous)!, QUAD_YELLOW);
  if (quads.recognition) strokeQuad(out, quads.recognition, QUAD_MAGENTA);
  if (quads.presented) strokeQuad(out, quads.presented, QUAD_GREEN);
  return out;
};
