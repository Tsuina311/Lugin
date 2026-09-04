// Find the card quadrilateral in a frame. Pure JS, no OpenCV.
//
// Strategy: separate the card from the background as a *region*, then read its
// corners off the convex hull — plus multi-threshold / chroma / edge fallbacks
// for real phone scenes where a single luminance ring threshold fails.
//
// History: the old contour+Douglas–Peucker path scored 0/220 on fixtures while
// edges were fine. Region separation recovered synthetic detection. Real tables
// then showed luminance-only masks failing on playmats and low-contrast desks,
// which is what the hybrid candidate path below addresses.

import {
  DETECT_MAX_AREA_SHARE,
  DETECT_MIN_AREA_SHARE,
  DETECT_TOP_COMPONENTS,
} from './params';
import type {
  DetectionCandidateDebug,
  DetectionDebug,
  DetectionScoreParts,
} from './detection/types';
import { selectPrimaryAmongDebugCandidates } from './detection/multi';
import {
  cornersToQuad,
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
  /** Structured candidates for debug / eval — always populated. */
  debug: DetectionDebug;
  quad: Quad | null;
  /** Confidence-ish score from scoreCardQuad; 0 if none. */
  score: number;
}

/** Analysis resolution. Corners are mapped back to full resolution at the end. */
const WORK_WIDTH = 320;

export const detectCardQuad = (image: ScanImage): DetectResult => {
  const began =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const { height: fullH, width: fullW } = image;
  const scale = fullW > WORK_WIDTH ? WORK_WIDTH / fullW : 1;
  const w = Math.max(32, Math.round(fullW * scale));
  const h = Math.max(32, Math.round(fullH * scale));
  const gray = downscaleGray(image, w, h);
  const rgb = downscaleRgb(image, w, h);

  const candidates: DetectionCandidateDebug[] = [];
  const chosen: {
    current: { corners: CardCorners; index: number; quad: Quad; score: number } | null;
  } = { current: null };

  const consider = (
    mask: Uint8Array,
    method: string,
    extras?: Partial<DetectionScoreParts>,
  ) => {
    const comps = topComponents(mask, w, h, DETECT_TOP_COMPONENTS);
    for (const component of comps) {
      const areaShare = component.area / (w * h);
      const rejectedBecause: string[] = [];
      if (areaShare < DETECT_MIN_AREA_SHARE) rejectedBecause.push('insufficient area');
      if (areaShare > DETECT_MAX_AREA_SHARE) rejectedBecause.push('covers whole frame');

      let corners: CardCorners | null = null;
      let score = 0;
      let parts: DetectionScoreParts = {
        aspect: 0,
        area: 0,
        center: 0,
        parallel: 0,
        ...extras,
      };

      if (!rejectedBecause.length) {
        const boundary = boundaryPoints(component.pixels, w, h);
        const hull = convexHull(boundary);
        if (hull.length < 4) {
          rejectedBecause.push('hull too small');
        } else {
          const approx = extremalCorners(hull);
          if (!approx) {
            rejectedBecause.push('degenerate corners');
          } else {
            const refined = refineCorners(boundary, approx) ?? approx;
            const quad = orderCorners(
              refined.map(p => ({ x: p.x / scale, y: p.y / scale })),
            );
            score = scoreCardQuad(quad, fullW, fullH);
            parts = scoreParts(quad, fullW, fullH, extras);
            if (score < 0.15) rejectedBecause.push('low silhouette score');
            if (parts.aspect < 0.25) rejectedBecause.push('aspect ratio');
            if ((method.startsWith('edge') || method.startsWith('chroma')) && score < 0.45) {
              rejectedBecause.push('weak non-luma candidate');
            }
            if (!rejectedBecause.length) {
              corners = quadToCorners(quad);
              const entry: DetectionCandidateDebug = {
                components: parts,
                corners,
                method,
                rejectedBecause: [],
                score,
              };
              const idx = candidates.length;
              candidates.push(entry);
              if (!chosen.current || score > chosen.current.score) {
                chosen.current = { corners, index: idx, quad, score };
              }
              continue;
            }
          }
        }
      }

      candidates.push({
        components: parts,
        corners,
        method,
        rejectedBecause,
        score,
      });
    }
  };

  // --- luminance difference masks (multi-threshold) ---
  const ringStats = sampleRingStats(gray, w, h);
  if (ringStats) {
    const { background, spread } = ringStats;
    for (const mult of [2.5, 3.5, 5, 7]) {
      const thr = Math.max(10, spread * mult);
      consider(diffMask(gray, w, h, background, thr), `luma×${mult}`);
    }
    // Absolute fixed thresholds help when MAD collapses on flat desks.
    for (const thr of [12, 18, 28]) {
      consider(diffMask(gray, w, h, background, thr), `luma@${thr}`);
    }
  }

  // --- chroma difference (playmat / wood grain) ---
  const chromaBg = sampleRingRgb(rgb, w, h);
  if (chromaBg) {
    for (const thr of [18, 28, 40]) {
      consider(chromaMask(rgb, w, h, chromaBg, thr), `chroma@${thr}`);
    }
  }

  // --- edge magnitude fallback ---
  const edges = sobelMask(gray, w, h);
  if (edges) consider(edges, 'edge', { edge: 0.5 });

  const ms =
    (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) -
    began;

  // Nested sleeve preference: may override pure max-score when an inner card
  // sits inside a stronger outer rectangle.
  const nestedPick = selectPrimaryAmongDebugCandidates(candidates, fullW, fullH);
  let selected = chosen.current;
  if (nestedPick.selectedIndex >= 0 && candidates[nestedPick.selectedIndex]?.corners) {
    const c = candidates[nestedPick.selectedIndex];
    if (c.corners) {
      selected = {
        corners: c.corners,
        index: nestedPick.selectedIndex,
        quad: cornersToQuad(c.corners),
        score: c.score,
      };
    }
  }

  if (!selected) {
    return {
      corners: null,
      debug: { candidates, ms, selectedIndex: -1, workSize: { height: h, width: w } },
      quad: null,
      score: 0,
    };
  }

  if (candidates[selected.index]) {
    candidates[selected.index] = {
      ...candidates[selected.index],
      rejectedBecause: [],
    };
  }

  return {
    corners: selected.corners,
    debug: {
      candidates,
      ms,
      selectedIndex: selected.index,
      workSize: { height: h, width: w },
    },
    quad: selected.quad,
    score: selected.score,
  };
};

const scoreParts = (
  quad: Quad,
  imageW: number,
  imageH: number,
  extras?: Partial<DetectionScoreParts>,
): DetectionScoreParts => {
  const [tl, tr, br, bl] = quad;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspect = width / Math.max(height, 1e-6);
  const CARD = 63 / 88;
  const aspectScore = 1 - Math.min(1, Math.abs(aspect - CARD) / CARD);
  const parallel =
    1 -
    Math.min(
      1,
      (Math.abs(top - bottom) / Math.max(width, 1) +
        Math.abs(left - right) / Math.max(height, 1)) /
        2,
    );
  const area =
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
    ) / 2;
  const areaScore = Math.min(1, area / (imageW * imageH * 0.35));
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const centerDist = Math.hypot(cx - imageW / 2, cy - imageH / 2);
  const centerScore = 1 - Math.min(1, centerDist / (Math.hypot(imageW, imageH) / 2));
  return {
    aspect: aspectScore,
    area: areaScore,
    center: centerScore,
    parallel,
    ...extras,
  };
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

const downscaleRgb = (
  image: ScanImage,
  dw: number,
  dh: number,
): { b: Float32Array; g: Float32Array; r: Float32Array } => {
  const { data, height: sh, width: sw } = image;
  const r = new Float32Array(dw * dh);
  const g = new Float32Array(dw * dh);
  const b = new Float32Array(dw * dh);
  const xStep = sw / dw;
  const yStep = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * yStep));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * xStep));
      const i = (sy * sw + sx) * 4;
      const o = y * dw + x;
      r[o] = data[i];
      g[o] = data[i + 1];
      b[o] = data[i + 2];
    }
  }
  return { b, g, r };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

const sampleRingStats = (
  gray: Float32Array,
  w: number,
  h: number,
): { background: number; spread: number } | null => {
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
  const spread = median(ring.map(v => Math.abs(v - background)));
  return { background, spread };
};

const sampleRingRgb = (
  rgb: { b: Float32Array; g: Float32Array; r: Float32Array },
  w: number,
  h: number,
): { b: number; g: number; r: number } | null => {
  const band = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y++) {
    const edgeRow = y < band || y >= h - band;
    for (let x = 0; x < w; x++) {
      if (!(edgeRow || x < band || x >= w - band)) continue;
      const i = y * w + x;
      rs.push(rgb.r[i]);
      gs.push(rgb.g[i]);
      bs.push(rgb.b[i]);
    }
  }
  if (rs.length < 16) return null;
  return { b: median(bs), g: median(gs), r: median(rs) };
};

const diffMask = (
  gray: Float32Array,
  w: number,
  h: number,
  background: number,
  threshold: number,
): Uint8Array => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Math.abs(gray[i] - background) > threshold ? 1 : 0;
  }
  dilate(mask, w, h);
  erode(mask, w, h);
  return mask;
};

const chromaMask = (
  rgb: { b: Float32Array; g: Float32Array; r: Float32Array },
  w: number,
  h: number,
  bg: { b: number; g: number; r: number },
  threshold: number,
): Uint8Array => {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const dr = rgb.r[i] - bg.r;
    const dg = rgb.g[i] - bg.g;
    const db = rgb.b[i] - bg.b;
    mask[i] = Math.sqrt(dr * dr + dg * dg + db * db) > threshold ? 1 : 0;
  }
  dilate(mask, w, h);
  dilate(mask, w, h);
  erode(mask, w, h);
  return mask;
};

/** Sobel edge magnitude → closed binary mask of strong edges. */
const sobelMask = (gray: Float32Array, w: number, h: number): Uint8Array | null => {
  const mag = new Float32Array(w * h);
  let sum = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] +
        gray[i - w + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + w - 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      sum += m;
      count += 1;
    }
  }
  if (!count) return null;
  const mean = sum / count;
  const thr = Math.max(25, mean * 1.8);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = mag[i] > thr ? 1 : 0;
  // Close edge ribbons lightly — heavy close fills a noisy frame into one blob.
  dilate(mask, w, h);
  dilate(mask, w, h);
  erode(mask, w, h);
  return mask;
};

/**
 * Original single-threshold mask (kept for tests / baseline variant).
 */
export const foregroundMask = (gray: Float32Array, w: number, h: number): Uint8Array | null => {
  const stats = sampleRingStats(gray, w, h);
  if (!stats) return null;
  const threshold = Math.max(16, stats.spread * 4);
  return diffMask(gray, w, h, stats.background, threshold);
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
      if (edge && x > 0 && y > 0 && x < w - 1 && y < h - 1) mask[i] = 0;
    }
  }
};

interface Component {
  area: number;
  pixels: Uint8Array;
}

/** Largest 4-connected blob — kept for unit tests. */
export const largestComponent = (
  mask: Uint8Array,
  w: number,
  h: number,
): Component | null => {
  const all = topComponents(mask, w, h, 1);
  return all[0] ?? null;
};

/** Top-N components by area. */
export const topComponents = (
  mask: Uint8Array,
  w: number,
  h: number,
  n: number,
): Component[] => {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const areas: number[] = [0];
  let label = 0;

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
    areas[label] = area;
  }

  const ranked = areas
    .map((area, id) => ({ area, id }))
    .filter(x => x.id > 0)
    .sort((a, b) => b.area - a.area)
    .slice(0, Math.max(1, n));

  return ranked.map(({ area, id }) => {
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < labels.length; i++) pixels[i] = labels[i] === id ? 1 : 0;
    return { area, pixels };
  });
};

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

const cross = (o: Pt, a: Pt, b: Pt): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

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
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (dist(corners[i], corners[j]) < 2) return null;
    }
  }
  return corners;
};

interface Line {
  dx: number;
  dy: number;
  x: number;
  y: number;
}

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
    const previous = sides[(i + 3) % 4];
    const next = sides[i];
    const point = intersect(previous, next);
    if (!point || dist(point, approx[i]) > dist(approx[i], approx[(i + 1) % 4]) * 0.25) {
      return null;
    }
    out.push(point);
  }
  return out;
};

/** Polygon IoU for detection eval (shoelace + Sutherland–Hodgman clip). */
export const polygonIoU = (a: CardCorners, b: CardCorners): number => {
  const pa = [a.topLeft, a.topRight, a.bottomRight, a.bottomLeft];
  const pb = [b.topLeft, b.topRight, b.bottomRight, b.bottomLeft];
  const areaA = shoelace(pa);
  const areaB = shoelace(pb);
  const inter = shoelace(clipPolygon(pa, pb));
  const union = areaA + areaB - inter;
  return union > 1e-6 ? inter / union : 0;
};

const shoelace = (pts: readonly Pt[]): number => {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};

const clipPolygon = (subject: Pt[], clip: Pt[]): Pt[] => {
  let output = [...subject];
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const pin = cross(a, b, p) >= 0;
      const qin = cross(a, b, q) >= 0;
      if (pin && qin) output.push(q);
      else if (pin && !qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
      } else if (!pin && qin) {
        const hit = edgeIntersect(p, q, a, b);
        if (hit) output.push(hit);
        output.push(q);
      }
    }
  }
  return output;
};

const edgeIntersect = (p: Pt, q: Pt, a: Pt, b: Pt): Pt | null => {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / det;
  return { x: p.x + t * dx, y: p.y + t * dy };
};
