import { CARD_HEIGHT, CARD_WIDTH } from '../geometry';
import type { CardCorners } from '../types';
import type { CardDensity } from './types';

export const cardBoundsPx = (quad: CardCorners): {
  cardAreaPx: number;
  cardBoundingHeightPx: number;
  cardBoundingWidthPx: number;
} => {
  const xs = [quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x];
  const ys = [quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(0, maxX - minX);
  const h = Math.max(0, maxY - minY);
  const area =
    Math.abs(
      (quad.topLeft.x * quad.topRight.y - quad.topRight.x * quad.topLeft.y +
        quad.topRight.x * quad.bottomRight.y -
        quad.bottomRight.x * quad.topRight.y +
        quad.bottomRight.x * quad.bottomLeft.y -
        quad.bottomLeft.x * quad.bottomRight.y +
        quad.bottomLeft.x * quad.topLeft.y -
        quad.topLeft.x * quad.bottomLeft.y) /
        2,
    );
  return { cardAreaPx: area, cardBoundingHeightPx: h, cardBoundingWidthPx: w };
};

export const cardDensity = (
  source: { height: number; width: number },
  quad: CardCorners,
  warp = { height: CARD_HEIGHT, width: CARD_WIDTH },
): CardDensity => {
  const bounds = cardBoundsPx(quad);
  return {
    ...bounds,
    sourceHeight: source.height,
    sourceWidth: source.width,
    warpHeight: warp.height,
    warpUpscaleX: bounds.cardBoundingWidthPx > 0 ? warp.width / bounds.cardBoundingWidthPx : 0,
    warpUpscaleY: bounds.cardBoundingHeightPx > 0 ? warp.height / bounds.cardBoundingHeightPx : 0,
    warpWidth: warp.width,
  };
};
