/** Warnings for a human art box. Does not move the points. */

import { isCompleteQuad } from '../schema.mjs';
import { quadArea, quadCoverage } from './report.mjs';

const points = quad => [quad.tl, quad.tr, quad.br, quad.bl].map(([x, y]) => ({ x, y }));

const properCross = (p, q, a, b) => {
  const det = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(det) < 1e-9) return false;
  const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / det;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / det;
  return t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4;
};

const selfIntersects = quad => {
  const p = points(quad);
  return properCross(p[0], p[1], p[2], p[3]) || properCross(p[1], p[2], p[3], p[0]);
};

/**
 * Reasons this polygon should not count as a completed art box.
 * Empty means it can be saved as human-reviewed.
 */
export const artBoxIssues = (art, card) => {
  const issues = [];
  if (!isCompleteQuad(art)) {
    issues.push('Art box needs four finite corners.');
    return issues;
  }
  if (selfIntersects(art)) issues.push('Art box crosses itself.');
  if (!isCompleteQuad(card)) {
    issues.push('Card quad is missing, so the art box cannot be checked against the card.');
    return issues;
  }
  const artArea = quadArea(art);
  const cardArea = quadArea(card);
  if (!(cardArea > 1e-6) || artArea < cardArea * 0.02) {
    issues.push('Art box area is too small to be the artwork.');
  }
  if (quadCoverage(art, card) < 0.85) {
    issues.push('Too much of the art box sits outside the card.');
  }
  return issues;
};
