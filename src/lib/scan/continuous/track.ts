/**
 * Continuous card track — accumulate evidence, publish with ownership.
 * Old-track async results must not publish after a newer track starts.
 */

import { cosineSimilarity } from './cardChange';
import { fuseContinuousEvidence } from './fusion';
import type {
  ContinuousCardTrack,
  ContinuousIdentity,
  ContinuousOcrObservation,
  ContinuousSession,
  ContinuousVisualObservation,
  PublishSource,
} from './types';

export type TryPublishResult = {
  track: ContinuousCardTrack;
  published: boolean;
  source: PublishSource | null;
  reason: string;
  /** False when generation no longer owns the session. */
  owned: boolean;
};

export const createTrack = (args: {
  trackId: number;
  at?: number;
  generation?: number;
}): ContinuousCardTrack => ({
  trackId: args.trackId,
  startedAt: args.at ?? performance.now(),
  attemptCount: 0,
  visualObservations: [],
  ocrObservations: [],
  bestCandidate: null,
  confidence: 0,
  publishedIdentity: null,
  publishedAt: null,
  lastEmbeddingSimilarity: null,
  locked: false,
  generation: args.generation ?? args.trackId,
});

export const emptyContinuousSession = (now = performance.now()): ContinuousSession => {
  void now;
  return {
    phase: 'NO_CARD',
    activeTrack: null,
    nextTrackId: 1,
    recentIdentities: [],
    missFrames: 0,
  };
};

/** Begin a new track; bumps generation so prior async work cannot publish. */
export const startNewTrack = (
  session: ContinuousSession,
  at = performance.now(),
): ContinuousSession => {
  const trackId = session.nextTrackId;
  const track = createTrack({ trackId, at, generation: trackId });
  return {
    ...session,
    phase: 'CANDIDATE',
    activeTrack: track,
    nextTrackId: trackId + 1,
    missFrames: 0,
  };
};

export const appendVisualObservation = (
  track: ContinuousCardTrack,
  obs: ContinuousVisualObservation,
): ContinuousCardTrack => {
  if (track.locked && track.publishedIdentity) return track;
  const visualObservations = [...track.visualObservations, obs].slice(-8);
  const best =
    !track.bestCandidate || obs.score >= track.confidence
      ? { name: obs.name, oracleId: obs.oracleId }
      : track.bestCandidate;
  const confidence = Math.max(track.confidence, obs.score);
  let lastEmbeddingSimilarity = track.lastEmbeddingSimilarity;
  const prevEmb = [...track.visualObservations].reverse().find(v => v.embedding)?.embedding;
  if (prevEmb && obs.embedding) {
    lastEmbeddingSimilarity = cosineSimilarity(prevEmb, obs.embedding);
  }
  return {
    ...track,
    attemptCount: track.attemptCount + 1,
    visualObservations,
    bestCandidate: best,
    confidence,
    lastEmbeddingSimilarity,
  };
};

export const appendOcrObservation = (
  track: ContinuousCardTrack,
  obs: ContinuousOcrObservation,
): ContinuousCardTrack => {
  if (track.locked && track.publishedIdentity) return track;
  const ocrObservations = [...track.ocrObservations, obs].slice(-8);
  const best =
    !track.bestCandidate || obs.score >= track.confidence
      ? { name: obs.name, oracleId: obs.oracleId }
      : track.bestCandidate;
  return {
    ...track,
    attemptCount: track.attemptCount + 1,
    ocrObservations,
    bestCandidate: best,
    confidence: Math.max(track.confidence, obs.score),
  };
};

/**
 * Attempt to publish from latest evidence.
 * `ownerGeneration` must match `track.generation` (session active owner).
 */
export const tryPublish = (
  track: ContinuousCardTrack,
  ownerGeneration: number,
  at = performance.now(),
): TryPublishResult => {
  if (track.generation !== ownerGeneration) {
    return {
      track,
      published: false,
      source: null,
      reason: 'stale_ownership',
      owned: false,
    };
  }
  if (track.locked && track.publishedIdentity) {
    return {
      track,
      published: false,
      source: null,
      reason: 'already_locked',
      owned: true,
    };
  }

  const visual = [...track.visualObservations].reverse()[0] ?? null;
  const ocr = [...track.ocrObservations].reverse()[0] ?? null;
  const fused = fuseContinuousEvidence({
    visual: visual
      ? {
          name: visual.name,
          oracleId: visual.oracleId,
          score: visual.score,
          margin: visual.margin,
        }
      : null,
    ocr: ocr
      ? {
          name: ocr.name,
          oracleId: ocr.oracleId,
          score: ocr.score,
          exact: ocr.exact,
        }
      : null,
  });

  if (!fused.publish || !fused.identity) {
    return {
      track,
      published: false,
      source: null,
      reason: fused.reason,
      owned: true,
    };
  }

  const next: ContinuousCardTrack = {
    ...track,
    bestCandidate: fused.identity,
    confidence: fused.confidence,
    publishedIdentity: fused.identity,
    publishedAt: at,
    locked: true,
  };
  return {
    track: next,
    published: true,
    source: fused.source,
    reason: fused.reason,
    owned: true,
  };
};

export const lockIdentity = (
  track: ContinuousCardTrack,
  identity: ContinuousIdentity,
  at = performance.now(),
): ContinuousCardTrack => ({
  ...track,
  bestCandidate: identity,
  publishedIdentity: identity,
  publishedAt: at,
  locked: true,
  confidence: Math.max(track.confidence, 1),
});

export const unlockForChange = (track: ContinuousCardTrack): ContinuousCardTrack => ({
  ...track,
  locked: false,
  publishedIdentity: null,
  publishedAt: null,
  // Invalidate in-flight async for this track id by bumping generation.
  generation: track.generation + 1,
});

/** Apply a successful publish into the session (recent strip, phase). */
export const applyPublishToSession = (
  session: ContinuousSession,
  published: ContinuousCardTrack,
  maxRecent = 5,
): ContinuousSession => {
  if (!published.publishedIdentity) return session;
  const recent = [
    ...session.recentIdentities.filter(
      r =>
        !(
          r.oracleId &&
          published.publishedIdentity?.oracleId &&
          r.oracleId === published.publishedIdentity.oracleId
        ) && r.name !== published.publishedIdentity?.name,
    ),
    published.publishedIdentity,
  ].slice(-maxRecent);
  return {
    ...session,
    phase: 'IDENTITY_LOCKED',
    activeTrack: published,
    recentIdentities: recent,
    missFrames: 0,
  };
};

/**
 * Ownership helper: only the session's active generation may publish.
 */
export const activeOwnerGeneration = (session: ContinuousSession): number | null =>
  session.activeTrack?.generation ?? null;
