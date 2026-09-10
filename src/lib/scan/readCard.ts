// Read the known regions of a normalized card.
//
// Pure and platform-independent: the recognizer is injected, so this is the same
// code whether it runs behind a phone camera or over a PNG fixture in the
// evaluation harness. No Scryfall, no React, no canvas.

import { emptyDiagnostics, type OcrSample, ScanTimer } from './diagnostics';
import type { Reading } from './matchName';
import {
  bestName,
  parseCollectorParts,
  parseSetSymbolText,
  tidyName,
  type CollectorParts,
} from './parseCollector';
import {
  PRODUCTION_VARIANT,
  enhanceForOcr,
  enhanceForOcrFast,
} from './preprocess';
import { STANDARD_PROFILE, type NamedRegion, type ScanProfile } from './regions';
import { type TextRecognitionResult, type TextRecognizer } from './textRecognizer';
import { cropImage, regionToRect, type Rect, type ScanImage } from './types';

/** Latin script plus the punctuation that shows up in card names. */
export const TITLE_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåæçèéêëìíîïñòóôõöùúûüýÿ0123456789,\',. -';

/** Collector strip: digits, letters, and the foil markers OCR might emit. */
export const COLLECTOR_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/•★*·. ';

/** Expansion-symbol crop: set codes only (e.g. M11, CMR, 2XM). */
export const SET_SYMBOL_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Soft type-line OCR character set. */
export const TYPE_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -—–';

export interface ReadOptions {
  /** Attach each preprocessed crop to its sample, for the debug view. */
  keepCrops?: boolean;
  /** Which layout to read. Only the standard frame exists so far. */
  profile?: ScanProfile;
  timer?: ScanTimer;
  /**
   * Prefer the fast preprocess chain (no upscale/scurve).
   * Opt-in: mobile hot path sets true; eval/default keeps full enhance.
   */
  fastPreprocess?: boolean;
  /**
   * After the first title framing yields a tidied name, stop.
   * Opt-in: mobile hot path sets true.
   */
  stopAfterFirstTitle?: boolean;
  /**
   * Skip set-symbol / classic-number / wide collector until primary number+set
   * miss. Opt-in: mobile hot path sets true.
   */
  footerPrimaryOnly?: boolean;
  /**
   * Debug: the exact raw crop + enhanced crop used for this pass.
   * Called with the live buffers — do not regenerate later.
   */
  onTitlePass?: (info: {
    card: ScanImage;
    cropRect: Rect;
    enhancedCrop: ScanImage;
    rawCrop: ScanImage;
    regionName: string;
    variant: string;
  }) => void;
}

const whitelistFor = (name: string): string => {
  if (name.startsWith('title')) return TITLE_WHITELIST;
  if (name === 'type-line') return TYPE_WHITELIST;
  return name === 'set-symbol' ? SET_SYMBOL_WHITELIST : COLLECTOR_WHITELIST;
};

const prepareCrop = (raw: ScanImage, options: ReadOptions): { crop: ScanImage; variant: string } => {
  if (options.fastPreprocess === true) {
    return { crop: enhanceForOcrFast(raw), variant: 'fast-trim-polarity-stretch' };
  }
  return { crop: enhanceForOcr(raw), variant: PRODUCTION_VARIANT };
};

const runPass = async (
  card: ScanImage,
  pass: NamedRegion,
  recognizer: TextRecognizer,
  options: ReadOptions,
  enhance: (raw: ScanImage) => { crop: ScanImage; variant: string } = raw =>
    prepareCrop(raw, options),
): Promise<{ result: TextRecognitionResult; sample: OcrSample }> => {
  const rawCrop = cropImage(card, pass.region);
  const { crop, variant } = enhance(rawCrop);
  if (pass.name.startsWith('title')) {
    options.onTitlePass?.({
      card,
      cropRect: regionToRect(card, pass.region),
      enhancedCrop: crop,
      rawCrop,
      regionName: pass.name,
      variant,
    });
  }
  const began = Date.now();
  const result = await recognizer.recognize(crop, {
    mode: pass.mode,
    whitelist: whitelistFor(pass.name),
  });
  return {
    result,
    sample: {
      confidence: result.confidence,
      ...(options.keepCrops ? { crop } : {}),
      cropHeight: crop.height,
      cropWidth: crop.width,
      ms: Date.now() - began,
      normalizedText: '',
      rawText: result.text,
      region: pass.name,
      variant,
      ...(result.engine
        ? {
            engineBytes: result.engine.bytesIn,
            engineTransport: result.engine.transport,
            engineMlkitMs: result.engine.mlkitMs,
            engineNativeMs: result.engine.nativeTotalMs,
            engineEncodeMs: result.engine.encodeMs,
            engineJsBridgeMs: result.engine.jsBridgeMs,
          }
        : {}),
    },
  };
};

export interface TitleReading {
  /**
   * Longest tidied string, kept only as a last resort for callers with no index
   * loaded. Length is not a quality signal: see `readings` and `matchReadings`.
   */
  name: string | null;
  /**
   * Every tidied reading, one per title framing.
   *
   * Returned rather than reduced to a winner because nothing here is in a
   * position to choose. Picking a string first and identifying it second throws
   * away the only evidence that separates a good read from a bad one — whether
   * the string names a card that exists — and that evidence lives in the index,
   * which is the caller's to hold.
   */
  readings: Reading[];
  samples: OcrSample[];
}

/**
 * Read the title. Hot path: first framing + fast preprocess; stop when a tidied
 * name appears. Wide framing / full enhance only as fallback when asked.
 */
export const readTitle = async (
  card: ScanImage,
  recognizer: TextRecognizer,
  options: ReadOptions = {},
): Promise<TitleReading> => {
  const samples: OcrSample[] = [];
  const readings: Reading[] = [];
  const texts: string[] = [];
  const stopEarly = options.stopAfterFirstTitle === true;
  const passes = (options.profile ?? STANDARD_PROFILE).title;

  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    // Fast preprocess only when opted in; otherwise full enhance every framing.
    const enhance =
      options.fastPreprocess === true && i === 0
        ? (raw: ScanImage) => prepareCrop(raw, { ...options, fastPreprocess: true })
        : (raw: ScanImage) => ({
            crop: enhanceForOcr(raw),
            variant: PRODUCTION_VARIANT,
          });
    const { result, sample } = await runPass(card, pass, recognizer, options, enhance);
    samples.push(sample);
    texts.push(result.text);
    const tidied = tidyName(result.text);
    sample.normalizedText = tidied ?? '';
    if (tidied) {
      readings.push({ source: pass.name, text: tidied });
      if (stopEarly) break;
    }
  }

  // One measured fallback: if primary framing failed under fast preprocess.
  if (!readings.length && passes[0] && options.fastPreprocess === true) {
    const pass = passes[0];
    const { result, sample } = await runPass(card, pass, recognizer, options, raw => ({
      crop: enhanceForOcr(raw),
      variant: PRODUCTION_VARIANT,
    }));
    samples.push(sample);
    texts.push(result.text);
    const tidied = tidyName(result.text);
    sample.normalizedText = tidied ?? '';
    if (tidied) readings.push({ source: `${pass.name}+full`, text: tidied });
  }

  return { name: bestName(...texts), readings, samples };
};

export interface CollectorReading {
  parts: CollectorParts;
  samples: OcrSample[];
}

/**
 * Read the collector regions and merge whatever came back.
 *
 * Hot path (`footerPrimaryOnly`): number + set only. Symbol / classic / wide
 * strip run only when those miss.
 */
export const readCollector = async (
  card: ScanImage,
  recognizer: TextRecognizer,
  merge: (into: CollectorParts, incoming: CollectorParts) => CollectorParts,
  options: ReadOptions = {},
): Promise<CollectorReading> => {
  const samples: OcrSample[] = [];
  let parts: CollectorParts = { foilMarker: null, raw: '' };
  const all = (options.profile ?? STANDARD_PROFILE).collector;
  const primaryOnly = options.footerPrimaryOnly === true;
  const primary = primaryOnly
    ? all.filter(p => p.name === 'number' || p.name === 'set')
    : all;
  const secondary = primaryOnly
    ? all.filter(p => p.name !== 'number' && p.name !== 'set')
    : [];

  const runList = async (list: readonly NamedRegion[]) => {
    for (const pass of list) {
      const { result, sample } = await runPass(card, pass, recognizer, options);
      samples.push(sample);

      if (pass.name === 'set-symbol') {
        const setCode = parseSetSymbolText(result.text);
        sample.normalizedText = setCode ?? '';
        if (setCode) {
          parts = merge(parts, { foilMarker: null, raw: result.text, setCode });
        }
        continue;
      }

      const incoming = parseCollectorParts(result.text);
      sample.normalizedText = [incoming.setCode, incoming.collectorNumber]
        .filter(Boolean)
        .join(' ');
      parts = merge(parts, incoming);
    }
  };

  await runList(primary);
  if (primaryOnly && (!parts.collectorNumber || !parts.setCode) && secondary.length) {
    await runList(secondary);
  }

  return { parts, samples };
};

export interface TypeLineReading {
  raw: string;
  /** Folded tokens useful for soft evidence (creature, artifact, …). */
  tokens: string[];
  samples: OcrSample[];
}

/** Soft type-line OCR — only used as secondary evidence when identity is unclear. */
export const readTypeLine = async (
  card: ScanImage,
  recognizer: TextRecognizer,
  options: ReadOptions = {},
): Promise<TypeLineReading> => {
  const profile = options.profile ?? STANDARD_PROFILE;
  const pass: NamedRegion = {
    mode: 'line',
    name: 'type-line',
    region: profile.typeLine,
  };
  const { result, sample } = await runPass(card, pass, recognizer, options);
  const tokens = result.text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(t => t.length >= 3);
  return { raw: result.text, tokens, samples: [sample] };
};

export const startDiagnostics = (frame: ScanImage) => ({
  ...emptyDiagnostics(),
  frameHeight: frame.height,
  frameWidth: frame.width,
  timer: new ScanTimer(),
});
