/** Frame-level selection metrics. Candidate-level accuracy is not the score. */

import { CATASTROPHIC_IOU, GOOD_IOU, USABLE_IOU } from './schema.mjs';

const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
};

export const evaluateFrames = (frames, selectedOf) => {
  const rows = frames.map(frame => {
    const selected = selectedOf(frame);
    const current = frame.baselines.current.iou;
    return {
      id: frame.id,
      image: frame.image,
      label: frame.label,
      captureGroup: frame.captureGroup,
      selectedIou: selected.iou,
      selectedIndex: selected.index,
      utility: selected.utility ?? null,
      secondUtility: selected.secondUtility ?? null,
      currentIou: current,
      oracleIou: frame.oracleBestIou,
      hasGoodCandidate: frame.hasGoodCandidate,
      noUsableCandidate: frame.noUsableCandidate,
    };
  });
  const ious = rows.map(row => row.selectedIou);
  const oracleFrames = rows.filter(row => row.hasGoodCandidate);
  const recovered = oracleFrames.filter(row => row.selectedIou >= GOOD_IOU).length;
  return {
    n: rows.length,
    good80: ious.filter(value => value >= GOOD_IOU).length,
    usable70: ious.filter(value => value >= USABLE_IOU).length,
    median: quantile(ious, 0.5),
    p10: quantile(ious, 0.1),
    catastrophic: ious.filter(value => value < CATASTROPHIC_IOU).length,
    meanOracle: ious.length ? rows.reduce((sum, row) => sum + row.oracleIou, 0) / rows.length : null,
    meanGap: ious.length ? rows.reduce((sum, row) => sum + (row.oracleIou - row.selectedIou), 0) / rows.length : null,
    oracleFrames: oracleFrames.length,
    oracleRecovery: oracleFrames.length ? recovered / oracleFrames.length : null,
    improved: rows.filter(row => row.selectedIou > row.currentIou + 0.01).length,
    regressed: rows.filter(row => row.selectedIou < row.currentIou - 0.01).length,
    goodToBad: rows.filter(row => row.currentIou >= GOOD_IOU && row.selectedIou < USABLE_IOU).length,
    noUsableFrames: rows.filter(row => row.noUsableCandidate).length,
    rows,
  };
};

export const baselineEval = (frames, key) => evaluateFrames(frames, frame => ({
  index: frame.baselines[key].index,
  iou: frame.baselines[key].iou,
  utility: null,
  secondUtility: null,
}));
