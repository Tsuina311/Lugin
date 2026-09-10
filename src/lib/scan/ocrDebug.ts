// Title-OCR diagnostics: the actual buffers + one bounded A/B matrix.
// Debug-only matrix runs at most once per process (reset in tests).

import { enhanceForOcrFast } from './preprocess';
import type { TextRecognitionResult, TextRecognizer } from './textRecognizer';
import type { Rect, ScanImage } from './types';
import {
  extractTitleCrop,
  hashScanImage,
  ocrInputHashFor,
  validateRgbaScanImage,
  type RgbaBufferCheck,
} from './ocrInput';

export const OCR_DEBUG_INBOX_FILES = [
  'ocr-debug.json',
  'post-lock.json',
  'recognition-card.png',
  'title-crop-raw.png',
  'title-crop-ocr.png',
] as const;

export type OcrOutcomeKind = 'text' | 'empty-success' | 'native-error' | 'input-invalid';

export const classifyOcrOutcome = (result: TextRecognitionResult): OcrOutcomeKind => {
  if (result.ocrInputInvalid) return 'input-invalid';
  if (result.nativeError) return 'native-error';
  if (result.text.trim().length > 0) return 'text';
  return 'empty-success';
};

export interface TitleOcrImages {
  recognitionCard: ScanImage;
  titleCropOcr: ScanImage;
  titleCropRaw: ScanImage;
}

export interface OcrDebugMatrixRow {
  durationMs: number;
  invoked: boolean;
  kind: OcrOutcomeKind;
  nativeError: { code: string; message: string } | null;
  text: string;
}

export interface OcrDebugMatrix {
  enhancedTitleBytes: OcrDebugMatrixRow;
  fullCardBytes: OcrDebugMatrixRow;
  legacyTitle: OcrDebugMatrixRow | { unavailable: true; reason: string };
  rawTitleBytes: OcrDebugMatrixRow;
}

export interface TitleOcrDebug {
  buffer: RgbaBufferCheck;
  crop: Rect;
  enhancer: string;
  enhancerParams: { percentile: number; polarity: boolean; trim: boolean };
  images?: TitleOcrImages;
  matrix?: OcrDebugMatrix | null;
  native: {
    bitmapHeight: number | null;
    bitmapWidth: number | null;
    blockCount: number | null;
    completedAt: number | null;
    durationMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    invoked: boolean;
    lineCount: number | null;
    mlKitCompleted: boolean | null;
    mlKitStarted: boolean | null;
    nativeBitmapCreated: boolean | null;
    submittedAt: number | null;
  };
  ocrInputHash: string;
  ocrSkippedReason: string | null;
  recognitionCard: { height: number; width: number };
  recognitionHash: string;
  result: {
    blockCount: number | null;
    lineCount: number | null;
    rawText: string | null;
  };
  sameInputAsPreviousAttempt: boolean;
  sourceAttemptId: number | null;
  titleCropHash: string;
  transport: 'rgba-bytes' | 'legacy-base64' | 'other' | 'none';
}

const clock = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

let matrixConsumed = false;

export const resetOcrDebugMatrixForTests = (): void => {
  matrixConsumed = false;
};

export const consumeOcrDebugMatrixSlot = (): boolean => {
  if (matrixConsumed) return false;
  matrixConsumed = true;
  return true;
};

const timeRecognize = async (
  recognize: TextRecognizer,
  image: ScanImage,
): Promise<OcrDebugMatrixRow> => {
  const t0 = clock();
  const result = await recognize.recognize(image);
  return {
    durationMs: clock() - t0,
    invoked: !result.ocrInputInvalid,
    kind: classifyOcrOutcome(result),
    nativeError: result.nativeError ?? null,
    text: result.text,
  };
};

export const runOcrDebugMatrix = async (args: {
  card: ScanImage;
  enhancedTitle: ScanImage;
  legacyRecognize?: TextRecognizer | null;
  rawTitle: ScanImage;
  recognize: TextRecognizer;
}): Promise<OcrDebugMatrix> => {
  const rawTitleBytes = await timeRecognize(args.recognize, args.rawTitle);
  const enhancedTitleBytes = await timeRecognize(args.recognize, args.enhancedTitle);
  const fullCardBytes = await timeRecognize(args.recognize, args.card);
  const legacyTitle = args.legacyRecognize
    ? await timeRecognize(args.legacyRecognize, args.enhancedTitle)
    : { unavailable: true as const, reason: 'legacy recognizeFromRgba not linked in this binary' };
  return { enhancedTitleBytes, fullCardBytes, legacyTitle, rawTitleBytes };
};

export const captureTitleOcrBuffers = (
  card: ScanImage,
): { enhanced: ScanImage; raw: ScanImage; rect: Rect } => {
  const { image: raw, rect } = extractTitleCrop(card);
  return { enhanced: enhanceForOcrFast(raw), raw, rect };
};

export const buildTitleOcrDebug = (args: {
  card: ScanImage;
  completedAt?: number | null;
  enhanced: ScanImage;
  invoked: boolean;
  matrix?: OcrDebugMatrix | null;
  ocrSkippedReason?: string | null;
  raw: ScanImage;
  recognitionAttemptId?: number | null;
  rect: Rect;
  result?: TextRecognitionResult | null;
  sameInputAsPreviousAttempt?: boolean;
  submittedAt?: number | null;
}): TitleOcrDebug => {
  const buffer = validateRgbaScanImage(args.enhanced);
  const recognitionHash = hashScanImage(args.card);
  const titleCropHash = hashScanImage(args.raw);
  const result = args.result;
  const transport =
    result?.engine?.transport === 'rgba-bytes'
      ? 'rgba-bytes'
      : result?.engine?.transport === 'rgba-base64' || result?.engine?.transport === 'legacy-base64'
        ? 'legacy-base64'
        : result?.engine?.transport
          ? 'other'
          : args.invoked
            ? 'other'
            : 'none';
  const wordCount = result?.words?.length ?? null;
  const nativeError = result?.nativeError ?? null;
  const submittedAt = args.submittedAt ?? null;
  const completedAt = args.completedAt ?? null;
  const invoked = args.invoked;
  const emptySuccess = Boolean(result && classifyOcrOutcome(result) === 'empty-success');
  return {
    buffer,
    crop: args.rect,
    enhancer: 'enhanceForOcrFast',
    enhancerParams: { percentile: 0.02, polarity: true, trim: true },
    images: {
      recognitionCard: args.card,
      titleCropOcr: args.enhanced,
      titleCropRaw: args.raw,
    },
    matrix: args.matrix ?? null,
    native: {
      bitmapHeight: result?.engine?.height ?? (invoked && !nativeError && !result?.ocrInputInvalid ? args.enhanced.height : null),
      bitmapWidth: result?.engine?.width ?? (invoked && !nativeError && !result?.ocrInputInvalid ? args.enhanced.width : null),
      blockCount: wordCount,
      completedAt,
      durationMs: submittedAt != null && completedAt != null ? completedAt - submittedAt : result?.engine?.jsBridgeMs ?? null,
      errorCode: nativeError?.code ?? (result?.ocrInputInvalid ? 'ocrInputInvalid' : null),
      errorMessage: nativeError?.message ?? null,
      invoked,
      lineCount: wordCount,
      mlKitCompleted: invoked && !nativeError && !result?.ocrInputInvalid ? true : invoked ? false : null,
      mlKitStarted: invoked && !result?.ocrInputInvalid ? true : invoked ? false : null,
      nativeBitmapCreated:
        invoked && !result?.ocrInputInvalid && !nativeError
          ? true
          : invoked && (result?.ocrInputInvalid || Boolean(nativeError))
            ? false
            : emptySuccess
              ? true
              : null,
      submittedAt,
    },
    ocrInputHash: ocrInputHashFor(recognitionHash, titleCropHash),
    ocrSkippedReason: args.ocrSkippedReason ?? null,
    recognitionCard: { height: args.card.height, width: args.card.width },
    recognitionHash,
    result: {
      blockCount: wordCount,
      lineCount: wordCount,
      rawText: result?.text ?? null,
    },
    sameInputAsPreviousAttempt: args.sameInputAsPreviousAttempt === true,
    sourceAttemptId: args.recognitionAttemptId ?? null,
    titleCropHash,
    transport,
  };
};

export const titleOcrDebugWithoutImages = (debug: TitleOcrDebug): TitleOcrDebug => {
  const { images: _images, ...rest } = debug;
  return rest;
};
