/**
 * Native OCR result shape — maps onto portable `TextRecognitionResult`
 * (`src/lib/scan/textRecognizer.ts`). Magic ranking stays in shared TS.
 */

export type NativeOcrRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type NativeOcrWord = {
  text: string;
  /** 0–1. */
  confidence: number;
  boundingBox?: NativeOcrRect;
};

/** Native-clock-local stage timings (ms). Do not subtract from JS epochs. */
export type NativeOcrStageTiming = {
  /** Base64/file decode only (0 for rgba-bytes). */
  decodeMs: number;
  /** RGBA → Bitmap. */
  bitmapMs: number;
  /** ML Kit process(). */
  mlkitMs: number;
  /** End-to-end native (decode+bitmap+mlkit). */
  timingMs: number;
};

export type NativeOcrResult = {
  /** Exactly what the engine returned, before normalization. */
  text: string;
  /** 0–1 mean over recognized words. */
  confidence: number;
  words: NativeOcrWord[];
  /** Recognizer-only duration on the native clock (ms). */
  timingMs: number;
  decodeMs?: number;
  bitmapMs?: number;
  mlkitMs?: number;
  bytesIn?: number;
  transport?: 'rgba-bytes' | 'rgba-base64' | 'file' | string;
  width?: number;
  height?: number;
  /**
   * Present when the native path could not run (e.g. stub / hard failure).
   * Starts with `ERR_NOT_IMPLEMENTED` for the scaffolding stub path.
   */
  errorCode?: string;
};

export type NativeOcrWarmUpResult = {
  alreadyWarm: boolean;
  timingMs: number;
};

export type ImplementationStatus = 'stub' | 'partial' | 'ready';

export type LuginOcrNativeModule = {
  implementationStatus: ImplementationStatus;
  /**
   * Production hot path: packed RGBA Uint8Array (length width*height*4).
   * Prefer this — no base64.
   */
  recognizeFromRgbaBytes?(
    rgba: Uint8Array,
    width: number,
    height: number,
  ): Promise<NativeOcrResult>;
  /**
   * Legacy RGBA base64 — avoid on hot path.
   */
  recognizeFromRgba(rgbaBase64: string, width: number, height: number): Promise<NativeOcrResult>;
  /**
   * JPEG/PNG file path (file:// or absolute) → OCR result.
   * Debug / offline only — not the scan hot path.
   */
  recognizeFromFile(path: string): Promise<NativeOcrResult>;
  /** Tiny dummy OCR to warm ML Kit (idempotent). */
  warmUp?(): Promise<NativeOcrWarmUpResult>;
};
