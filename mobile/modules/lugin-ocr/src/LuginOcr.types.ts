/**
 * Native OCR result shape — maps 1:1 onto portable `TextRecognitionResult`
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

export type NativeOcrResult = {
  /** Exactly what the engine returned, before normalization. */
  text: string;
  /** 0–1 mean over recognized words. */
  confidence: number;
  words: NativeOcrWord[];
  /** Recognizer-only duration on the native clock (ms). */
  timingMs: number;
  /**
   * Present when the native path could not run (e.g. stub / hard failure).
   * Starts with `ERR_NOT_IMPLEMENTED` for the scaffolding stub path.
   */
  errorCode?: string;
};

export type ImplementationStatus = 'stub' | 'partial' | 'ready';

export type LuginOcrNativeModule = {
  implementationStatus: ImplementationStatus;
  /**
   * RGBA base64 (length width*height*4, R,G,B,A) → OCR result.
   * Intended for normalized 744×1039 region crops, not live camera frames.
   */
  recognizeFromRgba(rgbaBase64: string, width: number, height: number): Promise<NativeOcrResult>;
  /**
   * JPEG/PNG file path (file:// or absolute) → OCR result.
   * Useful for debug bundles / temp-file bridges without RGBA round-trips.
   */
  recognizeFromFile(path: string): Promise<NativeOcrResult>;
};
