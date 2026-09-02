import { detectCardQuad } from './detectCard';
import type { DetectionDebug } from './detection/types';
import { emptyDetectionDebug } from './detection/types';
import {
  quadToCorners,
  rectQuad,
  warpQuadToCard,
  type Quad,
} from './geometry';
import type { CardCorners, RelativeRegion, ScanImage } from './types';

/** How the card rectangle was arrived at — the fallbacks are worth telling apart. */
export type CardSource = 'detected' | 'guide' | 'whole-frame';

export interface PreparedCard {
  /** Where the card was found in the *source* frame, when detection worked. */
  corners: CardCorners | null;
  /** True only when a real perspective quad was found and warped. */
  detected: boolean;
  detection: DetectionDebug;
  image: ScanImage;
  score: number;
  source: CardSource;
}

/** Below this, a detected quad is not trusted over the on-screen guide. */
export const MIN_DETECTION_SCORE = 0.28;

/**
 * Detect the card quad (if possible), perspective-correct it, and emit a
 * standard CARD_WIDTH × CARD_HEIGHT raster for region crops + OCR.
 *
 * Falls back to treating the whole frame as an already-framed card.
 * Callers that care about acquisition (live scan) must check `detected`.
 */
export const prepareCard = (source: ScanImage): PreparedCard => {
  const { debug, quad, score } = detectCardQuad(source);
  if (quad) return warped(source, quad, score, 'detected', debug);

  return warped(
    source,
    rectQuad(0, 0, source.width - 1, source.height - 1),
    0,
    'whole-frame',
    debug,
  );
};

/**
 * Same as prepareCard, but when detection fails, crop to the guide rectangle
 * the user was aiming with, expressed as fractions of the padded capture.
 */
export const prepareCardWithGuideFallback = (
  source: ScanImage,
  guide: RelativeRegion,
): PreparedCard => {
  const { debug, quad, score } = detectCardQuad(source);
  if (quad && score >= MIN_DETECTION_SCORE) {
    return warped(source, quad, score, 'detected', debug);
  }

  const fallback: Quad = rectQuad(
    guide.x * source.width,
    guide.y * source.height,
    Math.max(1, guide.w * source.width - 1),
    Math.max(1, guide.h * source.height - 1),
  );
  return warped(source, fallback, 0, 'guide', debug);
};

const warped = (
  source: ScanImage,
  quad: Quad,
  score: number,
  from: CardSource,
  detection: DetectionDebug = emptyDetectionDebug(),
): PreparedCard => ({
  corners: from === 'detected' ? quadToCorners(quad) : null,
  detected: from === 'detected',
  detection,
  image: warpQuadToCard(source, quad),
  score,
  source: from,
});
