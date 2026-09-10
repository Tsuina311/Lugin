import { glareRatio, sharpnessScore } from '../quality';
import type { ScanImage } from '../types';
import type { CaptureSideMetrics } from './types';

const lumaAt = (data: Uint8ClampedArray, i: number): number =>
  0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/** Luma standard deviation — relative A/B contrast, same crop size. */
export const localContrast = (image: ScanImage): number => {
  const { data } = image;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += lumaAt(data, i);
    n += 1;
  }
  if (n < 2) return 0;
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < data.length; i += 16) {
    const d = lumaAt(data, i) - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / n);
};

export const sideMetrics = (card: ScanImage, title: ScanImage): CaptureSideMetrics => ({
  cardGlare: glareRatio(card),
  cardSharpness: sharpnessScore(card),
  titleContrast: localContrast(title),
  titleGlare: glareRatio(title),
  titleSharpness: sharpnessScore(title),
});
