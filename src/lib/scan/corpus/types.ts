// Development-capture corpus types (portable — no DOM / React).
//
// Samples are labeled scanner *events*, not continuous video. Account identity
// is intentionally absent: only anonymous contributor/session/sample ids.

import type { DetectionCandidateDebug } from '../detection/types';
import type { FrameQuality } from '../quality';
import type { RankedCandidate } from '../ranking/fuse';
import type { CardCorners, Point } from '../types';

export const CORPUS_SCHEMA_VERSION = 1;

/** Consent text version — bump when copy or upload behavior changes materially. */
export const CORPUS_CONSENT_VERSION = 2;

export type ScanCorpusEventType =
  | 'DETECTION_TIMEOUT'
  | 'DETECTION_REJECTED'
  | 'DETECTION_UNSTABLE'
  | 'DETECTION_LOCKED'
  | 'FALSE_POSITIVE_REPORTED'
  | 'DETECTION_FAILURE_REPORTED'
  | 'RECOGNITION_AMBIGUOUS'
  | 'RECOGNITION_CORRECTED'
  | 'PRINTING_CORRECTED'
  | 'SUCCESS_SAMPLE'
  | 'CAMERA_BLUR'
  | 'CAMERA_FOCUS_FAILURE';

export type CorpusPriority = 'high' | 'medium' | 'low';

export type CorpusImageKind = 'full-frame' | 'normalized-card' | 'none';

export type CorpusLabelKind =
  | 'UNLABELED'
  | 'USER_CONFIRMED_CARD_PRESENT'
  | 'USER_REPORTED_FALSE_POSITIVE'
  | 'AUTO_LOCKED_POSITIVE'
  | 'MANUALLY_ANNOTATED'
  | 'RECOGNITION_CORRECTED'
  | 'PRINTING_CORRECTED';

export interface CorpusQuad {
  bottomLeft: Point;
  bottomRight: Point;
  topLeft: Point;
  topRight: Point;
}

export interface CorpusImageMeta {
  height: number;
  kind: Exclude<CorpusImageKind, 'none'>;
  mimeType: 'image/jpeg' | 'image/webp';
  width: number;
}

/** Metadata JSON uploaded beside the image bytes (no PII fields). */
export interface ScanCorpusSampleMeta {
  appVersion: string;
  contributorId: string;
  createdAt: string;
  detectedCards?: CorpusQuad[];
  detector?: {
    candidates?: DetectionCandidateDebug[];
    quality?: FrameQuality;
    selectedQuad?: CardCorners | null;
    stability?: number;
  };
  environment?: {
    orientation?: string;
    videoHeight?: number;
    videoWidth?: number;
  };
  /** Actual camera stream diagnostics (no personal identifiers beyond deviceId). */
  camera?: {
    deviceId?: string;
    facingMode?: string;
    focusMode?: string;
    frameRate?: number;
    height?: number;
    sharpness?: number;
    width?: number;
    zoom?: number;
  };
  eventType: ScanCorpusEventType;
  image: CorpusImageMeta | null;
  labelKind: CorpusLabelKind;
  priority: CorpusPriority;
  recognition?: {
    candidates?: RankedCandidate[];
    correctedOracleId?: string;
    correctedPrintingId?: string;
    margin?: number;
    predictedName?: string;
    predictedOracleId?: string;
    predictedPrintingId?: string;
    status?: string;
  };
  sampleId: string;
  scannerVersion: string;
  schemaVersion: number;
  sessionId: string;
}

export interface CorpusPolicyDecision {
  /** Max automatic captures of this type per session (Infinity = unlimited). */
  maxPerSession: number;
  /** Preferred image payload. */
  imageKind: CorpusImageKind;
  /** Min ms between automatic samples of this type. */
  minIntervalMs: number;
  priority: CorpusPriority;
  /** For SUCCESS_SAMPLE: probability in [0,1]. */
  sampleProbability?: number;
}
