/** Candidate features available at inference. Human IoU is not an input. */

import { quadCoverage } from '../../geometry/lib/frame-regions/report.mjs';

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const parseMethod = method => {
  const lumaMult = method.match(/^luma×([0-9.]+)$/);
  const lumaAbs = method.match(/^luma@([0-9.]+)$/);
  const chroma = method.match(/^chroma@([0-9.]+)$/);
  const family = method.startsWith('edge') ? 'edge' : method.startsWith('chroma') ? 'chroma' : method.startsWith('luma') ? 'luma' : 'other';
  return {
    srcEdge: family === 'edge' ? 1 : 0,
    srcLuma: family === 'luma' ? 1 : 0,
    srcChroma: family === 'chroma' ? 1 : 0,
    lumaMultiplier: lumaMult ? Number(lumaMult[1]) : 0,
    lumaThreshold: lumaAbs ? Number(lumaAbs[1]) : 0,
    chromaThreshold: chroma ? Number(chroma[1]) : 0,
  };
};

const center = quad => ({
  x: (quad.tl[0] + quad.tr[0] + quad.br[0] + quad.bl[0]) / 4,
  y: (quad.tl[1] + quad.tr[1] + quad.br[1] + quad.bl[1]) / 4,
});

const emptyStructure = () => ({
  frameRegionSuccess: 0,
  artBoxConfidence: 0,
  titleArtConfidence: 0,
  artTypeConfidence: 0,
  innerLeftConfidence: 0,
  innerRightConfidence: 0,
});

export const structureFeatures = detection => {
  if (!detection) return emptyStructure();
  const boundary = id => detection.debug?.boundaries?.find(row => row.id === id)?.confidence ?? 0;
  return {
    frameRegionSuccess: detection.regions?.artBox ? 1 : 0,
    artBoxConfidence: detection.regions?.artBox?.confidence ?? 0,
    titleArtConfidence: boundary('titleArt'),
    artTypeConfidence: boundary('artType'),
    innerLeftConfidence: boundary('innerLeft'),
    innerRightConfidence: boundary('innerRight'),
  };
};

export const buildFeatureRows = ({ rows, width, height, nested }) => {
  const scores = rows.map(row => row.detectorScore);
  const fracs = rows.map(row => row.frameFraction);
  const best = scores.length ? Math.max(...scores) : 0;
  const medScore = median(scores);
  const largest = fracs.length ? Math.max(...fracs) : 1;
  const medArea = median(fracs) || 1;
  const order = [...rows].sort((a, b) => b.detectorScore - a.detectorScore || a.index - b.index);
  const rankOf = new Map(order.map((row, rank) => [row.index, rank + 1]));
  const relations = nested?.relations ?? [];
  const containedBy = new Map(rows.map(row => [row.index, []]));
  const contains = new Map(rows.map(row => [row.index, []]));
  for (const outer of rows) {
    for (const inner of rows) {
      if (outer.index === inner.index || outer.frameFraction <= inner.frameFraction) continue;
      if (quadCoverage(inner.quad, outer.quad) < 0.9) continue;
      const ratio = inner.frameFraction / outer.frameFraction;
      const a = center(inner.quad);
      const b = center(outer.quad);
      const offset = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.sqrt(outer.frameFraction * width * height));
      containedBy.get(inner.index).push({ ratio, offset });
      contains.get(outer.index).push({ ratio });
    }
  }
  return rows.map(row => {
    const containers = containedBy.get(row.index);
    const contained = contains.get(row.index);
    const closestContainer = containers.reduce((best, item) => (!best || item.ratio > best.ratio ? item : best), null);
    const closestContained = contained.reduce((best, item) => (!best || item.ratio > best.ratio ? item : best), null);
    return {
      index: row.index,
      method: row.method,
      detectorScore: row.detectorScore,
      iou: row.iou,
      band: row.band,
      features: {
        detectorScore: row.detectorScore,
        aspectScore: row.aspectScore,
        parallelScore: row.parallelScore,
        areaScore: row.areaScore,
        centerScore: row.centerScore,
        aspectRatio: row.aspectRatio,
        frameFraction: row.frameFraction,
        centerX: row.centerX,
        centerY: row.centerY,
        parallelRaw: row.parallelRaw,
        scoreRank: rankOf.get(row.index),
        scoreMinusBest: row.detectorScore - best,
        scoreMinusMedian: row.detectorScore - medScore,
        areaOverLargest: largest > 0 ? row.frameFraction / largest : 0,
        areaOverMedian: medArea > 0 ? row.frameFraction / medArea : 0,
        candidateCount: rows.length,
        containedByCount: containers.length,
        containsCount: contained.length,
        hasContainer: closestContainer ? 1 : 0,
        closestContainerRatio: closestContainer?.ratio ?? 0,
        closestContainerOffset: closestContainer?.offset ?? 0,
        hasContained: closestContained ? 1 : 0,
        closestContainedRatio: closestContained?.ratio ?? 0,
        inNestedRelation: relations.some(rel => rel.outer === row.index || rel.inner === row.index) ? 1 : 0,
        isNestedInner: nested?.selected === row.index && nested?.selected === nested?.inner ? 1 : 0,
        isNestedOuter: nested?.selected === row.index && nested?.selected === nested?.outer ? 1 : 0,
        ...parseMethod(row.method),
        ...(row.structure ?? emptyStructure()),
      },
    };
  });
};
