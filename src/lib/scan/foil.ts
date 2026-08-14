// Is this printing a foil?
//
// Order of evidence, strongest first:
//   1. The collector-line marker — ★ for premium, • for regular. Definitive when
//      OCR saw it clearly.
//   2. Image stats on the collector strip / card face — foils scatter colour and
//      midtones in a way flat ink does not. A hint, never a verdict alone.
//   3. The user — every scan review lets them flip the finish before saving.

import type { CollectorParse } from './parseCollector';

export interface FoilHint {
  /** 0–1; below ~0.5 the UI should treat this as "please confirm". */
  confidence: number;
  /** What we would default the toggle to. */
  foil: boolean;
  reason: string;
}

export interface ImageStats {
  brightRatio: number;
  colorVariance: number;
  darkRatio: number;
  midtoneRatio: number;
}

/** Sample RGBA pixels into the handful of ratios foil detection needs. */
export const imageStats = (data: Uint8ClampedArray): ImageStats => {
  let dark = 0;
  let mid = 0;
  let bright = 0;
  let satSum = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = (r + g + b) / 3;
    if (y < 60) dark += 1;
    else if (y > 200) bright += 1;
    else mid += 1;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    satSum += max === 0 ? 0 : (max - min) / max;
  }
  return {
    brightRatio: bright / n,
    colorVariance: satSum / n,
    darkRatio: dark / n,
    midtoneRatio: mid / n,
  };
};

/** Foil guess from the collector-line parse and optional strip pixels. */
export const guessFoil = (
  collector: Pick<CollectorParse, 'foilMarker'> | null,
  stats?: ImageStats | null,
): FoilHint => {
  if (collector?.foilMarker === true) {
    return { confidence: 0.95, foil: true, reason: 'collector line shows ★' };
  }
  if (collector?.foilMarker === false) {
    return { confidence: 0.9, foil: false, reason: 'collector line shows •' };
  }

  if (stats) {
    const votes = [
      stats.colorVariance > 0.18,
      stats.midtoneRatio > 0.4,
      stats.darkRatio < 0.3 && stats.brightRatio < 0.35,
    ].filter(Boolean).length;
    if (votes >= 2) {
      return {
        confidence: 0.55 + votes * 0.1,
        foil: true,
        reason: 'colour scatter looks holographic',
      };
    }
    if (votes === 0) {
      return { confidence: 0.55, foil: false, reason: 'flat ink, no foil cue' };
    }
  }

  return { confidence: 0.4, foil: false, reason: 'no clear foil cue — confirm' };
};
