/** Feature schema for the candidate ranker. Inference-time fields only. */

export const FEATURE_SCHEMA_VERSION = 'ranker-features-v1';
export const DATASET_VERSION = 'v1';
export const FRAME_WARP_WIDTH = 372;

export const SCORE_FEATURES = ['detectorScore', 'aspectScore', 'parallelScore', 'areaScore', 'centerScore'];
export const RAW_FEATURES = ['aspectRatio', 'frameFraction', 'centerX', 'centerY', 'parallelRaw'];
export const RELATIVE_FEATURES = [
  'scoreRank',
  'scoreMinusBest',
  'scoreMinusMedian',
  'areaOverLargest',
  'areaOverMedian',
  'candidateCount',
  'containedByCount',
  'containsCount',
  'hasContainer',
  'closestContainerRatio',
  'closestContainerOffset',
  'hasContained',
  'closestContainedRatio',
  'inNestedRelation',
  'isNestedInner',
  'isNestedOuter',
];
export const SOURCE_FEATURES = ['srcEdge', 'srcLuma', 'srcChroma', 'lumaMultiplier', 'lumaThreshold', 'chromaThreshold'];
export const STRUCTURE_FEATURES = [
  'frameRegionSuccess',
  'artBoxConfidence',
  'titleArtConfidence',
  'artTypeConfidence',
  'innerLeftConfidence',
  'innerRightConfidence',
];

export const ABLATIONS = [
  { id: 'score', features: [...SCORE_FEATURES] },
  { id: 'score-geometry', features: [...SCORE_FEATURES, ...RAW_FEATURES, ...RELATIVE_FEATURES] },
  { id: 'score-geometry-source', features: [...SCORE_FEATURES, ...RAW_FEATURES, ...RELATIVE_FEATURES, ...SOURCE_FEATURES] },
  {
    id: 'all',
    features: [...SCORE_FEATURES, ...RAW_FEATURES, ...RELATIVE_FEATURES, ...SOURCE_FEATURES, ...STRUCTURE_FEATURES],
  },
];

export const FULL_FEATURES = ABLATIONS[3].features;

export const GOOD_IOU = 0.8;
export const USABLE_IOU = 0.7;
export const CATASTROPHIC_IOU = 0.5;

export const bandFor = iou => {
  if (iou >= GOOD_IOU) return 'GOOD';
  if (iou >= USABLE_IOU) return 'USABLE';
  return 'POOR';
};

export const vectorOf = (features, names) => names.map(name => {
  const value = features[name];
  if (!Number.isFinite(value)) throw new Error(`missing feature ${name}`);
  return value;
});
