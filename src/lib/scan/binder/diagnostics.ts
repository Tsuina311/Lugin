/**
 * Binder diagnostic session metadata — portable (no RN / FS).
 * Recognition is NOT part of this layer.
 */

import {
  BINDER_IDENTIFICATION_READY_MIN,
  BINDER_SHARPNESS_SOFT,
  type BinderBestCapture,
  type BinderPageSession,
  type BinderQualityHistoryEntry,
  type BinderTrack,
  type BinderTrackPhase,
} from './types';
import { BINDER_POLICY } from './policy';

export type BinderUnresolvedReason =
  | 'LOW_SHARPNESS'
  | 'GLARE'
  | 'BAD_GEOMETRY'
  | 'OOB'
  | 'INSUFFICIENT_FRAMES'
  | 'TRACK_LOST'
  | 'OTHER';

export type BinderReadyDecision = {
  readyDecision: boolean;
  qualityScore: number;
  qualityThreshold: number;
  sharpness: number;
  sharpnessThreshold: number;
  glarePass: boolean;
  glareScore: number;
  geometryReady: boolean;
  captureSafe: boolean;
};

export type BinderTrackDiagMeta = {
  binderTrackId: number;
  gridSlot: number | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  ageFrames: number;
  phase: BinderTrackPhase;
  acquired: boolean;
  currentQuad: BinderTrack['currentQuad'];
  bestQuad: BinderTrack['currentQuad'] | null;
  bestCaptureId: number | null;
  bestSourceFrameId: number | null;
  bestQualityScore: number | null;
  bestSharpness: number | null;
  bestGlareScore: number | null;
  bestGeometryScore: number | null;
  identificationReady: boolean;
  identificationReadyAt: number | null;
  qualityReasons: string[];
  qualityFailures: BinderUnresolvedReason[];
  readyDecision: BinderReadyDecision | null;
  qualityHistory: BinderQualityHistoryEntry[];
  bestCardFile: string | null;
  artifactOk: boolean | null;
};

export type BinderSnapshotDiagMeta = {
  snapshotId: number;
  sourceFrameId: number;
  pageIndex: number;
  capturedAt: number;
  width: number;
  height: number;
  file: string;
  bytes: number | null;
  candidateCount: number;
  candidates: { score: number; corners: BinderTrack['currentQuad'] }[];
};

export type BinderPageDiagMeta = {
  pageIndex: number;
  pageSessionId: string;
  startedAt: number;
  completedAt: number | null;
  status: 'IN_PROGRESS' | 'DONE' | 'INCOMPLETE';
  gridRows: number;
  gridCols: number;
  snapshotsRequested: number;
  snapshotsCompleted: number;
  trackCount: number;
  acquiredTrackCount: number;
  unresolvedTrackCount: number;
  firstCandidateAt: number | null;
  firstTrackAt: number | null;
  firstAcquiredAt: number | null;
  halfAcquiredAt: number | null;
  pageDoneAt: number | null;
  policy: typeof BINDER_POLICY;
  snapshots: BinderSnapshotDiagMeta[];
  tracks: BinderTrackDiagMeta[];
};

export type BinderSessionDiagBundle = {
  kind: 'binder';
  fixtureId: string;
  createdAt: string;
  completedAt: string | null;
  pages: BinderPageDiagMeta[];
  uploadStatus?: 'PENDING' | 'INCOMPLETE' | 'COMPLETE';
  missingFiles?: string[];
  uploadManifest?: {
    expectedFiles: string[];
    uploadedFiles: string[];
    missingFiles: string[];
  };
};

export const binderDiagFrameFile = (pageIndex: number, frameIndex: number) =>
  `p${String(pageIndex + 1).padStart(2, '0')}-f${String(frameIndex).padStart(3, '0')}.png`;

export const binderDiagPageMetaFile = (pageIndex: number) =>
  `p${String(pageIndex + 1).padStart(2, '0')}-metadata.json`;

export const binderDiagTracksFile = (pageIndex: number) =>
  `p${String(pageIndex + 1).padStart(2, '0')}-tracks.json`;

/** Track file index is 1-based ordinal within the page export, not binderTrackId. */
export const binderDiagCardFile = (pageIndex: number, trackOrdinal: number) =>
  `p${String(pageIndex + 1).padStart(2, '0')}-t${String(trackOrdinal).padStart(2, '0')}-card.png`;

export const makeBinderSessionId = (d = new Date()): string => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `binder-session-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export const classifyUnresolvedReasons = (
  track: Pick<BinderTrack, 'acquired' | 'phase' | 'ageFrames' | 'best'>,
): BinderUnresolvedReason[] => {
  if (track.acquired) return [];
  if (track.phase === 'lost') return ['TRACK_LOST'];
  const reasons: BinderUnresolvedReason[] = [];
  const q = track.best?.quality;
  if (!track.best) {
    if (track.ageFrames < 2) reasons.push('INSUFFICIENT_FRAMES');
    else reasons.push('OTHER');
    return reasons;
  }
  const rs = q?.reasons ?? [];
  if (rs.some(r => r.includes('soft') || r.includes('not-sharp'))) reasons.push('LOW_SHARPNESS');
  if (rs.some(r => r.includes('glare'))) reasons.push('GLARE');
  if (rs.some(r => r.includes('out_of_frame'))) reasons.push('OOB');
  if (rs.some(r => r.includes('geom:') || r.includes('extreme') || r.includes('too_'))) {
    reasons.push('BAD_GEOMETRY');
  }
  if (!reasons.length) reasons.push('OTHER');
  return reasons;
};

export const readyDecisionFromBest = (
  best: BinderBestCapture | null,
): BinderReadyDecision | null => {
  if (!best) return null;
  const glareScore = best.quality.components.glare;
  return {
    readyDecision: best.quality.identificationReady,
    qualityScore: best.quality.score,
    qualityThreshold: BINDER_IDENTIFICATION_READY_MIN,
    sharpness: best.sharpness,
    sharpnessThreshold: BINDER_SHARPNESS_SOFT,
    glarePass: glareScore >= 0.45,
    glareScore,
    geometryReady: best.quality.components.geometry >= 1,
    captureSafe: best.quality.components.captureSafe >= 1,
  };
};

export const trackDiagFromLive = (
  track: BinderTrack & {
    qualityHistory?: BinderQualityHistoryEntry[];
    identificationReadyAt?: number | null;
    firstSeenAt?: number | null;
  },
  opts: { trackOrdinal: number; pageIndex: number; artifactOk: boolean | null },
): BinderTrackDiagMeta => {
  const best = track.best;
  const history = track.qualityHistory ?? [];
  return {
    binderTrackId: track.binderTrackId,
    gridSlot: track.gridSlot,
    firstSeenAt: track.firstSeenAt ?? null,
    lastSeenAt: track.lastSeenAt,
    ageFrames: track.ageFrames,
    phase: track.phase,
    acquired: track.acquired,
    currentQuad: track.currentQuad,
    bestQuad: best?.quad ?? null,
    bestCaptureId: best?.captureId ?? null,
    bestSourceFrameId: best?.sourceFrameId ?? null,
    bestQualityScore: best?.quality.score ?? null,
    bestSharpness: best?.sharpness ?? null,
    bestGlareScore: best?.quality.components.glare ?? null,
    bestGeometryScore: best?.quality.components.geometry ?? null,
    identificationReady: best?.quality.identificationReady === true || track.acquired,
    identificationReadyAt: track.identificationReadyAt ?? null,
    qualityReasons: best?.quality.reasons ?? [],
    qualityFailures: classifyUnresolvedReasons(track),
    readyDecision: readyDecisionFromBest(best),
    qualityHistory: history,
    bestCardFile: best ? binderDiagCardFile(opts.pageIndex, opts.trackOrdinal) : null,
    artifactOk: opts.artifactOk,
  };
};

export const pageTimingsFromTracks = (
  session: BinderPageSession,
  snapshots: { capturedAt: number }[],
  completedAt: number | null,
): Pick<
  BinderPageDiagMeta,
  | 'firstCandidateAt'
  | 'firstTrackAt'
  | 'firstAcquiredAt'
  | 'halfAcquiredAt'
  | 'pageDoneAt'
> => {
  const firstCandidateAt = snapshots[0]?.capturedAt ?? null;
  const firstTrackAt = session.tracks.length
    ? Math.min(...session.tracks.map(t => t.lastSeenAt - (t.ageFrames > 0 ? 0 : 0)))
    : null;
  // Prefer earliest identificationReadyAt when present.
  const readyAts = session.tracks
    .map(t => (t as { identificationReadyAt?: number | null }).identificationReadyAt)
    .filter((n): n is number => typeof n === 'number');
  const firstAcquiredAt = readyAts.length ? Math.min(...readyAts) : null;
  const acquired = session.tracks.filter(t => t.acquired);
  let halfAcquiredAt: number | null = null;
  if (acquired.length >= Math.ceil(Math.max(1, session.tracks.filter(t => t.phase !== 'lost').length) / 2)) {
    halfAcquiredAt = firstAcquiredAt;
  }
  return {
    firstCandidateAt,
    firstTrackAt: firstTrackAt ?? session.startedAt,
    firstAcquiredAt,
    halfAcquiredAt,
    pageDoneAt: completedAt,
  };
};
