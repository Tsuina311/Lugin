// The OCR seam.
//
// Nothing outside `src/web/scan/tesseractRecognizer.ts` may import tesseract.js.
// Recognition is one swappable implementation detail: the browser's native
// TextDetector, or a native engine if Lugin ever ships as an app, should drop in
// behind this interface without touching matching, scoring, or UI.

import type { Rect, ScanImage } from './types';

export interface RecognizedWord {
  boundingBox?: Rect;
  /** 0–1. */
  confidence: number;
  text: string;
}

export interface TextRecognitionResult {
  /**
   * 0–1, mean over recognized words. This is the engine's opinion of its own
   * reading — emphatically *not* how sure we are which card this is.
   */
  confidence: number;
  /** Exactly what the engine returned, before any normalization. */
  text: string;
  words: RecognizedWord[];
}

/** How much page structure the engine should assume. */
export type RecognitionMode = 'block' | 'line' | 'word';

export interface RecognizeOptions {
  mode?: RecognitionMode;
  /**
   * Characters the engine may emit. Advisory only — Tesseract's LSTM path
   * largely ignores it, so normalization has to enforce the character set too.
   */
  whitelist?: string;
}

export interface TextRecognizer {
  recognize(image: ScanImage, options?: RecognizeOptions): Promise<TextRecognitionResult>;
}

export const EMPTY_RECOGNITION: TextRecognitionResult = {
  confidence: 0,
  text: '',
  words: [],
};

/** Mean word confidence, ignoring whitespace-only words. */
export const meanConfidence = (words: readonly RecognizedWord[]): number => {
  const scored = words.filter(w => w.text.trim().length > 0);
  if (!scored.length) return 0;
  return scored.reduce((sum, w) => sum + w.confidence, 0) / scored.length;
};
