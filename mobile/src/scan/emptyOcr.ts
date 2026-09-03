// Native TextRecognizer until a maintained OCR engine is adopted.
//
// Artwork matching and fusion run without OCR. Title / rules / footer
// evidence stay empty so we never invent readings.
//
// See docs/MOBILE-OCR.md for the engine survey. Adding ML Kit (or any
// native module) changes the EAS fingerprint and needs a new APK.

import { EMPTY_RECOGNITION, type TextRecognizer } from './sharedCore';

export const emptyTextRecognizer = (): TextRecognizer => ({
  recognize: async () => EMPTY_RECOGNITION,
});
