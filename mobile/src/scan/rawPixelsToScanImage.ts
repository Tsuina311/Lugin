// Convert a raw pixel buffer (photo / snapshot / Image) into ScanImage.
//
// Portable: no VisionCamera imports. Used by hi-res acquisition and by
// `raw-pixels-smoke.mjs`.

import { blankImage, type ScanImage } from './sharedCore';

export type RawPixelOrder =
  | 'rgba'
  | 'bgra'
  | 'argb'
  | 'abgr'
  | 'rgb'
  | 'bgr'
  | 'rgbx'
  | 'bgrx'
  | 'xrgb'
  | 'xbgr';

export interface RawPixels {
  bytes: Uint8Array;
  bytesPerRow?: number;
  height: number;
  pixelOrder: RawPixelOrder;
  width: number;
}

const bppFor = (order: RawPixelOrder): number =>
  order === 'rgb' || order === 'bgr' ? 3 : 4;

const channels = (order: RawPixelOrder): { b: number; g: number; r: number } => {
  switch (order) {
    case 'bgra':
    case 'bgrx':
      return { b: 0, g: 1, r: 2 };
    case 'argb':
    case 'xrgb':
      return { b: 3, g: 2, r: 1 };
    case 'abgr':
    case 'xbgr':
      return { b: 1, g: 2, r: 3 };
    case 'bgr':
      return { b: 0, g: 1, r: 2 };
    case 'rgb':
      return { b: 2, g: 1, r: 0 };
    default:
      return { b: 2, g: 1, r: 0 };
  }
};

export const parsePixelOrder = (value: string): RawPixelOrder | null => {
  const key = value.toLowerCase();
  if (
    key === 'rgba' ||
    key === 'bgra' ||
    key === 'argb' ||
    key === 'abgr' ||
    key === 'rgb' ||
    key === 'bgr' ||
    key === 'rgbx' ||
    key === 'bgrx' ||
    key === 'xrgb' ||
    key === 'xbgr'
  ) {
    return key;
  }
  return null;
};

/**
 * Copy raw pixels into RGBA ScanImage. Optional long-edge cap (nearest
 * neighbour) so a 12 MP photo is not copied at full size.
 */
export const rawPixelsToScanImage = (
  raw: RawPixels,
  options: { maxLongEdge?: number } = {},
): ScanImage => {
  const { bytes, height: srcH, pixelOrder, width: srcW } = raw;
  if (srcW <= 0 || srcH <= 0) return blankImage(1, 1);
  const bpp = bppFor(pixelOrder);
  const minStride = srcW * bpp;
  const stride = raw.bytesPerRow && raw.bytesPerRow >= minStride ? raw.bytesPerRow : minStride;
  const max = options.maxLongEdge ?? 0;
  const long = Math.max(srcW, srcH);
  const scale = max > 0 && long > max ? max / long : 1;
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));
  const out = blankImage(outW, outH);
  const { b, g, r } = channels(pixelOrder);
  const last = bytes.length - bpp;
  const xMap = new Int32Array(outW);
  for (let x = 0; x < outW; x++) {
    xMap[x] = Math.min(srcW - 1, Math.max(0, Math.floor((x * srcW) / outW)));
  }
  let di = 0;
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(srcH - 1, Math.max(0, Math.floor((y * srcH) / outH)));
    const row = sy * stride;
    for (let x = 0; x < outW; x++) {
      const si = row + xMap[x] * bpp;
      if (si >= 0 && si <= last) {
        out.data[di] = bytes[si + r];
        out.data[di + 1] = bytes[si + g];
        out.data[di + 2] = bytes[si + b];
      }
      di += 4;
    }
  }
  return out;
};
