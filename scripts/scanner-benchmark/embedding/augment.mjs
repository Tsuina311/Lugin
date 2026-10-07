/**
 * Synthetic phone-like views of a canonical card image.
 * Crop error, perspective, blur, glare, and exposure are the emphasized corruptions.
 */

import sharp from 'sharp';

import { mulberry32 } from './math.mjs';

export const hashSeed = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

const gauss = (A, b) => {
  const n = b.length;
  const M = A.map(row => Float64Array.from(row));
  const y = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('singular homography');
    if (pivot !== col) {
      [M[col], M[pivot]] = [M[pivot], M[col]];
      [y[col], y[pivot]] = [y[pivot], y[col]];
    }
    const div = M[col][col];
    for (let c = col; c < n; c++) M[col][c] /= div;
    y[col] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
      y[r] -= f * y[col];
    }
  }
  return y;
};

const solveHomography = (src, dst) => {
  const A = Array.from({ length: 8 }, () => new Float64Array(8));
  const b = new Float64Array(8);
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    const r = i * 2;
    A[r][0] = x;
    A[r][1] = y;
    A[r][2] = 1;
    A[r][6] = -u * x;
    A[r][7] = -u * y;
    b[r] = u;
    A[r + 1][3] = x;
    A[r + 1][4] = y;
    A[r + 1][5] = 1;
    A[r + 1][6] = -v * x;
    A[r + 1][7] = -v * y;
    b[r + 1] = v;
  }
  return gauss(A, b);
};

const applyH = (h, x, y) => {
  const den = h[6] * x + h[7] * y + 1 || 1e-8;
  return [(h[0] * x + h[1] * y + h[2]) / den, (h[3] * x + h[4] * y + h[5]) / den];
};

const sample = (src, w, h, x, y) => {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const out = [0, 0, 0, 255];
  for (let c = 0; c < 3; c++) {
    const v =
      src[i00 + c] * (1 - tx) * (1 - ty) +
      src[i10 + c] * tx * (1 - ty) +
      src[i01 + c] * (1 - tx) * ty +
      src[i11 + c] * tx * ty;
    out[c] = v;
  }
  return out;
};

const warp = (src, w, h, quad) => {
  const dst = Buffer.alloc(w * h * 4);
  const hmat = solveHomography(
    [
      [0, 0],
      [w - 1, 0],
      [w - 1, h - 1],
      [0, h - 1],
    ],
    quad,
  );
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = applyH(hmat, x, y);
      const px = sample(src, w, h, sx, sy);
      const o = (y * w + x) * 4;
      if (!px) {
        dst[o + 3] = 255;
        continue;
      }
      dst[o] = px[0];
      dst[o + 1] = px[1];
      dst[o + 2] = px[2];
      dst[o + 3] = 255;
    }
  }
  return dst;
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {string} inputPath
 * @param {object} preset
 * @param {string} seedKey
 * @returns {Promise<Buffer>}
 */
export const renderView = async (inputPath, preset, seedKey) => {
  const rng = mulberry32(hashSeed(seedKey));
  const base = await sharp(inputPath)
    .rotate()
    .resize({ width: 336, height: 336, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let buf = Buffer.from(base.data);
  let w = base.info.width;
  let h = base.info.height;
  const bg = [40 + rng() * 80, 40 + rng() * 70, 40 + rng() * 60];

  const crop = preset.crop ?? 0;
  const sign = preset.cropSign ?? (rng() < 0.5 ? -1 : 1);
  if (crop > 0) {
    if (sign < 0) {
      const cw = Math.max(8, Math.round(w * (1 - crop)));
      const ch = Math.max(8, Math.round(h * (1 - crop)));
      const maxL = w - cw;
      const maxT = h - ch;
      const left = clamp(Math.round(maxL * (0.5 + (rng() - 0.5) * 0.9)), 0, maxL);
      const top = clamp(Math.round(maxT * (0.5 + (rng() - 0.5) * 0.9)), 0, maxT);
      const next = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++) {
        buf.copy(next, y * cw * 4, ((top + y) * w + left) * 4, ((top + y) * w + left + cw) * 4);
      }
      buf = next;
      w = cw;
      h = ch;
    } else {
      const px = Math.round((w * crop) / 2);
      const py = Math.round((h * crop) / 2);
      const nw = w + px * 2;
      const nh = h + py * 2;
      const next = Buffer.alloc(nw * nh * 4);
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const o = (y * nw + x) * 4;
          const sx = x - px;
          const sy = y - py;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
            next[o] = bg[0];
            next[o + 1] = bg[1];
            next[o + 2] = bg[2];
            next[o + 3] = 255;
          } else {
            const s = (sy * w + sx) * 4;
            next[o] = buf[s];
            next[o + 1] = buf[s + 1];
            next[o + 2] = buf[s + 2];
            next[o + 3] = 255;
          }
        }
      }
      buf = next;
      w = nw;
      h = nh;
    }
  }

  if (preset.perspective) {
    const m = preset.perspective;
    const j = () => (rng() - 0.5) * 2 * m;
    const quad = [
      [w * clamp(j(), -0.2, 0.2), h * clamp(j(), -0.2, 0.2)],
      [w - 1 + w * clamp(j(), -0.2, 0.2), h * clamp(j(), -0.2, 0.2)],
      [w - 1 + w * clamp(j(), -0.2, 0.2), h - 1 + h * clamp(j(), -0.2, 0.2)],
      [w * clamp(j(), -0.2, 0.2), h - 1 + h * clamp(j(), -0.2, 0.2)],
    ];
    try {
      buf = warp(buf, w, h, quad);
    } catch {
      // Keep the unwarped view when the jitter is degenerate.
    }
  }

  if (preset.partial) {
    const side = Math.floor(rng() * 4);
    const cut = Math.round((side % 2 === 0 ? w : h) * preset.partial);
    const next = Buffer.from(buf);
    if (side === 0) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < cut; x++) {
          const o = (y * w + x) * 4;
          next[o] = bg[0];
          next[o + 1] = bg[1];
          next[o + 2] = bg[2];
        }
    } else if (side === 1) {
      for (let y = 0; y < h; y++)
        for (let x = w - cut; x < w; x++) {
          const o = (y * w + x) * 4;
          next[o] = bg[0];
          next[o + 1] = bg[1];
          next[o + 2] = bg[2];
        }
    } else if (side === 2) {
      for (let y = 0; y < cut; y++)
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          next[o] = bg[0];
          next[o + 1] = bg[1];
          next[o + 2] = bg[2];
        }
    } else {
      for (let y = h - cut; y < h; y++)
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          next[o] = bg[0];
          next[o + 1] = bg[1];
          next[o + 2] = bg[2];
        }
    }
    buf = next;
  }

  if (preset.background) {
    const scale = 1 - preset.background;
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const left = Math.round((w - cw) * (0.35 + rng() * 0.3));
    const top = Math.round((h - ch) * (0.35 + rng() * 0.3));
    const canvas = Buffer.alloc(w * h * 4);
    for (let i = 0; i < canvas.length; i += 4) {
      canvas[i] = clamp(bg[0] + (rng() - 0.5) * 40, 0, 255);
      canvas[i + 1] = clamp(bg[1] + (rng() - 0.5) * 40, 0, 255);
      canvas[i + 2] = clamp(bg[2] + (rng() - 0.5) * 40, 0, 255);
      canvas[i + 3] = 255;
    }
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = Math.min(w - 1, Math.round((x / cw) * (w - 1)));
        const sy = Math.min(h - 1, Math.round((y / ch) * (h - 1)));
        const s = (sy * w + sx) * 4;
        const d = ((top + y) * w + (left + x)) * 4;
        if (top + y >= h || left + x >= w) continue;
        canvas[d] = buf[s];
        canvas[d + 1] = buf[s + 1];
        canvas[d + 2] = buf[s + 2];
        canvas[d + 3] = 255;
      }
    }
    buf = canvas;
  }

  let pipeline = sharp(buf, { raw: { width: w, height: h, channels: 4 } });
  if (preset.blur) pipeline = pipeline.blur(preset.blur);
  const bright = preset.brightness ?? 1;
  if (bright !== 1) pipeline = pipeline.modulate({ brightness: bright });
  const again = await pipeline.raw().toBuffer({ resolveWithObject: true });
  buf = Buffer.from(again.data);
  w = again.info.width;
  h = again.info.height;

  if (preset.motion) {
    const radius = preset.motion;
    const next = Buffer.from(buf);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = clamp(x + k, 0, w - 1);
          const o = (y * w + xx) * 4;
          r += buf[o];
          g += buf[o + 1];
          b += buf[o + 2];
          n += 1;
        }
        const d = (y * w + x) * 4;
        next[d] = r / n;
        next[d + 1] = g / n;
        next[d + 2] = b / n;
      }
    }
    buf = next;
  }

  if (preset.noise) {
    const amp = preset.noise;
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = clamp(buf[i] + (rng() - 0.5) * 2 * amp, 0, 255);
      buf[i + 1] = clamp(buf[i + 1] + (rng() - 0.5) * 2 * amp, 0, 255);
      buf[i + 2] = clamp(buf[i + 2] + (rng() - 0.5) * 2 * amp, 0, 255);
    }
  }

  if (preset.wb) {
    const rr = 0.85 + rng() * 0.4;
    const bb = 0.85 + rng() * 0.4;
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = clamp(buf[i] * rr, 0, 255);
      buf[i + 2] = clamp(buf[i + 2] * bb, 0, 255);
    }
  }

  if (preset.glare) {
    const cx = w * (0.25 + rng() * 0.5);
    const cy = h * (0.2 + rng() * 0.45);
    const rad = Math.min(w, h) * (0.22 + rng() * 0.28) ;
    const gain = 170 * preset.glare;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d >= 1) continue;
        const add = (1 - d) * (1 - d) * gain;
        const o = (y * w + x) * 4;
        buf[o] = clamp(buf[o] + add, 0, 255);
        buf[o + 1] = clamp(buf[o + 1] + add, 0, 255);
        buf[o + 2] = clamp(buf[o + 2] + add, 0, 255);
      }
    }
  }

  if (preset.sleeve) {
    const y0 = Math.round(h * (0.15 + rng() * 0.5));
    const band = Math.round(h * 0.06);
    for (let y = y0; y < Math.min(h, y0 + band); y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        buf[o] = clamp(buf[o] * 0.7 + 90, 0, 255);
        buf[o + 1] = clamp(buf[o + 1] * 0.7 + 90, 0, 255);
        buf[o + 2] = clamp(buf[o + 2] * 0.7 + 90, 0, 255);
      }
    }
  }

  const quality = preset.jpeg ?? 72;
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .jpeg({ quality, mozjpeg: false })
    .toBuffer();
};

export const selfTestAugment = () => {
  const h = solveHomography(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  );
  const [x, y] = applyH(h, 5, 5);
  if (Math.abs(x - 5) > 1e-3 || Math.abs(y - 5) > 1e-3) {
    throw new Error(`homography identity failed: ${x}, ${y}`);
  }
  return true;
};
