// Strip EXIF/GPS by re-encoding through canvas. Never upload camera File blobs.

import {
  CORPUS_CARD_MAX_EDGE,
  CORPUS_FULL_FRAME_MAX_EDGE,
  CORPUS_JPEG_QUALITY,
} from '@/lib/scan/corpus/policy';
import type { ScanImage } from '@/lib/scan/types';
import { toCanvas } from '../canvasBridge';

export interface SanitizedImage {
  blob: Blob;
  height: number;
  mimeType: 'image/jpeg';
  width: number;
}

const encodeCanvas = (
  canvas: HTMLCanvasElement,
  quality = CORPUS_JPEG_QUALITY,
): Promise<SanitizedImage> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('Could not encode corpus image'));
          return;
        }
        resolve({
          blob,
          height: canvas.height,
          mimeType: 'image/jpeg',
          width: canvas.width,
        });
      },
      'image/jpeg',
      quality,
    );
  });

const scaleToMaxEdge = (
  source: HTMLCanvasElement,
  maxEdge: number,
): HTMLCanvasElement => {
  const long = Math.max(source.width, source.height);
  if (long <= maxEdge) return source;
  const scale = maxEdge / long;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not open sanitize canvas');
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
};

/** Video/canvas frame → JPEG without EXIF. */
export const sanitizeVideoFrame = async (
  video: HTMLVideoElement,
  maxEdge = CORPUS_FULL_FRAME_MAX_EDGE,
): Promise<SanitizedImage> => {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1;
  canvas.height = video.videoHeight || 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read video frame');
  ctx.drawImage(video, 0, 0);
  return encodeCanvas(scaleToMaxEdge(canvas, maxEdge));
};

/** Portable ScanImage → JPEG (normalized card crops). */
export const sanitizeScanImage = async (
  image: ScanImage,
  maxEdge = CORPUS_CARD_MAX_EDGE,
): Promise<SanitizedImage> => {
  const canvas = toCanvas(image);
  return encodeCanvas(scaleToMaxEdge(canvas, maxEdge));
};
