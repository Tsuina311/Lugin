// ML Kit–backed TextRecognizer for the native companion.
//
// Implements the portable `TextRecognizer` seam. Native module returns raw
// text + word boxes; Magic interpretation stays in shared readCard / fuse.
//
// Do not import this from `sharedCore.ts` — it pulls `expo-modules-core`.
// See docs/MOBILE-OCR.md.

import { getLuginOcrModule } from 'lugin-ocr';
import type { NativeOcrResult } from 'lugin-ocr';

import {
  EMPTY_RECOGNITION,
  meanConfidence,
  type RecognizeOptions,
  type RecognizedWord,
  type TextRecognitionResult,
  type TextRecognizer,
} from './sharedCore';
import type { Rect, ScanImage } from './sharedCore';

/** True when the Expo module is present in this binary (even before first call). */
export const isNativeOcrLinked = (): boolean => getLuginOcrModule() != null;

export const getNativeOcrImplementationStatus = (): string | null =>
  getLuginOcrModule()?.implementationStatus ?? null;

/**
 * TextRecognizer over ML Kit Latin.
 *
 * Throws if the module is not linked (old APK). Callers should feature-detect
 * with `isNativeOcrLinked()` and pass `ocr: null` when absent so title/text/
 * footer stay **unavailable** rather than empty-string scores.
 *
 * `RecognizeOptions` (mode / whitelist) are accepted for seam parity but not
 * forwarded — ML Kit Latin has no Tesseract-style PSM/whitelist; shared
 * preprocess + post-normalization own character constraints.
 */
export const createMlkitTextRecognizer = (): TextRecognizer => {
  const native = getLuginOcrModule();
  if (!native) {
    throw new Error(
      "TextRecognizer 'mlkit' requires the LuginOcr Expo module. " +
        'It is not linked in this binary — run expo prebuild and rebuild the ' +
        'development APK after adding lugin-ocr.',
    );
  }

  return {
    recognize: async (image: ScanImage, _options?: RecognizeOptions): Promise<TextRecognitionResult> => {
      const rgbaBase64 = rgbaToBase64(image.data);
      const raw = await native.recognizeFromRgba(rgbaBase64, image.width, image.height);
      return mapNativeResult(raw);
    },
  };
};

const mapNativeResult = (raw: NativeOcrResult): TextRecognitionResult => {
  if (raw.errorCode?.startsWith('ERR_NOT_IMPLEMENTED')) {
    return EMPTY_RECOGNITION;
  }

  const words: RecognizedWord[] = (raw.words ?? []).map(w => {
    const word: RecognizedWord = {
      text: w.text ?? '',
      confidence: clamp01(w.confidence ?? 0),
    };
    if (w.boundingBox) {
      word.boundingBox = rectFromNative(w.boundingBox);
    }
    return word;
  });

  const text = raw.text ?? words.map(w => w.text).join(' ');
  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? clamp01(raw.confidence)
      : meanConfidence(words);

  return { text, confidence, words };
};

const rectFromNative = (box: { x: number; y: number; w: number; h: number }): Rect => ({
  x: box.x,
  y: box.y,
  w: box.w,
  h: box.h,
});

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Chunked btoa for ScanImage RGBA — region crops only, not live frames. */
const rgbaToBase64 = (data: Uint8ClampedArray): string => {
  const btoaFn = globalThis.btoa;
  if (typeof btoaFn !== 'function') {
    throw new Error(
      'globalThis.btoa is unavailable; cannot encode RGBA for native recognizeFromRgba',
    );
  }
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, Math.min(i + chunk, data.length)));
  }
  return btoaFn(binary);
};
