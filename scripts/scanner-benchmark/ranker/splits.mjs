/** Capture-group splits. Existing holdout groups stay put. New groups join cross-validation only. */

export const FOLDS = 5;

export const groupKey = frame => frame.captureGroup || frame.seriesId || frame.id;

export const initSplits = (frames, existing = null) => {
  const groups = [...new Set(frames.map(groupKey))].sort();
  const holdout = new Set(existing?.holdoutGroups ?? []);
  const folds = { ...(existing?.folds ?? {}) };
  if (!existing) {
    for (const frame of frames) {
      if (frame.corpusSplit === 'test') holdout.add(groupKey(frame));
    }
  }
  for (const group of groups) {
    if (holdout.has(group)) continue;
    if (folds[group] == null) {
      const used = Object.keys(folds).length;
      folds[group] = used % FOLDS;
    }
  }
  const cvGroups = groups.filter(group => !holdout.has(group));
  const presentFolds = [...new Set(cvGroups.map(group => folds[group]))].sort((a, b) => a - b);
  return {
    holdoutGroups: [...holdout].sort(),
    folds,
    foldIds: presentFolds,
  };
};

export const partition = (frames, splits) => {
  const holdout = new Set(splits.holdoutGroups);
  const cv = [];
  const frozen = [];
  for (const frame of frames) {
    (holdout.has(groupKey(frame)) ? frozen : cv).push(frame);
  }
  const byFold = new Map(splits.foldIds.map(id => [id, []]));
  for (const frame of cv) {
    const fold = splits.folds[groupKey(frame)];
    if (!byFold.has(fold)) byFold.set(fold, []);
    byFold.get(fold).push(frame);
  }
  return { cv, frozen, byFold };
};
