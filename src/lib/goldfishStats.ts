/**
 * Smallest deck count whose rounded shares can produce every whole-number
 * percent Goldfish printed. Four decks only ever print 25, 50, 75, and 100;
 * a percent of 13 means the sample is bigger than four.
 *
 * Kept separate from the DOM-based Goldfish parser so Lugin Native can share
 * the inference without pulling browser DOM types into its TypeScript build.
 */
export const goldfishSampleSize = (percents: readonly number[]): number | undefined => {
  const seen = [
    ...new Set(
      percents.map(percent => Math.round(percent)).filter(percent => percent > 0 && percent <= 100),
    ),
  ];
  if (seen.length === 0) return undefined;
  for (let sample = 1; sample <= 80; sample++) {
    const fits = seen.every(percent => {
      for (let count = 0; count <= sample; count++) {
        if (Math.round((100 * count) / sample) === percent) return true;
      }
      return false;
    });
    if (fits) return sample;
  }
  return undefined;
};

/** Deck count behind one printed percent, once the sample size is known. */
export const goldfishDeckCount = (percent: number, sample: number): number | undefined => {
  const target = Math.round(percent);
  let best: number | undefined;
  let gap = Infinity;
  for (let count = 0; count <= sample; count++) {
    const next = Math.abs(Math.round((100 * count) / sample) - target);
    if (next < gap) {
      best = count;
      gap = next;
    }
  }
  return gap === 0 ? best : undefined;
};
