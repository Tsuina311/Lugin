// Map detector coordinates onto a live `<video>` that uses object-fit: cover.
//
// Pure math — no DOM. The web UI supplies sizes from videoWidth/clientWidth.

export interface Size2D {
  height: number;
  width: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Analysis frames are often downscaled (e.g. max width 640). Map a point from
 * that raster back into the full video source pixel space.
 */
export const mapAnalysisToSource = (
  p: Point2D,
  analysis: Size2D,
  source: Size2D,
): Point2D => {
  if (analysis.width <= 0 || analysis.height <= 0) return { x: 0, y: 0 };
  return {
    x: (p.x / analysis.width) * source.width,
    y: (p.y / analysis.height) * source.height,
  };
};

/**
 * How `object-fit: cover` draws `source` into a `dest` box: uniform scale to
 * cover, then center-crop the overflow.
 */
export const coverLayout = (
  source: Size2D,
  dest: Size2D,
): { offsetX: number; offsetY: number; scale: number } => {
  if (source.width <= 0 || source.height <= 0 || dest.width <= 0 || dest.height <= 0) {
    return { offsetX: 0, offsetY: 0, scale: 1 };
  }
  const scale = Math.max(dest.width / source.width, dest.height / source.height);
  const drawnW = source.width * scale;
  const drawnH = source.height * scale;
  return {
    offsetX: (dest.width - drawnW) / 2,
    offsetY: (dest.height - drawnH) / 2,
    scale,
  };
};

/** Video-source pixel → CSS pixel inside the covered element. */
export const mapCoverSourceToDest = (
  p: Point2D,
  source: Size2D,
  dest: Size2D,
): Point2D => {
  const { offsetX, offsetY, scale } = coverLayout(source, dest);
  return { x: p.x * scale + offsetX, y: p.y * scale + offsetY };
};

/** Inverse: CSS pixel in the element → video-source pixel (for taps/focus). */
export const mapCoverDestToSource = (
  p: Point2D,
  source: Size2D,
  dest: Size2D,
): Point2D => {
  const { offsetX, offsetY, scale } = coverLayout(source, dest);
  if (scale === 0) return { x: 0, y: 0 };
  return { x: (p.x - offsetX) / scale, y: (p.y - offsetY) / scale };
};

/**
 * Full pipeline used by the live polygon overlay:
 * analysis (detector) → video source → object-fit:cover destination.
 */
export const mapAnalysisToOverlay = (
  p: Point2D,
  analysis: Size2D,
  source: Size2D,
  dest: Size2D,
): Point2D =>
  mapCoverSourceToDest(mapAnalysisToSource(p, analysis, source), source, dest);

/** Map all four card corners through the same transform. */
export const mapCornersToOverlay = (
  corners: {
    bottomLeft: Point2D;
    bottomRight: Point2D;
    topLeft: Point2D;
    topRight: Point2D;
  },
  analysis: Size2D,
  source: Size2D,
  dest: Size2D,
): {
  bottomLeft: Point2D;
  bottomRight: Point2D;
  topLeft: Point2D;
  topRight: Point2D;
} => ({
  bottomLeft: mapAnalysisToOverlay(corners.bottomLeft, analysis, source, dest),
  bottomRight: mapAnalysisToOverlay(corners.bottomRight, analysis, source, dest),
  topLeft: mapAnalysisToOverlay(corners.topLeft, analysis, source, dest),
  topRight: mapAnalysisToOverlay(corners.topRight, analysis, source, dest),
});
