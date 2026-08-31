// Continuous scan session state machine (portable — no React / DOM).

import { describeArtwork, descriptorSimilarity } from '../artwork/descriptors';
import {
  DETECT_MIN_SCORE,
  GONE_FRAMES,
  QUALITY_MIN_SCORE,
  QUALITY_POOL_SIZE,
  REPLACE_VISUAL_DELTA,
} from '../params';
import { prepareCard, type PreparedCard } from '../prepareCard';
import { frameQualityScore, pushQualityPool, type FrameQuality } from '../quality';
import type { FusedResult } from '../ranking/fuse';
import { profileForCard } from '../regions';
import { emptyTemporal, type TemporalState } from '../temporal/consensus';
import {
  emptyTrack,
  geometryChanged,
  latestCorners,
  pushTrack,
  sampleFromQuad,
  type TrackState,
} from '../tracking';
import { cropImage, type CardCorners, type ScanImage } from '../types';

import {
  recognizeCard,
  type RecognizeDeps,
  type RecognizeOptions,
  type RecognizeResult,
} from './recognize';

export type ScannerPhase =
  | 'searching'
  | 'detected'
  | 'locking'
  | 'recognizing'
  | 'found'
  | 'ambiguous';

export interface ScanContext {
  preferLanguage?: string;
  preferSets?: readonly string[];
}

export interface SessionSnapshot {
  corners: CardCorners | null;
  fused?: FusedResult;
  message: string;
  phase: ScannerPhase;
  quality?: FrameQuality;
  recognition?: RecognizeResult;
}

export interface SessionController {
  /** Feed a camera/analysis frame (latest-frame semantics — caller drops stale). */
  onFrame(frame: ScanImage): Promise<SessionSnapshot>;
  /** Manual still (photo library / shutter fallback). */
  recognizeStill(frame: ScanImage): Promise<SessionSnapshot>;
  reset(): void;
  snapshot(): SessionSnapshot;
}

interface QualFrame {
  card: PreparedCard;
  quality: FrameQuality;
}

export const createSessionController = (
  deps: RecognizeDeps,
  context: ScanContext = {},
): SessionController => {
  let phase: ScannerPhase = 'searching';
  let track: TrackState = emptyTrack();
  let temporal: TemporalState = emptyTemporal();
  let pool: QualFrame[] = [];
  let gone = 0;
  let foundDescriptor: ReturnType<typeof describeArtwork> | null = null;
  let foundCorners: CardCorners | null = null;
  let lastFused: FusedResult | undefined;
  let lastRecognition: RecognizeResult | undefined;
  let lastQuality: FrameQuality | undefined;
  let recognizing = false;
  let message = 'Place a card in view';

  const snap = (): SessionSnapshot => ({
    corners: latestCorners(track) ?? foundCorners,
    fused: lastFused,
    message,
    phase,
    quality: lastQuality,
    recognition: lastRecognition,
  });

  const clearLock = () => {
    pool = [];
    temporal = emptyTemporal();
    foundDescriptor = null;
    foundCorners = null;
    lastFused = undefined;
    lastRecognition = undefined;
  };

  const enterSearching = (why: string) => {
    phase = 'searching';
    track = emptyTrack();
    clearLock();
    gone = 0;
    message = why;
  };

  const artDescriptor = (card: PreparedCard) => {
    const profile = profileForCard(card.image.width, card.image.height);
    return describeArtwork(cropImage(card.image, profile.artwork));
  };

  const runRecognize = async (card: PreparedCard): Promise<void> => {
    if (recognizing) return;
    recognizing = true;
    phase = 'recognizing';
    message = 'Identifying…';
    try {
      const opts: RecognizeOptions = { preferSets: context.preferSets };
      const { result, temporal: nextTemp } = await recognizeCard(
        card.image,
        deps,
        opts,
        temporal,
      );
      temporal = nextTemp;
      lastRecognition = result;
      lastFused = result.fused;
      const status = result.fused.status;
      if (status === 'identified' || status === 'printing-ambiguous') {
        phase = 'found';
        message =
          status === 'printing-ambiguous'
            ? `${result.fused.card?.name ?? 'Card'} — printing uncertain`
            : (result.fused.card?.name ?? 'Identified');
        foundCorners = card.corners;
        foundDescriptor = artDescriptor(card);
      } else if (status === 'card-ambiguous') {
        phase = 'ambiguous';
        message = 'Ambiguous — keep steady or pick a candidate';
      } else {
        phase = 'locking';
        message = 'Need a clearer view…';
      }
    } finally {
      recognizing = false;
    }
  };

  return {
    async onFrame(frame) {
      const prepared = prepareCard(frame);
      lastQuality = frameQualityScore(
        prepared.detected ? prepared.image : frame,
        prepared.score,
      );

      if (!prepared.detected || !prepared.corners || prepared.score < DETECT_MIN_SCORE) {
        track = pushTrack(track, null);
        if (phase === 'found' || phase === 'ambiguous') {
          gone += 1;
          if (gone >= GONE_FRAMES) enterSearching('Place a card in view');
        } else if (phase !== 'searching' && phase !== 'recognizing') {
          enterSearching('Place a card in view');
        }
        return snap();
      }

      gone = 0;
      track = pushTrack(track, sampleFromQuad(prepared.corners, prepared.score));

      if (phase === 'found' && foundCorners && foundDescriptor) {
        if (!geometryChanged(foundCorners, prepared.corners)) return snap();
        const desc = artDescriptor(prepared);
        if (descriptorSimilarity(foundDescriptor, desc) > 1 - REPLACE_VISUAL_DELTA) {
          return snap();
        }
        enterSearching('New card…');
        // Fall through to start tracking the replacement.
        track = pushTrack(emptyTrack(), sampleFromQuad(prepared.corners, prepared.score));
      }

      if (phase === 'recognizing') return snap();

      if (!track.stable) {
        phase = 'detected';
        message = 'Hold steady…';
        pool = [];
        return snap();
      }

      if (phase !== 'found' && phase !== 'ambiguous') {
        phase = 'locking';
        message = 'Card locked';
        pool = pushQualityPool(
          pool,
          { card: prepared, quality: lastQuality },
          QUALITY_POOL_SIZE,
        );
        const best = pool[0];
        if (best && best.quality.score >= QUALITY_MIN_SCORE && !recognizing) {
          await runRecognize(best.card);
        }
      }

      return snap();
    },

    async recognizeStill(frame) {
      clearLock();
      track = emptyTrack();
      const prepared = prepareCard(frame);
      lastQuality = frameQualityScore(prepared.image, prepared.score);
      if (prepared.corners) {
        track = pushTrack(track, sampleFromQuad(prepared.corners, prepared.score));
        track = { ...track, stable: true };
      }
      await runRecognize(prepared);
      return snap();
    },

    reset() {
      enterSearching('Place a card in view');
    },

    snapshot: snap,
  };
};
