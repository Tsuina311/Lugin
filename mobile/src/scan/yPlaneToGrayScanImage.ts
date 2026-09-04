// Build a grayscale ScanImage from a Y (luma) plane for session quality /
// prepareAnalysis fallback. Detection itself must NOT require this — native
// detectFromYPlane owns geometry. This only exists so SessionController can
// still compute sharpness when the live path skips full camera RGB.

import { blankImage, type ScanImage } from './sharedCore';

export const yPlaneToGrayScanImage = (
  y: Uint8Array,
  width: number,
  height: number,
  rowStride: number,
): ScanImage => {
  const out = blankImage(width, height);
  const data = out.data;
  for (let row = 0; row < height; row++) {
    const srcRow = row * rowStride;
    const dstRow = row * width * 4;
    for (let col = 0; col < width; col++) {
      const v = y[srcRow + col] ?? 0;
      const o = dstRow + col * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return out;
};
