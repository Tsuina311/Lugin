// ML Kit–backed TextRecognizer for the native companion.
//
// Production hot path: RGBA Uint8Array → native (no base64).
// Legacy base64 remains only when the APK lacks recognizeFromRgbaBytes.
//
// Do not import this from `sharedCore.ts` — it pulls `expo-modules-core`.
// See docs/MOBILE-OCR.md.

import { getLuginOcrModule } from 'lugin-ocr';
import type { NativeOcrResult } from 'lugin-ocr';

import {
  meanConfidence,
  packedRgbaBytes,
  validateRgbaScanImage,
  type RecognizeOptions,
  type RecognizedWord,
  type TextRecognitionResult,
  type TextRecognizer,
  type OcrEngineTimings,
} from './sharedCore';
import type { Rect, ScanImage } from './sharedCore';

/** True when the Expo module is present in this binary (even before first call). */
export const isNativeOcrLinked = (): boolean => getLuginOcrModule() != null;

export const getNativeOcrImplementationStatus = (): string | null =>
  getLuginOcrModule()?.implementationStatus ?? null;

export const supportsOcrRgbaBytes = (): boolean => {
  const native = getLuginOcrModule();
  return typeof native?.recognizeFromRgbaBytes === 'function';
};

/**
 * Low-priority ML Kit warmup (tiny bitmap). Call once when entering scanner.
 * Never await on the UI/camera critical path.
 */
export const warmUpMlkitOcr = (): void => {
  const native = getLuginOcrModule();
  if (!native?.warmUp) return;
  void native.warmUp().catch(err => {
    console.warn('[lugin] OCR warmUp failed', err);
  });
};

/**
 * TextRecognizer over ML Kit Latin.
 *
 * Hot path (new APK): Uint8Array RGBA → native Bitmap → ML Kit.
 * Fallback (old APK): base64 (slow — do not ship as primary).
 *
 * Throws if the module is not linked. Callers should feature-detect with
 * `isNativeOcrLinked()` and pass `ocr: null` when absent.
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

  const useBytes = typeof native.recognizeFromRgbaBytes === 'function';

  return {
    recognize: async (image: ScanImage, _options?: RecognizeOptions): Promise<TextRecognitionResult> =>
      recognizeWithNative(native, image, useBytes ? 'rgba-bytes' : 'legacy-base64'),
  };
};

/** Same-image comparison only — never the live scan path. */
export const createMlkitLegacyTextRecognizer = (): TextRecognizer | null => {
  const native = getLuginOcrModule();
  if (!native || typeof native.recognizeFromRgba !== 'function') return null;
  return {
    recognize: async (image: ScanImage): Promise<TextRecognitionResult> =>
      recognizeWithNative(native, image, 'legacy-base64'),
  };
};

const recognizeWithNative = async (
  native: NonNullable<ReturnType<typeof getLuginOcrModule>>,
  image: ScanImage,
  transport: 'rgba-bytes' | 'legacy-base64',
): Promise<TextRecognitionResult> => {
  const jsSubmitAt = performance.now();
  const check = validateRgbaScanImage(image);
  if (!check.ok) {
    return {
      confidence: 0,
      ocrInputInvalid: true,
      nativeError: {
        code: 'ocrInputInvalid',
        message: `RGBA byte length ${check.actualByteLength} != ${check.expectedByteLength} for ${check.width}x${check.height}`,
      },
      text: '',
      words: [],
      engine: {
        encodeMs: 0,
        decodeMs: 0,
        bitmapMs: 0,
        mlkitMs: 0,
        nativeTotalMs: 0,
        jsBridgeMs: 0,
        bytesIn: check.actualByteLength,
        width: image.width,
        height: image.height,
        transport,
      },
    };
  }

  let encodeMs = 0;
  try {
    let raw: NativeOcrResult;
    if (transport === 'rgba-bytes' && native.recognizeFromRgbaBytes) {
      raw = await native.recognizeFromRgbaBytes(packedRgbaBytes(image), image.width, image.height);
    } else {
      const tEnc = performance.now();
      const rgbaBase64 = rgbaToBase64(image.data);
      encodeMs = performance.now() - tEnc;
      raw = await native.recognizeFromRgba(rgbaBase64, image.width, image.height);
    }
    return mapNativeResult(raw, {
      encodeMs,
      jsBridgeMs: performance.now() - jsSubmitAt,
      bytesIn: check.actualByteLength,
      width: image.width,
      height: image.height,
      transport: transport === 'rgba-bytes' ? 'rgba-bytes' : 'rgba-base64',
    });
  } catch (err) {
    const code = nativeErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      confidence: 0,
      nativeError: { code, message },
      ocrInputInvalid: /byte length|ocrInputInvalid|InvalidOcr/i.test(`${code} ${message}`),
      text: '',
      words: [],
      engine: {
        encodeMs,
        decodeMs: 0,
        bitmapMs: 0,
        mlkitMs: 0,
        nativeTotalMs: 0,
        jsBridgeMs: performance.now() - jsSubmitAt,
        bytesIn: check.actualByteLength,
        width: image.width,
        height: image.height,
        transport: transport === 'rgba-bytes' ? 'rgba-bytes' : 'rgba-base64',
      },
    };
  }
};

const nativeErrorCode = (err: unknown): string => {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return 'OCR_FAILED';
};

const mapNativeResult = (
  raw: NativeOcrResult,
  js: {
    encodeMs: number;
    jsBridgeMs: number;
    bytesIn: number;
    width: number;
    height: number;
    transport: string;
  },
): TextRecognitionResult => {
  if (raw.errorCode?.startsWith('ERR_NOT_IMPLEMENTED')) {
    return {
      confidence: 0,
      nativeError: { code: raw.errorCode, message: 'native OCR not implemented in this binary' },
      text: '',
      words: [],
      engine: {
        encodeMs: js.encodeMs,
        decodeMs: raw.decodeMs ?? 0,
        bitmapMs: raw.bitmapMs ?? 0,
        mlkitMs: raw.mlkitMs ?? raw.timingMs ?? 0,
        nativeTotalMs: raw.timingMs ?? 0,
        jsBridgeMs: js.jsBridgeMs,
        bytesIn: raw.bytesIn ?? js.bytesIn,
        width: raw.width ?? js.width,
        height: raw.height ?? js.height,
        transport: raw.transport ?? js.transport,
      },
    };
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

  const engine: OcrEngineTimings = {
    encodeMs: js.encodeMs,
    decodeMs: raw.decodeMs ?? 0,
    bitmapMs: raw.bitmapMs ?? 0,
    mlkitMs: raw.mlkitMs ?? raw.timingMs ?? 0,
    nativeTotalMs: raw.timingMs ?? 0,
    jsBridgeMs: js.jsBridgeMs,
    bytesIn: raw.bytesIn ?? js.bytesIn,
    width: raw.width ?? js.width,
    height: raw.height ?? js.height,
    transport: raw.transport ?? js.transport,
  };

  return { text, confidence, words, engine };
};

const rectFromNative = (box: { x: number; y: number; w: number; h: number }): Rect => ({
  x: box.x,
  y: box.y,
  w: box.w,
  h: box.h,
});

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Legacy only — chunked btoa is multi-second on large buffers on Samsung. */
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
