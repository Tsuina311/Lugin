// Geometry helpers for card detection + perspective correction.

export interface Pt {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Pt, Pt, Pt, Pt];

/** Physical Magic card aspect (mm): width / height. */
export const CARD_ASPECT = 63 / 88;

/** Canonical upright card raster used for region crops + OCR. */
export const CARD_WIDTH = 504;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_ASPECT);

export const dist = (a: Pt, b: Pt): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

/** Reorder any 4 corners into TL, TR, BR, BL. */
export const orderCorners = (pts: readonly Pt[]): Quad => {
  if (pts.length !== 4) throw new Error('orderCorners expects 4 points');
  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
};

/** Axis-aligned quad for a rectangle in image space. */
export const rectQuad = (x: number, y: number, w: number, h: number): Quad =>
  orderCorners([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);

/**
 * Build the 3×3 homography that maps destination → source (inverse map),
 * so each output pixel can sample the input.
 */
export const homographyDestToSrc = (src: Quad, dest: Quad): Float64Array => {
  // Solve for H such that src = H * dest (in homogeneous coords).
  // 8 unknowns (h33 = 1).
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: dx, y: dy } = dest[i];
    const { x: sx, y: sy } = src[i];
    A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
    b.push(sx);
    A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
    b.push(sy);
  }
  const h = solve8(A, b);
  return new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
};

/** Apply homography to a point. */
export const applyH = (H: Float64Array, p: Pt): Pt => {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
};

/** Gaussian elimination for an 8×8 system. */
const solve8 = (A: number[][], b: number[]): number[] => {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    if (Math.abs(div) < 1e-12) throw new Error('Singular homography');
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
};

/**
 * Perspective-warp `src` so `quad` becomes an upright CARD_WIDTH × CARD_HEIGHT card.
 * Samples with bilinear interpolation (inverse mapping).
 */
export const warpQuadToCard = (
  src: {
    data: Uint8ClampedArray | Uint8Array;
    height: number;
    width: number;
  },
  quad: Quad,
  outW = CARD_WIDTH,
  outH = CARD_HEIGHT,
): { data: Uint8ClampedArray; height: number; width: number } => {
  const dest = rectQuad(0, 0, outW - 1, outH - 1);
  const H = homographyDestToSrc(quad, dest);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sw = src.width;
  const sh = src.height;
  const sdata = src.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(H, { x, y });
      const sx = p.x;
      const sy = p.y;
      const oi = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        out[oi] = out[oi + 1] = out[oi + 2] = 0;
        out[oi + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          sdata[i00 + c] * (1 - fx) * (1 - fy) +
          sdata[i10 + c] * fx * (1 - fy) +
          sdata[i01 + c] * (1 - fx) * fy +
          sdata[i11 + c] * fx * fy;
        out[oi + c] = v;
      }
      out[oi + 3] = 255;
    }
  }
  return { data: out, height: outH, width: outW };
};

/** How well a quad matches a Magic card silhouette (0–1-ish score). */
export const scoreCardQuad = (
  quad: Quad,
  imageW: number,
  imageH: number,
): number => {
  const [tl, tr, br, bl] = quad;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 8 || bottom < 8 || left < 8 || right < 8) return 0;

  const width = (top + bottom) / 2;
  const height = (left + right) / 2;
  const aspect = width / height;
  const aspectScore = 1 - Math.min(1, Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT);

  // Parallelism: opposite sides similar length.
  const parallel =
    1 -
    Math.min(1, (Math.abs(top - bottom) / width + Math.abs(left - right) / height) / 2);

  // Area relative to frame — prefer a large card, not a tiny scrap.
  const area = Math.abs(
    tl.x * tr.y +
      tr.x * br.y +
      br.x * bl.y +
      bl.x * tl.y -
      (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
  ) / 2;
  const areaScore = Math.min(1, area / (imageW * imageH * 0.35));

  // Prefer quads near the centre (guide).
  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;
  const centerDist = Math.hypot(cx - imageW / 2, cy - imageH / 2);
  const centerScore = 1 - Math.min(1, centerDist / (Math.hypot(imageW, imageH) / 2));

  return aspectScore * 0.4 + parallel * 0.25 + areaScore * 0.25 + centerScore * 0.1;
};
