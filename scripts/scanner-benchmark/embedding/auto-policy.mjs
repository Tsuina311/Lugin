/**
 * Automatic art-anchor crop policies.
 * Thresholds below were fixed before the auto +3% scores were computed.
 * Human art boxes are a ceiling reference. They never choose a crop.
 */

export const AUTO_PAD = 0.03;
export const BOUNDARY_IOU = 0.75;
export const WRONG_CONFIDENT_MARGIN = 0.05;

/** Rank rows saved by the corrected margin sweep. NO_ANCHOR stays unranked. */
export const scoreFromRank = saved => {
  if (!saved || saved.available === false) {
    return {
      available: false,
      failed: true,
      reason: saved?.reason || 'NO_ANCHOR',
      top1: false,
      top3: false,
      top5: false,
      top10: false,
      rank: null,
      top1Name: null,
      top1Score: null,
      expectedScore: null,
      margin: null,
      wrongConfident: false,
    };
  }
  const rank = saved.rank ?? null;
  const top1 = Boolean(saved.top1);
  return {
    available: true,
    failed: false,
    top1,
    top3: rank != null && rank <= 3,
    top5: rank != null && rank <= 5,
    top10: rank != null && rank <= 10,
    rank,
    top1Name: saved.top1Name ?? null,
    top1Score: saved.top1Score ?? null,
    expectedScore: saved.expectedScore ?? null,
    margin: saved.margin ?? null,
    wrongConfident: !top1 && rank != null && saved.margin != null && saved.margin >= WRONG_CONFIDENT_MARGIN,
  };
};

/** Why human +3% hit and the automatic +3% crop did not. */
export const gapCause = ({ anchor, iou }) => {
  if (!anchor) return 'NO_ANCHOR';
  if (!(iou >= BOUNDARY_IOU)) return 'BAD_BOUNDARY';
  return 'OTHER';
};

export const iouBucket = ({ anchor, iou }) => {
  if (!anchor) return 'no anchor';
  if (!(iou >= BOUNDARY_IOU)) return '<0.75';
  if (iou < 0.9) return '0.75–0.90';
  return '>=0.90';
};

/**
 * Practical policy verdict.
 * A material win is at least +3 Top1 over current, with regressions not exceeding fixes.
 * Near the human ceiling means most of the known human fixes return, at most 2 regressions,
 * and Top1 within 2 of that ceiling. Otherwise the unrecovered human hits decide
 * whether missing anchors or bad boundaries dominate.
 */
export const chooseAutoPolicy = ({
  currentTop1,
  policyTop1,
  wrongToCorrect,
  correctToWrong,
  recoveredFixes,
  humanFixCount,
  humanCeilingTop1,
  gapCauses,
}) => {
  const material = policyTop1 - currentTop1 >= 3 && correctToWrong <= wrongToCorrect;
  const near = material
    && recoveredFixes * 2 > humanFixCount
    && correctToWrong <= 2
    && humanCeilingTop1 - policyTop1 <= 2;
  const coverage = gapCauses.filter(cause => cause === 'NO_ANCHOR').length;
  const boundary = gapCauses.filter(cause => cause === 'BAD_BOUNDARY').length;
  if (!material) {
    return {
      verdict: 'AUTO_POLICY_NO_MATERIAL_WIN',
      practicalId: 'current',
      why: `auto +3% with current fallback is ${policyTop1} Top1 versus current ${currentTop1}, with ${wrongToCorrect} wrong→correct and ${correctToWrong} correct→wrong. That is not a material gain.`,
    };
  }
  if (near) {
    return {
      verdict: 'AUTO_POLICY_NEAR_CEILING',
      practicalId: 'auto3_current_fallback',
      why: `auto +3% with current fallback reaches ${policyTop1} Top1 versus current ${currentTop1} and the human +3% ceiling ${humanCeilingTop1}. It recovers ${recoveredFixes} of ${humanFixCount} human fixes, with ${correctToWrong} regressions.`,
    };
  }
  if (coverage >= 2 && coverage >= 2 * boundary) {
    return {
      verdict: 'ANCHOR_COVERAGE_BOTTLENECK',
      practicalId: 'auto3_current_fallback',
      why: `The fallback beats current (${policyTop1} vs ${currentTop1}) but remains ${humanCeilingTop1 - policyTop1} Top1 short of human +3%. Of the human hits it misses, ${coverage} have no anchor and ${boundary} ${boundary === 1 ? 'has' : 'have'} a weak boundary.`,
    };
  }
  if (boundary >= 2 && boundary >= 2 * coverage) {
    return {
      verdict: 'ANCHOR_ACCURACY_BOTTLENECK',
      practicalId: 'auto3_current_fallback',
      why: `The fallback beats current (${policyTop1} vs ${currentTop1}) but remains ${humanCeilingTop1 - policyTop1} Top1 short of human +3%. Of the human hits it misses, ${boundary} have a weak boundary and ${coverage} have no anchor.`,
    };
  }
  return {
    verdict: 'ANCHOR_MIXED_LIMIT',
    practicalId: 'auto3_current_fallback',
    why: `The fallback beats current (${policyTop1} vs ${currentTop1}) but remains ${humanCeilingTop1 - policyTop1} Top1 short of human +3%. The misses split across missing anchors (${coverage}) and weak boundaries (${boundary}).`,
  };
};
