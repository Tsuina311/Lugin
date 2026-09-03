// VisionCamera frame → portable `ScanImage`.
//
// This is the whole native→shared seam for pixels: everything downstream
// (detectCardQuad, warpQuadToCard, quality, OCR preprocessing) already speaks
// `ScanImage` and must not learn about cameras.
//
// Four corrections happen in the single copy below, because we are touching
// every pixel anyway and doing them separately would cost extra passes:
//
//   1. Channel order. `pixelFormat: 'rgb'` gives BGRA on Android
//      (`rgb-bgra-8-bit`), while `ScanImage` is RGBA. This is not cosmetic —
//      luma weights R at 0.299 and B at 0.114, so a swapped frame changes
//      detection scores, sharpness, artwork hue histograms and OCR contrast.
//   2. Pixel size. The pipeline may also hand back 3-byte `rgb-rgb-8-bit`.
//   3. Row stride. `bytesPerRow` is frequently larger than `width * bpp`
//      because the camera pads rows for alignment. Ignoring it shears the
//      image; trusting it blindly when it is 0 or short collapses every row
//      onto row 0, which reads as a flat frame and detects nothing.
//   4. Rotation and mirroring. The camera streams in sensor orientation and
//      reports the correction as metadata rather than paying for a physical
//      rotation pass. Applying it here is free; `enablePhysicalBufferRotation`
//      would make the pipeline do an extra copy.
//
// Deliberately no `react-native` / VisionCamera imports, so
// `mobile/scripts/frame-adapter-smoke.mjs` can exercise it under Node against
// synthetic buffers with known answers.

import { blankImage, type ScanImage } from './sharedCore';

/** Correction the camera reports for sensor-vs-output rotation. */
export type FrameOrientation = 'up' | 'right' | 'down' | 'left';

/** Byte order of a non-planar 8-bit frame. */
export type FramePixelOrder = 'bgra' | 'rgba' | 'rgb';

export const bytesPerPixelFor = (order: FramePixelOrder): number => (order === 'rgb' ? 3 : 4);

/**
 * The subset of a VisionCamera `Frame` this adapter needs, as plain data.
 *
 * Structurally compatible with `Frame` plus its pixel buffer, so the worklet
 * can fill it in without a translation layer, but portable enough to
 * construct in a test.
 */
export interface RawFrameView {
  /** View over the frame's pixel buffer. Not copied, not retained. */
  bytes: Uint8Array;
  /** Row pitch in bytes as reported by the camera; may exceed `width * bpp`. */
  bytesPerRow: number;
  height: number;
  /** Whether pixel rows must be read right-to-left. */
  isMirrored: boolean;
  orientation: FrameOrientation;
  pixelOrder: FramePixelOrder;
  width: number;
}

export interface OrientedRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface FrameConvertOptions {
  /**
   * Rectangle in *oriented* space to copy. Defaults to the full upright
   * frame. The native pipeline passes the preview's cover-crop here so the
   * detector sees the same FOV as the user, not the full sensor.
   */
  crop?: OrientedRect;
  /**
   * Longest edge of the analysis image, applied after rotation and crop.
   *
   * A guard, not the primary downscale: the camera should already be
   * delivering a small frame via `FrameOutputOptions.targetResolution`. Full
   * resolution frames must never reach this function.
   */
  maxLongEdge?: number;
  /**
   * @deprecated Prefer {@link maxLongEdge}. Kept so existing tests that
   * constrain width still compile; treated as a long-edge cap.
   */
  maxWidth?: number;
}

export interface FrameValidation {
  bytesPerPixel: number;
  /** Non-null when the frame cannot be read as described. */
  reason: string | null;
  /** Bytes the buffer must contain for the reported geometry. */
  requiredBytes: number;
  /** Row pitch actually used, after correcting an implausible `bytesPerRow`. */
  stride: number;
  /** True when the reported `bytesPerRow` was unusable and was replaced. */
  strideCorrected: boolean;
}

/**
 * Decide whether a frame can be read, and with what row pitch.
 *
 * Separate from the conversion so the debug panel can show the arithmetic —
 * "expected minimum byte length" versus what actually arrived is the fastest
 * way to tell a stride bug from a truncated transfer.
 */
export const validateFrameView = (
  frame: Omit<RawFrameView, 'bytes'> & { byteLength: number },
): FrameValidation => {
  const bytesPerPixel = bytesPerPixelFor(frame.pixelOrder);
  const minStride = frame.width * bytesPerPixel;
  // A camera reporting 0 (or less than one row) is reporting nothing useful.
  const strideCorrected = !(frame.bytesPerRow >= minStride);
  const stride = strideCorrected ? minStride : frame.bytesPerRow;
  // The last row needs only its pixels, not a full stride of padding.
  const requiredBytes = frame.height > 0 ? stride * (frame.height - 1) + minStride : 0;

  let reason: string | null = null;
  if (frame.width <= 0 || frame.height <= 0) {
    reason = `frame reports ${frame.width}×${frame.height}`;
  } else if (frame.byteLength < requiredBytes) {
    reason = `buffer has ${frame.byteLength} bytes, needs ${requiredBytes}`;
  }

  return { bytesPerPixel, reason, requiredBytes, stride, strideCorrected };
};

/** Upright size of a frame after applying {@link RawFrameView.orientation}. */
export const orientedSize = (
  frame: Pick<RawFrameView, 'height' | 'orientation' | 'width'>,
): { height: number; width: number } => {
  const turned = frame.orientation === 'left' || frame.orientation === 'right';
  return {
    height: turned ? frame.width : frame.height,
    width: turned ? frame.height : frame.width,
  };
};

/** Clamp `crop` onto `bounds` so a cover-rect cannot read off the image. */
export const clampRect = (crop: OrientedRect, bounds: OrientedRect): OrientedRect => {
  const x = Math.min(Math.max(0, crop.x), Math.max(0, bounds.width - 1));
  const y = Math.min(Math.max(0, crop.y), Math.max(0, bounds.height - 1));
  return {
    height: Math.max(1, Math.min(crop.height, bounds.height - y)),
    width: Math.max(1, Math.min(crop.width, bounds.width - x)),
    x,
    y,
  };
};

/** Size of the analysis image `frameToScanImage` would produce. */
export const analysisSize = (
  frame: Pick<RawFrameView, 'height' | 'orientation' | 'width'>,
  options: FrameConvertOptions = {},
): { height: number; width: number } => {
  const oriented = orientedSize(frame);
  const crop = clampRect(options.crop ?? { ...oriented, x: 0, y: 0 }, { ...oriented, x: 0, y: 0 });
  const max = options.maxLongEdge ?? options.maxWidth ?? 0;
  const long = Math.max(crop.width, crop.height);
  const scale = max > 0 && long > max ? max / long : 1;
  return {
    height: Math.max(1, Math.round(crop.height * scale)),
    width: Math.max(1, Math.round(crop.width * scale)),
  };
};

/**
 * Copy `frame` into a fresh upright RGBA `ScanImage`.
 *
 * Nearest-neighbour when downscaling. That is deliberate: `detectCardQuad`
 * immediately downscales to its own 320 px working width with a box filter, so
 * paying for a better filter here would be spent twice and thrown away once.
 */
export const frameToScanImage = (
  frame: RawFrameView,
  options: FrameConvertOptions = {},
): ScanImage => {
  const { bytes, height: srcH, isMirrored, orientation, pixelOrder, width: srcW } = frame;
  if (srcW <= 0 || srcH <= 0) return blankImage(1, 1);

  const { bytesPerPixel: bpp, stride } = validateFrameView({
    byteLength: bytes.length,
    bytesPerRow: frame.bytesPerRow,
    height: srcH,
    isMirrored,
    orientation,
    pixelOrder,
    width: srcW,
  });

  const oriented = orientedSize(frame);
  const crop = clampRect(options.crop ?? { ...oriented, x: 0, y: 0 }, { ...oriented, x: 0, y: 0 });
  const target = analysisSize(frame, { ...options, crop });
  const out = blankImage(target.width, target.height);
  const { data, height: outH, width: outW } = out;

  // Rotation is affine in the corrected-space coordinates (rx, ry):
  //   sx = ax*rx + bx*ry + cx
  //   sy = ay*rx + by*ry + cy
  // Solving it as coefficients instead of a switch inside the pixel loop keeps
  // all eight orientation/mirror combinations on one code path, and reduces the
  // inner loop to a single multiply-add.
  let ax = 1;
  let bx = 0;
  let cx = 0;
  let ay = 0;
  let by = 1;
  let cy = 0;
  switch (orientation) {
    case 'right': // content turned 90° right; counter-rotate left
      ax = 0;
      bx = -1;
      cx = srcW - 1;
      ay = 1;
      by = 0;
      cy = 0;
      break;
    case 'left': // content turned 90° left; counter-rotate right
      ax = 0;
      bx = 1;
      cx = 0;
      ay = -1;
      by = 0;
      cy = srcH - 1;
      break;
    case 'down':
      ax = -1;
      bx = 0;
      cx = srcW - 1;
      ay = 0;
      by = -1;
      cy = srcH - 1;
      break;
    default:
      break;
  }
  if (isMirrored) {
    // Mirroring is along the buffer's vertical axis: read rows right-to-left.
    ax = -ax;
    bx = -bx;
    cx = srcW - 1 - cx;
  }

  // Column stride through the source buffer, constant for a given orientation.
  const colStep = ay * stride + ax * bpp;
  const swap = pixelOrder === 'bgra';
  // Never read past the buffer: an out-of-range index yields `undefined`, which
  // lands in the image as 0 and looks exactly like a black camera frame.
  const lastPixel = bytes.length - bpp;

  // Hoist the horizontal nearest-neighbour map out of the row loop.
  // Coordinates are in oriented space, offset by the preview cover-crop.
  const xMap = new Int32Array(outW);
  for (let ox = 0; ox < outW; ox++) {
    const rx = crop.x + (outW === crop.width ? ox : (ox * crop.width) / outW);
    xMap[ox] = Math.min(oriented.width - 1, Math.max(0, Math.floor(rx)));
  }

  let di = 0;
  for (let oy = 0; oy < outH; oy++) {
    const ry = crop.y + (outH === crop.height ? oy : (oy * crop.height) / outH);
    const rowY = Math.min(oriented.height - 1, Math.max(0, Math.floor(ry)));
    const rowBase = (by * rowY + cy) * stride + (bx * rowY + cx) * bpp;
    for (let ox = 0; ox < outW; ox++) {
      const si = rowBase + xMap[ox] * colStep;
      if (si < 0 || si > lastPixel) {
        di += 4;
        continue;
      }
      if (swap) {
        data[di] = bytes[si + 2];
        data[di + 1] = bytes[si + 1];
        data[di + 2] = bytes[si];
      } else {
        data[di] = bytes[si];
        data[di + 1] = bytes[si + 1];
        data[di + 2] = bytes[si + 2];
      }
      // Alpha stays at the 255 `blankImage` already wrote; the camera's alpha
      // channel is padding and is not always 255.
      di += 4;
    }
  }

  return out;
};

/** Map a VisionCamera `pixelFormat` string onto a byte order, if we can use it. */
export const pixelOrderFor = (pixelFormat: string): FramePixelOrder | null => {
  if (pixelFormat === 'rgb-bgra-8-bit') return 'bgra';
  if (pixelFormat === 'rgb-rgba-8-bit') return 'rgba';
  if (pixelFormat === 'rgb-rgb-8-bit') return 'rgb';
  return null;
};

/**
 * Cheap strided checksum, used to prove a buffer survived the worklet → JS
 * hop intact.
 *
 * Samples rather than hashing every byte: this runs per frame on both sides of
 * the boundary, and the failure it guards against (a view over a disposed
 * native frame, or a truncated copy) changes bytes everywhere, not subtly in
 * one place. `sum` is kept in 32-bit range so both runtimes agree exactly.
 */
export const bufferChecksum = (bytes: Uint8Array, samples = 64): { sum: number; taken: number } => {
  if (bytes.length === 0) return { sum: 0, taken: 0 };
  const step = Math.max(1, Math.floor(bytes.length / samples));
  let sum = 0;
  let taken = 0;
  for (let i = 0; i < bytes.length; i += step) {
    // Position-weighted so a shifted buffer does not checksum the same.
    sum = (sum + bytes[i] * (taken + 1)) % 0x7fffffff;
    taken++;
  }
  return { sum, taken };
};

/** Mean luma of a `ScanImage`, to tell a black frame from a dark one. */
export const imageBrightness = (image: ScanImage, samples = 512): number => {
  const pixels = image.width * image.height;
  if (pixels === 0) return 0;
  const step = Math.max(1, Math.floor(pixels / samples));
  let total = 0;
  let taken = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    total += 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
    taken++;
  }
  return taken === 0 ? 0 : total / taken;
};
