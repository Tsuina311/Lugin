// Scanner Lab — portable types. No camera, no SessionController.

import type { CardCorners, Rect, ScanImage } from '../types';

export const KNOWN_GOOD_RECOGNITION_COMMIT = '1dd4932';
/** Proven accuracy baseline is Scanner Lab CURRENT, not 1dd4932 legacy. */
export const PROVEN_RECOGNITION_BASELINE =
  'current Scanner Lab pipeline on fixture wand-of-wonder-20260908T073958';
export const KNOWN_GOOD_RECOGNITION_SUMMARY =
  'PROVEN BASELINE = current: recognitionQuad → warpQuadToCard → enhanceForOcrFast → ' +
  'rgba-bytes → CardNameIndex. Fixture wand-of-wonder-20260908T073958: ' +
  '"Wand of Wonder" exact / 553ms. Legacy 1dd4932 is diagnostic only (empty / 1214ms).';

export type LabPipelineId = 'baseline' | 'current';

export type LabQuadSpace = 'source-highres';

export interface LabQuadSet {
  raw: CardCorners | null;
  recognition: CardCorners | null;
  tracked: CardCorners | null;
}

export interface LabInput {
  nameIndex: import('../matchName').CardNameIndex | null;
  ocr: import('../textRecognizer').TextRecognizer | null;
  pipeline: LabPipelineId;
  quads: LabQuadSet;
  source: ScanImage;
}

export interface LabStageTimings {
  cropMs: number;
  fallbackOcrMs?: number;
  firstOcrMs?: number;
  lookupMs: number;
  ocrMs: number;
  preprocessMs: number;
  totalMs: number;
  warpMs: number;
}

export interface LabRunImages {
  titleEnhanced: ScanImage;
  titleRaw: ScanImage;
  warp: ScanImage;
}

export interface LabParityHashes {
  recognitionQuadHash: string;
  sourceImageHash: string;
  titleCropHash: string;
  warpedCardHash: string;
}

export interface LabRunResult {
  crop: Rect;
  error: string | null;
  hashes?: LabParityHashes;
  images?: LabRunImages;
  matchName: string | null;
  matchScore: number | null;
  ocrInvoked: boolean;
  ocrText: string;
  ocrTransport: string;
  pipeline: LabPipelineId;
  timings: LabStageTimings;
  titleDecode?: import('../titleDecode').TitleDecodeResult;
  warpQuad: CardCorners | null;
}

export interface LabCompare {
  sameMatch: boolean;
  sameSource: true;
  sameTitleText: boolean;
  timeDeltaMs: number;
}

export const compareLabRuns = (baseline: LabRunResult, current: LabRunResult): LabCompare => ({
  sameMatch: (baseline.matchName ?? '') === (current.matchName ?? ''),
  sameSource: true,
  sameTitleText: baseline.ocrText.trim() === current.ocrText.trim(),
  timeDeltaMs: current.timings.totalMs - baseline.timings.totalMs,
});
