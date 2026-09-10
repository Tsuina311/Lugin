// Recognition-attempt status for title OCR — distinct from “no text found”.

import type { RecognitionAttemptStatus } from './session/postLock';

export const shouldPersistOcrDebugBundle = (args: {
  alreadyWrittenAttemptId?: string | null;
  attemptId: string;
  sameInputAsPreviousAttempt: boolean;
}): { persist: boolean; upload: boolean; reason: string } => {
  if (args.sameInputAsPreviousAttempt) {
    return { persist: false, upload: false, reason: 'duplicate-input' };
  }
  if (args.alreadyWrittenAttemptId === args.attemptId) {
    return { persist: false, upload: false, reason: 'already-written' };
  }
  return { persist: true, upload: true, reason: 'unique-attempt' };
};

export const attemptDebugDirName = (attemptId: number | string): string =>
  `attempt-${attemptId}`;

export const attemptStatusFromOcr = (args: {
  fusedStatus: string | null | undefined;
  nativeError?: { code: string; message: string } | null;
  ocrInputInvalid?: boolean;
  ocrSkippedReason?: string | null;
  titleRawText: string | null | undefined;
}): RecognitionAttemptStatus => {
  if (args.fusedStatus === 'identified') return 'identified';
  if (args.fusedStatus === 'printing-ambiguous') return 'printing-ambiguous';
  if (args.fusedStatus === 'card-ambiguous') return 'card-ambiguous';
  if (args.ocrSkippedReason === 'no-ocr') return 'ocr-unavailable';
  if (args.ocrInputInvalid) return 'ocr-input-invalid';
  if (args.nativeError) return 'ocr-native-error';
  if (!args.titleRawText || !args.titleRawText.trim()) return 'ocr-empty';
  return 'insufficient-confidence';
};
