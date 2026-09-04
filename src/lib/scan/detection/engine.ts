// Portable detector engine seam.
//
// Live geometry may run as Shared JS (`detectCardQuad`) or Native (YUV/luma).
// Recognition (artwork, OCR interpretation, fusion) stays in TypeScript.

import type { DetectionDebug } from './types';
import type { CardCorners, Point, ScanImage } from '../types';

export type DetectorEngineId = 'shared-js' | 'native';

/** Corners in the analysis / detector frame coordinate system (pixels). */
export type DetectorCorners = [Point, Point, Point, Point];

export interface NativeDetectionResult {
  detected: boolean;
  corners?: DetectorCorners;
  score?: number;
  /** Ranked plausible quads (≤12); primary is `corners`. */
  candidates?: Array<{
    areaRatio?: number;
    aspectRatio?: number;
    corners: DetectorCorners;
    method?: string;
    score: number;
  }>;
  diagnostics?: {
    areaRatio?: number;
    aspectRatio?: number;
    candidateCount?: number;
    nestedInnerPreferred?: boolean;
    rejectReason?: string;
  };
  /** Detector-only duration on the native clock (ms). */
  timingMs: number;
}

export interface DetectorEngine {
  id: DetectorEngineId;
  /**
   * Run geometric detection on an RGBA ScanImage.
   * Shared-JS path; Native may use this for parity only.
   */
  detect(input: ScanImage): {
    corners: CardCorners | null;
    score: number;
    debug: DetectionDebug;
  };
  /**
   * Live Native path: Y/luma plane only (no full RGB through RN).
   * Shared-JS engines leave this undefined.
   */
  detectYPlane?: (
    y: Uint8Array,
    width: number,
    height: number,
    rowStride: number,
  ) => {
    corners: CardCorners | null;
    score: number;
    debug: DetectionDebug;
  };
}
