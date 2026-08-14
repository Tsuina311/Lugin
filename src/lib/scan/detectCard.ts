// Detect a Magic-card-like quadrilateral in a frame (pure JS, no OpenCV).

import {
  orderCorners,
  scoreCardQuad,
  type Pt,
  type Quad,
} from './geometry';

export interface DetectResult {
  /** Confidence-ish score from scoreCardQuad; 0 if none. */
  score: number;
  quad: Quad | null;
}

/** Downscale / grayscale / blur / edges → best card quad, or null. */
export const detectCardQuad = (
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): DetectResult => {
  // Work on a small raster for speed on phones.
  const maxW = 320;
  const scale = width > maxW ? maxW / width : 1;
  const w = Math.max(32, Math.round(width * scale));
  const h = Math.max(32, Math.round(height * scale));
  const gray = downscaleGray(rgba, width, height, w, h);
  boxBlurInPlace(gray, w, h, 2);
  const edges = sobelThresh(gray, w, h);
  dilateInPlace(edges, w, h);
  dilateInPlace(edges, w, h);

  const contours = findExternalContours(edges, w, h);
  let best: Quad | null = null;
  let bestScore = 0;

  for (const contour of contours) {
    if (contour.length < 16) continue;
    const area = Math.abs(shoelace(contour));
    if (area < w * h * 0.08) continue;

    for (const epsFactor of [0.02, 0.03, 0.045, 0.06]) {
      const peri = perimeter(contour);
      const approx = approxPolyDP(contour, epsFactor * peri);
      if (approx.length !== 4) continue;
      const quad = orderCorners(approx);
      const score = scoreCardQuad(quad, w, h);
      if (score > bestScore) {
        bestScore = score;
        best = quad;
      }
    }
  }

  if (!best || bestScore < 0.35) {
    return { quad: null, score: 0 };
  }

  // Map back to full-resolution coordinates.
  const inv = 1 / scale;
  const full: Quad = orderCorners(
    best.map(p => ({ x: p.x * inv, y: p.y * inv })),
  );
  return { quad: full, score: bestScore };
};

const downscaleGray = (
  rgba: Uint8ClampedArray | Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array => {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * (sh / dh)));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * (sw / dw)));
      const i = (sy * sw + sx) * 4;
      out[y * dw + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
  }
  return out;
};

const boxBlurInPlace = (img: Float32Array, w: number, h: number, r: number) => {
  const tmp = new Float32Array(img.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        sum += img[y * w + xx];
        n += 1;
      }
      tmp[y * w + x] = sum / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        sum += tmp[yy * w + x];
        n += 1;
      }
      img[y * w + x] = sum / n;
    }
  }
};

const sobelThresh = (gray: Float32Array, w: number, h: number): Uint8Array => {
  const mag = new Float32Array(w * h);
  let max = 0;
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
      if (m > max) max = m;
    }
  }
  const thr = max * 0.18;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) out[i] = mag[i] >= thr ? 1 : 0;
  return out;
};

const dilateInPlace = (bin: Uint8Array, w: number, h: number) => {
  const copy = bin.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        copy[i] ||
        copy[i - 1] ||
        copy[i + 1] ||
        copy[i - w] ||
        copy[i + w]
      ) {
        bin[i] = 1;
      }
    }
  }
};

/** Moore-neighborhood external contour trace on a binary edge map. */
const findExternalContours = (bin: Uint8Array, w: number, h: number): Pt[][] => {
  const seen = new Uint8Array(w * h);
  const contours: Pt[][] = [];
  // 8-connected clockwise from east.
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!bin[i] || seen[i]) continue;
      // Start only on left-edge transitions to limit duplicates.
      if (bin[i - 1]) continue;

      const contour: Pt[] = [];
      let cx = x;
      let cy = y;
      let dir = 0;
      let guard = 0;
      do {
        const ci = cy * w + cx;
        if (!seen[ci]) {
          seen[ci] = 1;
          contour.push({ x: cx, y: cy });
        }
        let found = false;
        for (let k = 0; k < 8; k++) {
          const nd = (dir + 6 + k) % 8; // turn left-ish first
          const nx = cx + dx[nd];
          const ny = cy + dy[nd];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!bin[ny * w + nx]) continue;
          cx = nx;
          cy = ny;
          dir = nd;
          found = true;
          break;
        }
        if (!found) break;
        guard += 1;
      } while ((cx !== x || cy !== y) && guard < w * h);

      if (contour.length >= 16) contours.push(contour);
    }
  }
  return contours;
};

const shoelace = (pts: readonly Pt[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
};

const perimeter = (pts: readonly Pt[]): number => {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    p += Math.hypot(
      pts[i].x - pts[(i + 1) % pts.length].x,
      pts[i].y - pts[(i + 1) % pts.length].y,
    );
  }
  return p;
};

/** Douglas–Peucker polyline simplification. */
const approxPolyDP = (pts: readonly Pt[], epsilon: number): Pt[] => {
  if (pts.length < 3) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = start;
    const a = pts[start];
    const b = pts[end];
    for (let i = start + 1; i < end; i++) {
      const d = pointLineDist(pts[i], a, b);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  return pts.filter((_, i) => keep[i]);
};

const pointLineDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.sqrt(len2);
};
