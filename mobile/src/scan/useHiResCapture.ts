// On-demand high-res acquisition. Never runs at detector cadence.
//
// Order (default): snapshot → photo → analysis-fallback.
// Snapshot is preview-FOV (same-fov map). Photo is a still; we treat it as
// oriented-full and map through the analysis visible rect.
// A dedicated higher-res frame output is optional and armed only for one copy.

import { useRef } from 'react';

import type { CameraPhotoOutput, CameraRef, Photo } from 'react-native-vision-camera';

import {
  HIRES_MAX_LONG_EDGE,
  emptyHiResStore,
  mapAndWarp,
  putFallback,
  type HiResAttempt,
  type HiResCache,
  type HiResSpaces,
  type HiResStore,
  type PreferredSource,
  type RecognitionSource,
} from './hiresCapture';
import { scaleVisibleRect } from './hiresMap';
import { imageToScanImage, photoToScanImage } from './imageToScanImage';
import type { CardCorners, ScanImage } from './sharedCore';

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export interface CaptureRequest {
  analysis: ScanImage;
  corners: CardCorners;
  score: number;
  spaces: HiResSpaces;
}

export const createHiResCapturer = (deps: {
  cameraRef: { current: CameraRef | null };
  photoOutput: CameraPhotoOutput | null;
  store: HiResStore;
}) => {
  const captureSnapshot = async (req: CaptureRequest): Promise<HiResCache> => {
    const cam = deps.cameraRef.current;
    if (!cam?.takeSnapshot) throw new Error('Preview snapshot is not available');
    const t0 = now();
    const snap = await cam.takeSnapshot();
    const acquireMs = now() - t0;
    try {
      const t1 = now();
      const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
      const convertMs = now() - t1;
      const { mapped, prepared, warpMs } = mapAndWarp(
        source,
        req.corners,
        req.spaces.detector,
        'same-fov',
        req.spaces,
        false,
        req.score,
      );
      const attempt: HiResAttempt = {
        acquireMs,
        convertMs,
        mode: 'snapshot',
        previewInterrupted: false,
        sourceSize: { height: source.height, width: source.width },
        warpMs,
      };
      return { attempt, corners: req.corners, mapped, prepared, source };
    } finally {
      snap.dispose();
    }
  };

  const capturePhoto = async (req: CaptureRequest): Promise<HiResCache> => {
    const out = deps.photoOutput;
    if (!out) throw new Error('Photo output is not attached');
    const t0 = now();
    let photo: Photo | null = null;
    try {
      photo = await out.capturePhoto({ enableShutterSound: false, flashMode: 'off' }, {});
      const acquireMs = now() - t0;
      const t1 = now();
      const { image: source } = await photoToScanImage(photo, HIRES_MAX_LONG_EDGE);
      const convertMs = now() - t1;
      const dest = { height: source.height, width: source.width };
      const remapped = mapAndWarp(
        source,
        req.corners,
        req.spaces.detector,
        'oriented-full',
        {
          ...req.spaces,
          oriented: dest,
          visible: scaleVisibleRect(req.spaces.visible, req.spaces.oriented, dest),
        },
        photo.isMirrored,
        req.score,
      );
      const attempt: HiResAttempt = {
        acquireMs,
        convertMs,
        mode: 'photo',
        previewInterrupted: true,
        sourceSize: dest,
        warpMs: remapped.warpMs,
      };
      return {
        attempt,
        corners: req.corners,
        mapped: remapped.mapped,
        prepared: remapped.prepared,
        source,
      };
    } finally {
      photo?.dispose();
    }
  };

  return { capturePhoto, captureSnapshot };
};

export const useHiResStore = () => {
  const store = useRef(emptyHiResStore());
  return store;
};

export const runPreferredCapture = async (
  preferred: PreferredSource,
  capturer: ReturnType<typeof createHiResCapturer>,
  req: CaptureRequest,
  store: HiResStore,
  takeHiResFrame?: () => Promise<ScanImage | null>,
): Promise<HiResCache> => {
  const order: PreferredSource[] =
    preferred === 'photo'
      ? ['photo', 'snapshot', 'high-res-frame']
      : preferred === 'high-res-frame'
        ? ['high-res-frame', 'snapshot', 'photo']
        : ['snapshot', 'photo', 'high-res-frame'];

  const errors: string[] = [];
  for (const mode of order) {
    try {
      if (mode === 'snapshot') return await capturer.captureSnapshot(req);
      if (mode === 'photo') return await capturer.capturePhoto(req);
      if (mode === 'high-res-frame') {
        if (!takeHiResFrame) throw new Error('high-res frame latch is not armed');
        const t0 = now();
        const source = await takeHiResFrame();
        if (!source) throw new Error('high-res frame produced no pixels');
        const acquireMs = now() - t0;
        const { mapped, prepared, warpMs } = mapAndWarp(
          source,
          req.corners,
          req.spaces.detector,
          'same-fov',
          req.spaces,
          false,
          req.score,
        );
        return {
          attempt: {
            acquireMs,
            convertMs: 0,
            mode: 'high-res-frame',
            previewInterrupted: false,
            sourceSize: { height: source.height, width: source.width },
            warpMs,
          },
          corners: req.corners,
          mapped,
          prepared,
          source,
        };
      }
    } catch (err) {
      errors.push(`${mode}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const fallback = putFallback(store, req.analysis, req.corners, req.score);
  store.lastAttempt = {
    ...store.lastAttempt!,
    reason: errors.join(' · ') || 'all high-res sources failed',
  };
  return store.cache ?? {
    attempt: store.lastAttempt!,
    corners: req.corners,
    mapped: req.corners,
    prepared: fallback,
    source: req.analysis,
  };
};

export type { RecognitionSource };
