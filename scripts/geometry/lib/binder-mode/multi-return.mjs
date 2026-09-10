/**
 * Geometric multi-return from detector candidates (no GT).
 */

export const multiReturnNms = (
  cands,
  polygonIoU,
  { maxCards = 12, nmsIou = 0.35, minScore = 0.28 } = {},
) => {
  const ranked = [...(cands || [])]
    .map(c => ({
      corners: c.quad || c.corners,
      score: c.finalScore ?? c.score ?? 0,
      method: c.method,
      areaShare: c.areaShare,
    }))
    .filter(c => c.corners && c.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const kept = [];
  for (const c of ranked) {
    const dup = kept.some(k => polygonIoU(k.corners, c.corners) >= nmsIou);
    if (dup) continue;
    kept.push(c);
    if (kept.length >= maxCards) break;
  }
  return kept;
};

/** Duplicate rate among kept vs pre-NMS (how many near-duplicates removed). */
export const nmsStats = (rawCands, kept, polygonIoU, nmsIou = 0.35) => {
  const raw = (rawCands || [])
    .map(c => c.quad || c.corners)
    .filter(Boolean);
  let nearDupPairs = 0;
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      if (polygonIoU(raw[i], raw[j]) >= nmsIou) nearDupPairs += 1;
    }
  }
  return {
    rawCount: raw.length,
    keptCount: kept.length,
    nearDupPairs,
    duplicateRate: raw.length ? 1 - kept.length / Math.max(raw.length, 1) : 0,
  };
};
