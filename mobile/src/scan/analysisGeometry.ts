// Coordinate spaces for the native scanner.
//
// The Samsung screenshots showed two independent failures that look like
// "the detector is wrong":
//
//   1. The analysis image was landscape 640×480 with the card on its side,
//      while the preview was portrait and upright. Detection then ran on a
//      rotated world whose aspect/region scores do not mean what they do
//      on an upright card.
//   2. That landscape buffer was the *full sensor*, while the preview is a
//      cover-crop of the upright frame into a tall screen. The card filled
//      the preview and occupied a strip of the analysis image.
//
// The overlay then mapped detector coordinates as if analysis and preview
// shared a FOV, so the polygon had no reason to land on the physical card.
//
// Spaces, in order. Nothing in this file is allowed to conflate them:
//
//   raw        — VisionCamera Frame.width × Frame.height, sensor-native
//   oriented   — raw after applying Frame.orientation / isMirrored
//   visible    — cover-crop of oriented into the preview view (videoMap)
//   detector   — visible, downscaled so the long edge is ≤ ~640
//   overlay    — preview view pixels
//
// Pure math, no VisionCamera imports: `analysis-geometry-smoke.mjs` runs it
// under Node against the same Samsung-shaped numbers the phone reports.

import { orientedSize, type FrameOrientation, type OrientedRect } from './frameToScanImage';
import {
  coverSourceRect,
  type CardCorners,
  type Point2D,
  type Size2D,
} from './sharedCore';

export interface CoordinateSpaces {
  detector: Size2D;
  oriented: Size2D;
  overlay: Size2D;
  raw: Size2D;
  visible: OrientedRect;
}

export interface QuadDiagnostics {
  areaRatio: number;
  aspect: number;
  corners: CardCorners;
}

export const parseOrientation = (value: string): FrameOrientation => {
  if (value === 'right' || value === 'left' || value === 'down' || value === 'up') return value;
  return 'up';
};

export const spacesFor = (
  raw: Size2D,
  orientation: FrameOrientation,
  overlay: Size2D,
  maxLongEdge = 640,
): CoordinateSpaces => {
  const oriented = orientedSize({ ...raw, orientation });
  const visible =
    overlay.width > 0 && overlay.height > 0
      ? coverSourceRect(oriented, overlay)
      : { height: oriented.height, width: oriented.width, x: 0, y: 0 };
  const long = Math.max(visible.width, visible.height);
  const scale = maxLongEdge > 0 && long > maxLongEdge ? maxLongEdge / long : 1;
  return {
    detector: {
      height: Math.max(1, Math.round(visible.height * scale)),
      width: Math.max(1, Math.round(visible.width * scale)),
    },
    oriented,
    overlay,
    raw,
    visible,
  };
};

const dist = (a: Point2D, b: Point2D): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Shoelace area of the named quad, as a fraction of the detector raster. */
export const quadDiagnostics = (corners: CardCorners, detector: Size2D): QuadDiagnostics => {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  const raster = Math.max(1, detector.width * detector.height);
  const width = (dist(corners.topLeft, corners.topRight) + dist(corners.bottomLeft, corners.bottomRight)) / 2;
  const height = (dist(corners.topLeft, corners.bottomLeft) + dist(corners.topRight, corners.bottomRight)) / 2;
  return {
    areaRatio: area / raster,
    aspect: height > 0 ? width / height : 0,
    corners,
  };
};

export const formatCorner = (p: Point2D): string => `${p.x.toFixed(0)},${p.y.toFixed(0)}`;
