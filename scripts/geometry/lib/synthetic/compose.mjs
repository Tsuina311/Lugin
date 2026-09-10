/** Image buffers + perspective warp sampling for synthetic scenes. */

import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

export const loadRgba = async abs => {
  const buf = await readFile(abs);
  const lower = abs.toLowerCase();
  if (lower.endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const j = jpeg.decode(buf, { useTArray: true });
    return { data: new Uint8ClampedArray(j.data), width: j.width, height: j.height };
  }
  throw new Error(`unsupported image: ${abs}`);
};

export const blankRgba = (w, h, rgb = [128, 128, 128]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
};

export const encodePng = image => {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
};

export const savePng = async (abs, image) => {
  await writeFile(abs, encodePng(image));
};

/** Homography mapping dest → src for unit square card (0,0)-(1,0)-(1,1)-(0,1) to dest quad. */
export const homographyUnitToQuad = quad => {
  // Destination corners: tl,tr,br,bl in pixel space
  const [tl, tr, br, bl] = quad;
  // Solve H such that unit square maps to quad (8 DOF). Use DLT on 4 corners.
  const src = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const dst = [
    [tl[0], tl[1]],
    [tr[0], tr[1]],
    [br[0], br[1]],
    [bl[0], bl[1]],
  ];
  return dltHomography(src, dst);
};

const dltHomography = (src, dst) => {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([-x, -y, -1, 0, 0, 0, x * u, y * u, u]);
    A.push([0, 0, 0, -x, -y, -1, x * v, y * v, v]);
  }
  // Solve Ah=0 via nullspace of 8x9 (Gaussian on last column free h8=1)
  const M = A.map(r => r.slice(0, 8).map((v, j) => v - r[8] * (j === 7 ? 0 : 0)));
  // Better: set h[8]=1 and solve 8x8
  const B = A.map(r => r.slice(0, 8));
  const rhs = A.map(r => -r[8]);
  const h8 = solve8(B, rhs);
  return [...h8, 1];
};

const solve8 = (A, b) => {
  // Gaussian elimination with partial pivot
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(r => r[n]);
};

export const applyH = (H, x, y) => {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
};

export const invertH = H => {
  const m = [
    [H[0], H[1], H[2]],
    [H[3], H[4], H[5]],
    [H[6], H[7], H[8]],
  ];
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const invDet = 1 / (det || 1e-12);
  const c = (r, c0) => {
    const a = (r + 1) % 3;
    const b = (r + 2) % 3;
    const d = (c0 + 1) % 3;
    const e = (c0 + 2) % 3;
    return (m[a][d] * m[b][e] - m[a][e] * m[b][d]) * invDet;
  };
  // adjugate transpose
  return [c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1), c(0, 2), c(1, 2), c(2, 2)];
};

const sampleBilinear = (img, x, y) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= img.width - 1 || y0 >= img.height - 1) return null;
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * img.width + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + img.width * 4;
  const i11 = i01 + 4;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v =
      img.data[i00 + c] * (1 - fx) * (1 - fy) +
      img.data[i10 + c] * fx * (1 - fy) +
      img.data[i01 + c] * (1 - fx) * fy +
      img.data[i11 + c] * fx * fy;
    out[c] = v;
  }
  return out;
};

/**
 * Paste card image into frame using destination quad (tl,tr,br,bl).
 * Returns bounding box used.
 */
export const compositeCard = (frame, card, destQuad, { opacity = 1 } = {}) => {
  const H = homographyUnitToQuad(destQuad); // unit → dest
  const Hinv = invertH(H); // dest → unit
  const xs = destQuad.map(p => p[0]);
  const ys = destQuad.map(p => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(frame.width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(frame.height - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const u = applyH(Hinv, x + 0.5, y + 0.5);
      if (u.x < 0 || u.y < 0 || u.x > 1 || u.y > 1) continue;
      const sx = u.x * (card.width - 1);
      const sy = u.y * (card.height - 1);
      const s = sampleBilinear(card, sx, sy);
      if (!s || s[3] < 8) continue;
      const di = (y * frame.width + x) * 4;
      const a = (s[3] / 255) * opacity;
      frame.data[di] = s[0] * a + frame.data[di] * (1 - a);
      frame.data[di + 1] = s[1] * a + frame.data[di + 1] * (1 - a);
      frame.data[di + 2] = s[2] * a + frame.data[di + 2] * (1 - a);
      frame.data[di + 3] = 255;
    }
  }
  return { minX, maxX, minY, maxY };
};

/** Axis-aligned card placement with rotation about center (degrees). */
export const rotatedRectQuad = (cx, cy, w, h, deg) => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  return corners.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
};

/** Apply perspective by pulling corners inward/outward with severity 0..1. */
export const perspectiveWarpQuad = (baseQuad, severity, rng) => {
  if (severity <= 0) return baseQuad.map(p => [...p]);
  const cx = baseQuad.reduce((s, p) => s + p[0], 0) / 4;
  const cy = baseQuad.reduce((s, p) => s + p[1], 0) / 4;
  return baseQuad.map((p, i) => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    // Pull two opposite corners differently for foreshortening
    const pull = (i === 0 || i === 3 ? 1 : -1) * severity * 0.22;
    const side = (i === 0 || i === 1 ? 1 : -1) * severity * 0.12 * (rng() - 0.5);
    return [p[0] + dx * pull + dy * side, p[1] + dy * pull * 0.6 + dx * side];
  });
};

export const expandQuad = (quad, marginPx) => {
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4;
  const cy = quad.reduce((s, p) => s + p[1], 0) / 4;
  return quad.map(p => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    const f = (len + marginPx) / len;
    return [cx + dx * f, cy + dy * f];
  });
};

export const applyBrightness = (img, factor) => {
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.min(255, Math.max(0, img.data[i] * factor));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1] * factor));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2] * factor));
  }
};

export const applyContrast = (img, factor) => {
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = img.data[i + c];
      img.data[i + c] = Math.min(255, Math.max(0, (v - 128) * factor + 128));
    }
  }
};

/** Box blur radius in pixels (slow but simple). */
export const applyBlur = (img, radius) => {
  if (radius <= 0) return;
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const r = Math.max(1, Math.round(radius));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          rs += src[i];
          gs += src[i + 1];
          bs += src[i + 2];
          n += 1;
        }
      }
      const o = (y * w + x) * 4;
      data[o] = rs / n;
      data[o + 1] = gs / n;
      data[o + 2] = bs / n;
    }
  }
};

export const paintGlare = (img, { cx, cy, angleDeg, length, width, opacity }) => {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfL = length / 2;
  const halfW = width / 2;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (Math.abs(u) > halfL || Math.abs(v) > halfW) continue;
      const fall = (1 - Math.abs(u) / halfL) * (1 - Math.abs(v) / halfW);
      const a = opacity * fall;
      const i = (y * img.width + x) * 4;
      img.data[i] = img.data[i] * (1 - a) + 255 * a;
      img.data[i + 1] = img.data[i + 1] * (1 - a) + 255 * a;
      img.data[i + 2] = img.data[i + 2] * (1 - a) + 255 * a;
    }
  }
};

export const paintRectOccluder = (img, x0, y0, x1, y1, rgb = [20, 20, 20]) => {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1)));
  const maxX = Math.min(img.width - 1, Math.ceil(Math.max(x0, x1)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1)));
  const maxY = Math.min(img.height - 1, Math.ceil(Math.max(y0, y1)));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
};

export const quadToGt = quad => ({
  tl: [quad[0][0], quad[0][1]],
  tr: [quad[1][0], quad[1][1]],
  br: [quad[2][0], quad[2][1]],
  bl: [quad[3][0], quad[3][1]],
});

export const shoelaceArea = quad => {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
};

export const clipVisibleFraction = (quad, w, h) => {
  // Approximate: fraction of AABB inside frame * rough coverage
  const xs = quad.map(p => p[0]);
  const ys = quad.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const full = Math.max(1, (maxX - minX) * (maxY - minY));
  const ix0 = Math.max(0, minX);
  const iy0 = Math.max(0, minY);
  const ix1 = Math.min(w, maxX);
  const iy1 = Math.min(h, maxY);
  const vis = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  return Math.min(1, vis / full);
};
