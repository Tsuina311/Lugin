/**
 * Development adapter for the frozen dual-gallery search.
 * Missing native method or missing gallery files return an error.
 * The production F16 recognize path is not called from here.
 */

import { getLuginVisualModule } from 'lugin-visual-recognizer';
import type { VNextNameLookup, VNextNativeResult } from 'lugin-visual-recognizer';

export type VNextNativeCall = {
  ok: boolean;
  cleanTop: VNextNativeResult['cleanTop'];
  prototypeTop: VNextNativeResult['prototypeTop'];
  galleryBytes: number | null;
  nativeHeapBytes: number | null;
  encoderMs: number | null;
  adapterMs: number | null;
  searchMs: number | null;
  error: string | null;
};

const empty = (error: string): VNextNativeCall => ({
  ok: false,
  cleanTop: [],
  prototypeTop: [],
  galleryBytes: null,
  nativeHeapBytes: null,
  encoderMs: null,
  adapterMs: null,
  searchMs: null,
  error,
});

export const recognizeVNextArt = async (
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<VNextNativeCall> => {
  const mod = getLuginVisualModule();
  if (!mod?.recognizeVNextFromRgbaBytes) {
    return empty('VNEXT_NATIVE_METHOD_MISSING');
  }
  try {
    const result = await mod.recognizeVNextFromRgbaBytes(rgba, width, height, 5);
    if (result.error) return { ...empty(result.error), galleryBytes: result.galleryBytes, nativeHeapBytes: result.nativeHeapBytes };
    return {
      ok: true,
      cleanTop: result.cleanTop ?? [],
      prototypeTop: result.prototypeTop ?? [],
      galleryBytes: result.galleryBytes ?? null,
      nativeHeapBytes: result.nativeHeapBytes ?? null,
      encoderMs: result.timing?.encoderMs ?? null,
      adapterMs: result.timing?.adapterMs ?? null,
      searchMs: result.timing?.searchMs ?? null,
      error: null,
    };
  } catch (err) {
    return empty(err instanceof Error ? err.message : String(err));
  }
};

export const lookupVNextExactName = async (name: string): Promise<VNextNameLookup> => {
  const mod = getLuginVisualModule();
  if (!mod?.lookupVNextExactName) return { oracleIds: [], unique: false, error: 'native vNext lookup is not in this binary' };
  try {
    return await mod.lookupVNextExactName(name);
  } catch (err) {
    return { oracleIds: [], unique: false, error: err instanceof Error ? err.message : String(err) };
  }
};
