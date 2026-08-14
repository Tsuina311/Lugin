// Find the card quadrilateral in a frame. Pure JS, no OpenCV.
//
// Strategy: separate the card from the background as a *region*, then read its
// corners off the convex hull.
//
// The previous implementation traced contours of a dilated Sobel edge map and
// demanded that Douglas–Peucker simplify one to exactly four points. Measured
// over the fixture corpus that succeeded on 0 of 220 frames, including a flat,
// centred, evenly lit card — while 98.7% of the true card outline was present in
// the edge map. Edges were never the problem; requiring a four-point contour out
// of a ribbon-shaped trace was.
//
// A region has three advantages here: the card is a solid blob whatever its
// artwork does, a convex hull has no notion of "wrong number of points", and
// fitting the four sides recovers true corners even though real cards are
// rounded.

import {
  dist,
  orderCorners,
  quadToCorners,
  scoreCardQuad,
  type Pt,
  type Quad,
} from './geometry';
import type { CardCorners, ScanImage } from './types';

export interface DetectResult {
  corners: CardCorners | null;
  quad: Quad | null;
  /** Confidence-ish score from scoreCardQuad; 0 if none. */
  score: number;
}

const NONE: DetectResult = { corners: null, quad: null, score: 0 };


/** Analysis resolution. Corners are mapped back to full resolution at the end. */
const WORK_WIDTH = 320;

/** Minimum share of the frame a card must occupy to be worth reading. */
const MIN_AREA_SHARE = 0.06;

/**
 * A component covering essentially the whole frame means background estimation
 * failed, not that the card is enormous.
 */
const MAX_AREA_SHARE = 0.985;

export const detectCardQuad = (image: ScanImage): DetectResult => {
  const { height: fullH, width: fullW } = image;
  const scale = fullW > WORK_WIDTH ? WORK_WIDTH / fullW : 1;
  const w = Math.max(32, Math.round(fullW * scale));
  const h = Math.max(32, Math.round(fullH * scale));
  const gray = downscaleGray(image, w, h);

  const mask = foregroundMask(gray, w, h);
  if (!mask) return NONE;

  const component = largestComponent(mask, w, h);
  if (!component) return NONE;
  const area = component.area / (w * h);
  if (area < MIN_AREA_SHARE || area > MAX_AREA_SHARE) return NONE;

  const boundary = boundaryPoints(component.pixels, w, h);
  const hull = convexHull(boundary);
  if (hull.length < 4) return NONE;

  const approx = extremalCorners(hull);
  if (!approx) return NONE;
  // Corners come from the hull, sides from the full boundary: the hull drops
  // collinear points, which is exactly the evidence a straight side is made of.
  const corners = refineCorners(boundary, approx) ?? approx;

  const quad = orderCorners(corners.map(p => ({ x: p.x / scale, y: p.y / scale })));
  const score = scoreCardQuad(quad, fullW, fullH);
  return { corners: quadToCorners(quad), quad, score };
};

// ---------------------------------------------------------------------------
// Foreground / background separation
// ---------------------------------------------------------------------------

const downscaleGray = (image: ScanImage, dw: number, dh: number): Float32Array => {
  const { data, height: sh, width: sw } = image;
  const out = new Float32Array(dw * dh);
  const xStep = sw / dw;
  const yStep = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * yStep));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * xStep));
      const i = (sy * sw + sx) * 4;
      out[y * dw + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  return out;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

/**
 * Mark everything that does not look like the background.
 *
 * Background is sampled from a ring around the frame, because that is the one
 * region a user aiming at a card is not pointing at. Deliberately not "the card
 * is the bright part": a black-bordered card on a pale desk is darker than its
 * background, and half the corpus is exactly that. Only the *difference* from
 * background is reliable in both directions.
 */
const foregroundMask = (gray: Float32Array, w: number, h: number): Uint8Array | null => {
  const band = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const ring: number[] = [];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      if (edgeRow || x < band || x >= w - band) ring.push(gray[y * w + x]);
    }
  }
  if (ring.length < 16) return null;

  const background = median(ring);
  // Median absolute deviation: robust to a card corner intruding into the ring.
  const spread = median(ring.map(v => Math.abs(v - background)));
  const threshold = Math.max(16, spread * 4);

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Math.abs(gray[i] - background) > threshold ? 1 : 0;
  }

  // Close small gaps: a pale card on a pale desk separates along a thin seam,
  // and a one-pixel break is enough to split the blob in two.
  dilate(mask, w, h);
  erode(mask, w, h);
  return mask;
};

const dilate = (mask: Uint8Array, w: number, h: number): void => {
  const copy = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (copy[i]) continue;
      if (
        (x > 0 && copy[i - 1]) ||
        (x < w - 1 && copy[i + 1]) ||
        (y > 0 && copy[i - w]) ||
        (y < h - 1 && copy[i + w])
      ) {
        mask[i] = 1;
      }
    }
  }
};

const erode = (mask: Uint8Array, w: number, h: number): void => {
  const copy = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!copy[i]) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !copy[i - 1] ||
        !copy[i + 1] ||
        !copy[i - w] ||
        !copy[i + w];
      // Keep frame-edge pixels: a card running off the frame is still a card.
      if (edge && x > 0 && y > 0 && x < w - 1 && y < h - 1) mask[i] = 0;
    }
  }
};

interface Component {
  area: number;
  /** Component membership, same layout as the mask. */
  pixels: Uint8Array;
}

/**
 * Largest 4-connected blob of set pixels, by flood fill.
 *
 * Labels every component in one pass and only materializes the winner, so a
 * speckled background costs two allocations rather than one per blob.
 */
export const largestComponent = (
  mask: Uint8Array,
  w: number,
  h: number,
): Component | null => {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  let label = 0;
  let bestLabel = 0;
  let bestArea = 0;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let area = 0;

    while (head < tail) {
      const i = queue[head++];
      area += 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) {
        labels[i - 1] = label;
        queue[tail++] = i - 1;
      }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) {
        labels[i + 1] = label;
        queue[tail++] = i + 1;
      }
      if (y > 0 && mask[i - w] && !labels[i - w]) {
        labels[i - w] = label;
        queue[tail++] = i - w;
      }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) {
        labels[i + w] = label;
        queue[tail++] = i + w;
      }
    }

    if (area > bestArea) {
      bestArea = area;
      bestLabel = label;
    }
  }

  if (!bestLabel) return null;
  const pixels = new Uint8Array(w * h);
  for (let i = 0; i < labels.length; i++) pixels[i] = labels[i] === bestLabel ? 1 : 0;
  return { area: bestArea, pixels };
};

/**
 * Extreme set pixels of every row *and* every column.
 *
 * Rows alone would be enough to find the hull vertices, but not to fit the
 * sides: a near-horizontal edge contributes only the two ends of its topmost
 * row, so side-fitting has nothing to work with and silently gives up. Columns
 * sample the horizontal edges, rows the vertical ones.
 *
 * Either way this turns ~100k candidate pixels into a few hundred.
 */
export const boundaryPoints = (pixels: Uint8Array, w: number, h: number): Pt[] => {
  const out: Pt[] = [];
  for (let y = 0; y < h; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < w; x++) {
      if (!pixels[y * w + x]) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left < 0) continue;
    out.push({ x: left, y });
    if (right !== left) out.push({ x: right, y });
  }
  for (let x = 0; x < w; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      if (!pixels[y * w + x]) continue;
      if (top < 0) top = y;
      bottom = y;
    }
    if (top < 0) continue;
    out.push({ x, y: top });
    if (bottom !== top) out.push({ x, y: bottom });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Hull and corners
// ---------------------------------------------------------------------------

const cross = (o: Pt, a: Pt, b: Pt): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Andrew's monotone chain. Returns hull vertices counter-clockwise. */
export const convexHull = (points: readonly Pt[]): Pt[] => {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const half = (input: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    return out;
  };

  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};

/**
 * Smallest-area enclosing rectangle, by rotating calipers over hull edges.
 * Returns the rotation that makes the card axis-aligned.
 */
export const minAreaRectAngle = (hull: readonly Pt[]): number => {
  let bestAngle = 0;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of hull) {
      const x = p.x * cos - p.y * sin;
      const y = p.x * sin + p.y * cos;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) {
      bestArea = area;
      bestAngle = angle;
    }
  }
  return bestAngle;
};

/**
 * Four corner candidates: rotate into the card's own frame, then take the
 * extremes of x+y and x−y. Robust to rotation, unlike raw min/max on x and y.
 */
export const extremalCorners = (hull: readonly Pt[]): Pt[] | null => {
  if (hull.length < 4) return null;
  const angle = minAreaRectAngle(hull);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);

  let tl = hull[0];
  let tr = hull[0];
  let br = hull[0];
  let bl = hull[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of hull) {
    const x = p.x * cos - p.y * sin;
    const y = p.x * sin + p.y * cos;
    if (x + y < minSum) {
      minSum = x + y;
      tl = p;
    }
    if (x + y > maxSum) {
      maxSum = x + y;
      br = p;
    }
    if (x - y > maxDiff) {
      maxDiff = x - y;
      tr = p;
    }
    if (x - y < minDiff) {
      minDiff = x - y;
      bl = p;
    }
  }

  const corners = [tl, tr, br, bl];
  // Degenerate hulls can nominate the same point twice.
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (dist(corners[i], corners[j]) < 2) return null;
    }
  }
  return corners;
};

interface Line {
  /** Unit direction. */
  dx: number;
  dy: number;
  x: number;
  y: number;
}

/** Total-least-squares line through points, via the principal axis. */
const fitLine = (points: readonly Pt[]): Line | null => {
  if (points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Principal eigenvector of the 2×2 covariance matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { dx, dy, x: mx, y: my };
};

const intersect = (a: Line, b: Line): Pt | null => {
  const det = a.dx * -b.dy - a.dy * -b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const t = (rx * -b.dy - ry * -b.dx) / det;
  const p = { x: a.x + a.dx * t, y: a.y + a.dy * t };
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
};

const pointLineDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return dist(p, a);
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
};

/**
 * Fit the four sides and intersect them.
 *
 * Magic cards have rounded corners, so the extreme hull point of a corner sits
 * on the arc — inside the true corner. Every region crop downstream is expressed
 * as a fraction of the card, so a systematically undersized quad shifts the
 * title band on every single scan. Intersecting the straight sides puts the
 * corner back where the cardboard would meet.
 */
export const refineCorners = (
  boundary: readonly Pt[],
  approx: readonly Pt[],
): Pt[] | null => {
  const sides: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const a = approx[i];
    const b = approx[(i + 1) % 4];
    const length = dist(a, b);
    if (length < 8) return null;
    const tolerance = Math.max(1.5, length * 0.04);

    // Points along this side, skipping the rounded ends.
    const along = boundary.filter(p => {
      if (pointLineDist(p, a, b) > tolerance) return false;
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length);
      return t > 0.12 && t < 0.88;
    });
    const line = along.length >= 3 ? fitLine(along) : null;
    if (!line) return null;
    sides.push(line);
  }

  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    // Corner i is where the side ending at it meets the side leaving it.
    const previous = sides[(i + 3) % 4];
    const next = sides[i];
    const point = intersect(previous, next);
    // Reject a refinement that wandered: near-parallel sides send the
    // intersection off to infinity.
    if (!point || dist(point, approx[i]) > dist(approx[i], approx[(i + 1) % 4]) * 0.25) {
      return null;
    }
    out.push(point);
  }
  return out;
};
