// Read the known regions of a normalized card.
//
// Pure and platform-independent: the recognizer is injected, so this is the same
// code whether it runs behind a phone camera or over a PNG fixture in the
// evaluation harness. No Scryfall, no React, no canvas.

import { emptyDiagnostics, type OcrSample, ScanTimer } from './diagnostics';
import { bestName, parseCollectorParts, parseSetSymbolText, type CollectorParts } from './parseCollector';
import { PRODUCTION_VARIANT, enhanceForOcr } from './preprocess';
import {
  CLASSIC_NUMBER_REGION,
  COLLECTOR_REGION,
  NAME_REGION,
  NUMBER_REGION,
  SET_REGION,
  SET_SYMBOL_REGION,
  TITLE_LINE_REGION,
  TITLE_ZOOM_REGION,
  type Region,
} from './regions';
import {
  type RecognizeOptions,
  type TextRecognitionResult,
  type TextRecognizer,
} from './textRecognizer';
import { cropImage, type ScanImage } from './types';

/** Latin script plus the punctuation that shows up in card names. */
export const TITLE_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåæçèéêëìíîïñòóôõöùúûüýÿ0123456789,\',. -';

/** Collector strip: digits, letters, and the foil markers OCR might emit. */
export const COLLECTOR_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/•★*·. ';

/** Expansion-symbol crop: set codes only (e.g. M11, CMR, 2XM). */
export const SET_SYMBOL_WHITELIST =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export interface ReadOptions {
  /** Attach each preprocessed crop to its sample, for the debug view. */
  keepCrops?: boolean;
  timer?: ScanTimer;
}

interface Pass {
  mode: RecognizeOptions['mode'];
  name: string;
  region: Region;
  whitelist: string;
}

/** Step 1 reads only the title, from the three framings a user might offer. */
const TITLE_PASSES: readonly Pass[] = [
  { mode: 'line', name: 'title-bar', region: NAME_REGION, whitelist: TITLE_WHITELIST },
  { mode: 'line', name: 'title-line', region: TITLE_LINE_REGION, whitelist: TITLE_WHITELIST },
  { mode: 'line', name: 'title-zoom', region: TITLE_ZOOM_REGION, whitelist: TITLE_WHITELIST },
  // A block read catches names that wrap onto a second line.
  { mode: 'block', name: 'title-zoom-block', region: TITLE_ZOOM_REGION, whitelist: TITLE_WHITELIST },
];

/** Step 2 reads set and collector number, which sit in a few possible places. */
const COLLECTOR_PASSES: readonly Pass[] = [
  { mode: 'block', name: 'number', region: NUMBER_REGION, whitelist: COLLECTOR_WHITELIST },
  { mode: 'block', name: 'number-classic', region: CLASSIC_NUMBER_REGION, whitelist: COLLECTOR_WHITELIST },
  { mode: 'block', name: 'set', region: SET_REGION, whitelist: COLLECTOR_WHITELIST },
  { mode: 'block', name: 'set-symbol', region: SET_SYMBOL_REGION, whitelist: SET_SYMBOL_WHITELIST },
  { mode: 'block', name: 'collector', region: COLLECTOR_REGION, whitelist: COLLECTOR_WHITELIST },
];

const runPass = async (
  card: ScanImage,
  pass: Pass,
  recognizer: TextRecognizer,
  options: ReadOptions,
): Promise<{ result: TextRecognitionResult; sample: OcrSample }> => {
  const crop = enhanceForOcr(cropImage(card, pass.region));
  const began = Date.now();
  const result = await recognizer.recognize(crop, {
    mode: pass.mode,
    whitelist: pass.whitelist,
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
      variant: PRODUCTION_VARIANT,
    },
  };
};

export interface TitleReading {
  /** Tidied OCR name — a candidate string, not a card identity. */
  name: string | null;
  samples: OcrSample[];
}

/** Read every title framing and tidy the best-looking result. */
export const readTitle = async (
  card: ScanImage,
  recognizer: TextRecognizer,
  options: ReadOptions = {},
): Promise<TitleReading> => {
  const samples: OcrSample[] = [];
  const texts: string[] = [];
  for (const pass of TITLE_PASSES) {
    const { result, sample } = await runPass(card, pass, recognizer, options);
    samples.push(sample);
    texts.push(result.text);
  }
  const name = bestName(...texts);
  for (const sample of samples) sample.normalizedText = name ?? '';
  return { name, samples };
};

export interface CollectorReading {
  parts: CollectorParts;
  samples: OcrSample[];
}

/**
 * Read the collector regions and merge whatever came back.
 *
 * Only called once the name is locked, so every hit is merged — the guard
 * against title text masquerading as a set code lives in `mergePartsForScan`.
 */
export const readCollector = async (
  card: ScanImage,
  recognizer: TextRecognizer,
  merge: (into: CollectorParts, incoming: CollectorParts) => CollectorParts,
  options: ReadOptions = {},
): Promise<CollectorReading> => {
  const samples: OcrSample[] = [];
  let parts: CollectorParts = { foilMarker: null, raw: '' };

  for (const pass of COLLECTOR_PASSES) {
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

  return { parts, samples };
};

/** Fresh diagnostics seeded from a capture, for callers that record a whole scan. */
export const startDiagnostics = (frame: ScanImage) => ({
  ...emptyDiagnostics(),
  frameHeight: frame.height,
  frameWidth: frame.width,
});
