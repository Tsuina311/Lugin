/**
 * Temporal binder coverage metrics — GT evaluation only.
 */

import { matchQuadsByIoU } from '../metrics.mjs';
import { gtQuadToCorners, isCompleteQuad } from '../schema.mjs';
import { createMultiCardTracker } from './tracker.mjs';

export { createMultiCardTracker };

export const acquiredSlots = (tracks, frameGts, polygonIoU, { minIou = 0.8 } = {}) => {
  const gts = frameGts
    .map((c, i) => ({
      slot: c.slot ?? i,
      corners: isCompleteQuad(c.groundTruthQuad) ? gtQuadToCorners(c.groundTruthQuad) : null,
    }))
    .filter(g => g.corners);

  const usable = tracks.filter(t => t.best?.corners);
  const preds = usable.map(t => t.best.corners);
  const matching = matchQuadsByIoU(
    preds,
    gts.map(g => g.corners),
    polygonIoU,
  );
  const hitSlots = new Set();
  for (const p of matching.pairs) {
    if (p.iou >= minIou) hitSlots.add(gts[p.gi].slot);
  }
  return { hitSlots, hit: hitSlots.size, gt: gts.length, pairs: matching.pairs, gts, usable };
};

export const runTemporalAnalysis = ({
  fixtures,
  detectionsByFrameId,
  polygonIoU,
  candidateSource = 'raw',
  fps = 15,
  minIou = 0.8,
}) => {
  const tracker = createMultiCardTracker({ polygonIoU });
  const curve = [];
  const everSeen = new Set();
  const perFrameSingle = [];

  for (const f of fixtures) {
    const det = detectionsByFrameId.get(f.id);
    const pipe = det?.pipeline;
    const cands =
      candidateSource === 'shortlist'
        ? pipe?.shortlist || det?.candidates || []
        : pipe?.rawAfterQuad || pipe?.postDedupe || det?.candidates || [];

    const gts = (f.cards || [])
      .map(c => (isCompleteQuad(c.groundTruthQuad) ? gtQuadToCorners(c.groundTruthQuad) : null))
      .filter(Boolean);
    const preds = cands.map(c => c.quad || c.corners).filter(Boolean);
    const frameMatch = matchQuadsByIoU(preds, gts, polygonIoU);
    const frameHit = frameMatch.pairs.filter(p => p.iou >= minIou).length;
    perFrameSingle.push({
      frameIndex: f.frameIndex,
      hit: frameHit,
      gt: gts.length,
      recall: gts.length ? frameHit / gts.length : null,
    });

    tracker.step(f.frameIndex, cands);
    const tracks = tracker.getTracks();
    const acq = acquiredSlots(tracks, f.cards || [], polygonIoU, { minIou });
    for (const s of acq.hitSlots) everSeen.add(s);
    curve.push({
      frameIndex: f.frameIndex,
      timeSec: f.frameIndex / fps,
      acquired: everSeen.size,
      gt: 9,
      recall: everSeen.size / 9,
      activeTracks: tracks.filter(t => t.state !== 'lost').length,
      confirmed: tracks.filter(t => t.state === 'confirmed').length,
      frameSingleHit: frameHit,
    });
  }

  const tracks = tracker.getTracks();
  let bestGlobal = perFrameSingle[0] || { hit: 0, frameIndex: 0, gt: 9 };
  for (const row of perFrameSingle) {
    if (row.hit > bestGlobal.hit) bestGlobal = row;
  }

  const trackQuality = [];
  for (const t of tracks) {
    if (!t.observations.length) continue;
    let bestIou = 0;
    let firstIou = 0;
    let matchedSlot = null;
    for (let oi = 0; oi < t.observations.length; oi++) {
      const obs = t.observations[oi];
      const fix = fixtures.find(f => f.frameIndex === obs.frameIndex);
      if (!fix) continue;
      for (const c of fix.cards || []) {
        if (!isCompleteQuad(c.groundTruthQuad)) continue;
        const gt = gtQuadToCorners(c.groundTruthQuad);
        const iou = polygonIoU(obs.corners, gt);
        if (oi === 0) firstIou = Math.max(firstIou, iou);
        if (iou > bestIou) {
          bestIou = iou;
          matchedSlot = c.slot;
        }
      }
    }
    let bestStoredIou = 0;
    if (t.best) {
      const fix = fixtures.find(f => f.frameIndex === t.best.frameIndex);
      if (fix) {
        for (const c of fix.cards || []) {
          if (!isCompleteQuad(c.groundTruthQuad)) continue;
          bestStoredIou = Math.max(
            bestStoredIou,
            polygonIoU(t.best.corners, gtQuadToCorners(c.groundTruthQuad)),
          );
        }
      }
    }
    trackQuality.push({
      trackId: t.id,
      state: t.state,
      hits: t.hits,
      matchedSlot,
      firstIou,
      bestObsIou: bestIou,
      bestStoredIou,
      bestFrame: t.best?.frameIndex,
      scoreBest: t.best?.score,
      deltaBestMinusFirst: bestStoredIou - firstIou,
    });
  }

  const slotTracks = new Map();
  for (const tq of trackQuality) {
    if (tq.matchedSlot == null || tq.bestObsIou < minIou) continue;
    if (!slotTracks.has(tq.matchedSlot)) slotTracks.set(tq.matchedSlot, new Set());
    slotTracks.get(tq.matchedSlot).add(tq.trackId);
  }
  let fragmented = 0;
  let duplicates = 0;
  for (const [, set] of slotTracks) {
    if (set.size > 1) {
      fragmented += 1;
      duplicates += set.size - 1;
    }
  }

  const neverSeen = [];
  for (let slot = 0; slot < 9; slot++) {
    if (everSeen.has(slot)) continue;
    let everCand = false;
    let glareAlways = true;
    for (const f of fixtures) {
      const card = (f.cards || []).find(c => c.slot === slot);
      if (card && !card.glareHit && !card.occluded) glareAlways = false;
      const det = detectionsByFrameId.get(f.id);
      const cands =
        candidateSource === 'shortlist'
          ? det?.pipeline?.shortlist || []
          : det?.pipeline?.rawAfterQuad || [];
      if (!card || !isCompleteQuad(card.groundTruthQuad)) continue;
      const gt = gtQuadToCorners(card.groundTruthQuad);
      for (const c of cands) {
        const q = c.quad || c.corners;
        if (q && polygonIoU(q, gt) >= minIou) everCand = true;
      }
    }
    neverSeen.push({
      slot,
      reason: !everCand
        ? glareAlways
          ? 'no-raw-candidate-static-glare-likely'
          : 'no-raw-candidate-ever'
        : 'candidate-existed-tracker-missed',
      everCand,
    });
  }

  const completionFrame = curve.find(c => c.acquired >= 9)?.frameIndex ?? null;

  return {
    candidateSource,
    curve,
    perFrameSingle,
    bestGlobalFrame: bestGlobal,
    firstFrameRecall: perFrameSingle[0]?.recall ?? null,
    bestSingleFrameRecall: bestGlobal.gt ? bestGlobal.hit / bestGlobal.gt : null,
    eventualRecall: everSeen.size / 9,
    eventualAcquired: everSeen.size,
    completionFrame,
    completionTimeSec: completionFrame != null ? completionFrame / fps : null,
    tracks: tracks.map(t => ({
      id: t.id,
      state: t.state,
      hits: t.hits,
      bornFrame: t.bornFrame,
      bestFrame: t.best?.frameIndex,
      bestScore: t.best?.score,
      bestCorners: t.best?.corners,
    })),
    trackQuality,
    tracking: {
      trackCount: tracks.length,
      fragmentedSlots: fragmented,
      duplicateExtraTracks: duplicates,
      falseTracks: trackQuality.filter(t => t.bestObsIou < minIou).length,
      identitySwitches: fragmented,
    },
    neverSeen,
    events: tracker.getEvents(),
  };
};

const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
};

export const aggregateTemporalReports = (reports, fps = 15) => {
  const eventual = reports.map(r => r.eventualRecall);
  const first = reports.map(r => r.firstFrameRecall).filter(x => x != null);
  const bestSingle = reports.map(r => r.bestSingleFrameRecall).filter(x => x != null);
  const completionTimes = reports.map(r => r.completionTimeSec).filter(x => x != null);
  const maxFrames = Math.max(0, ...reports.map(r => r.curve.length));
  const meanCurve = [];
  for (let i = 0; i < maxFrames; i++) {
    const vals = reports.map(r => r.curve[i]?.recall).filter(x => x != null);
    meanCurve.push({
      frameIndex: i,
      timeSec: i / fps,
      meanRecall: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      n: vals.length,
    });
  }
  return {
    n: reports.length,
    meanFirstFrame: first.length ? first.reduce((a, b) => a + b, 0) / first.length : null,
    meanBestSingleFrame: bestSingle.length
      ? bestSingle.reduce((a, b) => a + b, 0) / bestSingle.length
      : null,
    meanEventual: eventual.length ? eventual.reduce((a, b) => a + b, 0) / eventual.length : null,
    p50CompletionSec: percentile(completionTimes, 50),
    p90CompletionSec: percentile(completionTimes, 90),
    completedPages: completionTimes.length,
    meanCurve,
  };
};
