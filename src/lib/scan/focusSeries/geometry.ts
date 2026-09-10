import { dist } from '../geometry';
import { compareQuads } from '../session/postLock';
import type { CardCorners } from '../types';

import type { FocusSeriesGeometry } from './types';

const FROZEN_IOU = 0.98;

const pts = (c: CardCorners) => [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];

const diagonal = (c: CardCorners): number =>
  Math.max(
    dist(c.topLeft, c.bottomRight),
    dist(c.topRight, c.bottomLeft),
    1,
  );

export const meanCornerDelta = (a: CardCorners, b: CardCorners): number => {
  const pa = pts(a);
  const pb = pts(b);
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += dist(pa[i], pb[i]);
  return sum / 4 / diagonal(b);
};

export const driftVsT0 = (current: CardCorners, t0: CardCorners): FocusSeriesGeometry => {
  const cmp = compareQuads(current, t0);
  return {
    centerDeltaVsT0: cmp.centerDelta,
    cornerDeltaVsT0: meanCornerDelta(current, t0),
    iouVsT0: cmp.iou,
  };
};

export const quadsNearlyIdentical = (a: CardCorners, b: CardCorners): boolean =>
  compareQuads(a, b).iou >= FROZEN_IOU && meanCornerDelta(a, b) < 0.02;

export const seriesUsesFrozenQuad = (quads: readonly CardCorners[]): boolean => {
  const t0 = quads[0];
  if (!t0 || quads.length < 2) return false;
  return quads.every(q => quadsNearlyIdentical(q, t0));
};
