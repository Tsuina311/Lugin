// Which scanner events warrant a corpus sample, and how aggressively.

import type {
  CorpusPolicyDecision,
  ScanCorpusEventType,
} from './types';

const POLICY: Record<ScanCorpusEventType, CorpusPolicyDecision> = {
  CAMERA_BLUR: {
    imageKind: 'full-frame',
    maxPerSession: 2,
    minIntervalMs: 40_000,
    priority: 'medium',
  },
  CAMERA_FOCUS_FAILURE: {
    imageKind: 'full-frame',
    maxPerSession: 2,
    minIntervalMs: 45_000,
    priority: 'medium',
  },
  DETECTION_FAILURE_REPORTED: {
    imageKind: 'full-frame',
    maxPerSession: Infinity,
    minIntervalMs: 0,
    priority: 'high',
  },
  DETECTION_LOCKED: {
    imageKind: 'full-frame',
    maxPerSession: 2,
    minIntervalMs: 30_000,
    priority: 'low',
    sampleProbability: 0.12,
  },
  DETECTION_REJECTED: {
    imageKind: 'full-frame',
    maxPerSession: 3,
    minIntervalMs: 20_000,
    priority: 'medium',
  },
  DETECTION_TIMEOUT: {
    imageKind: 'full-frame',
    maxPerSession: 2,
    minIntervalMs: 45_000,
    priority: 'medium',
  },
  DETECTION_UNSTABLE: {
    imageKind: 'full-frame',
    maxPerSession: 2,
    minIntervalMs: 25_000,
    priority: 'medium',
  },
  FALSE_POSITIVE_REPORTED: {
    imageKind: 'full-frame',
    maxPerSession: Infinity,
    minIntervalMs: 0,
    priority: 'high',
  },
  PRINTING_CORRECTED: {
    imageKind: 'normalized-card',
    maxPerSession: Infinity,
    minIntervalMs: 0,
    priority: 'high',
  },
  RECOGNITION_AMBIGUOUS: {
    imageKind: 'normalized-card',
    maxPerSession: 3,
    minIntervalMs: 15_000,
    priority: 'medium',
  },
  RECOGNITION_CORRECTED: {
    imageKind: 'normalized-card',
    maxPerSession: Infinity,
    minIntervalMs: 0,
    priority: 'high',
  },
  SUCCESS_SAMPLE: {
    imageKind: 'normalized-card',
    maxPerSession: 4,
    minIntervalMs: 20_000,
    priority: 'low',
    sampleProbability: 0.08,
  },
};

export const corpusPolicyFor = (event: ScanCorpusEventType): CorpusPolicyDecision =>
  POLICY[event];

export const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Seconds of continuous searching before an automatic DETECTION_TIMEOUT sample. */
export const DETECTION_TIMEOUT_MS = 8_000;

/** Frames tracked without reaching stable before DETECTION_UNSTABLE may fire. */
export const UNSTABLE_TRACK_FRAMES = 12;

/** Max pending samples in the local queue. */
export const CORPUS_QUEUE_MAX_SAMPLES = 40;

/** Soft byte budget for pending image payloads (~24 MB). */
export const CORPUS_QUEUE_MAX_BYTES = 24 * 1024 * 1024;

/** Full-frame encode max edge (keeps detection detail, strips camera bloat). */
export const CORPUS_FULL_FRAME_MAX_EDGE = 1280;

/** Normalized-card encode max edge. */
export const CORPUS_CARD_MAX_EDGE = 744;

export const CORPUS_JPEG_QUALITY = 0.82;
