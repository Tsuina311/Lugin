/**
 * Binder per-card spatial tracking — IoU + center proximity association.
 */

import { polygonIoU } from '../detectCard';
import { cornersToQuad, dist } from '../geometry';
import type { CardCorners } from '../types';
import {
  BINDER_TRACK_CENTER_MATCH_NORM,
  BINDER_TRACK_IOU_MATCH,
  BINDER_TRACK_LOST_FRAMES,
  qualityHistoryEntry,
  type BinderBestCapture,
  type BinderPageSession,
  type BinderTrack,
  type BinderTrackPhase,
} from './types';

const center = (c: CardCorners) => {
  const q = cornersToQuad(c);
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
};

const frameDiag = (frame: { width: number; height: number }): number =>
  Math.hypot(frame.width, frame.height);

export const matchObservationToTrack = (
  tracks: readonly BinderTrack[],
  corners: CardCorners,
  frame: { width: number; height: number },
): number | null => {
  let bestIdx: number | null = null;
  let bestScore = 0;
  const obs = center(corners);
  const diag = Math.max(1, frameDiag(frame));
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.phase === 'lost') continue;
    const iou = polygonIoU(t.currentQuad, corners);
    const tc = center(t.currentQuad);
    const centerNorm = dist(obs, tc) / diag;
    const score =
      iou * 0.7 + (centerNorm < BINDER_TRACK_CENTER_MATCH_NORM ? 0.3 * (1 - centerNorm / BINDER_TRACK_CENTER_MATCH_NORM) : 0);
    if (iou >= BINDER_TRACK_IOU_MATCH || centerNorm < BINDER_TRACK_CENTER_MATCH_NORM) {
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
};

const phaseFor = (t: BinderTrack): BinderTrackPhase => {
  if (t.acquired) return 'acquired';
  if (t.missFrames >= BINDER_TRACK_LOST_FRAMES) return 'lost';
  if (t.best && t.best.quality.identificationReady) return 'capture_ready';
  if (t.ageFrames >= 2) return 'tracking';
  return 'detected';
};

export const tickBinderTracks = (
  session: BinderPageSession,
  observations: readonly { corners: CardCorners; score: number }[],
  now: number,
  frame: { width: number; height: number },
): BinderPageSession => {
  const tracks = session.tracks.map(t => ({ ...t }));
  const claimed = new Set<number>();

  for (const obs of observations) {
    let idx = matchObservationToTrack(
      tracks.filter((_, i) => !claimed.has(i)),
      obs.corners,
      frame,
    );
    // Remap idx through filtered list — redo on full list excluding claimed.
    idx = null;
    let bestScore = 0;
    const obsC = center(obs.corners);
    const diag = Math.max(1, frameDiag(frame));
    for (let i = 0; i < tracks.length; i++) {
      if (claimed.has(i)) continue;
      const t = tracks[i];
      if (t.phase === 'lost') continue;
      const iou = polygonIoU(t.currentQuad, obs.corners);
      const centerNorm = dist(obsC, center(t.currentQuad)) / diag;
      if (iou < BINDER_TRACK_IOU_MATCH && centerNorm >= BINDER_TRACK_CENTER_MATCH_NORM) continue;
      const score =
        iou * 0.7 +
        (centerNorm < BINDER_TRACK_CENTER_MATCH_NORM
          ? 0.3 * (1 - centerNorm / BINDER_TRACK_CENTER_MATCH_NORM)
          : 0);
      if (score > bestScore) {
        bestScore = score;
        idx = i;
      }
    }

    if (idx == null) {
      const id = session.nextTrackId;
      tracks.push({
        binderTrackId: id,
        phase: 'detected',
        currentQuad: obs.corners,
        lastSeenAt: now,
        ageFrames: 1,
        missFrames: 0,
        confidence: obs.score,
        gridSlot: null,
        best: null,
        acquired: false,
        firstSeenAt: now,
        identificationReadyAt: null,
        qualityHistory: [],
      });
      claimed.add(tracks.length - 1);
      session = { ...session, nextTrackId: id + 1 };
      continue;
    }

    const t = tracks[idx];
    claimed.add(idx);
    tracks[idx] = {
      ...t,
      currentQuad: obs.corners,
      lastSeenAt: now,
      ageFrames: t.ageFrames + 1,
      missFrames: 0,
      confidence: Math.max(t.confidence * 0.7, obs.score),
      phase: t.acquired ? 'acquired' : t.ageFrames + 1 >= 2 ? 'tracking' : 'detected',
    };
  }

  for (let i = 0; i < tracks.length; i++) {
    if (claimed.has(i)) continue;
    const t = tracks[i];
    const miss = t.missFrames + 1;
    tracks[i] = {
      ...t,
      missFrames: miss,
      phase: t.acquired
        ? 'acquired'
        : miss >= BINDER_TRACK_LOST_FRAMES
          ? 'lost'
          : t.phase,
    };
  }

  // Drop long-lost non-acquired tracks to avoid clutter.
  const pruned = tracks.filter(t => !(t.phase === 'lost' && !t.acquired && t.missFrames > BINDER_TRACK_LOST_FRAMES * 2));

  return { ...session, tracks: pruned.map(t => ({ ...t, phase: phaseFor(t) })) };
};

/** Replace best capture when quality improves; never downgrade acquired. */
export const applyBestCapture = (
  session: BinderPageSession,
  binderTrackId: number,
  capture: BinderBestCapture,
): BinderPageSession => {
  const tracks = session.tracks.map(t => {
    if (t.binderTrackId !== binderTrackId) return t;
    const better =
      !t.best ||
      capture.quality.score > t.best.quality.score + 0.02 ||
      (capture.quality.identificationReady && !t.best.quality.identificationReady);
    if (!better) {
      return t;
    }
    const wasReady = t.acquired || t.best?.quality.identificationReady === true;
    const acquired = t.acquired || capture.quality.identificationReady;
    const becameReady = !wasReady && capture.quality.identificationReady;
    const history = [
      ...(t.qualityHistory ?? []),
      qualityHistoryEntry({
        timestamp: capture.capturedAt,
        capture,
        becameBest: true,
        becameReady,
      }),
    ].slice(-24);
    return {
      ...t,
      best: capture,
      acquired,
      phase: acquired ? ('acquired' as const) : t.phase,
      identificationReadyAt:
        becameReady
          ? capture.capturedAt
          : t.identificationReadyAt ?? (acquired ? capture.capturedAt : null),
      qualityHistory: history,
    };
  });
  return { ...session, tracks };
};

export const binderOverlays = (session: BinderPageSession) =>
  session.tracks
    .filter(t => t.phase !== 'lost')
    .map(t => ({
      binderTrackId: t.binderTrackId,
      quad: t.currentQuad,
      phase: t.phase,
      acquired: t.acquired,
      qualityScore: t.best?.quality.score ?? null,
      gridSlot: t.gridSlot,
    }));

export const binderPageHud = (session: BinderPageSession) => {
  const active = session.tracks.filter(t => t.phase !== 'lost');
  const acquired = active.filter(t => t.acquired);
  const pending = active.filter(t => !t.acquired);
  const expected = session.gridRows * session.gridCols;
  const pageReady = active.length > 0 && pending.length === 0;
  let hint = '';
  if (pending.length > 0) hint = 'MOVE PHONE SLIGHTLY';
  else if (pageReady) hint = 'PAGE READY';
  else hint = 'POINT AT BINDER PAGE';
  return {
    acquiredCount: acquired.length,
    trackedCount: active.length,
    expectedSlots: expected,
    hint,
    pageReady,
  };
};

export const nextBinderPage = (
  session: BinderPageSession,
  now = performance.now(),
): BinderPageSession => ({
  pageId: `binder-page-${session.pageIndex + 1}-${Math.round(now)}`,
  pageIndex: session.pageIndex + 1,
  startedAt: now,
  tracks: [],
  nextTrackId: 1,
  nextCaptureId: 1,
  nextSourceFrameId: 1,
  lastPageSnapshotAt: null,
  gridRows: session.gridRows,
  gridCols: session.gridCols,
});
