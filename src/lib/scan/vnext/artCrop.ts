/**
 * Recognition art crop used by the frozen stack.
 * Detected art box, expanded 3% about its center, warped to 625×436.
 * If the box is missing or leaves the card, the current canonical art window.
 */

import { detectFrameRegions } from '../../../../scripts/geometry/lib/frame-regions/detect.mjs';
import { ensureFrameBuffer } from './bufferShim';
import { warpQuadToCard, type Quad } from '../geometry';
import { extractArtCropFromCard } from '../regions';
import type { ScanImage } from '../types';

export const ART_CROP_WIDTH = 625;
export const ART_CROP_HEIGHT = 436;
const ART_MARGIN = 0.03;

type NamedQuad = {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
};

const KEYS = ['tl', 'tr', 'br', 'bl'] as const;

const now = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

/** Scale width and height about the quad center, then clamp to the card. */
export const scaleCanonicalArt = (
  quad: NamedQuad,
  margin: number,
  width: number,
  height: number,
): NamedQuad => {
  const pts = KEYS.map(key => ({ x: quad[key][0], y: quad[key][1] }));
  const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
  const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
  const factor = 1 + margin;
  const scaled = pts.map(point => ({
    x: Math.min(width - 1, Math.max(0, cx + (point.x - cx) * factor)),
    y: Math.min(height - 1, Math.max(0, cy + (point.y - cy) * factor)),
  }));
  const out = {} as NamedQuad;
  KEYS.forEach((key, index) => {
    out[key] = [scaled[index].x, scaled[index].y];
  });
  return out;
};

const inside = (quad: NamedQuad, width: number, height: number): boolean =>
  KEYS.every(key => {
    const [x, y] = quad[key];
    return x >= -2 && y >= -2 && x <= width + 1 && y <= height + 1;
  });

const toPoints = (quad: NamedQuad): Quad => [
  { x: quad.tl[0], y: quad.tl[1] },
  { x: quad.tr[0], y: quad.tr[1] },
  { x: quad.br[0], y: quad.br[1] },
  { x: quad.bl[0], y: quad.bl[1] },
];

export const cropRecognitionArt = (
  card: ScanImage,
): { crop: ScanImage; anchor: 'frame-art+3' | 'canonical-window'; artMs: number } => {
  const t0 = now();
  ensureFrameBuffer();
  const detected = detectFrameRegions(card) as {
    regions?: { artBox?: { quad?: NamedQuad } | null };
  };
  const art = detected.regions?.artBox?.quad ?? null;
  if (art) {
    const padded = scaleCanonicalArt(art, ART_MARGIN, card.width, card.height);
    if (inside(padded, card.width, card.height)) {
      return {
        crop: warpQuadToCard(card, toPoints(padded), ART_CROP_WIDTH, ART_CROP_HEIGHT),
        anchor: 'frame-art+3',
        artMs: now() - t0,
      };
    }
  }
  return {
    crop: extractArtCropFromCard(card, { variant: 'PRIMARY' }).crop,
    anchor: 'canonical-window',
    artMs: now() - t0,
  };
};
