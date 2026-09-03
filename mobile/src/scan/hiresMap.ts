// Map a detector quad onto a high-resolution recognition source.
//
// Detector pixels and hi-res pixels are not the same space. The only safe
// intermediate is *normalized preview-visible FOV* (0–1), never screen pixels.
//
// Two cases:
//
//   same FOV     — both rasters are the preview cover-crop (or both full-frame).
//                  Uniform scale through 0–1.
//   different    — detector is a cover-crop of the oriented analysis buffer;
//                  hi-res is the full oriented source (photo / larger frame).
//                  Lift detector → visible rect → oriented → scale to hi-res.
//
// Pure math. No VisionCamera imports.

import type { CardCorners, Point2D, Size2D } from './sharedCore';

export interface NormPoint {
  x: number;
  y: number;
}

export interface VisibleRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export const toNorm = (p: Point2D, size: Size2D): NormPoint => ({
  x: size.width <= 0 ? 0 : p.x / size.width,
  y: size.height <= 0 ? 0 : p.y / size.height,
});

export const fromNorm = (p: NormPoint, size: Size2D): Point2D => ({
  x: p.x * size.width,
  y: p.y * size.height,
});

/** Detector (already the visible crop) → another raster of the same FOV. */
export const mapSameFov = (p: Point2D, detector: Size2D, dest: Size2D): Point2D =>
  fromNorm(toNorm(p, detector), dest);

/**
 * Detector is the cover-crop of `oriented`. Hi-res is that full oriented
 * buffer (possibly a different pixel size, same aspect).
 */
export const mapDetectorToOrientedSource = (
  p: Point2D,
  detector: Size2D,
  visible: VisibleRect,
  oriented: Size2D,
  hires: Size2D,
): Point2D => {
  const nx = detector.width <= 0 ? 0 : p.x / detector.width;
  const ny = detector.height <= 0 ? 0 : p.y / detector.height;
  const ox = visible.x + nx * visible.width;
  const oy = visible.y + ny * visible.height;
  return {
    x: oriented.width <= 0 ? 0 : (ox / oriented.width) * hires.width,
    y: oriented.height <= 0 ? 0 : (oy / oriented.height) * hires.height,
  };
};

export const mapCornersSameFov = (
  corners: CardCorners,
  detector: Size2D,
  dest: Size2D,
): CardCorners => ({
  bottomLeft: mapSameFov(corners.bottomLeft, detector, dest),
  bottomRight: mapSameFov(corners.bottomRight, detector, dest),
  topLeft: mapSameFov(corners.topLeft, detector, dest),
  topRight: mapSameFov(corners.topRight, detector, dest),
});

/** Flip a point across the vertical axis of `size`. */
export const mirrorX = (p: Point2D, size: Size2D): Point2D => ({
  x: size.width - p.x,
  y: p.y,
});

export const mirrorCornersX = (corners: CardCorners, size: Size2D): CardCorners => ({
  bottomLeft: mirrorX(corners.bottomLeft, size),
  bottomRight: mirrorX(corners.bottomRight, size),
  topLeft: mirrorX(corners.topLeft, size),
  topRight: mirrorX(corners.topRight, size),
});

/**
 * Scale a visible rect from one oriented raster onto another of the same
 * aspect (analysis oriented → photo oriented).
 */
export const scaleVisibleRect = (
  visible: VisibleRect,
  from: Size2D,
  to: Size2D,
): VisibleRect => {
  const sx = from.width <= 0 ? 1 : to.width / from.width;
  const sy = from.height <= 0 ? 1 : to.height / from.height;
  return {
    height: visible.height * sy,
    width: visible.width * sx,
    x: visible.x * sx,
    y: visible.y * sy,
  };
};

export type HiResMapKind = 'same-fov' | 'oriented-full';

export interface HiResMapRequest {
  destMirrored?: boolean;
  detector: Size2D;
  dest: Size2D;
  kind: HiResMapKind;
  oriented?: Size2D;
  visible?: VisibleRect;
}

/** Detector point → hi-res pixels. Never via screen coordinates. */
export const mapDetectorToHiRes = (p: Point2D, req: HiResMapRequest): Point2D => {
  const raw =
    req.kind === 'same-fov' || !req.visible || !req.oriented
      ? mapSameFov(p, req.detector, req.dest)
      : mapDetectorToOrientedSource(p, req.detector, req.visible, req.oriented, req.dest);
  return req.destMirrored ? mirrorX(raw, req.dest) : raw;
};

export const mapCornersToHiRes = (corners: CardCorners, req: HiResMapRequest): CardCorners => ({
  bottomLeft: mapDetectorToHiRes(corners.bottomLeft, req),
  bottomRight: mapDetectorToHiRes(corners.bottomRight, req),
  topLeft: mapDetectorToHiRes(corners.topLeft, req),
  topRight: mapDetectorToHiRes(corners.topRight, req),
});

export const mapCornersToOrientedSource = (
  corners: CardCorners,
  detector: Size2D,
  visible: VisibleRect,
  oriented: Size2D,
  hires: Size2D,
): CardCorners => ({
  bottomLeft: mapDetectorToOrientedSource(corners.bottomLeft, detector, visible, oriented, hires),
  bottomRight: mapDetectorToOrientedSource(
    corners.bottomRight,
    detector,
    visible,
    oriented,
    hires,
  ),
  topLeft: mapDetectorToOrientedSource(corners.topLeft, detector, visible, oriented, hires),
  topRight: mapDetectorToOrientedSource(corners.topRight, detector, visible, oriented, hires),
});
