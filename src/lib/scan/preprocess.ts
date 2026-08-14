// Image preprocessing for OCR — pure, so the same code runs on a phone and in
// the evaluation harness.
//
// Every step is a separate exported function and the pipelines are declared as
// data, because the point is to *measure* which chain helps rather than to
// assert that a clever filter stack must be an improvement. `PRODUCTION_VARIANT`
// names whichever one currently ships; the harness reports all of them.

import { blankImage, type ScanImage } from './types';

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Tesseract wants roughly this cap height; below it accuracy falls off a cliff. */
export const TARGET_TEXT_HEIGHT = 64;

/** Integer upscale factor that brings a crop up to TARGET_TEXT_HEIGHT, capped at 4×. */
export const upscaleFactorFor = (height: number): number =>
  Math.max(1, Math.min(4, Math.ceil(TARGET_TEXT_HEIGHT / Math.max(1, height))));

/** Bilinear resize. Matches what a canvas does with high-quality smoothing. */
export const resize = (image: ScanImage, width: number, height: number): ScanImage => {
  if (width === image.width && height === image.height) return copy(image);
  const out = blankImage(width, height);
  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = sx - x0;
      const i00 = (y0 * image.width + x0) * 4;
      const i10 = (y0 * image.width + x1) * 4;
      const i01 = (y1 * image.width + x0) * 4;
      const i11 = (y1 * image.width + x1) * 4;
      const oi = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        out.data[oi + c] =
          image.data[i00 + c] * (1 - fx) * (1 - fy) +
          image.data[i10 + c] * fx * (1 - fy) +
          image.data[i01 + c] * (1 - fx) * fy +
          image.data[i11 + c] * fx * fy;
      }
      out.data[oi + 3] = 255;
    }
  }
  return out;
};

/** Scale a crop up so its text is tall enough for OCR. */
export const upscaleForOcr = (image: ScanImage): ScanImage => {
  const factor = upscaleFactorFor(image.height);
  return factor === 1 ? copy(image) : resize(image, image.width * factor, image.height * factor);
};

export const grayscale = (image: ScanImage): ScanImage => {
  const out = copy(image);
  for (let i = 0; i < out.data.length; i += 4) {
    const y = luma(out.data[i], out.data[i + 1], out.data[i + 2]);
    out.data[i] = out.data[i + 1] = out.data[i + 2] = y;
  }
  return out;
};

/**
 * Stretch the luminance histogram to the full range.
 *
 * Global min/max, which is cheap but fragile: a single glare highlight pins the
 * maximum at 255 and flattens the text. `percentile` clips that tail — 0 keeps
 * the original naive behaviour.
 */
export const contrastStretch = (image: ScanImage, percentile = 0): ScanImage => {
  const out = grayscale(image);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < out.data.length; i += 4) histogram[out.data[i] | 0] += 1;

  const total = out.width * out.height;
  const clip = Math.floor(total * percentile);
  let min = 0;
  let max = 255;
  for (let seen = 0, v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen > clip) {
      min = v;
      break;
    }
  }
  for (let seen = 0, v = 255; v >= 0; v--) {
    seen += histogram[v];
    if (seen > clip) {
      max = v;
      break;
    }
  }

  // Clipping can collapse the range entirely when one value dominates the crop.
  // Falling back to the true extremes beats mapping the whole image to black.
  if (max <= min) {
    min = 255;
    max = 0;
    for (let v = 0; v < 256; v++) {
      if (!histogram[v]) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = Math.max(1, max - min);
  for (let i = 0; i < out.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((out.data[i] - min) / range) * 255));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
};

/** Mild S-curve — pushes ink toward black and paper toward white. */
export const sCurve = (image: ScanImage): ScanImage => {
  const out = copy(image);
  for (let i = 0; i < out.data.length; i += 4) {
    const t = out.data[i] / 255;
    const v = (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) * 255;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
};

/**
 * 3×3 unsharp (centre ×5 minus four neighbours).
 *
 * Worth being suspicious of: on a soft, noisy phone frame this amplifies sensor
 * noise into glyph-shaped edges. Kept as an opt-in variant for that reason.
 */
export const sharpen = (image: ScanImage): ScanImage => {
  const out = copy(image);
  const { height, width } = image;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const v =
        5 * image.data[i] -
        image.data[i - 4] -
        image.data[i + 4] -
        image.data[i - width * 4] -
        image.data[i + width * 4];
      const c = Math.max(0, Math.min(255, v));
      out.data[i] = out.data[i + 1] = out.data[i + 2] = c;
    }
  }
  return out;
};

/** Otsu's method: pick the threshold that best separates ink from paper. */
export const otsuThreshold = (image: ScanImage): number => {
  const gray = grayscale(image);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.data.length; i += 4) histogram[gray.data[i] | 0] += 1;

  const total = gray.width * gray.height;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * histogram[v];

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  // Between-class variance is flat across any empty gap between two modes.
  // Taking the middle of that plateau puts the threshold between the modes
  // instead of hard against the darker one.
  let plateauFrom = 0;
  let plateauTo = 0;
  for (let v = 0; v < 256; v++) {
    weightBackground += histogram[v];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += v * histogram[v];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      plateauFrom = v;
      plateauTo = v;
    } else if (variance === bestVariance) {
      plateauTo = v;
    }
  }
  return Math.floor((plateauFrom + plateauTo) / 2);
};

/** Pixels *above* the threshold become paper; the threshold itself counts as ink. */
export const binarize = (image: ScanImage, threshold = otsuThreshold(image)): ScanImage => {
  const out = grayscale(image);
  for (let i = 0; i < out.data.length; i += 4) {
    const v = out.data[i] > threshold ? 255 : 0;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
};

export const copy = (image: ScanImage): ScanImage => ({
  data: new Uint8ClampedArray(image.data),
  height: image.height,
  width: image.width,
});

export interface PreprocessVariant {
  apply: (image: ScanImage) => ScanImage;
  name: string;
}

/**
 * Candidate chains, all starting from the same upscale so the comparison is
 * about filtering rather than resolution.
 */
export const PREPROCESS_VARIANTS: readonly PreprocessVariant[] = [
  { apply: image => copy(image), name: 'original' },
  { apply: upscaleForOcr, name: 'upscale' },
  { apply: image => grayscale(upscaleForOcr(image)), name: 'gray' },
  { apply: image => contrastStretch(upscaleForOcr(image)), name: 'stretch' },
  { apply: image => contrastStretch(upscaleForOcr(image), 0.02), name: 'stretch-clipped' },
  { apply: image => sCurve(contrastStretch(upscaleForOcr(image))), name: 'stretch-scurve' },
  {
    apply: image => sharpen(sCurve(contrastStretch(upscaleForOcr(image)))),
    name: 'stretch-scurve-sharpen',
  },
  { apply: image => binarize(contrastStretch(upscaleForOcr(image), 0.02)), name: 'otsu' },
];

/** Whichever variant `enhanceForOcr` currently implements. */
export const PRODUCTION_VARIANT = 'stretch-scurve-sharpen';

/**
 * The shipping preprocessing chain.
 *
 * Unvalidated as of Phase A — `scripts/scan-eval.mjs` exists to replace this
 * choice with a measured one.
 */
export const enhanceForOcr = (image: ScanImage): ScanImage =>
  sharpen(sCurve(contrastStretch(upscaleForOcr(image))));
