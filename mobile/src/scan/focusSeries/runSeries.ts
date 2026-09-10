// Lab-only: one fresh focus request, then four fast snapshots at measured offsets.
// Each snapshot freezes the latest valid recognitionQuad at that capture time.

import {
  cardBoundsPx,
  cardDensity,
  firstPassExactFromVariants,
  motionFromQuads,
  sideMetrics,
  tagsFromLabel,
} from '@/lib/scan/captureQuality';
import { localContrast } from '@/lib/scan/captureQuality/metrics';
import {
  FOCUS_SERIES_OFFSETS_MS,
  attachFocusSeriesDiagnostics,
  quadsNearlyIdentical,
  type FocusSeriesBundle,
  type FocusSeriesNominalMs,
  type FocusSeriesSample,
} from '@/lib/scan/focusSeries';
import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import { extractTitleCrop } from '@/lib/scan/ocrInput';
import { sharpnessScore } from '@/lib/scan/quality';
import { TITLE_ONLY_MIN } from '@/lib/scan/ranking/fuse';
import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';
import { durationMs, monoNow } from '@/lib/scan/timing';
import { cropRect } from '@/lib/scan/types';
import type { CardNameIndex } from '@/lib/scan/matchName';
import type { TextRecognizer } from '@/lib/scan/textRecognizer';
import type { CardCorners, ScanImage } from '@/lib/scan/types';

import { annotateGeometryImage } from '../annotateQuads';
import { HIRES_MAX_LONG_EDGE, type HiResSpaces } from '../hiresCapture';
import { mapCornersToHiRes } from '../hiresMap';
import { imageToScanImage } from '../imageToScanImage';
import { requestFocusOnCamera } from '../nativeHelpers';
import type { CameraRef } from 'react-native-vision-camera';

export type FocusSeriesRun = FocusSeriesBundle & {
  images: Record<
    FocusSeriesNominalMs,
    { card: ScanImage; overlay: ScanImage; source: ScanImage; title: ScanImage }
  >;
};

export type FocusSeriesLatch = {
  detectorCorners: CardCorners;
  quadTimestamp: number | null;
  recognitionQuadSource: string | null;
  recognitionQuadValid: boolean | null;
  spaces: HiResSpaces;
  trackId: number | null;
};

export type FocusSeriesContext = {
  cameraRef: { current: CameraRef | null };
  focusAttemptId: number | null;
  focusNorm: { x: number; y: number };
  focusTrackId: number | null;
  currentTrackId: number | null;
  nameIndex: CardNameIndex | null;
  ocr: TextRecognizer | null;
  peekLatest: () => FocusSeriesLatch | null;
  preview: { height: number; width: number };
};

const waitUntil = async (targetMono: number): Promise<void> => {
  while (monoNow() < targetMono) {
    const left = targetMono - monoNow();
    await new Promise(r => setTimeout(r, Math.max(4, Math.min(20, left))));
  }
};

const cropSourceCard = (source: ScanImage, quad: CardCorners): ScanImage | null => {
  const b = cardBoundsPx(quad);
  const x = Math.max(0, Math.min(source.width - 1, Math.floor(Math.min(quad.topLeft.x, quad.topRight.x, quad.bottomRight.x, quad.bottomLeft.x))));
  const y = Math.max(0, Math.min(source.height - 1, Math.floor(Math.min(quad.topLeft.y, quad.topRight.y, quad.bottomRight.y, quad.bottomLeft.y))));
  const w = Math.max(1, Math.min(source.width - x, Math.round(b.cardBoundingWidthPx)));
  const h = Math.max(1, Math.min(source.height - y, Math.round(b.cardBoundingHeightPx)));
  if (w < 8 || h < 8) return null;
  return cropRect(source, { h, w, x, y });
};

const latchAtCapture = (
  peekLatest: () => FocusSeriesLatch | null,
  lastValid: FocusSeriesLatch | null,
  captureMono: number,
): { latch: FocusSeriesLatch; from: 'live' | 'last-valid' } => {
  const live = peekLatest();
  if (live) {
    const sameAsLast =
      lastValid != null &&
      lastValid.quadTimestamp != null &&
      quadsNearlyIdentical(lastValid.detectorCorners, live.detectorCorners);
    return {
      from: 'live',
      latch: {
        ...live,
        quadTimestamp: sameAsLast ? lastValid.quadTimestamp : captureMono,
      },
    };
  }
  if (lastValid) {
    return { from: 'last-valid', latch: lastValid };
  }
  throw new Error('no valid recognitionQuad at snapshot — keep the live camera on the same card');
};

export const runFocusSeries = async (
  ctx: FocusSeriesContext,
  label: string,
): Promise<FocusSeriesRun> => {
  const cam = ctx.cameraRef.current;
  if (!cam?.takeSnapshot) throw new Error('takeSnapshot is not available');
  if (ctx.preview.width <= 0 || ctx.preview.height <= 0) {
    throw new Error('preview size unknown — keep the live camera up');
  }

  requestFocusOnCamera(cam, ctx.preview, ctx.focusNorm.x, ctx.focusNorm.y);
  const focusRequestedAt = monoNow();

  const captured: {
    actualDelayFromFocusRequestMs: number;
    capturedAtMono: number;
    latch: FocusSeriesLatch;
    latchedFrom: 'live' | 'last-valid';
    nominalDelayMs: FocusSeriesNominalMs;
    previousDetector: CardCorners | null;
    source: ScanImage;
  }[] = [];

  const peeked = ctx.peekLatest();
  let lastValid = peeked ? { ...peeked, quadTimestamp: null } : null;
  let previousDetector = lastValid?.detectorCorners ?? null;

  for (const nominal of FOCUS_SERIES_OFFSETS_MS) {
    await waitUntil(focusRequestedAt + nominal);
    const snap = await cam.takeSnapshot();
    const capturedAtMono = monoNow();
    try {
      const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
      const { from, latch } = latchAtCapture(ctx.peekLatest, lastValid, capturedAtMono);
      if (from === 'live') lastValid = latch;
      captured.push({
        actualDelayFromFocusRequestMs: capturedAtMono - focusRequestedAt,
        capturedAtMono,
        latch,
        latchedFrom: from,
        nominalDelayMs: nominal,
        previousDetector,
        source,
      });
      previousDetector = latch.detectorCorners;
    } finally {
      snap.dispose();
    }
  }

  const images = {} as FocusSeriesRun['images'];
  const rawSamples: FocusSeriesSample[] = [];
  const trackIds = new Set<number>();

  for (const item of captured) {
    const mapped = mapCornersToHiRes(item.latch.detectorCorners, {
      dest: { height: item.source.height, width: item.source.width },
      detector: item.latch.spaces.detector,
      kind: 'same-fov',
    });
    const warp = warpQuadToCard(item.source, cornersToQuad(mapped));
    const { image: title } = extractTitleCrop(warp);
    const overlay = annotateGeometryImage(item.source, { recognition: mapped });
    const sourceCard = cropSourceCard(item.source, mapped);
    const t0 = monoNow();
    const recognized = await recognizeCapturedCard({
      alreadyWarped: false,
      attemptId: 1,
      captureAt: null,
      nameIndex: ctx.nameIndex,
      ocr: ctx.ocr,
      recognitionQuad: mapped,
      source: item.source,
      trackId: item.latch.trackId ?? ctx.currentTrackId,
    });
    const recognitionMs = monoNow() - t0;
    const card = recognized.warp ?? warp;
    const titleImg = recognized.titleRaw ?? title;
    images[item.nominalDelayMs] = { card, overlay, source: item.source, title: titleImg };
    if (item.latch.trackId != null) trackIds.add(item.latch.trackId);
    rawSamples.push({
      actualDelayFromFocusRequestMs: item.actualDelayFromFocusRequestMs,
      cardContrast: localContrast(card),
      density: cardDensity(item.source, mapped),
      failureClass: null,
      geometry: null,
      metrics: sideMetrics(card, titleImg),
      motion: motionFromQuads(item.previousDetector, item.latch.detectorCorners),
      nominalDelayMs: item.nominalDelayMs,
      ocr: {
        decision: recognized.titleDecode.decision,
        firstPassExact: firstPassExactFromVariants(recognized.titleDecode.variants, TITLE_ONLY_MIN),
        matchName: recognized.matchName,
        matchScore: recognized.matchScore,
        ocrText: recognized.ocrText,
        ocrVariantCount: recognized.titleDecode.variants.filter(v => v.ocrText.trim()).length,
        rawOcrFirst: recognized.titleDecode.variants[0]?.ocrText ?? '',
        reason: recognized.titleDecode.reason,
        recognitionMs,
        status: recognized.status,
      },
      quad: mapped,
      quadAgeAtCaptureMs: durationMs(item.latch.quadTimestamp, item.capturedAtMono),
      quadLatchedFrom: item.latchedFrom,
      quadTimestamp: item.latch.quadTimestamp,
      recognitionQuadSource: item.latch.recognitionQuadSource,
      recognitionQuadValid: item.latch.recognitionQuadValid,
      sourceCardContrast: sourceCard ? localContrast(sourceCard) : null,
      sourceCardSharpness: sourceCard ? sharpnessScore(sourceCard) : null,
      sourceContrast: localContrast(item.source),
      sourceHeight: item.source.height,
      sourceSharpness: sharpnessScore(item.source),
      sourceWidth: item.source.width,
      trackId: item.latch.trackId,
    });
  }

  const samples = attachFocusSeriesDiagnostics(rawSamples);
  const capturedAt = new Date().toISOString();
  const trackChangedDuringSeries = trackIds.size > 1;
  return {
    capturedAt,
    currentTrackId: ctx.currentTrackId,
    fixtureId: `focus-series-${capturedAt.replace(/[-:]/g, '').replace(/\..+$/, '')}`,
    focusAttemptId: ctx.focusAttemptId,
    focusRequestedAt,
    focusTrackId: ctx.focusTrackId,
    images,
    label,
    quadMode: 'per-snapshot',
    sameTrackFocus: ctx.focusTrackId != null && ctx.focusTrackId === ctx.currentTrackId,
    samples,
    tags: tagsFromLabel(label),
    trackChangedDuringSeries,
  };
};
