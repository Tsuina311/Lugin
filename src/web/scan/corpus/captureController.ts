// Event-driven development capture. Never runs without consent.
// Failures here must never break scanning.

import { newSampleId, newSessionId } from '@/lib/scan/corpus/ids';
import {
  CORPUS_CARD_MAX_EDGE,
  CORPUS_FULL_FRAME_MAX_EDGE,
  corpusPolicyFor,
  DETECTION_TIMEOUT_MS,
  UNSTABLE_TRACK_FRAMES,
} from '@/lib/scan/corpus/policy';
import {
  allowAutomaticSample,
  emptyThrottle,
  type ThrottleState,
} from '@/lib/scan/corpus/throttle';
import {
  CORPUS_SCHEMA_VERSION,
  type CorpusLabelKind,
  type ScanCorpusEventType,
  type ScanCorpusSampleMeta,
} from '@/lib/scan/corpus/types';
import type { SessionSnapshot } from '@/lib/scan/session/controller';
import type { ScanImage } from '@/lib/scan/types';
import { flags } from '@/lib/flags';

import {
  ensureContributorId,
  getCorpusStats,
  isCorpusCaptureEnabled,
} from './consent';
import { enqueueCorpusSample, listPendingCorpus } from './queue';
import { sanitizeScanImage, sanitizeVideoFrame } from './sanitize';
import { pumpCorpusUploads } from './uploader';

export interface CaptureDebugLine {
  event: ScanCorpusEventType;
  note: string;
  sampleId?: string;
  at: number;
}

export interface CorpusCaptureController {
  dispose: () => void;
  getDebug: () => CaptureDebugLine[];
  getPendingCount: () => Promise<number>;
  getStats: () => { contributed: number };
  /** Manual high-value reports (always previewed by UI before calling). */
  reportDetectionFailure: () => Promise<string | null>;
  reportFalsePositive: () => Promise<string | null>;
  reportPrintingCorrected: (opts: {
    correctedPrintingId: string;
    normalized: ScanImage | null;
  }) => Promise<string | null>;
  reportRecognitionCorrected: (opts: {
    correctedOracleId: string;
    correctedName?: string;
    normalized: ScanImage | null;
  }) => Promise<string | null>;
  /** Feed each session snapshot while the scanner is active. */
  onSnapshot: (snap: SessionSnapshot) => void;
  setActive: (active: boolean) => void;
  setNormalizedCard: (image: ScanImage | null) => void;
  setVideo: (video: HTMLVideoElement | null) => void;
}

const appVersion = (): string =>
  (import.meta.env.VITE_LUGIN_BUILD as string | undefined) ?? 'dev';

const scannerVersion = (): string => `scan-corpus/${CORPUS_SCHEMA_VERSION}`;

export const createCorpusCaptureController = (): CorpusCaptureController => {
  let active = false;
  let video: HTMLVideoElement | null = null;
  let normalized: ScanImage | null = null;
  let lastSnap: SessionSnapshot | null = null;
  let sessionId = newSessionId();
  let throttle: ThrottleState = emptyThrottle();
  let searchingSince: number | null = null;
  let lastPhase: string | null = null;
  let lastTrackKey: string | null = null;
  const debug: CaptureDebugLine[] = [];

  const pushDebug = (event: ScanCorpusEventType, note: string, sampleId?: string) => {
    debug.unshift({ at: Date.now(), event, note, sampleId });
    if (debug.length > 30) debug.length = 30;
  };

  const buildMeta = (
    event: ScanCorpusEventType,
    labelKind: CorpusLabelKind,
    imageMeta: ScanCorpusSampleMeta['image'],
  ): ScanCorpusSampleMeta => {
    const snap = lastSnap;
    const policy = corpusPolicyFor(event);
    return {
      appVersion: appVersion(),
      contributorId: ensureContributorId(),
      createdAt: new Date().toISOString(),
      detectedCards: snap?.corners ? [snap.corners] : undefined,
      detector: snap
        ? {
            candidates: snap.detection.candidates.slice(0, 12),
            quality: snap.quality,
            selectedQuad: snap.corners,
            stability: 1 - Math.min(1, snap.motion),
          }
        : undefined,
      environment: video
        ? {
            orientation:
              typeof screen !== 'undefined' && 'orientation' in screen
                ? String((screen.orientation as ScreenOrientation)?.type ?? '')
                : undefined,
            videoHeight: video.videoHeight,
            videoWidth: video.videoWidth,
          }
        : undefined,
      eventType: event,
      image: imageMeta,
      labelKind,
      priority: policy.priority,
      recognition: snap?.fused
        ? {
            candidates: snap.fused.candidates.slice(0, 8),
            margin: snap.fused.margin,
            predictedName: snap.fused.card?.name,
            predictedOracleId: snap.fused.card?.oracleId,
            status: snap.fused.status,
          }
        : undefined,
      sampleId: newSampleId(),
      scannerVersion: scannerVersion(),
      schemaVersion: CORPUS_SCHEMA_VERSION,
      sessionId,
    };
  };

  const enqueue = async (
    event: ScanCorpusEventType,
    labelKind: CorpusLabelKind,
    opts: {
      force?: boolean;
      normalizedOverride?: ScanImage | null;
      recognitionPatch?: NonNullable<ScanCorpusSampleMeta['recognition']>;
    } = {},
  ): Promise<string | null> => {
    if (!isCorpusCaptureEnabled()) return null;
    if (!active && !opts.force) return null;

    const policy = corpusPolicyFor(event);
    if (!opts.force) {
      const gate = allowAutomaticSample(throttle, event);
      throttle = gate.next;
      if (!gate.ok) {
        pushDebug(event, 'throttled');
        return null;
      }
    }

    try {
      let imageBuf: ArrayBuffer | null = null;
      let mime: 'image/jpeg' | null = null;
      let imageMeta: ScanCorpusSampleMeta['image'] = null;

      if (policy.imageKind === 'full-frame' && video?.videoWidth) {
        const sanitized = await sanitizeVideoFrame(video, CORPUS_FULL_FRAME_MAX_EDGE);
        imageBuf = await sanitized.blob.arrayBuffer();
        mime = sanitized.mimeType;
        imageMeta = {
          height: sanitized.height,
          kind: 'full-frame',
          mimeType: sanitized.mimeType,
          width: sanitized.width,
        };
      } else if (policy.imageKind === 'normalized-card') {
        const src = opts.normalizedOverride ?? normalized;
        if (src) {
          const sanitized = await sanitizeScanImage(src, CORPUS_CARD_MAX_EDGE);
          imageBuf = await sanitized.blob.arrayBuffer();
          mime = sanitized.mimeType;
          imageMeta = {
            height: sanitized.height,
            kind: 'normalized-card',
            mimeType: sanitized.mimeType,
            width: sanitized.width,
          };
        }
      }

      const meta = buildMeta(event, labelKind, imageMeta);
      if (opts.recognitionPatch) {
        meta.recognition = { ...meta.recognition, ...opts.recognitionPatch };
      }
      await enqueueCorpusSample({
        bytes: imageBuf?.byteLength ?? 0,
        id: meta.sampleId,
        image: imageBuf,
        meta,
        mimeType: mime,
        priority: policy.priority,
      });
      pushDebug(event, 'queued', meta.sampleId);
      if (flags.scanDebug) {
        // eslint-disable-next-line no-console
        console.debug('[corpus]', event, meta.sampleId);
      }
      void pumpCorpusUploads();
      return meta.sampleId;
    } catch (err) {
      pushDebug(event, err instanceof Error ? err.message : 'capture failed');
      return null;
    }
  };

  return {
    dispose() {
      active = false;
      video = null;
      normalized = null;
      lastSnap = null;
    },

    getDebug: () => [...debug],

    getPendingCount: () => listPendingCorpus().then(r => r.length),

    getStats: () => getCorpusStats(),

    async reportDetectionFailure() {
      return enqueue('DETECTION_FAILURE_REPORTED', 'USER_CONFIRMED_CARD_PRESENT', {
        force: true,
      });
    },

    async reportFalsePositive() {
      return enqueue('FALSE_POSITIVE_REPORTED', 'USER_REPORTED_FALSE_POSITIVE', {
        force: true,
      });
    },

    async reportPrintingCorrected({ correctedPrintingId, normalized: card }) {
      return enqueue('PRINTING_CORRECTED', 'PRINTING_CORRECTED', {
        force: true,
        normalizedOverride: card,
        recognitionPatch: { correctedPrintingId },
      });
    },

    async reportRecognitionCorrected({ correctedOracleId, correctedName, normalized: card }) {
      return enqueue('RECOGNITION_CORRECTED', 'RECOGNITION_CORRECTED', {
        force: true,
        normalizedOverride: card,
        recognitionPatch: {
          correctedOracleId,
          ...(correctedName ? { predictedName: correctedName } : {}),
        },
      });
    },

    onSnapshot(snap) {
      if (!active || !isCorpusCaptureEnabled()) {
        lastSnap = snap;
        return;
      }
      lastSnap = snap;

      if (snap.phase === 'searching') {
        if (searchingSince == null) searchingSince = Date.now();
        else if (Date.now() - searchingSince >= DETECTION_TIMEOUT_MS) {
          void enqueue('DETECTION_TIMEOUT', 'UNLABELED');
          searchingSince = Date.now(); // reset so we don't spam
        }
      } else {
        searchingSince = null;
      }

      if (
        snap.phase === 'detected' &&
        snap.trackFrames >= UNSTABLE_TRACK_FRAMES &&
        !snap.motion
      ) {
        // Unstable: many frames but motion still high — use motion threshold.
      }
      if (
        (snap.phase === 'detected' || snap.phase === 'locking') &&
        snap.trackFrames >= UNSTABLE_TRACK_FRAMES &&
        snap.motion > 0.04
      ) {
        void enqueue('DETECTION_UNSTABLE', 'UNLABELED');
      }

      if (
        snap.detection.selectedIndex < 0 &&
        snap.detection.candidates.some(c => c.rejectedBecause.length) &&
        snap.phase === 'searching'
      ) {
        void enqueue('DETECTION_REJECTED', 'UNLABELED');
      }

      if (snap.phase === 'locking' && lastPhase !== 'locking') {
        const key = snap.corners
          ? `${Math.round(snap.corners.topLeft.x)}:${Math.round(snap.corners.topLeft.y)}`
          : null;
        if (key && key !== lastTrackKey) {
          lastTrackKey = key;
          void enqueue('DETECTION_LOCKED', 'AUTO_LOCKED_POSITIVE');
        }
      }

      if (snap.phase === 'ambiguous' && lastPhase !== 'ambiguous') {
        void enqueue('RECOGNITION_AMBIGUOUS', 'UNLABELED');
      }

      if (
        (snap.phase === 'found' || snap.fused?.status === 'identified') &&
        lastPhase !== 'found'
      ) {
        void enqueue('SUCCESS_SAMPLE', 'AUTO_LOCKED_POSITIVE');
      }

      if (snap.phase === 'searching' && lastPhase && lastPhase !== 'searching') {
        lastTrackKey = null;
      }

      lastPhase = snap.phase;
    },

    setActive(value) {
      active = value;
      if (value) {
        sessionId = newSessionId();
        throttle = emptyThrottle();
        searchingSince = null;
        lastPhase = null;
        lastTrackKey = null;
        void pumpCorpusUploads();
      }
    },

    setNormalizedCard(image) {
      normalized = image;
    },

    setVideo(v) {
      video = v;
    },
  };
};
