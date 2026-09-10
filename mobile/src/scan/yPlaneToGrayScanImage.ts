// Build a grayscale ScanImage from a Y (luma) plane for session quality /
// prepareAnalysis fallback. Detection itself must NOT require this — native
// detectFromYPlane owns geometry. This only exists so SessionController can
// still compute sharpness when the live path skips full camera RGB.

import { blankImage, type ScanImage } from './sharedCore';
import type { DetectorLuma } from './frameToScanImage';

/** Packed detector luma → gray ScanImage (same width/height as native corners). */
export const packedYToGrayScanImage = (luma: DetectorLuma): ScanImage => {
  const { height, width, y } = luma;
  const out = blankImage(width, height);
  const data = out.data;
  for (let i = 0, p = 0; i < y.length; i++, p += 4) {
    const v = y[i] ?? 0;
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  return out;
};

/** Full-resolution gray (expensive — avoid on hot path). */
export const yPlaneToGrayScanImage = (
  y: Uint8Array,
  width: number,
  height: number,
  rowStride: number,
): ScanImage => yPlaneToGrayScanImageDownscaled(y, width, height, rowStride, Math.max(width, height));

/**
 * Downscale Y → gray RGBA for quality scoring.
 * maxLongEdge ~96 is enough for sharpness; full analysis res is wasteful.
 */
export const yPlaneToGrayScanImageDownscaled = (
  y: Uint8Array,
  width: number,
  height: number,
  rowStride: number,
  maxLongEdge = 96,
): ScanImage => {
  const long = Math.max(width, height);
  const scale = long > maxLongEdge ? maxLongEdge / long : 1;
  const outW = Math.max(8, Math.round(width * scale));
  const outH = Math.max(8, Math.round(height * scale));
  const out = blankImage(outW, outH);
  const data = out.data;
  for (let row = 0; row < outH; row++) {
    const srcRow = Math.min(height - 1, Math.floor((row / outH) * height)) * rowStride;
    const dstRow = row * outW * 4;
    for (let col = 0; col < outW; col++) {
      const srcCol = Math.min(width - 1, Math.floor((col / outW) * width));
      const v = y[srcRow + srcCol] ?? 0;
      const o = dstRow + col * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return out;
};
