// Compact visual descriptors for artwork matching.
//
// Designed to be computed offline into an index and again at scan time from a
// normalized artwork crop. No neural nets: dHash + block-mean hash are small,
// deterministic, and good enough as a *candidate generator* — title OCR and
// fusion still have to confirm identity.

import type { ScanImage } from '../types';

/** Fixed artwork analysis size — keeps descriptors comparable across sources. */
export const ART_SIZE = 32;

export interface ArtworkDescriptor {
  /** 64-bit difference hash as two uint32s (portable JSON). */
  dhash: [number, number];
  /** 16×4-bit block means packed into 8 bytes (as uint32 pairs). */
  block: [number, number, number, number];
  /** Coarse hue histogram, 8 bins, L1-normalized × 255. */
  hue: number[];
}

const lumaAt = (data: Uint8ClampedArray, width: number, x: number, y: number): number => {
  const i = (y * width + x) * 4;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
};

/** Nearest-neighbour resize to ART_SIZE² grayscale (and optional RGB for hue). */
export const resizeArt = (
  image: ScanImage,
  size = ART_SIZE,
): { gray: Float32Array; hue: Float32Array } => {
  const gray = new Float32Array(size * size);
  const hue = new Float32Array(size * size);
  const xStep = image.width / size;
  const yStep = image.height / size;
  for (let y = 0; y < size; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y + 0.5) * yStep));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x + 0.5) * xStep));
      const i = (sy * image.width + sx) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      gray[y * size + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      hue[y * size + x] = rgbHue(r, g, b);
    }
  }
  return { gray, hue };
};

const rgbHue = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h;
};

/** Classic dHash on a 9×8 gradient of the 32×32 gray art. */
export const differenceHash = (gray: Float32Array, size = ART_SIZE): [number, number] => {
  // Compare horizontally on an 8×8 grid sampled from size×size.
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const x0 = Math.floor((x / 8) * size);
      const x1 = Math.min(size - 1, Math.floor(((x + 1) / 8) * size));
      const yy = Math.floor(((y + 0.5) / 8) * size);
      const left = gray[yy * size + x0];
      const right = gray[yy * size + x1];
      if (left > right) {
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
      bit += 1;
    }
  }
  return [hi >>> 0, lo >>> 0];
};

/** 4×4 block means quantized to 4 bits each → 16 nibbles → 4 uint32s. */
export const blockMeanHash = (gray: Float32Array, size = ART_SIZE): [number, number, number, number] => {
  const blocks = 4;
  const step = size / blocks;
  const means: number[] = [];
  let sumAll = 0;
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor(bx * step);
      const y0 = Math.floor(by * step);
      const x1 = Math.floor((bx + 1) * step);
      const y1 = Math.floor((by + 1) * step);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += gray[y * size + x];
          n += 1;
        }
      }
      const m = n ? sum / n : 0;
      means.push(m);
      sumAll += m;
    }
  }
  const avg = sumAll / means.length;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < means.length; i++) {
    // 4-bit residual around the mean, centered at 8.
    const q = Math.max(0, Math.min(15, Math.round((means[i] - avg) / 16 + 8)));
    const word = Math.floor(i / 4);
    const shift = (i % 4) * 4;
    out[word] |= q << shift;
  }
  return out.map(n => n >>> 0) as [number, number, number, number];
};

export const hueHistogram = (hue: Float32Array, bins = 8): number[] => {
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < hue.length; i++) {
    const b = Math.min(bins - 1, Math.floor(hue[i] * bins));
    counts[b] += 1;
  }
  const n = hue.length || 1;
  return counts.map(c => Math.round((c / n) * 255));
};

export const describeArtwork = (image: ScanImage): ArtworkDescriptor => {
  const { gray, hue } = resizeArt(image);
  return {
    block: blockMeanHash(gray),
    dhash: differenceHash(gray),
    hue: hueHistogram(hue),
  };
};

const popcount32 = (n: number): number => {
  let x = n >>> 0;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export const hamming64 = (a: [number, number], b: [number, number]): number =>
  popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]);

const nibbleDistance = (a: number, b: number): number => {
  let d = 0;
  for (let i = 0; i < 8; i++) {
    const sa = (a >>> (i * 4)) & 0xf;
    const sb = (b >>> (i * 4)) & 0xf;
    d += Math.abs(sa - sb);
  }
  return d;
};

export const blockDistance = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): number =>
  nibbleDistance(a[0], b[0]) +
  nibbleDistance(a[1], b[1]) +
  nibbleDistance(a[2], b[2]) +
  nibbleDistance(a[3], b[3]);

export const hueDistance = (a: readonly number[], b: readonly number[]): number => {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]);
  return d;
};

/**
 * Similarity 0–1 from two descriptors. Weighted blend of dHash agreement,
 * block-mean agreement, and hue histogram agreement.
 */
export const descriptorSimilarity = (a: ArtworkDescriptor, b: ArtworkDescriptor): number => {
  const dh = 1 - hamming64(a.dhash, b.dhash) / 64;
  const bl = 1 - Math.min(1, blockDistance(a.block, b.block) / (16 * 8));
  const hu = 1 - Math.min(1, hueDistance(a.hue, b.hue) / (255 * 2));
  return Math.max(0, Math.min(1, 0.5 * dh + 0.35 * bl + 0.15 * hu));
};

/** Unused but keeps lumaAt available for tests that build tiny images. */
export const _lumaAt = lumaAt;
