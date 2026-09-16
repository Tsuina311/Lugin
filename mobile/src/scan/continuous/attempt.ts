/**
 * Continuous V0 recognition attempt — snapshot-first hot path.
 *
 * LIVE Y decides WHEN → takeSnapshot → detectFromRgba on frozen pixels
 * → seeded candidate → 744×1039 warp → ART_CROP → CLIP ∥ title OCR → fuse.
 */

import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import {
  CONTINUOUS_VISUAL_STRONG_MARGIN,
  CONTINUOUS_VISUAL_STRONG_SCORE,
  CONTINUOUS_VISUAL_WEAK_SCORE,
  selectSeededCandidate,
  type ContinuousOcrEvidence,
  type ContinuousVisualEvidence,
} from '@/lib/scan/continuous';
import { extractArtCropFromCard, type ArtCropVariant } from '@/lib/scan/regions';
import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';
import type { CardNameIndex } from '@/lib/scan/matchName';
import type { CardCorners, ScanImage } from '@/lib/scan/types';
import type { CameraRef } from 'react-native-vision-camera';

import { createNativeDetectorEngine, createSharedJsDetectorEngine } from '../detectorEngine';
import { HIRES_MAX_LONG_EDGE, type HiResSpaces } from '../hiresCapture';
import { mapCornersToHiRes } from '../hiresMap';
import { imageToScanImage } from '../imageToScanImage';
import { getOrCreateOcrRecognizer } from '../ocrAdapter';
import {
  recognizeArtCropRgba,
  type VisualHit,
} from '../visualRecognizer';

export type ContinuousAttemptTiming = {
  snapshotMs: number;
  redetectMs: number;
  warpMs: number;
  visualStartedAt: number;
  visualDoneAt: number;
  ocrStartedAt: number;
  ocrDoneAt: number;
  encoderMs: number | null;
  searchMs: number | null;
  totalMs: number;
};

export type ContinuousAttemptResult = {
  ok: boolean;
  error: string | null;
  liveSeed: CardCorners;
  snapshotQuad: CardCorners;
  seedSelectReason: string;
  artCropVariant: ArtCropVariant;
  visual: ContinuousVisualEvidence | null;
  visualHits: VisualHit[];
  ocr: ContinuousOcrEvidence | null;
  embeddingHandle: number;
  timing: ContinuousAttemptTiming;
  card: ScanImage | null;
  source: ScanImage | null;
};

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const scanImageToRgba = (img: ScanImage): Uint8Array =>
  new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);

const visualFromHits = (hits: VisualHit[]): ContinuousVisualEvidence | null => {
  const top = hits[0];
  if (!top) return null;
  return {
    name: top.name,
    oracleId: top.oracleId,
    score: top.score,
    margin: top.margin,
  };
};

const isVisualWeak = (v: ContinuousVisualEvidence | null): boolean => {
  if (!v) return true;
  if (v.score < CONTINUOUS_VISUAL_WEAK_SCORE) return true;
  if (
    v.margin != null &&
    v.margin < CONTINUOUS_VISUAL_STRONG_MARGIN &&
    v.score < CONTINUOUS_VISUAL_STRONG_SCORE
  ) {
    return true;
  }
  return false;
};

let detectorEngine: ReturnType<typeof createNativeDetectorEngine> | null = null;

const getDetector = () => {
  if (detectorEngine) return detectorEngine;
  try {
    detectorEngine = createNativeDetectorEngine();
  } catch {
    detectorEngine = createSharedJsDetectorEngine() as ReturnType<typeof createNativeDetectorEngine>;
  }
  return detectorEngine;
};

/**
 * One Continuous recognition attempt from a live-eligible seed quad.
 */
export const runContinuousAttempt = async (args: {
  cameraRef: { current: CameraRef | null };
  liveSeed: CardCorners;
  spaces: HiResSpaces;
  nameIndex: CardNameIndex | null;
  /** When false, skip OCR (CLIP-only). Default true. */
  runOcr?: boolean;
  topK?: number;
}): Promise<ContinuousAttemptResult> => {
  const t0 = nowMs();
  const cam = args.cameraRef.current;
  if (!cam?.takeSnapshot) {
    return emptyFail(args.liveSeed, 'takeSnapshot unavailable', t0);
  }

  let source: ScanImage | null = null;
  let card: ScanImage | null = null;
  const snap = await cam.takeSnapshot();
  let snapshotMs = 0;
  try {
    const tSnap = nowMs();
    source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
    snapshotMs = nowMs() - tSnap;
  } finally {
    snap.dispose();
  }
  if (!source) return emptyFail(args.liveSeed, 'snapshot decode failed', t0);

  const seedMapped = mapCornersToHiRes(args.liveSeed, {
    dest: { height: source.height, width: source.width },
    detector: args.spaces.detector,
    kind: 'same-fov',
  });

  const tDet = nowMs();
  const det = getDetector().detect(source);
  const candidates = (det.debug.candidates ?? [])
    .filter(c => c.corners && (!c.rejectedBecause || c.rejectedBecause.length === 0))
    .map(c => ({ corners: c.corners!, score: c.score }));
  // Always include detector winner if present.
  if (det.corners && !candidates.some(c => c.corners === det.corners)) {
    candidates.unshift({ corners: det.corners, score: det.score });
  }
  const picked = selectSeededCandidate({
    seed: seedMapped,
    candidates,
    frame: { width: source.width, height: source.height },
  });
  const snapshotQuad = picked.selected ?? seedMapped;
  const redetectMs = nowMs() - tDet;

  const tWarp = nowMs();
  card = warpQuadToCard(source, cornersToQuad(snapshotQuad));
  const warpMs = nowMs() - tWarp;

  const runOcr = args.runOcr !== false;
  const ocrEngine = runOcr ? getOrCreateOcrRecognizer() : null;

  let artCropVariant: ArtCropVariant = 'PRIMARY';
  const primary = extractArtCropFromCard(card, { variant: 'PRIMARY' });

  const visualStartedAt = nowMs();
  const ocrStartedAt = nowMs();

  const clipPromise = recognizeArtCropRgba(
    scanImageToRgba(primary.crop),
    primary.crop.width,
    primary.crop.height,
    args.topK ?? 5,
  );

  const ocrPromise = (async (): Promise<ContinuousOcrEvidence | null> => {
    if (!ocrEngine) return null;
    try {
      const captured = await recognizeCapturedCard({
        alreadyWarped: true,
        attemptId: 0,
        captureAt: t0,
        nameIndex: args.nameIndex,
        ocr: ocrEngine,
        recognitionQuad: snapshotQuad,
        source: card!,
        trackId: null,
      });
      if (!captured.matchName) return null;
      return {
        name: captured.matchName,
        oracleId: captured.oracleId,
        score: captured.matchScore ?? 0,
        exact: captured.status === 'identified' && (captured.matchScore ?? 0) >= 0.94,
      };
    } catch {
      return null;
    }
  })();

  let clip = await clipPromise;
  let visualDoneAt = nowMs();
  let hits = clip.hits;
  let visual = visualFromHits(hits);
  let embeddingHandle = clip.embeddingHandle;
  let encoderMs = clip.encoderMs;
  let searchMs = clip.searchMs;

  // Weak visual → ONE +5% oversize fallback (not +10%).
  if (isVisualWeak(visual) && clip.ok !== false) {
    artCropVariant = 'OVERSIZE_5';
    const secondary = extractArtCropFromCard(card, { variant: 'OVERSIZE_5' });
    const clip2 = await recognizeArtCropRgba(
      scanImageToRgba(secondary.crop),
      secondary.crop.width,
      secondary.crop.height,
      args.topK ?? 5,
    );
    visualDoneAt = nowMs();
    const v2 = visualFromHits(clip2.hits);
    if (v2 && (!visual || v2.score > visual.score)) {
      hits = clip2.hits;
      visual = v2;
      embeddingHandle = clip2.embeddingHandle;
      encoderMs = (encoderMs ?? 0) + (clip2.encoderMs ?? 0);
      searchMs = (searchMs ?? 0) + (clip2.searchMs ?? 0);
    }
  }

  const ocr = await ocrPromise;
  const ocrDoneAt = nowMs();

  return {
    ok: Boolean(visual || ocr),
    error: clip.error,
    liveSeed: args.liveSeed,
    snapshotQuad,
    seedSelectReason: picked.reason,
    artCropVariant,
    visual,
    visualHits: hits,
    ocr,
    embeddingHandle,
    timing: {
      snapshotMs,
      redetectMs,
      warpMs,
      visualStartedAt,
      visualDoneAt,
      ocrStartedAt,
      ocrDoneAt,
      encoderMs,
      searchMs,
      totalMs: nowMs() - t0,
    },
    card,
    source,
  };
};

const emptyFail = (
  liveSeed: CardCorners,
  error: string,
  t0: number,
): ContinuousAttemptResult => ({
  ok: false,
  error,
  liveSeed,
  snapshotQuad: liveSeed,
  seedSelectReason: 'failed',
  artCropVariant: 'PRIMARY',
  visual: null,
  visualHits: [],
  ocr: null,
  embeddingHandle: 0,
  timing: {
    snapshotMs: 0,
    redetectMs: 0,
    warpMs: 0,
    visualStartedAt: t0,
    visualDoneAt: t0,
    ocrStartedAt: t0,
    ocrDoneAt: t0,
    encoderMs: null,
    searchMs: null,
    totalMs: nowMs() - t0,
  },
  card: null,
  source: null,
});
