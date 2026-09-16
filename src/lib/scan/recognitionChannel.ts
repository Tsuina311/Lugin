/**
 * Live Single Scan recognition channel mode — measure OCR vs art vs both.
 * Does not change detector / capture-safe / CardNameIndex thresholds.
 */

import type { RecognizeOptions } from './session/recognize';

export type RecognitionChannelMode =
  | 'OCR_ONLY'
  | 'ART_ONLY'
  | 'OCR_AND_ART'
  | 'EDITION_OCR'
  /** Continuous / bakeoff — neural visual retrieval (CLIP), not legacy ART. */
  | 'VISUAL'
  /** Continuous / bakeoff — CLIP visual + title OCR in parallel. */
  | 'VISUAL_PLUS_OCR';

export const RECOGNITION_CHANNEL_MODES: readonly RecognitionChannelMode[] = [
  'OCR_ONLY',
  'ART_ONLY',
  'OCR_AND_ART',
  'EDITION_OCR',
  'VISUAL',
  'VISUAL_PLUS_OCR',
] as const;

export const RECOGNITION_CHANNEL_LABELS: Record<RecognitionChannelMode, string> = {
  OCR_ONLY: 'OCR',
  ART_ONLY: 'ART',
  OCR_AND_ART: 'BOTH',
  EDITION_OCR: 'EDITION',
  VISUAL: 'CLIP',
  VISUAL_PLUS_OCR: 'CLIP+OCR',
};

/** @deprecated Prefer RECOGNITION_CHANNEL_LABELS; aliases kept for HUD/docs. */
export const RECOGNITION_CHANNEL_LABEL_ALIASES: Record<RecognitionChannelMode, string> = {
  ...RECOGNITION_CHANNEL_LABELS,
  VISUAL: 'CLIP',
  VISUAL_PLUS_OCR: 'CLIP+OCR',
};

/** Legacy chip cycle — phone HUD without Continuous / CLIP modes. */
export const LEGACY_RECOGNITION_CHANNEL_MODES: readonly RecognitionChannelMode[] = [
  'OCR_ONLY',
  'ART_ONLY',
  'OCR_AND_ART',
  'EDITION_OCR',
] as const;

/**
 * Dev HUD cycle when Continuous / CLIP is enabled — includes VISUAL modes.
 */
export const DEV_RECOGNITION_CHANNEL_MODES: readonly RecognitionChannelMode[] = [
  'OCR_ONLY',
  'ART_ONLY',
  'OCR_AND_ART',
  'EDITION_OCR',
  'VISUAL',
  'VISUAL_PLUS_OCR',
] as const;

let active: RecognitionChannelMode = 'OCR_ONLY';

export const getRecognitionChannel = (): RecognitionChannelMode => active;

export const setRecognitionChannel = (mode: RecognitionChannelMode): RecognitionChannelMode => {
  active = mode;
  return active;
};

export type CycleRecognitionChannelOpts = {
  /** When true, cycle DEV_RECOGNITION_CHANNEL_MODES (includes CLIP). */
  includeVisual?: boolean;
};

export const cycleRecognitionChannel = (
  opts?: CycleRecognitionChannelOpts,
): RecognitionChannelMode => {
  const list = opts?.includeVisual
    ? DEV_RECOGNITION_CHANNEL_MODES
    : LEGACY_RECOGNITION_CHANNEL_MODES;
  const i = list.indexOf(active as (typeof list)[number]);
  const idx = i >= 0 ? i : 0;
  active = list[(idx + 1) % list.length]!;
  return active;
};

/** Title fast-path (recognizeCapturedCard) only for OCR_ONLY. */
export const channelUsesTitleFastPath = (mode: RecognitionChannelMode = active): boolean =>
  mode === 'OCR_ONLY';

/** Neural visual / Continuous CLIP modes. */
export const channelIsNewVisual = (mode: RecognitionChannelMode = active): boolean =>
  mode === 'VISUAL' || mode === 'VISUAL_PLUS_OCR';

/**
 * Map channel → RecognizeOptions for recognizeCard.
 * Channel mode overrides perfBaseline artwork/footer toggles for this pass.
 *
 * VISUAL / VISUAL_PLUS_OCR: Phase B Continuous owns CLIP via
 * `lugin-visual-recognizer`; legacy recognizeCard still maps to art/OCR options
 * for bakeoff parity until the live Continuous path fully replaces them.
 */
export const channelToRecognizeOptions = (
  mode: RecognitionChannelMode = active,
): RecognizeOptions => {
  switch (mode) {
    case 'OCR_ONLY':
      return {
        skipOcr: false,
        skipArtwork: true,
        skipFooter: true,
        skipTypeLine: true,
        wantFooter: false,
        wantTypeLine: false,
      };
    case 'ART_ONLY':
      return {
        skipOcr: true,
        skipArtwork: false,
        skipFooter: true,
        skipTypeLine: true,
        wantFooter: false,
        wantTypeLine: false,
      };
    case 'OCR_AND_ART':
      return {
        skipOcr: false,
        skipArtwork: false,
        skipFooter: true,
        skipTypeLine: true,
        wantFooter: false,
        wantTypeLine: false,
      };
    case 'EDITION_OCR':
      return {
        skipOcr: false,
        skipArtwork: true,
        skipFooter: false,
        skipTypeLine: true,
        wantFooter: true,
        wantTypeLine: false,
      };
    case 'VISUAL':
      // Phase B: Continuous CLIP path preferred; legacy art options for bakeoff.
      return {
        skipOcr: true,
        skipArtwork: false,
        skipFooter: true,
        skipTypeLine: true,
        wantFooter: false,
        wantTypeLine: false,
      };
    case 'VISUAL_PLUS_OCR':
      // Phase B: Continuous CLIP∥OCR; legacy both for bakeoff parity.
      return {
        skipOcr: false,
        skipArtwork: false,
        skipFooter: true,
        skipTypeLine: true,
        wantFooter: false,
        wantTypeLine: false,
      };
  }
};

export type ChannelTimingSummary = {
  mode: RecognitionChannelMode;
  titleMs: number | null;
  artworkMs: number | null;
  artworkDescriptorMs: number | null;
  artworkMatcherMs: number | null;
  footerMs: number | null;
  footerLookupMs: number | null;
  totalMs: number | null;
  earlyReason: string | null;
  artMode: string | null;
};

export const channelTimingFromRecognize = (
  mode: RecognitionChannelMode,
  timings: {
    titleMs?: number;
    artworkMs?: number;
    artworkDescriptorMs?: number;
    artworkMatcherMs?: number;
    footerMs?: number;
    footerLookupMs?: number;
    totalMs?: number;
    earlyReason?: string | null;
    artMode?: string;
  } | null | undefined,
): ChannelTimingSummary => ({
  mode,
  titleMs: timings?.titleMs ?? null,
  artworkMs: timings?.artworkMs ?? null,
  artworkDescriptorMs: timings?.artworkDescriptorMs ?? null,
  artworkMatcherMs: timings?.artworkMatcherMs ?? null,
  footerMs: timings?.footerMs ?? null,
  footerLookupMs: timings?.footerLookupMs ?? null,
  totalMs: timings?.totalMs ?? null,
  earlyReason: timings?.earlyReason ?? null,
  artMode: timings?.artMode ?? null,
});

export const formatChannelTimingLine = (t: ChannelTimingSummary): string => {
  const parts = [`mode=${RECOGNITION_CHANNEL_LABELS[t.mode]}`];
  if (t.titleMs != null) parts.push(`title=${Math.round(t.titleMs)}ms`);
  if (t.artworkMs != null) parts.push(`art=${Math.round(t.artworkMs)}ms`);
  if (t.footerMs != null) parts.push(`footer=${Math.round(t.footerMs)}ms`);
  if (t.totalMs != null) parts.push(`total=${Math.round(t.totalMs)}ms`);
  if (t.earlyReason) parts.push(`via=${t.earlyReason}`);
  return parts.join(' · ');
};
