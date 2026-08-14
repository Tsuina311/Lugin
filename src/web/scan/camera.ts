// Camera access for the phone scanner.

export interface CameraSession {
  stop: () => void;
  stream: MediaStream;
  video: HTMLVideoElement;
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
      height: { ideal: 1920 },
      width: { ideal: 1080 },
    },
  });
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
 * Snapshot the current frame, cropped to the card guide.
 *
 * `guide` is the on-screen card rectangle in video-element CSS pixels; we map
 * that onto the actual video frame.
 */
export const captureCard = (
  video: HTMLVideoElement,
  guide: { height: number; left: number; top: number; width: number },
): HTMLCanvasElement => {
  const scaleX = video.videoWidth / video.clientWidth;
  const scaleY = video.videoHeight / video.clientHeight;
  const sx = Math.max(0, Math.round(guide.left * scaleX));
  const sy = Math.max(0, Math.round(guide.top * scaleY));
  const sw = Math.min(video.videoWidth - sx, Math.round(guide.width * scaleX));
  const sh = Math.min(video.videoHeight - sy, Math.round(guide.height * scaleY));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not open a canvas for the capture');
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
};
