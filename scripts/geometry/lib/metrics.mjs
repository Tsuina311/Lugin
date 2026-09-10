/** Geometry metrics + multi-card assignment. */

export const bandForIoU = iou => {
  if (iou >= 0.95) return 'iou>=0.95';
  if (iou >= 0.9) return 'iou>=0.90';
  if (iou >= 0.8) return 'iou>=0.80';
  return 'miss';
};

export const cornerErrors = (pred, gt) => {
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  const errs = keys.map(k => Math.hypot(pred[k].x - gt[k].x, pred[k].y - gt[k].y));
  return {
    mean: errs.reduce((a, b) => a + b, 0) / 4,
    max: Math.max(...errs),
    perCorner: Object.fromEntries(keys.map((k, i) => [k, errs[i]])),
  };
};

export const centerOf = corners => {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / 4,
    y: pts.reduce((s, p) => s + p.y, 0) / 4,
  };
};

export const aspectOf = corners => {
  const w =
    (Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y) +
      Math.hypot(
        corners.bottomRight.x - corners.bottomLeft.x,
        corners.bottomRight.y - corners.bottomLeft.y,
      )) /
    2;
  const h =
    (Math.hypot(
      corners.bottomLeft.x - corners.topLeft.x,
      corners.bottomLeft.y - corners.topLeft.y,
    ) +
      Math.hypot(
        corners.bottomRight.x - corners.topRight.x,
        corners.bottomRight.y - corners.topRight.y,
      )) /
    2;
  return h > 1e-6 ? w / h : 0;
};

export const aspectRatioError = (pred, gt) => Math.abs(aspectOf(pred) - aspectOf(gt));

export const centerError = (pred, gt) => {
  const a = centerOf(pred);
  const b = centerOf(gt);
  return Math.hypot(a.x - b.x, a.y - b.y);
};

/**
 * Greedy max-IoU matching of predictions to ground-truth cards.
 * Returns pairs + unmatched preds/gts.
 */
export const matchQuadsByIoU = (predictions, groundTruths, polygonIoU) => {
  const pairs = [];
  const usedP = new Set();
  const usedG = new Set();
  const scores = [];
  for (let gi = 0; gi < groundTruths.length; gi++) {
    for (let pi = 0; pi < predictions.length; pi++) {
      const iou = polygonIoU(predictions[pi], groundTruths[gi]);
      scores.push({ gi, pi, iou });
    }
  }
  scores.sort((a, b) => b.iou - a.iou);
  for (const s of scores) {
    if (usedP.has(s.pi) || usedG.has(s.gi)) continue;
    if (s.iou <= 0) continue;
    usedP.add(s.pi);
    usedG.add(s.gi);
    pairs.push(s);
  }
  return {
    pairs,
    unmatchedPredictions: predictions.map((_, i) => i).filter(i => !usedP.has(i)),
    unmatchedGroundTruth: groundTruths.map((_, i) => i).filter(i => !usedG.has(i)),
  };
};

export const scoreCardPair = (pred, gt, polygonIoU, { detectMinScore = 0.28, score = 0 } = {}) => {
  const detected = Boolean(pred) && score >= detectMinScore;
  if (!detected || !gt) {
    return {
      detected: Boolean(pred) && score >= detectMinScore,
      iou: 0,
      meanCornerError: null,
      maxCornerError: null,
      aspectRatioError: null,
      centerError: null,
      band: 'miss',
      score,
    };
  }
  const iou = polygonIoU(pred, gt);
  const ce = cornerErrors(pred, gt);
  return {
    detected: true,
    iou,
    meanCornerError: ce.mean,
    maxCornerError: ce.max,
    aspectRatioError: aspectRatioError(pred, gt),
    centerError: centerError(pred, gt),
    band: bandForIoU(iou),
    score,
  };
};

const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
};

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = xs => percentile(xs, 50);

export const aggregateMetrics = rows => {
  const gtCount = rows.reduce((n, r) => n + (r.gtCards ?? 1), 0) || rows.length;
  const detectedCards = rows.filter(r => r.detected && r.matched).length;
  const falseDetections = rows.reduce((n, r) => n + (r.falseDetections ?? 0), 0);
  const ious = rows.filter(r => r.matched).map(r => r.iou);
  const meanCorners = rows.filter(r => r.matched && r.meanCornerError != null).map(r => r.meanCornerError);
  const maxCorners = rows.filter(r => r.matched && r.maxCornerError != null).map(r => r.maxCornerError);
  const runtimes = rows.map(r => r.runtimeMs).filter(n => n != null);
  const band = {
    'iou>=0.95': rows.filter(r => r.band === 'iou>=0.95').length,
    'iou>=0.90': rows.filter(r => r.band === 'iou>=0.90' || r.band === 'iou>=0.95').length,
    'iou>=0.80': rows.filter(r =>
      ['iou>=0.80', 'iou>=0.90', 'iou>=0.95'].includes(r.band),
    ).length,
    miss: rows.filter(r => r.band === 'miss' || !r.matched).length,
  };
  const precisionDenom = detectedCards + falseDetections;
  return {
    fixtures: rows.length,
    groundTruthCards: gtCount,
    recall: gtCount ? detectedCards / gtCount : null,
    precision: precisionDenom ? detectedCards / precisionDenom : null,
    meanIoU: mean(ious),
    medianIoU: median(ious),
    p10IoU: percentile(ious, 10),
    meanCornerError: mean(meanCorners),
    p95CornerError: percentile(maxCorners, 95),
    bands: {
      'iou>=0.95': gtCount ? band['iou>=0.95'] / gtCount : null,
      'iou>=0.90': gtCount ? band['iou>=0.90'] / gtCount : null,
      'iou>=0.80': gtCount ? band['iou>=0.80'] / gtCount : null,
      miss: gtCount ? band.miss / gtCount : null,
    },
    falseDetections,
    runtime: {
      meanMs: mean(runtimes),
      medianMs: median(runtimes),
      p95Ms: percentile(runtimes, 95),
    },
  };
};

export const byTagBreakdown = (rows, tagList) => {
  const out = {};
  for (const tag of tagList) {
    const subset = rows.filter(r => (r.tags ?? []).includes(tag));
    if (!subset.length) continue;
    out[tag] = aggregateMetrics(subset);
  }
  return out;
};

export const deltaPct = (cur, base) => {
  if (cur == null || base == null) return null;
  return (cur - base) * 100;
};

export const formatPct = x => (x == null || Number.isNaN(x) ? '—' : `${(100 * x).toFixed(1)}%`);
export const formatNum = (x, digits = 3) =>
  x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(digits);
export const formatDelta = (cur, base, asPct = true) => {
  if (cur == null || base == null) return '';
  const d = asPct ? (cur - base) * 100 : cur - base;
  const sign = d >= 0 ? '+' : '';
  return asPct ? `(${sign}${d.toFixed(1)})` : `(${sign}${d.toFixed(2)})`;
};
