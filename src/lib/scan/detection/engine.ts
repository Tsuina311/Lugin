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
  diagnostics?: {
    areaRatio?: number;
    aspectRatio?: number;
    candidateCount?: number;
    rejectReason?: string;
  };
  /** Detector-only duration on the native clock (ms). */
  timingMs: number;
}

export interface DetectorEngine {
  id: DetectorEngineId;
  /**
   * Run geometric detection.
   * Shared-JS path receives an RGBA ScanImage.
   * Native path should prefer a Y/luma plane and must not require a full RGB
   * buffer on every live frame.
   */
  detect(input: ScanImage): {
    corners: CardCorners | null;
    score: number;
    debug: DetectionDebug;
  };
}
