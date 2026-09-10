// One-button fast-snapshot vs photo A/B. Not on the detector path.

import {
  FAST_SNAPSHOT_LABEL,
  PHOTO_LABEL,
  cardDensity,
  firstPassExactFromVariants,
  motionFromQuads,
  sideMetrics,
  tagsFromLabel,
  type CaptureQualityBundle,
  type CaptureSideRecord,
  type FocusAtCapture,
  type MotionSample,
} from '@/lib/scan/captureQuality';
import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import { extractTitleCrop } from '@/lib/scan/ocrInput';
import { TITLE_ONLY_MIN } from '@/lib/scan/ranking/fuse';
import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';
import type { CardNameIndex } from '@/lib/scan/matchName';
import type { TextRecognizer } from '@/lib/scan/textRecognizer';
import type { CardCorners, ScanImage } from '@/lib/scan/types';

import { annotateGeometryImage } from '../annotateQuads';
import { HIRES_MAX_LONG_EDGE, type HiResSpaces } from '../hiresCapture';
import { mapCornersToHiRes } from '../hiresMap';
import { scaleVisibleRect } from '../hiresMap';
import { imageToScanImage, photoToScanImage } from '../imageToScanImage';
import type { CameraPhotoOutput, CameraRef } from 'react-native-vision-camera';

/** Decode stills up to this long edge. Live recognition stays at HIRES_MAX_LONG_EDGE. */
export const PHOTO_BENCH_MAX_LONG_EDGE = 4096;

const clock = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export { tagsFromLabel };

const sideFromCapture = async (args: {
  acquireMs: number;
  convertMs: number;
  label: CaptureSideRecord['label'];
  mapped: CardCorners;
  nameIndex: CardNameIndex | null;
  nativeSize: { height: number; width: number } | null;
  ocr: TextRecognizer | null;
  source: ScanImage;
  warpMs: number;
}): Promise<{ card: ScanImage; overlay: ScanImage; record: CaptureSideRecord; title: ScanImage }> => {
  const t0 = clock();
  const warp = warpQuadToCard(args.source, cornersToQuad(args.mapped));
  const { image: title } = extractTitleCrop(warp);
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: args.nameIndex,
    ocr: args.ocr,
    recognitionQuad: args.mapped,
    source: args.source,
    trackId: 1,
  });
  const identityMs = clock() - t0;
  const overlay = annotateGeometryImage(args.source, { recognition: args.mapped });
  return {
    card: captured.warp ?? warp,
    overlay,
    title: captured.titleRaw ?? title,
    record: {
      decodedHeight: args.source.height,
      decodedWidth: args.source.width,
      density: cardDensity(args.source, args.mapped),
      label: args.label,
      metrics: sideMetrics(captured.warp ?? warp, captured.titleRaw ?? title),
      nativeHeight: args.nativeSize?.height ?? args.source.height,
      nativeWidth: args.nativeSize?.width ?? args.source.width,
      ocr: {
        decision: captured.titleDecode.decision,
        firstPassExact: firstPassExactFromVariants(captured.titleDecode.variants, TITLE_ONLY_MIN),
        matchName: captured.matchName,
        matchScore: captured.matchScore,
        ocrText: captured.ocrText,
        ocrVariantCount: captured.titleDecode.variants.filter(v => v.ocrText.trim()).length,
        rawOcrFirst: captured.titleDecode.variants[0]?.ocrText ?? '',
        reason: captured.titleDecode.reason,
        recognitionMs: captured.timings.totalMs,
        status: captured.status,
      },
      quad: args.mapped,
      timings: {
        captureRequestToSourceReadyMs: args.acquireMs + args.convertMs,
        convertMs: args.convertMs,
        fallbackOcrMs: captured.timings.fallbackOcrMs,
        firstOcrMs: captured.timings.firstOcrMs,
        lookupMs: captured.timings.lookupMs,
        sourceReadyToIdentityMs: identityMs,
        totalCaptureToIdentityMs: args.acquireMs + args.convertMs + identityMs,
        warpMs: args.warpMs + captured.timings.warpMs,
      },
    },
  };
};

export type CaptureQualityContext = {
  cameraRef: { current: CameraRef | null };
  detectorCorners: CardCorners;
  focus: FocusAtCapture;
  lockToCaptureStartMs: number | null;
  motion: MotionSample | null;
  nameIndex: CardNameIndex | null;
  ocr: TextRecognizer | null;
  photoOutput: CameraPhotoOutput | null;
  previousDetectorCorners: CardCorners | null;
  spaces: HiResSpaces;
};

export type CaptureQualityRun = CaptureQualityBundle & {
  images: {
    fastCard: ScanImage;
    fastOverlay: ScanImage;
    fastSource: ScanImage;
    fastTitle: ScanImage;
    photoCard: ScanImage;
    photoOverlay: ScanImage;
    photoSource: ScanImage;
    photoTitle: ScanImage;
  };
};

export const runCaptureQualityPair = async (
  ctx: CaptureQualityContext,
  label: string,
): Promise<CaptureQualityRun> => {
  const cam = ctx.cameraRef.current;
  if (!cam?.takeSnapshot) throw new Error('takeSnapshot is not available');
  if (!ctx.photoOutput) throw new Error('photo output is not attached');

  const capturedAt = new Date().toISOString();
  const tFast0 = clock();
  const snap = await cam.takeSnapshot();
  const acquireFast = clock() - tFast0;
  let fastSource: ScanImage;
  try {
    const t1 = clock();
    fastSource = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
    const convertFast = clock() - t1;
    const mappedFast = mapCornersToHiRes(ctx.detectorCorners, {
      dest: { height: fastSource.height, width: fastSource.width },
      detector: ctx.spaces.detector,
      kind: 'same-fov',
    });
    const fast = await sideFromCapture({
      acquireMs: acquireFast,
      convertMs: convertFast,
      label: FAST_SNAPSHOT_LABEL,
      mapped: mappedFast,
      nameIndex: ctx.nameIndex,
      nativeSize: { height: fastSource.height, width: fastSource.width },
      ocr: ctx.ocr,
      source: fastSource,
      warpMs: 0,
    });

    const tPhoto0 = clock();
    const photo = await ctx.photoOutput.capturePhoto(
      { enableShutterSound: false, flashMode: 'off' },
      {},
    );
    const acquirePhoto = clock() - tPhoto0;
    try {
      const t2 = clock();
      const converted = await photoToScanImage(photo, PHOTO_BENCH_MAX_LONG_EDGE);
      const convertPhoto = clock() - t2;
      const dest = { height: converted.image.height, width: converted.image.width };
      const mappedPhoto = mapCornersToHiRes(ctx.detectorCorners, {
        dest,
        destMirrored: photo.isMirrored,
        detector: ctx.spaces.detector,
        kind: 'oriented-full',
        oriented: dest,
        visible: scaleVisibleRect(ctx.spaces.visible, ctx.spaces.oriented, dest),
      });
      const photoSide = await sideFromCapture({
        acquireMs: acquirePhoto,
        convertMs: convertPhoto,
        label: PHOTO_LABEL,
        mapped: mappedPhoto,
        nameIndex: ctx.nameIndex,
        nativeSize: converted.nativeSize,
        ocr: ctx.ocr,
        source: converted.image,
        warpMs: 0,
      });

      const fixtureId = `cq-${capturedAt.replace(/[-:]/g, '').replace(/\..+$/, '')}`;

      return {
        capturedAt,
        fixtureId,
        focus: ctx.focus,
        gapAbMs: tPhoto0 - (tFast0 + acquireFast + convertFast),
        label,
        lockToCaptureStartMs: ctx.lockToCaptureStartMs,
        motion: ctx.motion ?? motionFromQuads(ctx.previousDetectorCorners, ctx.detectorCorners),
        photo: photoSide.record,
        snapshot: fast.record,
        tags: tagsFromLabel(label),
        images: {
          fastCard: fast.card,
          fastOverlay: fast.overlay,
          fastSource,
          fastTitle: fast.title,
          photoCard: photoSide.card,
          photoOverlay: photoSide.overlay,
          photoSource: converted.image,
          photoTitle: photoSide.title,
        },
      };
    } finally {
      photo.dispose();
    }
  } finally {
    snap.dispose();
  }
};
