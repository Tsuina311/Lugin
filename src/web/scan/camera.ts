// Camera access for the phone scanner.

export interface CameraSession {
  stop: () => void;
  stream: MediaStream;
  video: HTMLVideoElement;
}

export interface GuideRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** Open the rear camera into a video element. Caller must stop() when done. */
export const openCamera = async (video: HTMLVideoElement): Promise<CameraSession> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot open the camera.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      // Prefer a high still; phones often downscale if we only ask for 1080.
      height: { ideal: 2160 },
      width: { ideal: 3840 },
    },
  });

  // Best-effort focus / exposure — ignored when the browser doesn't support them.
  const [track] = stream.getVideoTracks();
  if (track?.getCapabilities && track.applyConstraints) {
    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      focusMode?: string[];
      exposureMode?: string[];
    };
    const advanced: MediaTrackConstraintSet = {};
    if (caps.focusMode?.includes('continuous')) {
      (advanced as { focusMode?: string }).focusMode = 'continuous';
    }
    if (caps.exposureMode?.includes('continuous')) {
      (advanced as { exposureMode?: string }).exposureMode = 'continuous';
    }
    if (Object.keys(advanced).length) {
      try {
        await track.applyConstraints({ advanced: [advanced] });
      } catch {
        // Capabilities lie on some Android WebViews — ignore.
      }
    }
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();
  return {
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
    stream,
    video,
  };
};

/**
 * Map a CSS-pixel rect on a video element (object-fit: cover) onto source-frame
 * pixels. A naive width/clientWidth scale is wrong when the feed is cropped.
 */
export const guideToSource = (
  video: HTMLVideoElement,
  guide: GuideRect,
): { sx: number; sy: number; sw: number; sh: number } => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ew = video.clientWidth;
  const eh = video.clientHeight;
  if (!vw || !vh || !ew || !eh) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  const videoAspect = vw / vh;
  const elemAspect = ew / eh;
  let renderW: number;
  let renderH: number;
  let offsetX: number;
  let offsetY: number;
  if (videoAspect > elemAspect) {
    // Wider than the box → crop left/right.
    renderH = eh;
    renderW = eh * videoAspect;
    offsetX = (ew - renderW) / 2;
    offsetY = 0;
  } else {
    // Taller than the box → crop top/bottom.
    renderW = ew;
    renderH = ew / videoAspect;
    offsetX = 0;
    offsetY = (eh - renderH) / 2;
  }

  const scaleX = vw / renderW;
  const scaleY = vh / renderH;
  const sx = Math.max(0, Math.round((guide.left - offsetX) * scaleX));
  const sy = Math.max(0, Math.round((guide.top - offsetY) * scaleY));
  const sw = Math.min(vw - sx, Math.round(guide.width * scaleX));
  const sh = Math.min(vh - sy, Math.round(guide.height * scaleY));
  return { sx, sy, sw: Math.max(1, sw), sh: Math.max(1, sh) };
};

/**
 * Snapshot the current frame, cropped to the card guide.
 *
 * `guide` is the on-screen card rectangle in video-element CSS pixels.
 */
export const captureCard = (
  video: HTMLVideoElement,
  guide: GuideRect,
): HTMLCanvasElement => {
  const { sx, sy, sw, sh } = guideToSource(video, guide);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a canvas for the capture');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
};

/** Rough focus score — higher = sharper. Used to pick the best of a few frames. */
export const sharpnessScore = (canvas: HTMLCanvasElement): number => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { width, height } = canvas;
  // Sample a mid band; full-frame Laplacian is expensive on 4K.
  const sampleH = Math.max(32, Math.floor(height * 0.35));
  const sampleY = Math.floor((height - sampleH) / 2);
  const { data } = ctx.getImageData(0, sampleY, width, sampleH);
  let prev = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const d = y - prev;
    sum += d;
    sumSq += d * d;
    prev = y;
    n += 1;
  }
  if (n < 2) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
};

/**
 * Grab a few frames ~90ms apart and keep the sharpest. Helps when autofocus is
 * still settling (especially on a glowing phone/monitor screen).
 */
export const captureBestCard = async (
  video: HTMLVideoElement,
  guide: GuideRect,
  frames = 3,
): Promise<HTMLCanvasElement> => {
  let best: HTMLCanvasElement | null = null;
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
  return best ?? captureCard(video, guide);
};

/** Load a still (screenshot / photo library) into a card-sized canvas. */
export const canvasFromFile = async (file: File): Promise<HTMLCanvasElement> => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a canvas for the photo');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
