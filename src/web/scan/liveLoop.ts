// Latest-frame camera analysis loop for continuous scanning.
//
// Uses requestVideoFrameCallback when available; otherwise rAF. Never queues
// unbounded work — if analysis is busy, the next run uses the newest frame.
//
// Detection runs on a downscaled copy; when the card is stable we refine from
// the full-resolution video for sharpness gating + recognition.

import { captureNormalizedFromVideo } from './camera';
import { toScanImage } from './canvasBridge';

import { DETECT_ANALYSIS_MAX_WIDTH, DETECT_INTERVAL_MS } from '@/lib/scan/params';
import type {
  FrameHelpers,
  SessionController,
  SessionSnapshot,
} from '@/lib/scan/session/controller';
import type { ScanImage } from '@/lib/scan/types';

type VideoFrameCb = (
  now: number,
  metadata: { mediaTime: number; presentedFrames: number },
) => void;

type VideoWithFrameCb = HTMLVideoElement & {
  cancelVideoFrameCallback?: (handle: number) => void;
  requestVideoFrameCallback?: (cb: VideoFrameCb) => number;
};

export interface LiveLoop {
  start: () => void;
  stop: () => void;
}

export interface LiveLoopOptions {
  /** Request focus at normalized video coords (0–1). */
  requestFocusNorm?: (x: number, y: number) => void;
}

/**
 * Downscale the video into a ScanImage for cheap detection.
 * Full-res recognition crops come from captureNormalizedFromVideo.
 */
const frameToScanImage = (
  video: HTMLVideoElement,
  maxWidth = DETECT_ANALYSIS_MAX_WIDTH,
): ScanImage | null => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(32, Math.round(vw * scale));
  const h = Math.max(32, Math.round(vh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(video, 0, 0, w, h);
  return toScanImage(canvas);
};

export const startLiveLoop = (
  video: HTMLVideoElement,
  session: SessionController,
  onUpdate: (snap: SessionSnapshot) => void,
  options: LiveLoopOptions = {},
): LiveLoop => {
  let stopped = false;
  let busy = false;
  let dirty = false;
  let raf = 0;
  let vfc = 0;
  let lastDetect = 0;

  const helpers: FrameHelpers = {
    refineCard: (corners, analysisSize) =>
      captureNormalizedFromVideo(video, corners, analysisSize),
    requestFocusNorm: options.requestFocusNorm,
  };

  const tick = async () => {
    if (stopped || busy) {
      dirty = true;
      return;
    }
    const t = performance.now();
    if (t - lastDetect < DETECT_INTERVAL_MS) return;
    lastDetect = t;
    const frame = frameToScanImage(video);
    if (!frame) return;
    busy = true;
    dirty = false;
    try {
      const snap = await session.onFrame(frame, helpers);
      if (!stopped) onUpdate(snap);
    } finally {
      busy = false;
      if (dirty && !stopped) void tick();
    }
  };

  const schedule = () => {
    if (stopped) return;
    const v = video as VideoWithFrameCb;
    if (v.requestVideoFrameCallback) {
      vfc = v.requestVideoFrameCallback(() => {
        void tick();
        schedule();
      });
    } else {
      raf = requestAnimationFrame(() => {
        void tick();
        schedule();
      });
    }
  };

  return {
    start() {
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      const v = video as VideoWithFrameCb;
      if (vfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(vfc);
      if (raf) cancelAnimationFrame(raf);
    },
  };
};
