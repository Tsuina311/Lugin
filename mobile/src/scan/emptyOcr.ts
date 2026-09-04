// Fallback TextRecognizer that returns EMPTY_RECOGNITION.
//
// Prefer `createMlkitTextRecognizer()` when `lugin-ocr` is linked
// (see `mlkitTextRecognizer.ts`). Keep this helper for tests / explicit
// empty-engine wiring — do not use it on the live path in place of `ocr: null`
// when the module is absent (unavailable ≠ empty-string scores).
//
// See docs/MOBILE-OCR.md.

import { EMPTY_RECOGNITION, type TextRecognizer } from './sharedCore';

export const emptyTextRecognizer = (): TextRecognizer => ({
  recognize: async () => EMPTY_RECOGNITION,
});
