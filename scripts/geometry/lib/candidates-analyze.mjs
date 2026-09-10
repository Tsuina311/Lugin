/**
 * Top-K / sleeve / nested / failure-category analysis over detector shortlists.
 * Diagnosis only — does not change DetectCard selection.
 *
 * Thresholds (explicit):
 *   MATCH_IOU       ≥ 0.80  → "good" candidate vs GT
 *   STRONG_IOU      ≥ 0.90
 *   EXCELLENT_IOU   ≥ 0.95
 *   AMBIGUOUS_SCORE_MARGIN ≤ 0.03 between top-2 scores
 *   SLEEVE/CARD label: higher IoU to sleeveQuad vs card GT (min IoU 0.5 to claim)
 */

import { centerOf, aspectOf } from './metrics.mjs';
import { gtQuadToCorners, isCompleteQuad } from './schema.mjs';

export const MATCH_IOU = 0.8;
export const STRONG_IOU = 0.9;
export const EXCELLENT_IOU = 0.95;
export const AMBIGUOUS_SCORE_MARGIN = 0.03;
export const LABEL_MIN_IOU = 0.5;

export const FAILURE = {
  SELECTION_FAILURE: 'SELECTION_FAILURE',
  GENERATION_FAILURE: 'GENERATION_FAILURE',
  SUPPRESSION_FAILURE: 'SUPPRESSION_FAILURE',
  AMBIGUOUS: 'AMBIGUOUS',
  OTHER: 'OTHER',
};

const SCORE_WEIGHTS = { aspect: 0.4, parallel: 0.25, area: 0.25, center: 0.1 };

export const cornersFromCandidate = c => {
  if (!c) return null;
  if (c.quad) return c.quad;
  if (c.corners) return c.corners;
  return null;
};

const percentile = (sorted, p) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[i];
};

/**
 * Rank candidates by finalScore desc (stable). Native shortlist may already be sorted.
 */
export const rankedCandidates = (det, { top = Infinity } = {}) => {
  const list = [...(det?.candidates ?? [])];
  list.sort((a, b) => (b.finalScore ?? b.score ?? 0) - (a.finalScore ?? a.score ?? 0));
  return list.slice(0, top).map((c, i) => ({
    ...c,
    rank: i + 1,
    score: c.finalScore ?? c.score ?? 0,
    corners: cornersFromCandidate(c),
  }));
};

export const bestMatchVsGt = (cands, gtCorners, polygonIoU) => {
  let best = { iou: 0, rank: null, cand: null };
  for (const c of cands) {
    if (!c.corners) continue;
    const iou = polygonIoU(c.corners, gtCorners);
    if (iou > best.iou) best = { iou, rank: c.rank, cand: c };
  }
  return best;
};

export const classifyCandVsCardSleeve = (candCorners, cardGt, sleeveGt, polygonIoU) => {
  const iouCard = cardGt ? polygonIoU(candCorners, cardGt) : 0;
  const iouSleeve = sleeveGt ? polygonIoU(candCorners, sleeveGt) : 0;
  // Prefer CARD on near-ties: sleeve GT contains the card, so sleeve IoU is inflated.
  const TIE = 0.03;
  if (iouCard < LABEL_MIN_IOU && iouSleeve < LABEL_MIN_IOU) {
    return { label: 'OTHER', iouCard, iouSleeve };
  }
  if (iouCard + TIE >= iouSleeve) return { label: 'CARD', iouCard, iouSleeve };
  return { label: 'SLEEVE', iouCard, iouSleeve };
};

/**
 * Failure category for one GT card vs detector shortlist + selected primary.
 */
export const classifyFailure = ({
  selectedIou,
  bestCandIou,
  bestCandRank,
  shortlistSize,
  rawCandidateCount,
  topScores,
  matched,
}) => {
  if (matched && selectedIou >= MATCH_IOU) return null; // success for this GT

  const goodInShortlist = bestCandIou >= MATCH_IOU;
  const scoreGap =
    topScores?.length >= 2 ? Math.abs((topScores[0] ?? 0) - (topScores[1] ?? 0)) : null;

  // Good candidate exists but selected primary is weak vs this GT
  // (includes nested pick of a different shortlist member than best-IoU).
  if (goodInShortlist && selectedIou < MATCH_IOU) {
    if (scoreGap != null && scoreGap <= AMBIGUOUS_SCORE_MARGIN) {
      return FAILURE.AMBIGUOUS;
    }
    return FAILURE.SELECTION_FAILURE;
  }

  if (!goodInShortlist) {
    // Heuristic suppression: many raw components considered but shortlist empty of GT match.
    // Pre-dedupe list is not exported by DetectCard — this is approximate.
    if ((rawCandidateCount ?? 0) >= 8 && (shortlistSize ?? 0) >= 1 && bestCandIou < MATCH_IOU) {
      if (bestCandIou >= 0.4 && bestCandIou < MATCH_IOU && shortlistSize >= 8) {
        return FAILURE.SUPPRESSION_FAILURE;
      }
      return FAILURE.GENERATION_FAILURE;
    }
    return FAILURE.GENERATION_FAILURE;
  }

  return FAILURE.OTHER;
};

export const componentDeltas = (sleeveCand, cardCand) => {
  const sc = sleeveCand?.components || {};
  const cc = cardCand?.components || {};
  const keys = ['aspect', 'parallel', 'area', 'center'];
  const deltas = {};
  let weighted = 0;
  for (const k of keys) {
    const d = (sc[k] ?? 0) - (cc[k] ?? 0);
    deltas[k] = d;
    weighted += d * (SCORE_WEIGHTS[k] ?? 0);
  }
  return {
    deltas,
    weightedDelta: weighted,
    sleeveScore: sleeveCand?.score ?? sleeveCand?.finalScore ?? null,
    cardScore: cardCand?.score ?? cardCand?.finalScore ?? null,
    scoreMargin:
      (sleeveCand?.score ?? sleeveCand?.finalScore ?? 0) -
      (cardCand?.score ?? cardCand?.finalScore ?? 0),
  };
};

export const analyzeFixture = (fixture, det, polygonIoU, { top = 5, matchIou = MATCH_IOU } = {}) => {
  const cands = rankedCandidates(det, { top: Infinity });
  const topK = cands.slice(0, top);
  const selected =
    det?.corners &&
    (det.selectedIndex != null
      ? cands.find((_, i) => i === det.selectedIndex) ||
        cands.find(c => c.selected) ||
        null
      : cands.find(c => c.selected) || null);

  // Prefer comparing selected corners from detection result
  const selectedCorners = det?.corners ?? selected?.corners ?? null;
  const selectedScore = det?.score ?? selected?.score ?? 0;

  const cards = fixture.cards ?? [];
  const gtCards = cards
    .map((c, gi) => ({
      gi,
      id: c.id,
      corners: isCompleteQuad(c.groundTruthQuad) ? gtQuadToCorners(c.groundTruthQuad) : null,
      sleeveCorners: isCompleteQuad(c.sleeveQuad) ? gtQuadToCorners(c.sleeveQuad) : null,
      visibleFraction: c.visibleFraction ?? null,
      occluded: c.occluded ?? false,
      zIndex: c.zIndex ?? gi,
    }))
    .filter(c => c.corners);

  const perGt = [];
  for (const gt of gtCards) {
    const best = bestMatchVsGt(cands, gt.corners, polygonIoU);
    const selectedIou = selectedCorners ? polygonIoU(selectedCorners, gt.corners) : 0;
    const topHits = {};
    for (const k of [1, 2, 3, 5]) {
      const slice = cands.slice(0, k);
      const b = bestMatchVsGt(slice, gt.corners, polygonIoU);
      topHits[`top${k}`] = {
        iou: b.iou,
        hit80: b.iou >= matchIou,
        hit90: b.iou >= STRONG_IOU,
        hit95: b.iou >= EXCELLENT_IOU,
        rank: b.rank,
      };
    }
    const any = bestMatchVsGt(cands, gt.corners, polygonIoU);
    topHits.any = {
      iou: any.iou,
      hit80: any.iou >= matchIou,
      hit90: any.iou >= STRONG_IOU,
      hit95: any.iou >= EXCELLENT_IOU,
      rank: any.rank,
    };

    let sleeveAnalysis = null;
    if (gt.sleeveCorners) {
      const labeled = cands.map(c => ({
        ...c,
        ...classifyCandVsCardSleeve(c.corners, gt.corners, gt.sleeveCorners, polygonIoU),
      }));
      // Best match to physical card GT (independent of sleeve label)
      const bestCard = bestMatchVsGt(cands, gt.corners, polygonIoU);
      const bestSleeve = bestMatchVsGt(cands, gt.sleeveCorners, polygonIoU);
      const cardCand = bestCard.cand;
      const sleeveCand = bestSleeve.cand;
      const winLabel = selectedCorners
        ? classifyCandVsCardSleeve(selectedCorners, gt.corners, gt.sleeveCorners, polygonIoU)
            .label
        : 'OTHER';
      const selectedVs = selectedCorners
        ? {
            iouCard: polygonIoU(selectedCorners, gt.corners),
            iouSleeve: polygonIoU(selectedCorners, gt.sleeveCorners),
          }
        : null;
      sleeveAnalysis = {
        winner: winLabel,
        selectedVs,
        cardRank: bestCard.rank,
        sleeveRank: bestSleeve.rank,
        cardIou: bestCard.iou,
        sleeveIou: bestSleeve.iou,
        goodCardInShortlist: bestCard.iou >= matchIou,
        components:
          cardCand && sleeveCand && bestCard.rank !== bestSleeve.rank
            ? componentDeltas(sleeveCand, cardCand)
            : cardCand && sleeveCand
              ? componentDeltas(sleeveCand, cardCand)
              : null,
        cardCand: cardCand
          ? { rank: cardCand.rank, score: cardCand.score, method: cardCand.method, iou: bestCard.iou }
          : null,
        sleeveCand: sleeveCand
          ? {
              rank: sleeveCand.rank,
              score: sleeveCand.score,
              method: sleeveCand.method,
              iou: bestSleeve.iou,
            }
          : null,
        labelsInShortlist: {
          card: labeled.filter(c => c.label === 'CARD').length,
          sleeve: labeled.filter(c => c.label === 'SLEEVE').length,
          other: labeled.filter(c => c.label === 'OTHER').length,
        },
      };
    }

    const failure = classifyFailure({
      selectedIou,
      bestCandIou: best.iou,
      bestCandRank: best.rank,
      shortlistSize: cands.length,
      rawCandidateCount: det?.diagnostics?.candidateCount,
      topScores: cands.slice(0, 2).map(c => c.score),
      matched: selectedIou >= matchIou,
    });

    perGt.push({
      gi: gt.gi,
      cardId: gt.id,
      visibleFraction: gt.visibleFraction,
      occluded: gt.occluded,
      selectedIou,
      bestCandidateIou: best.iou,
      bestCandidateRank: best.rank,
      topHits,
      sleeveAnalysis,
      failureCategory: failure,
    });
  }

  // Multi-card latent recall: greedy assign shortlist → GT
  const predCorners = cands.map(c => c.corners).filter(Boolean);
  const gtCorners = gtCards.map(g => g.corners);
  const assignment = greedyAssign(predCorners, gtCorners, polygonIoU);
  const latent = {
    gtCount: gtCards.length,
    shortlistCount: cands.length,
    rawCandidateCount: det?.diagnostics?.candidateCount ?? null,
    matchedAt80: assignment.filter(p => p.iou >= matchIou).length,
    matchedAt90: assignment.filter(p => p.iou >= STRONG_IOU).length,
    matchedAt95: assignment.filter(p => p.iou >= EXCELLENT_IOU).length,
    pairs: assignment,
  };

  const nested = analyzeNested(cands, det?.nestedPairs, det?.diagnostics?.nestedInnerPreferred);

  return {
    id: fixture.id,
    suite: fixture.suite || fixture.provenance?.suite || null,
    tags: fixture.tags ?? [],
    detected: Boolean(det?.detected),
    selectedScore,
    selectedIndex: det?.selectedIndex ?? null,
    nestedInnerPreferred: det?.diagnostics?.nestedInnerPreferred ?? null,
    runtimeMs: det?.runtimeMs ?? null,
    shortlistCount: cands.length,
    rawCandidateCount: det?.diagnostics?.candidateCount ?? null,
    candidates: topK.map(c => ({
      rank: c.rank,
      score: c.score,
      method: c.method,
      selected: Boolean(c.selected),
      areaShare: c.areaShare,
      aspectRatio: c.aspectRatio,
      components: c.components,
      quad: c.corners,
    })),
    perGt,
    latent,
    nested,
    engine: det?.engine ?? null,
    inputMode: det?.inputMode ?? null,
  };
};

const greedyAssign = (preds, gts, polygonIoU) => {
  const scores = [];
  for (let gi = 0; gi < gts.length; gi++) {
    for (let pi = 0; pi < preds.length; pi++) {
      scores.push({ gi, pi, iou: polygonIoU(preds[pi], gts[gi]) });
    }
  }
  scores.sort((a, b) => b.iou - a.iou);
  const usedP = new Set();
  const usedG = new Set();
  const pairs = [];
  for (const s of scores) {
    if (usedP.has(s.pi) || usedG.has(s.gi)) continue;
    if (s.iou <= 0) continue;
    usedP.add(s.pi);
    usedG.add(s.gi);
    pairs.push(s);
  }
  return pairs;
};

const analyzeNested = (cands, nestedPairsFromNative, nestedInnerPreferred) => {
  const pairs = nestedPairsFromNative?.length
    ? nestedPairsFromNative
    : [];
  // Also compute from shortlist if native didn't send pairs
  const computed = [];
  if (!pairs.length && cands.length >= 2) {
    for (let o = 0; o < cands.length; o++) {
      for (let i = 0; i < cands.length; i++) {
        if (o === i) continue;
        const outer = cands[o];
        const inner = cands[i];
        if ((outer.areaShare ?? 0) <= (inner.areaShare ?? 0)) continue;
        const af = (inner.areaShare ?? 0) / Math.max(outer.areaShare ?? 1e-9, 1e-9);
        if (af < 0.55 || af > 0.97) continue;
        const cO = centerOf(outer.corners);
        const cI = centerOf(inner.corners);
        const outerDiag = Math.hypot(
          outer.corners.topLeft.x - outer.corners.bottomRight.x,
          outer.corners.topLeft.y - outer.corners.bottomRight.y,
        );
        const centerDistNorm =
          Math.hypot(cO.x - cI.x, cO.y - cI.y) / Math.max(outerDiag, 1);
        if (centerDistNorm > 0.12) continue;
        const preferInner = inner.score >= 0.28 || inner.score >= outer.score * 0.75;
        computed.push({
          outerRank: outer.rank,
          innerRank: inner.rank,
          areaFraction: af,
          centerDistNorm,
          outerScore: outer.score,
          innerScore: inner.score,
          preferInnerGate: preferInner,
          aspectDiff: Math.abs((outer.aspectRatio ?? aspectOf(outer.corners)) - (inner.aspectRatio ?? aspectOf(inner.corners))),
        });
      }
    }
  }

  const all = pairs.length ? pairs : computed;
  let behavior = 'no-nested-pair';
  if (all.length) {
    const anyPrefer = all.some(p => p.preferInnerGate);
    if (nestedInnerPreferred) behavior = 'nested-inner-selected';
    else if (anyPrefer) behavior = 'nested-gate-pass-but-outer-or-other-selected';
    else behavior = 'nested-identified-inner-below-prefer-gate';
  }

  return {
    pairCount: all.length,
    pairs: all,
    nestedInnerPreferred: Boolean(nestedInnerPreferred),
    behavior,
  };
};

export const aggregateCandidateReport = analyses => {
  const singleCard = analyses.filter(a => (a.perGt?.length ?? 0) === 1);
  const multiCard = analyses.filter(a => (a.perGt?.length ?? 0) > 1);

  const topKBands = (key, band) => {
    let hit = 0;
    let n = 0;
    for (const a of singleCard) {
      const g = a.perGt[0];
      if (!g?.topHits?.[key]) continue;
      n += 1;
      if (g.topHits[key][band]) hit += 1;
    }
    return { hit, n, rate: n ? hit / n : null };
  };

  const topKSummary = {};
  for (const k of ['top1', 'top2', 'top3', 'top5', 'any']) {
    topKSummary[k] = {
      iou80: topKBands(k, 'hit80'),
      iou90: topKBands(k, 'hit90'),
      iou95: topKBands(k, 'hit95'),
    };
  }

  const failures = {};
  for (const v of Object.values(FAILURE)) failures[v] = 0;
  let failureN = 0;
  for (const a of singleCard) {
    const g = a.perGt[0];
    if (!g) continue;
    if (g.selectedIou >= MATCH_IOU) continue;
    failureN += 1;
    const cat = g.failureCategory || FAILURE.OTHER;
    failures[cat] = (failures[cat] || 0) + 1;
  }

  // Sleeve root-cause
  const sleeveCases = [];
  for (const a of analyses) {
    for (const g of a.perGt ?? []) {
      if (!g.sleeveAnalysis) continue;
      sleeveCases.push({
        id: a.id,
        ...g.sleeveAnalysis,
        bestCandidateRank: g.bestCandidateRank,
        bestCandidateIou: g.bestCandidateIou,
        nested: a.nested,
      });
    }
  }
  const sleeveWins = sleeveCases.filter(s => s.winner === 'SLEEVE');
  const cardWins = sleeveCases.filter(s => s.winner === 'CARD');
  const sleeveHadCard = sleeveWins.filter(s => s.goodCardInShortlist).length;
  const sleeveNoCard = sleeveWins.filter(s => !s.goodCardInShortlist).length;
  const cardRanks = sleeveWins
    .filter(s => s.goodCardInShortlist && s.cardRank != null)
    .map(s => s.cardRank)
    .sort((a, b) => a - b);
  // When sleeve wins but nested preferred inner: inner still closer to sleeve GT than card GT
  const sleeveWinsDespiteNestedInner = sleeveWins.filter(
    s => s.nested?.nestedInnerPreferred || s.nested?.behavior === 'nested-inner-selected',
  ).length;
  const margins = sleeveWins
    .map(s => s.components?.scoreMargin)
    .filter(m => m != null)
    .sort((a, b) => a - b);
  const selectedMargins = sleeveWins
    .map(s =>
      s.selectedVs ? s.selectedVs.iouSleeve - s.selectedVs.iouCard : null,
    )
    .filter(m => m != null)
    .sort((a, b) => a - b);
  const componentMeans = { aspect: 0, parallel: 0, area: 0, center: 0 };
  let compN = 0;
  for (const s of sleeveWins) {
    const d = s.components?.deltas;
    if (!d) continue;
    compN += 1;
    for (const k of Object.keys(componentMeans)) {
      componentMeans[k] += d[k] ?? 0;
    }
  }
  if (compN) {
    for (const k of Object.keys(componentMeans)) componentMeans[k] /= compN;
  }

  // Latent multi-card
  const latentRows = multiCard.map(a => ({
    id: a.id,
    suite: a.suite,
    gtCount: a.latent.gtCount,
    finalOne: a.detected ? 1 : 0,
    latent80: a.latent.matchedAt80,
    latent90: a.latent.matchedAt90,
    shortlist: a.latent.shortlistCount,
    raw: a.latent.rawCandidateCount,
    tags: a.tags,
  }));

  // Overlap / visibility
  const byVisibility = { full: { n: 0, hit80: 0 }, partial: { n: 0, hit80: 0 } };
  for (const a of analyses) {
    for (const g of a.perGt ?? []) {
      const key = g.occluded || (g.visibleFraction != null && g.visibleFraction < 0.99)
        ? 'partial'
        : 'full';
      byVisibility[key].n += 1;
      if (g.bestCandidateIou >= MATCH_IOU) byVisibility[key].hit80 += 1;
    }
  }

  const shortlistSizes = analyses.map(a => a.shortlistCount ?? 0).sort((a, b) => a - b);
  const rawCounts = analyses
    .map(a => a.rawCandidateCount)
    .filter(x => x != null)
    .sort((a, b) => a - b);
  const runtimes = analyses
    .map(a => a.runtimeMs)
    .filter(x => x != null)
    .sort((a, b) => a - b);

  const nestedBehaviors = {};
  for (const a of analyses) {
    const b = a.nested?.behavior || 'unknown';
    nestedBehaviors[b] = (nestedBehaviors[b] || 0) + 1;
  }

  return {
    fixtures: analyses.length,
    singleCard: singleCard.length,
    multiCard: multiCard.length,
    topKSummary,
    failures: { n: failureN, counts: failures },
    sleeve: {
      n: sleeveCases.length,
      choseCard: cardWins.length,
      choseSleeve: sleeveWins.length,
      choseOther: sleeveCases.filter(s => s.winner === 'OTHER').length,
      sleeveWinsWithGoodCardCandidate: sleeveHadCard,
      sleeveWinsWithoutGoodCardCandidate: sleeveNoCard,
      sleeveWinsDespiteNestedInner,
      medianCardRankWhenPresent: cardRanks.length
        ? cardRanks[Math.floor(cardRanks.length / 2)]
        : null,
      medianScoreMarginSleeveMinusCard: margins.length
        ? margins[Math.floor(margins.length / 2)]
        : null,
      medianSelectedIouSleeveMinusCard: selectedMargins.length
        ? selectedMargins[Math.floor(selectedMargins.length / 2)]
        : null,
      meanComponentDeltasSleeveMinusCard: compN ? componentMeans : null,
      nestedBehaviors,
    },
    latentMultiCard: {
      rows: latentRows,
      binder: summarizeLatent(latentRows.filter(r => (r.tags || []).includes('binder') || r.suite === 'binder')),
      overlap: summarizeLatent(latentRows.filter(r => (r.tags || []).includes('overlap') || r.suite === 'overlap')),
      scattered: summarizeLatent(
        latentRows.filter(r => (r.tags || []).includes('scattered') || r.suite === 'scattered'),
      ),
    },
    visibility: byVisibility,
    candidateCounts: {
      shortlist: {
        p50: percentile(shortlistSizes, 50),
        p95: percentile(shortlistSizes, 95),
        max: shortlistSizes.length ? shortlistSizes[shortlistSizes.length - 1] : null,
      },
      raw: {
        p50: percentile(rawCounts, 50),
        p95: percentile(rawCounts, 95),
        max: rawCounts.length ? rawCounts[rawCounts.length - 1] : null,
      },
    },
    runtimeHostMs: {
      p50: percentile(runtimes, 50),
      p95: percentile(runtimes, 95),
      max: runtimes.length ? runtimes[runtimes.length - 1] : null,
      note: 'HOST_JVM_NOT_DEVICE_LATENCY',
    },
    nestedBehaviors,
  };
};

const summarizeLatent = rows => {
  if (!rows.length) return null;
  const gt = rows.reduce((s, r) => s + r.gtCount, 0);
  const lat80 = rows.reduce((s, r) => s + r.latent80, 0);
  const final = rows.reduce((s, r) => s + r.finalOne, 0);
  return {
    scenes: rows.length,
    gtCards: gt,
    finalSelectedVsGt: `${final}/${gt}`,
    finalRecall: gt ? final / gt : null,
    latentRecall80: gt ? lat80 / gt : null,
    latentMatched80: lat80,
  };
};

export const formatPct = (rate, digits = 1) =>
  rate == null || Number.isNaN(rate) ? '—' : `${(rate * 100).toFixed(digits)}%`;
