// Camera access for the phone scanner.
//
// Acquisition, focus, torch/zoom, and mapping. Pixel inspection stays in
// `src/lib/scan/**`. Requested constraints ≠ actual settings — always read
// getSettings() after open.

import { drawToScanImage } from './canvasBridge';

import {
  buildContinuousFocusConstraints,
  buildPointFocusConstraints,
  cameraConstraintFallbacks,
  normalizeCapabilities,
  normalizeSettings,
  preferredMainLensZoom,
  supportsTapFocus,
  type ScannerCameraCapabilities,
  type ScannerCameraSettings,
} from '@/lib/scan/cameraCapabilities';
import { emptyDetectionDebug } from '@/lib/scan/detection/types';
import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import {
  prepareCard,
  prepareCardWithGuideFallback,
  type PreparedCard,
} from '@/lib/scan/prepareCard';
import { sharpnessScore } from '@/lib/scan/quality';
import type { CardCorners, Rect, ScanImage } from '@/lib/scan/types';
import { mapAnalysisToSource } from '@/lib/scan/videoMap';

export interface VideoDeviceInfo {
  deviceId: string;
  label: string;
}

export interface CameraDiagnostics {
  capabilities: ScannerCameraCapabilities;
  devices: VideoDeviceInfo[];
  display: { height: number; width: number };
  requested: string;
  settings: ScannerCameraSettings;
  supportsTapFocus: boolean;
  video: { height: number; width: number };
}

export interface CameraSession {
  diagnostics: () => Promise<CameraDiagnostics>;
  focusAt: (clientX: number, clientY: number) => Promise<boolean>;
  /** Focus/meter at normalized video coordinates (0–1). */
  focusAtNorm: (x: number, y: number) => Promise<boolean>;
  listDevices: () => Promise<VideoDeviceInfo[]>;
  setTorch: (on: boolean) => Promise<boolean>;
  setZoom: (zoom: number) => Promise<boolean>;
  stop: () => void;
  stream: MediaStream;
  supportsTapFocus: () => boolean;
  /** Tear down and reopen with an explicit deviceId (debug). */
  switchDevice: (deviceId: string) => Promise<void>;
  video: HTMLVideoElement;
}

export interface GuideRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** How far past the on-screen guide we capture so card edges are visible. */
const GUIDE_PAD = 0.22;

type TrackCaps = MediaTrackCapabilities & Record<string, unknown>;

const trackOf = (stream: MediaStream): MediaStreamTrack | null =>
  stream.getVideoTracks()[0] ?? null;

const readCaps = (track: MediaStreamTrack | null): ScannerCameraCapabilities => {
  if (!track?.getCapabilities) return {};
  try {
    return normalizeCapabilities(track.getCapabilities() as TrackCaps);
  } catch {
    return {};
  }
};

const readSettings = (track: MediaStreamTrack | null): ScannerCameraSettings => {
  if (!track?.getSettings) return {};
  try {
    return normalizeSettings(track.getSettings() as Record<string, unknown>);
  } catch {
    return {};
  }
};

const applyAdvanced = async (
  track: MediaStreamTrack,
  advanced: Record<string, unknown>,
): Promise<boolean> => {
  if (!track.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
};

const applyContinuousFocus = async (track: MediaStreamTrack | null): Promise<boolean> => {
  if (!track) return false;
  const advanced = buildContinuousFocusConstraints(readCaps(track));
  if (!advanced) {
    // Capabilities sometimes omit focusMode on Samsung — still ask.
    return applyAdvanced(track, { focusMode: 'continuous' });
  }
  return applyAdvanced(track, advanced);
};

/**
 * Avoid the ultrawide default on multi-lens Android phones (common on Galaxy S).
 * zoom.min < 1 → ultrawide; zoom = 1 → main camera with usable close focus.
 */
const preferMainLens = async (track: MediaStreamTrack | null): Promise<boolean> => {
  if (!track) return false;
  const target = preferredMainLensZoom(readCaps(track));
  if (target == null) return false;
  const settings = readSettings(track);
  if (settings.zoom != null && Math.abs(settings.zoom - target) < 0.05) return true;
  return applyAdvanced(track, { zoom: target });
};

/** Run every focus attempt until one succeeds; then restore continuous AF. */
const nudgeFocusAt = async (
  track: MediaStreamTrack,
  point: { x: number; y: number },
): Promise<boolean> => {
  const caps = readCaps(track);
  let ok = false;
  for (const advanced of buildPointFocusConstraints(caps, point)) {
    if (await applyAdvanced(track, advanced)) ok = true;
  }
  // Always try to land back in continuous so the preview keeps hunting.
  await applyAdvanced(track, { focusMode: 'continuous' });
  return ok;
};

const getUserMediaVideo = async (
  videoConstraints: MediaTrackConstraints | boolean,
): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });

/**
 * Staged rear-camera acquisition: prefer 1080p environment, then simplify.
 * Always inspect actual settings after grant.
 */
const openStream = async (deviceId?: string): Promise<{ requested: string; stream: MediaStream }> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot open the camera.');
  }
  const steps = cameraConstraintFallbacks(deviceId);
  const labels = deviceId
    ? [`device ${deviceId.slice(0, 8)}… 1920×1080`, 'device 1280×720', 'device any']
    : ['environment 1920×1080 @30', 'environment 1280×720', 'environment any', 'any camera'];

  let lastErr: unknown;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const stream = await getUserMediaVideo(step as MediaTrackConstraints | boolean);
      return { requested: labels[i] ?? `step ${i}`, stream };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not open the camera.');
};

const bindVideo = async (video: HTMLVideoElement, stream: MediaStream): Promise<void> => {
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  // Prefer the source resolution for layout math; CSS may still scale the preview.
  video.style.objectFit = 'cover';
  await video.play();
};

/** Open the rear camera into a video element. Caller must stop() when done. */
export const openCamera = async (video: HTMLVideoElement): Promise<CameraSession> => {
  const opened = await openStream();
  let currentStream = opened.stream;
  let requestedLabel = opened.requested;

  await preferMainLens(trackOf(currentStream));
  await applyContinuousFocus(trackOf(currentStream));
  await bindVideo(video, currentStream);

  const refreshTrack = () => trackOf(currentStream);

  const session: CameraSession = {
    async diagnostics() {
      const track = refreshTrack();
      const caps = readCaps(track);
      const settings = readSettings(track);
      return {
        capabilities: caps,
        devices: await session.listDevices(),
        display: { height: video.clientHeight, width: video.clientWidth },
        requested: requestedLabel,
        settings,
        supportsTapFocus: supportsTapFocus(caps),
        video: { height: video.videoHeight, width: video.videoWidth },
      };
    },

    focusAt: (clientX, clientY) => focusAtPoint(currentStream, video, clientX, clientY),

    async focusAtNorm(x, y) {
      const track = refreshTrack();
      if (!track) return false;
      return nudgeFocusAt(track, {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      });
    },

    async listDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter(d => d.kind === 'videoinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 6)}`,
        }));
    },

    async setTorch(on) {
      const track = refreshTrack();
      if (!track || !readCaps(track).torch) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return true;
      } catch {
        return false;
      }
    },

    async setZoom(zoom) {
      const track = refreshTrack();
      const range = readCaps(track).zoom;
      if (!track || !range) return false;
      const min = range.min ?? 1;
      const max = range.max ?? min;
      const clamped = Math.min(max, Math.max(min, zoom));
      try {
        await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
        return true;
      } catch {
        return false;
      }
    },

    stop: () => {
      for (const t of currentStream.getTracks()) t.stop();
      video.srcObject = null;
    },

    get stream() {
      return currentStream;
    },

    supportsTapFocus: () => supportsTapFocus(readCaps(refreshTrack())),

    async switchDevice(deviceId) {
      for (const t of currentStream.getTracks()) t.stop();
      const next = await openStream(deviceId);
      currentStream = next.stream;
      requestedLabel = next.requested;
      await preferMainLens(trackOf(currentStream));
      await applyContinuousFocus(trackOf(currentStream));
      await bindVideo(video, currentStream);
    },

    video,
  };

  return session;
};

/**
 * Map a tap on the video element (object-fit: cover) to normalized 0–1
 * coordinates in the underlying video frame.
 */
export const clientToVideoNorm = (
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null => {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || rect.width <= 0 || rect.height <= 0) return null;

  const videoAspect = vw / vh;
  const elemAspect = rect.width / rect.height;
  let renderW: number;
  let renderH: number;
  let offsetX: number;
  let offsetY: number;
  if (videoAspect > elemAspect) {
    renderH = rect.height;
    renderW = rect.height * videoAspect;
    offsetX = (rect.width - renderW) / 2;
    offsetY = 0;
  } else {
    renderW = rect.width;
    renderH = rect.width / videoAspect;
    offsetX = 0;
    offsetY = (rect.height - renderH) / 2;
  }

  const lx = clientX - rect.left - offsetX;
  const ly = clientY - rect.top - offsetY;
  if (lx < 0 || ly < 0 || lx > renderW || ly > renderH) return null;

  return {
    x: Math.min(1, Math.max(0, lx / renderW)),
    y: Math.min(1, Math.max(0, ly / renderH)),
  };
};

/**
 * Ask the camera to focus (and meter) at a tap point.
 * Best-effort on Samsung/Chrome — POI is often missing; we still nudge AF.
 */
export const focusAtPoint = async (
  stream: MediaStream,
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): Promise<boolean> => {
  const point = clientToVideoNorm(video, clientX, clientY);
  if (!point) return false;
  const track = trackOf(stream);
  if (!track?.applyConstraints) return false;
  return nudgeFocusAt(track, point);
};

/**
 * Map a CSS-pixel rect on a video element (object-fit: cover) onto source-frame
 * pixels. A naive width/clientWidth scale is wrong when the feed is cropped.
 */
export const guideToSource = (video: HTMLVideoElement, guide: GuideRect): Rect => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  if (!vw || !vh || !ew || !eh) return { h: 1, w: 1, x: 0, y: 0 };

  const videoAspect = vw / vh;
  const elemAspect = ew / eh;
  let renderW: number;
  let renderH: number;
  let offsetX: number;
  let offsetY: number;
  if (videoAspect > elemAspect) {
    renderH = eh;
    renderW = eh * videoAspect;
    offsetX = (ew - renderW) / 2;
    offsetY = 0;
  } else {
    renderW = ew;
    renderH = ew / videoAspect;
    offsetX = 0;
    offsetY = (eh - renderH) / 2;
  }

  const scaleX = vw / renderW;
  const scaleY = vh / renderH;
  const x = Math.max(0, Math.round((guide.left - offsetX) * scaleX));
  const y = Math.max(0, Math.round((guide.top - offsetY) * scaleY));
  return {
    h: Math.max(1, Math.min(vh - y, Math.round(guide.height * scaleY))),
    w: Math.max(1, Math.min(vw - x, Math.round(guide.width * scaleX))),
    x,
    y,
  };
};

/** Snapshot the current frame, cropped to the card guide. */
export const captureCard = (video: HTMLVideoElement, guide: GuideRect): ScanImage =>
  drawToScanImage(video, guideToSource(video, guide));

/**
 * Warp a high-resolution card from the live video using analysis-space corners.
 * Detection stays cheap; recognition gets the sharp source crop.
 */
export const captureNormalizedFromVideo = (
  video: HTMLVideoElement,
  corners: CardCorners,
  analysisSize: { height: number; width: number },
): PreparedCard | null => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const source = { height: vh, width: vw };
  const mapped: CardCorners = {
    bottomLeft: mapAnalysisToSource(corners.bottomLeft, analysisSize, source),
    bottomRight: mapAnalysisToSource(corners.bottomRight, analysisSize, source),
    topLeft: mapAnalysisToSource(corners.topLeft, analysisSize, source),
    topRight: mapAnalysisToSource(corners.topRight, analysisSize, source),
  };

  // Grab a padded axis-aligned crop of the full video, then warp within it.
  const xs = [
    mapped.topLeft.x,
    mapped.topRight.x,
    mapped.bottomRight.x,
    mapped.bottomLeft.x,
  ];
  const ys = [
    mapped.topLeft.y,
    mapped.topRight.y,
    mapped.bottomRight.y,
    mapped.bottomLeft.y,
  ];
  const minX = Math.max(0, Math.floor(Math.min(...xs) - 8));
  const minY = Math.max(0, Math.floor(Math.min(...ys) - 8));
  const maxX = Math.min(vw, Math.ceil(Math.max(...xs) + 8));
  const maxY = Math.min(vh, Math.ceil(Math.max(...ys) + 8));
  const w = Math.max(32, maxX - minX);
  const h = Math.max(32, maxY - minY);
  const crop = drawToScanImage(video, { h, w, x: minX, y: minY });
  const local: CardCorners = {
    bottomLeft: { x: mapped.bottomLeft.x - minX, y: mapped.bottomLeft.y - minY },
    bottomRight: { x: mapped.bottomRight.x - minX, y: mapped.bottomRight.y - minY },
    topLeft: { x: mapped.topLeft.x - minX, y: mapped.topLeft.y - minY },
    topRight: { x: mapped.topRight.x - minX, y: mapped.topRight.y - minY },
  };
  const image = warpQuadToCard(crop, cornersToQuad(local));
  return {
    corners: mapped,
    detected: true,
    detection: emptyDetectionDebug(),
    image,
    score: 1,
    source: 'detected',
  };
};

export interface BestFrame {
  frames: number;
  image: ScanImage;
  sharpness: number;
}

/**
 * Grab a few frames ~90ms apart and keep the sharpest. Helps when autofocus is
 * still settling (especially on a glowing phone/monitor screen).
 */
export const captureBestCard = async (
  video: HTMLVideoElement,
  guide: GuideRect,
  frames = 3,
): Promise<BestFrame> => {
  let best: ScanImage | null = null;
  let bestScore = -1;
  for (let i = 0; i < frames; i++) {
    if (i > 0) await wait(90);
    const shot = captureCard(video, guide);
    const score = sharpnessScore(shot);
    if (score > bestScore) {
      bestScore = score;
      best = shot;
    }
  }
  const image = best ?? captureCard(video, guide);
  return { frames, image, sharpness: Math.max(0, bestScore) };
};

export interface Capture {
  card: PreparedCard;
  frame: ScanImage;
  sharpness: number;
}

/**
 * Capture around the guide, detect the card quad, perspective-correct, and
 * emit a normalized upright card. Falls back to the guide rectangle if
 * detection fails.
 */
export const capturePreparedCard = async (
  video: HTMLVideoElement,
  guide: GuideRect,
): Promise<Capture> => {
  const padded: GuideRect = {
    height: guide.height * (1 + 2 * GUIDE_PAD),
    left: guide.left - guide.width * GUIDE_PAD,
    top: guide.top - guide.height * GUIDE_PAD,
    width: guide.width * (1 + 2 * GUIDE_PAD),
  };
  const { image, sharpness } = await captureBestCard(video, padded);
  const inset = GUIDE_PAD / (1 + 2 * GUIDE_PAD);
  const card = prepareCardWithGuideFallback(image, {
    h: 1 - 2 * inset,
    w: 1 - 2 * inset,
    x: inset,
    y: inset,
  });
  return { card, frame: image, sharpness };
};

/** Load a still and run the same detect → warp pipeline. */
export const imageFromFile = async (file: File): Promise<Capture> => {
  const bitmap = await createImageBitmap(file);
  try {
    const frame = drawToScanImage(bitmap, {
      h: bitmap.height,
      w: bitmap.width,
      x: 0,
      y: 0,
    });
    return { card: prepareCard(frame), frame, sharpness: sharpnessScore(frame) };
  } finally {
    bitmap.close();
  }
};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type { PreparedCard };
