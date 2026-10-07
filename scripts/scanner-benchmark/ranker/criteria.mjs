/**
 * Challenger gates. Fixed before any model scores were read.
 * A pass requires a higher oracle-recovery rate than the current selector,
 * no increase in selections below 0.50 IoU, zero current-good to model-bad
 * regressions, and that pattern on at least half of the grouped folds.
 * A strong win also needs the same pattern on a frozen holdout of at least 8 frames.
 * Anything short of a pass keeps the heuristic. A pass without that holdout
 * is an early-model result, not a production approval.
 */

export const challengerPasses = ({
  oracleRecovery,
  baselineRecovery,
  catastrophic,
  baselineCatastrophic,
  goodToBad,
  foldsWon,
  foldCount,
}) => {
  if (foldCount < 1) return false;
  const recoveryUp = oracleRecovery > baselineRecovery + 1e-6;
  const catsOk = catastrophic <= baselineCatastrophic;
  const noRegret = goodToBad === 0;
  const acrossFolds = foldsWon >= Math.ceil(foldCount / 2);
  return recoveryUp && catsOk && noRegret && acrossFolds;
};

export const holdoutPasses = ({
  n,
  oracleRecovery,
  baselineRecovery,
  catastrophic,
  baselineCatastrophic,
  goodToBad,
}) => {
  if (n < 8) return false;
  return oracleRecovery > baselineRecovery + 1e-6 && catastrophic <= baselineCatastrophic && goodToBad === 0;
};

export const recommend = ({ anyPass, holdoutOk }) => {
  if (!anyPass) return 'KEEP_HEURISTIC';
  if (holdoutOk) return 'LEARNED_RANKER_STRONG_WIN';
  return 'LEARNED_RANKER_PROMISING';
};
