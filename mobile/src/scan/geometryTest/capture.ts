/**
 * One-shot hi-res capture for Geometry Test — no OCR / recognition.
 *
 * PRODUCT NOTE: the in-memory 744×1039 warp is ready at `warpDoneAt`.
 * A future production recognizer should consume that buffer immediately.
 * It must NOT wait for PNG encoding, filesystem persistence, preview display,
 * or benchmark upload. Geometry Test preview/persistence is UI overhead only.
 */

import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import { cornerMarginMetrics } from '@/lib/scan/geometryTest';
import { sharpnessScore } from '@/lib/scan/quality';
import type { CardCorners, ScanImage } from '@/lib/scan/types';
import type { CameraRef } from 'react-native-vision-camera';

import { HIRES_MAX_LONG_EDGE, type HiResSpaces } from '../hiresCapture';
import { mapCornersToHiRes } from '../hiresMap';
import { imageToScanImage } from '../imageToScanImage';

export type GeometryCaptureResult = {
  source: ScanImage;
  card: ScanImage;
  mapped: CardCorners;
  sharpness: number;
  /** After snapshot decode (before warp). */
  captureDoneAt: number;
  /** After 744×1039 warp — recognition-ready. */
  warpDoneAt: number;
  /** Telemetry: min corner inset in source pixels after FOV map. */
  minCornerMarginPixelsSource: number | null;
};

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const captureGeometryOnce = async (args: {
  cameraRef: { current: CameraRef | null };
  frozenQuad: CardCorners;
  spaces: HiResSpaces;
}): Promise<GeometryCaptureResult> => {
  const cam = args.cameraRef.current;
  if (!cam?.takeSnapshot) throw new Error('takeSnapshot is not available');
  const snap = await cam.takeSnapshot();
  try {
    const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
    const captureDoneAt = nowMs();
    const mapped = mapCornersToHiRes(args.frozenQuad, {
      dest: { height: source.height, width: source.width },
      detector: args.spaces.detector,
      kind: 'same-fov',
    });
    const card = warpQuadToCard(source, cornersToQuad(mapped));
    const warpDoneAt = nowMs();
    return {
      source,
      card,
      mapped,
      sharpness: sharpnessScore(card),
      captureDoneAt,
      warpDoneAt,
      /** Telemetry only — residual margin of mapped corners in source pixels. */
      minCornerMarginPixelsSource: cornerMarginMetrics({
        corners: mapped,
        frame: { width: source.width, height: source.height },
      }).minCornerMarginPixels,
    };
  } finally {
    snap.dispose();
  }
};
