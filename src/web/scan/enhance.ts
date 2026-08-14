/** Prepare a crop for Tesseract: upscale, grayscale, contrast, light unsharp. */

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Boost contrast around the midtones and run a tiny sharpen pass.
 * Helps when the source is soft (screen glare, slight defocus) without
 * inventing edges from noise.
 */
export const enhanceForOcr = (source: HTMLCanvasElement): HTMLCanvasElement => {
  const { width, height } = source;
  // Target ~64px tall letters when possible.
  const scale = Math.max(1, Math.min(4, Math.ceil(64 / Math.max(1, height))));
  const out = document.createElement('canvas');
  out.width = width * scale;
  out.height = height * scale;
  const ctx = out.getContext('2d');
  if (!ctx) return source;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const { data } = img;
  const gray = new Float32Array(out.width * out.height);

  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const y = luma(data[i], data[i + 1], data[i + 2]);
    gray[p] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  const range = Math.max(1, max - min);
  // Stretch to full range, then mild S-curve for ink vs paper.
  for (let p = 0; p < gray.length; p++) {
    let y = ((gray[p] - min) / range) * 255;
    const t = y / 255;
    y = (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) * 255;
    gray[p] = y;
  }

  // 3×3 unsharp: center*5 - neighbors.
  const w = out.width;
  const h = out.height;
  const sharp = new Float32Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        sharp[i] = gray[i];
        continue;
      }
      const c =
        5 * gray[i] -
        gray[i - 1] -
        gray[i + 1] -
        gray[i - w] -
        gray[i + w];
      sharp[i] = Math.max(0, Math.min(255, c));
    }
  }

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = Math.round(sharp[p]);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
};
