/**
 * Host-side representation of detector parameters that COULD be tuned later.
 * Scaffold only — geometry:tune does not search today unless --dry-run.
 *
 * Sources: src/lib/scan/params.ts + internal detectCard.ts constants.
 * Production values must not be changed by this module.
 */

export const PARAMETER_SPACE = {
  version: 1,
  note: 'Scaffold for future yarn geometry:tune. Do not optimize until corpus is trusted + host/native parity is understood.',
  groups: [
    {
      id: 'area',
      params: [
        { name: 'DETECT_MIN_AREA_SHARE', path: 'params.ts', type: 'float', default: 0.04, range: [0.02, 0.12] },
        { name: 'DETECT_MAX_AREA_SHARE', path: 'params.ts', type: 'float', default: 0.82, range: [0.65, 0.95] },
        { name: 'DETECT_TOP_COMPONENTS', path: 'params.ts', type: 'int', default: 4, range: [2, 8] },
      ],
    },
    {
      id: 'score-gate',
      params: [
        { name: 'DETECT_MIN_SCORE', path: 'params.ts', type: 'float', default: 0.28, range: [0.15, 0.45] },
        { name: 'LOCK_MIN_SCORE', path: 'params.ts', type: 'float', default: 0.7, range: [0.5, 0.85] },
      ],
    },
    {
      id: 'continuity',
      params: [
        { name: 'CONTINUITY_KEEP_IOU', path: 'params.ts', type: 'float', default: 0.55, range: [0.35, 0.75] },
        { name: 'CONTINUITY_SWITCH_IOU', path: 'params.ts', type: 'float', default: 0.35, range: [0.2, 0.5] },
        { name: 'CONTINUITY_INNER_PROMOTE_FRAMES', path: 'params.ts', type: 'int', default: 3, range: [1, 6] },
      ],
    },
    {
      id: 'detectCard-internal',
      note: 'Not exported — would need injection hooks before tuning. Listed for design only.',
      params: [
        { name: 'WORK_WIDTH', path: 'detectCard.ts', type: 'int', default: 320, range: [240, 480] },
        { name: 'lumaThresholdMultipliers', path: 'detectCard.ts', type: 'float[]', default: 'spread-based', range: null },
        { name: 'chromaThreshold', path: 'detectCard.ts', type: 'float', default: 'adaptive', range: null },
        { name: 'edgeSobelFallback', path: 'detectCard.ts', type: 'bool', default: true, range: null },
        { name: 'scoreCardQuadWeights', path: 'geometry.ts', type: 'weights', default: 'scoreParts', range: null },
        { name: 'innerOuterSelection', path: 'detection/multi.ts', type: 'weights', default: 'selectPrimary', range: null },
      ],
    },
  ],
};

export const defaultCandidate = () => ({
  id: 'current-production',
  description: 'Frozen production defaults — no search applied',
  params: Object.fromEntries(
    PARAMETER_SPACE.groups.flatMap(g =>
      g.params.filter(p => p.default != null && typeof p.default !== 'string').map(p => [p.name, p.default]),
    ),
  ),
});

/**
 * Future tune loop (documented contract):
 *   1. sample candidates from PARAMETER_SPACE
 *   2. benchmark train split only
 *   3. rank on validation
 *   4. never touch hidden test until final report
 */
export const TUNE_PROTOCOL = {
  trainMetric: 'maximize mean IoU subject to recall floor',
  validationGate: 'no hard-regression miss; IoU>=0.90 not worse than baseline by >2pp',
  testSet: 'untouched until final candidate',
  runtime: 'optional soft budget — robustness may cost a few ms',
};
