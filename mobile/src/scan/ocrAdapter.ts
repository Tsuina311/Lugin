// Live OCR adapter — never freeze `ocr: null` from the first render.
//
// `requireOptionalNativeModule('LuginOcr')` can return null before Expo
// finishes registering native modules. A useRef initializer that captured that
// null kept deps.ocr null for the whole session (the Samsung no-ocr traces).
// Warmup is optional and must not gate availability.

import { getLuginOcrModule } from 'lugin-ocr';

import {
  createMlkitLegacyTextRecognizer,
  createMlkitTextRecognizer,
  isNativeOcrLinked,
  supportsOcrRgbaBytes,
  warmUpMlkitOcr,
} from './mlkitTextRecognizer';
import type { TextRecognizer } from './sharedCore';

export type OcrWarmupState = 'not-started' | 'warming' | 'ready' | 'failed';

export type OcrAdapterSnapshot = {
  controllerHasOcrDependency: boolean;
  lastOcrAdapterError: string | null;
  nativeModuleAvailable: boolean;
  recognizeFromRgbaBytesAvailable: boolean;
  textRecognizerCreated: boolean;
  transport: 'rgba-bytes' | 'legacy-base64' | 'none';
  warmupState: OcrWarmupState;
};

const state = {
  lastError: null as string | null,
  legacy: null as TextRecognizer | null,
  recognizer: null as TextRecognizer | null,
  warmup: 'not-started' as OcrWarmupState,
};

export const resetOcrAdapterForTests = (): void => {
  state.lastError = null;
  state.legacy = null;
  state.recognizer = null;
  state.warmup = 'not-started';
};

export const getOrCreateOcrRecognizer = (): TextRecognizer | null => {
  if (state.recognizer) return state.recognizer;
  if (!isNativeOcrLinked() || !getLuginOcrModule()) {
    state.lastError = state.lastError ?? 'native module LuginOcr not available';
    return null;
  }
  try {
    state.recognizer = createMlkitTextRecognizer();
    state.lastError = null;
    return state.recognizer;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    state.recognizer = null;
    return null;
  }
};

export const getOrCreateLegacyOcrRecognizer = (): TextRecognizer | null => {
  if (state.legacy) return state.legacy;
  if (!isNativeOcrLinked()) return null;
  try {
    state.legacy = createMlkitLegacyTextRecognizer();
    return state.legacy;
  } catch {
    return null;
  }
};

/** Optional. Failure must not clear the recognizer. */
export const startOcrWarmupIfEnabled = (enabled: boolean): void => {
  if (!enabled) return;
  if (state.warmup === 'warming' || state.warmup === 'ready') return;
  if (!getOrCreateOcrRecognizer()) return;
  state.warmup = 'warming';
  try {
    warmUpMlkitOcr();
    state.warmup = 'ready';
  } catch (err) {
    state.warmup = 'failed';
    state.lastError = err instanceof Error ? err.message : String(err);
  }
};

export const getOcrAdapterSnapshot = (): OcrAdapterSnapshot => {
  const recognizer = state.recognizer ?? getOrCreateOcrRecognizer();
  const native = isNativeOcrLinked();
  const bytes = supportsOcrRgbaBytes();
  return {
    controllerHasOcrDependency: recognizer != null,
    lastOcrAdapterError: native ? state.lastError : state.lastError ?? 'native module LuginOcr not available',
    nativeModuleAvailable: native,
    recognizeFromRgbaBytesAvailable: bytes,
    textRecognizerCreated: recognizer != null,
    transport: !recognizer ? 'none' : bytes ? 'rgba-bytes' : 'legacy-base64',
    warmupState: state.warmup,
  };
};

export const ocrUnavailableReason = (): string | null => {
  const snap = getOcrAdapterSnapshot();
  if (snap.textRecognizerCreated && snap.controllerHasOcrDependency) return null;
  return snap.lastOcrAdapterError ?? 'OCR adapter not created';
};
