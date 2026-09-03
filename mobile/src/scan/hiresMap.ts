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
