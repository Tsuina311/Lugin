/** Shared geometry evaluation — same metrics for JS and native engines. */

import { loadDetectScan } from './detect-host.mjs';
import {
  aggregateMetrics,
  byTagBreakdown,
  matchQuadsByIoU,
  scoreCardPair,
} from './metrics.mjs';
import { fixtureTrustedEval, gtQuadToCorners, isCompleteQuad } from './schema.mjs';

export const evaluateDetections = async (fixtures, detectionsById, { detectMinScore = 0.28 } = {}) => {
  const { scan } = await loadDetectScan();
  const polygonIoU = scan.polygonIoU;
  const rows = [];
  const perFixture = [];

  for (const fixture of fixtures) {
    const det = detectionsById.get(fixture.id) ?? {
      detected: false,
      corners: null,
      score: 0,
      runtimeMs: null,
      failureReason: 'missing-detection',
    };
    const gts = (fixture.cards ?? [])
      .filter(c => isCompleteQuad(c.groundTruthQuad))
      .map(c => gtQuadToCorners(c.groundTruthQuad));
    const detected = Boolean(det.detected && det.corners && (det.score ?? 0) >= detectMinScore);

    if (fixture.negative) {
      const falseDet = detected ? 1 : 0;
      rows.push({
        id: fixture.id,
        tags: fixture.tags,
        detected,
        matched: false,
        falseDetections: falseDet,
        iou: 0,
        band: detected ? 'miss' : 'iou>=0.95',
        runtimeMs: det.runtimeMs,
        gtCards: 0,
        meanCornerError: null,
        maxCornerError: null,
      });
      perFixture.push({
        id: fixture.id,
        negative: true,
        detected,
        falseDetection: Boolean(falseDet),
        score: det.score,
        runtimeMs: det.runtimeMs,
        corners: det.corners,
        failureReason: det.failureReason,
      });
      continue;
    }

    const predictions = detected && det.corners ? [det.corners] : [];
    const matching = matchQuadsByIoU(predictions, gts, polygonIoU);
    const falseDetections = matching.unmatchedPredictions.length;

    if (!gts.length) {
      rows.push({
        id: fixture.id,
        tags: fixture.tags,
        detected,
        matched: false,
        falseDetections,
        iou: 0,
        band: 'miss',
        runtimeMs: det.runtimeMs,
        gtCards: 0,
      });
      continue;
    }

    for (let gi = 0; gi < gts.length; gi++) {
      const pair = matching.pairs.find(p => p.gi === gi);
      const pred = pair ? predictions[pair.pi] : null;
      const scored = scoreCardPair(pred, gts[gi], polygonIoU, {
        detectMinScore,
        score: det.score ?? 0,
      });
      rows.push({
        id: `${fixture.id}#${gi}`,
        fixtureId: fixture.id,
        tags: [...(fixture.tags ?? []), ...(fixture.cards?.[gi]?.tags ?? [])],
        detected: Boolean(pred),
        matched: Boolean(pair),
        falseDetections: gi === 0 ? falseDetections : 0,
        iou: scored.iou,
        meanCornerError: scored.meanCornerError,
        maxCornerError: scored.maxCornerError,
        aspectRatioError: scored.aspectRatioError,
        centerError: scored.centerError,
        band: pair ? scored.band : 'miss',
        runtimeMs: gi === 0 ? det.runtimeMs : null,
        gtCards: 1,
        score: det.score,
      });
    }

    perFixture.push({
      id: fixture.id,
      trusted: fixture.trusted,
      trustedEval: fixtureTrustedEval(fixture),
      source: fixture.source,
      tags: fixture.tags,
      score: det.score,
      method: det.method,
      runtimeMs: det.runtimeMs,
      corners: det.corners,
      detected,
      gtCards: gts.length,
      pairs: matching.pairs.map(p => ({ gi: p.gi, pi: p.pi, iou: p.iou })),
      unmatchedGt: matching.unmatchedGroundTruth,
      falseDetections,
      failureReason: det.failureReason,
      diagnostics: det.diagnostics ?? null,
      // Single-card detector vs multi-GT: which card was selected + best IoU
      selectedGtIndex: matching.pairs[0]?.gi ?? null,
      bestIoUAnyGt: matching.pairs.length
        ? Math.max(...matching.pairs.map(p => p.iou))
        : predictions.length && gts.length
          ? Math.max(...gts.map(g => polygonIoU(predictions[0], g)))
          : 0,
    });
  }

  const overall = aggregateMetrics(rows);
  const tagSet = new Set(rows.flatMap(r => r.tags ?? []));
  const byTag = byTagBreakdown(rows, [...tagSet].sort());
  return { rows, perFixture, overall, byTag };
};
