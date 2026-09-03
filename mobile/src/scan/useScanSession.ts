// SessionController on the live native path.
//
// Acquisition stays in useFrameAnalysis. This hook owns phases, tracking,
// focus, quality pool, and recognition — all via the portable controller.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraRef } from 'react-native-vision-camera';

import { scanImageToPngDataUri } from './debug/scanImagePng';
import { emptyTextRecognizer } from './emptyOcr';
import { emptyHiResStore } from './hiresCapture';
import { loadArtworkIndex, loadNameIndex, type ArtIndexLoad, type NameIndexLoad } from './indexLoader';
import {
  createFrameHelpers,
  createNativeHelperState,
  rememberTap,
  requestFocusOnCamera,
} from './nativeHelpers';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  createSessionController,
  describeArtwork,
  type DetectResult,
  type RecognizeDeps,
  type ScanImage,
  type ScannerPhase,
  type SessionSnapshot,
} from './sharedCore';

const DEBUG_MS = 700;

export interface AnalyzedFrame {
  detection: DetectResult;
  image: ScanImage;
}

export interface SessionDebug {
  art: ArtIndexLoad | null;
  artCandidates: { name: string; score: number }[];
  names: NameIndexLoad | null;
  normalizedUri: string | null;
  phase: ScannerPhase;
  qualityBest: number | null;
  qualityPool: number;
}

export const useScanSession = (opts: {
  cameraRef: { current: CameraRef | null };
  enabled?: boolean;
  previewSize: { height: number; width: number };
}) => {
  const { cameraRef, enabled = true, previewSize } = opts;
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [debug, setDebug] = useState<SessionDebug>({
    art: null,
    artCandidates: [],
    names: null,
    normalizedUri: null,
    phase: 'searching',
    qualityBest: null,
    qualityPool: 0,
  });
  const [indexes, setIndexes] = useState<{
    art: ArtIndexLoad | null;
    names: NameIndexLoad | null;
  }>({ art: null, names: null });

  const store = useRef(emptyHiResStore());
  const helperState = useRef(createNativeHelperState(store.current));
  helperState.current.preview = previewSize;

  const lastDebugAt = useRef(0);
  const lastPhase = useRef<ScannerPhase>('searching');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadNameIndex(), loadArtworkIndex()]).then(([names, art]) => {
      if (!cancelled) setIndexes({ art, names });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deps: RecognizeDeps = useMemo(
    () => ({
      artwork: indexes.art?.matcher ?? null,
      artworkIndex: indexes.art?.data ?? null,
      nameIndex: indexes.names?.index ?? null,
      ocr: emptyTextRecognizer(),
      textIndex: indexes.art?.text ?? null,
    }),
    [indexes],
  );

  const controller = useMemo(() => createSessionController(deps), [deps]);
  const helpers = useMemo(() => createFrameHelpers(helperState.current, cameraRef), [cameraRef]);

  const onAnalyzed = useCallback(
    async (frame: AnalyzedFrame) => {
      helperState.current.analysis = frame.image;
      helperState.current.detection = frame.detection;
      const snap = await controller.onFrame(frame.image, helpers);
      const phaseChanged = snap.phase !== lastPhase.current;
      lastPhase.current = snap.phase;
      const t = Date.now();
      const terminal = snap.phase === 'found' || snap.phase === 'ambiguous';
      if (phaseChanged || terminal || t - lastDebugAt.current >= DEBUG_MS) {
        setSnapshot(snap);
      }

      if (t - lastDebugAt.current < DEBUG_MS) return;
      lastDebugAt.current = t;
      const normalized = controller.lastNormalized();
      let normalizedUri: string | null = null;
      if (
        normalized &&
        normalized.width === CARD_WIDTH &&
        normalized.height === CARD_HEIGHT
      ) {
        try {
          normalizedUri = scanImageToPngDataUri(normalized);
        } catch {
          normalizedUri = null;
        }
      }
      setDebug({
        art: indexes.art,
        artCandidates: (snap.recognition?.visualTop ?? []).slice(0, 5).map(c => ({
          name: c.name,
          score: c.visualScore,
        })),
        names: indexes.names,
        normalizedUri,
        phase: snap.phase,
        qualityBest: snap.quality?.score ?? null,
        qualityPool: snap.trackFrames,
      });
    },
    [controller, helpers, indexes.art, indexes.names],
  );

  const reset = useCallback(() => {
    controller.reset();
    store.current.cache = null;
    helperState.current.analysis = null;
    helperState.current.detection = null;
    setSnapshot(controller.snapshot());
  }, [controller]);

  const markTap = useCallback(() => {
    rememberTap(helperState.current);
  }, []);

  const focusNorm = useCallback(
    (nx: number, ny: number) => {
      rememberTap(helperState.current);
      requestFocusOnCamera(cameraRef.current, helperState.current.preview, nx, ny);
    },
    [cameraRef],
  );

  return {
    debug,
    describeLastArt: () => {
      const image = controller.lastNormalized();
      if (!image) return null;
      return describeArtwork(image);
    },
    focusNorm,
    indexes,
    markTap,
    onAnalyzed: enabled ? onAnalyzed : undefined,
    reset,
    snapshot,
  };
};
