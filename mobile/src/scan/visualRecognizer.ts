/**
 * JS adapter for native `LuginVisual` (CLIP ViT-B/32 + F16 gallery).
 * Soft-fails when the Expo module is not linked (pre-EAS APK).
 */

import { getLuginVisualModule } from 'lugin-visual-recognizer';
import type {
  VisualEngineStatus,
  VisualInitResult,
  VisualRecognizeResult as NativeRecognizeResult,
} from 'lugin-visual-recognizer';

export type VisualRecognizerState = VisualEngineStatus;

export type VisualHit = {
  name: string;
  oracleId: string | null;
  score: number;
  margin: number | null;
  artReferenceId: string | null;
};

export type VisualRecognizeResult = {
  ok: boolean;
  hits: VisualHit[];
  embeddingHandle: number;
  latencyMs: number | null;
  encoderMs: number | null;
  searchMs: number | null;
  error: string | null;
};

let state: VisualRecognizerState = 'UNINITIALIZED';
let lastError: string | null = null;
let lastInit: VisualInitResult | null = null;

export const getVisualRecognizerState = (): VisualRecognizerState => state;
export const getVisualRecognizerError = (): string | null => lastError;
export const getVisualInitInfo = (): VisualInitResult | null => lastInit;
export const isNativeVisualRecognizerLinked = (): boolean => getLuginVisualModule() != null;

export const resetVisualRecognizerForTests = (): void => {
  state = 'UNINITIALIZED';
  lastError = null;
  lastInit = null;
};

export const initializeVisualRecognizer = async (): Promise<VisualRecognizerState> => {
  const mod = getLuginVisualModule();
  if (!mod) {
    state = 'ERROR';
    lastError = 'LuginVisual native module not linked — rebuild APK with EAS';
    return state;
  }
  state = 'LOADING';
  lastError = null;
  try {
    const result = await mod.initialize();
    lastInit = result;
    if (result.status === 'READY') {
      state = 'READY';
      lastError = null;
    } else {
      state = 'ERROR';
      lastError = result.error ?? 'initialize failed';
    }
  } catch (err) {
    state = 'ERROR';
    lastError = err instanceof Error ? err.message : String(err);
  }
  return state;
};

/** Packed RGBA art-crop → top-K oracle candidates. */
export const recognizeArtCropRgba = async (
  rgba: Uint8Array,
  width: number,
  height: number,
  topK = 5,
): Promise<VisualRecognizeResult> => {
  const mod = getLuginVisualModule();
  if (!mod || state !== 'READY') {
    return {
      ok: false,
      hits: [],
      embeddingHandle: 0,
      latencyMs: null,
      encoderMs: null,
      searchMs: null,
      error: lastError ?? 'CLIP not READY',
    };
  }
  try {
    const raw: NativeRecognizeResult = await mod.recognizeFromRgbaBytes(rgba, width, height, topK);
    const hits: VisualHit[] = (raw.topCandidates ?? []).map((c, i, arr) => ({
      name: c.name,
      oracleId: c.oracleId,
      score: c.score,
      artReferenceId: c.artReferenceId,
      margin: i === 0 && arr[1] ? c.score - arr[1].score : null,
    }));
    return {
      ok: hits.length > 0,
      hits,
      embeddingHandle: raw.embeddingHandle ?? 0,
      latencyMs: raw.timing?.totalMs ?? null,
      encoderMs: raw.timing?.encoderMs ?? null,
      searchMs: raw.timing?.searchMs ?? null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      hits: [],
      embeddingHandle: 0,
      latencyMs: null,
      encoderMs: null,
      searchMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const lockVisualHandle = async (handle: number): Promise<void> => {
  const mod = getLuginVisualModule();
  if (!mod || handle <= 0) return;
  await mod.lockHandle(handle);
};

export const clearLockedVisualHandle = async (): Promise<void> => {
  const mod = getLuginVisualModule();
  if (!mod) return;
  await mod.clearLockedHandle();
};

export const compareToLockedVisual = async (
  rgba: Uint8Array,
  width: number,
  height: number,
  handle: number,
): Promise<{ ok: boolean; similarity: number | null; ms: number | null; error: string | null }> => {
  const mod = getLuginVisualModule();
  if (!mod || state !== 'READY') {
    return { ok: false, similarity: null, ms: null, error: 'CLIP not READY' };
  }
  try {
    const r = await mod.compareToHandle(rgba, width, height, handle);
    return { ok: true, similarity: r.similarity, ms: r.ms, error: null };
  } catch (err) {
    return {
      ok: false,
      similarity: null,
      ms: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

export const warmUpVisualRecognizer = async (): Promise<{
  coldMs: number;
  warmMs: number;
} | null> => {
  const mod = getLuginVisualModule();
  if (!mod || state !== 'READY') return null;
  return mod.warmUp();
};
