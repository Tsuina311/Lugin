// Continuous scan session state machine (portable — no React / DOM).

import { describeArtwork, descriptorSimilarity } from '../artwork/descriptors';
import { focusGateDecision } from '../cameraCapabilities';
import type { DetectionDebug } from '../detection/types';
import { emptyDetectionDebug } from '../detection/types';
import {
  DETECT_MIN_SCORE,
  FOCUS_TIMEOUT_MS,
  FOCUS_TOO_CLOSE_AREA_SHARE,
  GONE_FRAMES,
  QUALITY_MIN_SCORE,
  QUALITY_POOL_SIZE,
  REPLACE_VISUAL_DELTA,
  SHARPNESS_MIN,
} from '../params';
import { CARD_HEIGHT, CARD_WIDTH, cornersToQuad, warpQuadToCard } from '../geometry';
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
  trackMotion,
  type TrackState,
} from '../tracking';
import { cropImage, type CardCorners, type ScanImage } from '../types';

import {
  isStrongArtOnly,
  isStrongDualEvidence,
  isStrongTitleOnly,
  recognizeCard,
  type RecognizeDeps,
  type RecognizeOptions,
  type RecognizeResult,
} from './recognize';

export type ScannerPhase =
  | 'searching'
  | 'detected'
  | 'focusing'
  | 'locking'
  | 'recognizing'
  | 'found'
  | 'ambiguous';

export interface ScanContext {
  preferLanguage?: string;
  preferSets?: readonly string[];
}

/** Optional live-camera helpers (hi-res crop / focus). DOM-free contract. */
export interface FrameHelpers {
  /**
   * Supply a detect-only (or already-prepared) analysis result.
   *
   * Live camera already ran `detectCardQuad` for the overlay. Calling
   * `prepareCard` again would detect *and* warp to 744×1039 on every search
   * frame. When this returns a result, `onFrame` uses it instead.
   *
   * Recognition still goes through {@link refineCard} (or `prepareCard` if
   * that helper is absent) so the 744×1039 crop is not skipped at lock.
   */
  prepareAnalysis?: (frame: ScanImage) => PreparedCard | null;
  /**
   * Build a recognition crop from the full camera frame using analysis corners.
   * When absent (fixtures / stills), analysis-frame prepareCard is used.
   */
  refineCard?: (
    corners: CardCorners,
    analysisSize: { height: number; width: number },
  ) => PreparedCard | null;
  /** Request focus/metering at normalized video coords (0–1). */
  requestFocusNorm?: (x: number, y: number) => void;
  /**
   * When false, stay in locking without starting recognition.
   * Native uses this while a high-res still is in flight.
   */
  allowRecognize?: () => boolean;
}

/** User-facing latency anchors (performance.now ms). */
export interface SessionUserLatency {
  /** Stable lock → first provisional/final oracle name on screen. */
  lockToFirstOracleMs: number | null;
  /** Stable lock → final fused identity (after channels settle). */
  lockToFinalOracleMs: number | null;
  /** Stable lock → exact printing (identified, not printing-ambiguous). */
  lockToPrintingMs: number | null;
  /** Recognize start → first oracle name (early or final). */
  recognizeToFirstOracleMs: number | null;
}

export interface SessionSnapshot {
  /** Analysis frame size corners are expressed in. */
  analysisSize: { height: number; width: number } | null;
  corners: CardCorners | null;
  detection: DetectionDebug;
  /** Wall time when provisional identity first reached the UI (if any). */
  earlyShownAt?: number | null;
  /** Wall time when final identity was applied after recognize settled. */
  finalIdentityAt?: number | null;
  fused?: FusedResult;
  /** Wall time when track first became lock-ready (phase → locking). */
  lockedAt?: number | null;
  message: string;
  /** Mean corner motion (fraction of diagonal); lower = more stable. */
  motion: number;
  phase: ScannerPhase;
  /** Wall time when exact printing first applied (fused.status === identified). */
  printingShownAt?: number | null;
  quality?: FrameQuality;
  recognition?: RecognizeResult;
  /** Wall time when the current recognize pass started. */
  recognizingStartedAt?: number | null;
  /** Recent recognition observations for the current track. */
  temporal?: TemporalState;
  /** Frames currently held in the track. */
  trackFrames: number;
  /** Derived lock→oracle / printing deltas for debug + export. */
  userLatency?: SessionUserLatency;
}

export interface SessionController {
  /** Last locked/recognized normalized card, if any (for corpus / debug). */
  lastNormalized(): ScanImage | null;
  onFrame(frame: ScanImage, helpers?: FrameHelpers): Promise<SessionSnapshot>;
  recognizeStill(frame: ScanImage): Promise<SessionSnapshot>;
  reset(): void;
  snapshot(): SessionSnapshot;
}

interface QualFrame {
  card: PreparedCard;
  quality: FrameQuality;
}

const cornerCenter = (c: CardCorners): { x: number; y: number } => ({
  x: (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) / 4,
  y: (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) / 4,
});

const quadAreaShare = (
  c: CardCorners,
  size: { height: number; width: number },
): number => {
  const xs = [c.topLeft.x, c.topRight.x, c.bottomRight.x, c.bottomLeft.x];
  const ys = [c.topLeft.y, c.topRight.y, c.bottomRight.y, c.bottomLeft.y];
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const frame = Math.max(1, size.width * size.height);
  return (w * h) / frame;
};

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
  let lastDetection: DetectionDebug = emptyDetectionDebug();
  let analysisSize: { height: number; width: number } | null = null;
  let recognizing = false;
  let message = 'Place a card in view';
  let lastNormalized: ScanImage | null = null;
  let focusingSince: number | null = null;
  let lastFocusRequestAt = 0;
  let lastFocusCenter: { x: number; y: number } | null = null;
  let recognizingStartedAt: number | null = null;
  let earlyShownAt: number | null = null;
  let lockedAt: number | null = null;
  let finalIdentityAt: number | null = null;
  let printingShownAt: number | null = null;
  let earlyApplied = false;

  const userLatency = (): SessionUserLatency => {
    const firstOracleAt = earlyShownAt ?? finalIdentityAt;
    const delta = (from: number | null, to: number | null): number | null =>
      from != null && to != null && to >= from ? to - from : null;
    return {
      lockToFirstOracleMs: delta(lockedAt, firstOracleAt),
      lockToFinalOracleMs: delta(lockedAt, finalIdentityAt),
      lockToPrintingMs: delta(lockedAt, printingShownAt),
      recognizeToFirstOracleMs: delta(recognizingStartedAt, firstOracleAt),
    };
  };

  const snap = (): SessionSnapshot => ({
    analysisSize,
    corners: latestCorners(track) ?? foundCorners,
    detection: lastDetection,
    earlyShownAt,
    finalIdentityAt,
    fused: lastFused,
    lockedAt,
    message,
    motion: trackMotion(track),
    phase,
    printingShownAt,
    quality: lastQuality,
    recognition: lastRecognition,
    recognizingStartedAt,
    temporal,
    trackFrames: track.history.length,
    userLatency: userLatency(),
  });

  const clearLock = () => {
    pool = [];
    temporal = emptyTemporal();
    foundDescriptor = null;
    foundCorners = null;
    lastFused = undefined;
    lastRecognition = undefined;
    lastNormalized = null;
    focusingSince = null;
    lastFocusCenter = null;
    recognizingStartedAt = null;
    earlyShownAt = null;
    lockedAt = null;
    finalIdentityAt = null;
    printingShownAt = null;
    earlyApplied = false;
  };

  const applyIdentity = (
    result: RecognizeResult,
    card: PreparedCard,
    opts: { provisional?: boolean } = {},
  ) => {
    lastRecognition = result;
    lastFused = result.fused;
    const status = result.fused.status;
    const nowMs = performance.now();
    if (status === 'identified' || status === 'printing-ambiguous') {
      phase = 'found';
      message = result.fused.card?.name ?? 'Identified';
      foundCorners = card.corners;
      foundDescriptor = artDescriptor(card);
      if (!opts.provisional) {
        if (finalIdentityAt == null) finalIdentityAt = nowMs;
        if (status === 'identified' && printingShownAt == null) printingShownAt = nowMs;
      }
    } else if (status === 'card-ambiguous') {
      phase = 'ambiguous';
      message = 'Ambiguous — keep steady or pick a candidate';
    } else {
      phase = 'focusing';
      message = 'Need a clearer view…';
      focusingSince = nowMs;
    }
  };

  /** Final wins only when it strongly contradicts the provisional early identity. */
  const stronglyContradictsEarly = (early: FusedResult, final: FusedResult): boolean => {
    const earlyKey = early.card?.oracleId ?? early.card?.name;
    const finalKey = final.card?.oracleId ?? final.card?.name;
    if (!earlyKey || !finalKey || earlyKey === finalKey) return false;
    if (final.status !== 'identified' && final.status !== 'printing-ambiguous') return false;
    return (
      isStrongDualEvidence(final) || isStrongTitleOnly(final) || isStrongArtOnly(final)
    );
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
    earlyApplied = false;
    earlyShownAt = null;
    recognizingStartedAt = performance.now();
    phase = 'recognizing';
    message = 'Recognizing…';
    lastNormalized = card.image;
    focusingSince = null;
    try {
      const opts: RecognizeOptions = { preferSets: context.preferSets };
      const { result, temporal: nextTemp } = await recognizeCard(
        card.image,
        {
          ...deps,
          onEarlyIdentity: provisional => {
            earlyApplied = true;
            earlyShownAt = performance.now();
            applyIdentity(provisional, card, { provisional: true });
            deps.onEarlyIdentity?.(provisional);
          },
        },
        opts,
        temporal,
      );
      temporal = nextTemp;

      if (earlyApplied && lastFused) {
        const same =
          (lastFused.card?.oracleId &&
            lastFused.card.oracleId === result.fused.card?.oracleId) ||
          (lastFused.card?.name && lastFused.card.name === result.fused.card?.name);
        if (!same && stronglyContradictsEarly(lastFused, result.fused)) {
          applyIdentity(result, card);
        } else if (!same) {
          // Weak contradict — keep provisional name; attach final timings/evidence.
          lastRecognition = {
            ...result,
            earlyIdentity: true,
            earlyReason: lastRecognition?.earlyReason ?? result.earlyReason ?? null,
            fused: lastFused,
          };
          if (finalIdentityAt == null) finalIdentityAt = performance.now();
        } else {
          applyIdentity(result, card);
        }
      } else {
        applyIdentity(result, card);
      }
    } finally {
      recognizing = false;
    }
  };

  const maybeRequestFocus = (
    corners: CardCorners,
    size: { height: number; width: number },
    helpers?: FrameHelpers,
  ) => {
    if (!helpers?.requestFocusNorm) return;
    const now = performance.now();
    if (now - lastFocusRequestAt < 700) return;
    const c = cornerCenter(corners);
    const nx = c.x / Math.max(1, size.width);
    const ny = c.y / Math.max(1, size.height);
    if (
      lastFocusCenter &&
      Math.hypot(nx - lastFocusCenter.x, ny - lastFocusCenter.y) < 0.04 &&
      now - lastFocusRequestAt < 1600
    ) {
      return;
    }
    lastFocusRequestAt = now;
    lastFocusCenter = { x: nx, y: ny };
    helpers.requestFocusNorm(nx, ny);
  };

  return {
    lastNormalized: () => lastNormalized,

    async onFrame(frame, helpers) {
      analysisSize = { height: frame.height, width: frame.width };
      const prepared = helpers?.prepareAnalysis?.(frame) ?? prepareCard(frame);
      lastDetection = prepared.detection;

      if (!prepared.detected || !prepared.corners || prepared.score < DETECT_MIN_SCORE) {
        lastQuality = frameQualityScore(frame, prepared.score);
        track = pushTrack(track, null);
        focusingSince = null;
        if (phase === 'found' || phase === 'ambiguous') {
          gone += 1;
          if (gone >= GONE_FRAMES) enterSearching('Place a card in view');
        } else if (phase !== 'searching' && phase !== 'recognizing' && !track.history.length) {
          enterSearching('Place a card in view');
        } else if (track.history.length && phase !== 'recognizing') {
          phase = 'detected';
          message = 'Hold steady…';
        }
        return snap();
      }

      gone = 0;
      track = pushTrack(track, sampleFromQuad(prepared.corners, prepared.score));

      // Prefer a full-resolution warp for quality + recognition when available.
      const refined =
        helpers?.refineCard?.(prepared.corners, analysisSize) ?? null;
      const forQuality = refined ?? prepared;
      lastQuality = frameQualityScore(forQuality.image, prepared.score);

      if (phase === 'found' && foundCorners && foundDescriptor) {
        if (!geometryChanged(foundCorners, prepared.corners)) return snap();
        const desc = artDescriptor(forQuality);
        if (descriptorSimilarity(foundDescriptor, desc) > 1 - REPLACE_VISUAL_DELTA) {
          return snap();
        }
        enterSearching('New card…');
        track = pushTrack(emptyTrack(), sampleFromQuad(prepared.corners, prepared.score));
      }

      if (phase === 'recognizing') return snap();

      if (!track.stable) {
        phase = 'detected';
        message = 'Hold steady…';
        pool = [];
        focusingSince = null;
        return snap();
      }

      const now = performance.now();
      if (focusingSince == null) focusingSince = now;
      const gate = focusGateDecision({
        focusingSince,
        minQuality: QUALITY_MIN_SCORE,
        minSharpness: SHARPNESS_MIN,
        now,
        qualityScore: lastQuality.score,
        sharpness: lastQuality.sharpness,
        stable: true,
        timeoutMs: FOCUS_TIMEOUT_MS,
      });

      if (gate.kind === 'focusing' || gate.kind === 'timeout') {
        phase = 'focusing';
        pool = pushQualityPool(
          pool,
          { card: forQuality, quality: lastQuality },
          QUALITY_POOL_SIZE,
        );
        maybeRequestFocus(prepared.corners, analysisSize, helpers);
        if (gate.kind === 'timeout') {
          const area = quadAreaShare(prepared.corners, analysisSize);
          message =
            area >= FOCUS_TOO_CLOSE_AREA_SHARE
              ? 'Move slightly farther away'
              : helpers?.requestFocusNorm
                ? 'Tap the card to focus'
                : 'Hold steady — waiting for a sharper frame';
        } else {
          message = 'Focusing…';
        }
        return snap();
      }

      // Sharp enough.
      if (phase !== 'found' && phase !== 'ambiguous') {
        phase = 'locking';
        if (lockedAt == null) lockedAt = now;
        message = 'Card locked';
        pool = pushQualityPool(
          pool,
          { card: forQuality, quality: lastQuality },
          QUALITY_POOL_SIZE,
        );
        const best = pool[0];
        if (best && best.quality.score >= QUALITY_MIN_SCORE && !recognizing) {
          if (helpers?.allowRecognize && !helpers.allowRecognize()) {
            message = 'Capturing…';
            return snap();
          }
          // prepareAnalysis skips the 744×1039 warp on search frames.
          // Prefer refineCard (hi-res cache); otherwise warp this analysis
          // frame once. Do not run detectCardQuad again.
          const canonical =
            best.card.image.width === CARD_WIDTH &&
            best.card.image.height === CARD_HEIGHT;
          const card = canonical
            ? best.card
            : helpers?.refineCard?.(prepared.corners, analysisSize) ??
              {
                ...best.card,
                corners: prepared.corners,
                detected: true,
                image: warpQuadToCard(frame, cornersToQuad(prepared.corners)),
              };
          lastNormalized = card.image;
          await runRecognize(card);
        }
      }

      return snap();
    },

    async recognizeStill(frame) {
      analysisSize = { height: frame.height, width: frame.width };
      clearLock();
      track = emptyTrack();
      const prepared = prepareCard(frame);
      lastDetection = prepared.detection;
      lastQuality = frameQualityScore(prepared.image, prepared.score);
      lastNormalized = prepared.image;
      if (prepared.corners) {
        track = pushTrack(track, sampleFromQuad(prepared.corners, prepared.score));
        track = { ...track, stable: true };
      }
      await runRecognize(prepared);
      return snap();
    },

    reset() {
      enterSearching('Place a card in view');
      lastDetection = emptyDetectionDebug();
      analysisSize = null;
    },

    snapshot: snap,
  };
};
