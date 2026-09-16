// Where to look on a normalized card.
//
// Every region is a fraction of the card rectangle produced by `prepareCard`,
// origin top-left. Because the card has been detected and perspective-corrected
// first, the same fractions hold at any camera angle or distance — which is the
// whole reason detection had to work before these numbers could mean anything.
//
// The vertical bands come from measurement, not from reading a card by eye:
// `node scripts/scan-eval.mjs --calibrate` locates the title on every fixture and
// prints the spread. Standard frames land at 0.043–0.101; borderless and
// full-art sit a little higher, which is what the wide framing is for.

import { cropImage, type RelativeRegion, type ScanImage } from './types';

/**
 * Canonical art-crop semantics shared by host bakeoff, native CLIP, Continuous,
 * and Verified. Bump when fractions change — must stay in lockstep with
 * pack-visual-assets manifest `artCrop.version`.
 */
export const ART_CROP_VERSION = 1;

/**
 * Regions are fractions of the *normalized* card, so they survive any camera
 * angle or distance once `prepareCard` has straightened the card.
 */
export type Region = RelativeRegion;

export interface NamedRegion {
  /** How much page structure OCR should assume for this crop. */
  mode: 'block' | 'line';
  name: string;
  region: Region;
}

/**
 * Title band, cut before the mana cost.
 *
 * Stopping at 0.78 costs a little of the longest names but keeps mana symbols out
 * of the crop, and those reliably come back as punctuation glued to the name.
 */
export const NAME_REGION: Region = { h: 0.072, w: 0.72, x: 0.06, y: 0.038 };

/**
 * Tolerant framing: higher, taller, and full width.
 *
 * Covers borderless and full-art prints, whose titles sit above the standard
 * band, and any card where the detected quad ran a couple of percent small.
 */
export const NAME_WIDE_REGION: Region = { h: 0.105, w: 0.88, x: 0.045, y: 0.012 };

/**
 * Expansion symbol on the type line (right). Core sets like M11 print the code
 * inside the icon — OCR here when the bottom set text is missing or tiny.
 * Abstract symbols won't yield letters; those still need name + number.
 */
export const SET_SYMBOL_REGION: Region = { h: 0.055, w: 0.2, x: 0.74, y: 0.545 };

/**
 * Collector number line (bottom-left): modern `0123 •` or post-2015 `286/361`.
 * Kept tight so ML Kit does not see artist/copyright noise.
 */
export const NUMBER_REGION: Region = { h: 0.038, w: 0.48, x: 0.03, y: 0.888 };

/**
 * Older frames (e.g. M11) put `134/249` toward the bottom-right of the border,
 * not under the artist credit on the left.
 */
export const CLASSIC_NUMBER_REGION: Region = { h: 0.038, w: 0.4, x: 0.52, y: 0.918 };

/** Three-letter set code under the number — `CMR`, `DMU`, … (modern frames). */
export const SET_REGION: Region = { h: 0.032, w: 0.36, x: 0.03, y: 0.926 };

/**
 * Narrow left-biased strip covering number + set only (not full copyright row).
 * Fallback when split crops miss.
 */
export const COLLECTOR_REGION: Region = { h: 0.055, w: 0.55, x: 0.025, y: 0.885 };

/**
 * Artwork window on a modern portrait frame — between the title bar and the
 * type line. Used for visual descriptors; not OCR'd.
 */
export const ARTWORK_REGION: Region = { h: 0.42, w: 0.84, x: 0.08, y: 0.12 };

/**
 * Rules / oracle text box (modern frame). Secondary evidence only — never the
 * sole identification path.
 */
export const TEXT_BOX_REGION: Region = { h: 0.28, w: 0.84, x: 0.08, y: 0.58 };

/** Type line strip (creature / artifact / …). */
export const TYPE_LINE_REGION: Region = { h: 0.045, w: 0.84, x: 0.08, y: 0.545 };

/**
 * A card layout the scanner knows how to read.
 *
 * One profile today. It exists as a named group rather than eight loose exports
 * because split, battle, and rotated layouts need entirely different geometry —
 * a battle card's canonical image is landscape — and that will be a second
 * profile, not a wider set of tolerances on this one.
 */
export interface ScanProfile {
  /** Artwork crop for visual matching. */
  artwork: Region;
  collector: readonly NamedRegion[];
  name: string;
  /** Rules/printed text box — secondary evidence only. */
  textBox: Region;
  title: readonly NamedRegion[];
  typeLine: Region;
}

export const STANDARD_PROFILE: ScanProfile = {
  artwork: ARTWORK_REGION,
  collector: [
    { mode: 'block', name: 'number', region: NUMBER_REGION },
    { mode: 'block', name: 'number-classic', region: CLASSIC_NUMBER_REGION },
    { mode: 'block', name: 'set', region: SET_REGION },
    { mode: 'block', name: 'set-symbol', region: SET_SYMBOL_REGION },
    { mode: 'block', name: 'collector', region: COLLECTOR_REGION },
  ],
  name: 'standard',
  textBox: TEXT_BOX_REGION,
  title: [
    { mode: 'line', name: 'title', region: NAME_REGION },
    { mode: 'line', name: 'title-wide', region: NAME_WIDE_REGION },
  ],
  typeLine: TYPE_LINE_REGION,
};

/**
 * Landscape battle cards: the whole "card" raster is wider than tall, so
 * fractions are relative to that warped rectangle.
 */
export const BATTLE_PROFILE: ScanProfile = {
  artwork: { h: 0.55, w: 0.42, x: 0.04, y: 0.12 },
  collector: STANDARD_PROFILE.collector,
  name: 'battle',
  textBox: { h: 0.55, w: 0.42, x: 0.5, y: 0.2 },
  title: [
    { mode: 'line', name: 'title', region: { h: 0.1, w: 0.45, x: 0.04, y: 0.04 } },
  ],
  typeLine: { h: 0.06, w: 0.42, x: 0.5, y: 0.12 },
};

/**
 * Every region the scanner reads, in the order the debug view lists them.
 * Named so diagnostics can label a crop without a second lookup table.
 */
export const NAMED_REGIONS: readonly NamedRegion[] = [
  ...STANDARD_PROFILE.title,
  ...STANDARD_PROFILE.collector,
];

/** Pick a profile from a warped card's aspect (battle ≈ landscape). */
export const profileForCard = (width: number, height: number): ScanProfile =>
  width > height * 1.15 ? BATTLE_PROFILE : STANDARD_PROFILE;

export type ArtCropVariant = 'PRIMARY' | 'OVERSIZE_5';

/** Expand a relative region about its center; clamp to the unit square. */
export const expandRelativeRegion = (r: RelativeRegion, frac: number): RelativeRegion => {
  const w = Math.min(1, r.w * (1 + frac));
  const h = Math.min(1, r.h * (1 + frac));
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return {
    x: Math.max(0, Math.min(1 - w, cx - w / 2)),
    y: Math.max(0, Math.min(1 - h, cy - h / 2)),
    w,
    h,
  };
};

/**
 * Extract the canonical artwork ROI from a perspective-corrected card.
 * Use PRIMARY for the first CLIP pass; OVERSIZE_5 (+5%) only as a weak-confidence fallback.
 * Do NOT use +10% — bakeoff A.3 showed heavy top1 degradation.
 */
export const extractArtCropFromCard = (
  card: ScanImage,
  opts?: { variant?: ArtCropVariant },
): { crop: ScanImage; region: RelativeRegion; variant: ArtCropVariant; version: number } => {
  const variant: ArtCropVariant = opts?.variant ?? 'PRIMARY';
  const base = profileForCard(card.width, card.height).artwork;
  const region = variant === 'OVERSIZE_5' ? expandRelativeRegion(base, 0.05) : base;
  return {
    crop: cropImage(card, region),
    region,
    variant,
    version: ART_CROP_VERSION,
  };
};