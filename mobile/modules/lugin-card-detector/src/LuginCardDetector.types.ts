/**
 * Mirrors `NativeDetectionResult` in `src/lib/scan/detection/engine.ts`.
 * Keep fields in sync when the shared contract changes.
 */
export type DetectorCorners = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

export type NativeDetectionResult = {
  detected: boolean;
  corners?: DetectorCorners;
  score?: number;
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
};

export type ImplementationStatus = 'stub' | 'partial' | 'ready';

export type LuginCardDetectorNativeModule = {
  implementationStatus: ImplementationStatus;
  /**
   * Packed RGBA Uint8Array (length width*height*4, R,G,B,A) → detection.
   * Prefer typed array — no base64 on the live/parity bridge.
   */
  detectFromRgba(rgba: Uint8Array, width: number, height: number): NativeDetectionResult;
  /**
   * Live path: Y (luma) plane Uint8Array + rowStride (>= width).
   * Same WORK_WIDTH luma multi-threshold + Sobel edge as RGBA; chroma skipped.
   */
  detectFromYPlane(
    y: Uint8Array,
    width: number,
    height: number,
    rowStride: number,
  ): NativeDetectionResult;
};
