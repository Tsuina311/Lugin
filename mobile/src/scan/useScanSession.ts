// SessionController on the live native path.
//
// Acquisition stays in useFrameAnalysis. This hook owns phases, tracking,
// focus, quality pool, and recognition — all via the portable controller.
// High-res capture is async and must finish (or fail) before recognize.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraPhotoOutput, CameraRef } from 'react-native-vision-camera';

import { scanImageToPngDataUri } from './debug/scanImagePng';
import {
  RECOGNITION_SOURCES,
  emptyHiResStore,
  isTrueHiRes,
  type HiResSpaces,
  type PreferredSource,
  type RecognitionSource,
} from './hiresCapture';
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
import { createHiResCapturer, runPreferredCapture } from './useHiResCapture';

const DEBUG_MS = 700;

export interface AnalyzedFrame {
  detection: DetectResult;
  image: ScanImage;
  spaces: HiResSpaces;
}

export interface SessionDebug {
  art: ArtIndexLoad | null;
  artCandidates: { name: string; score: number }[];
  artworkDescriptorMs: number | null;
  artworkMatcherMs: number | null;
  artworkMs: number | null;
  captureMs: number | null;
  convertMs: number | null;
  footerEvidence: 'unavailable' | 'present';
  hiresUri: string | null;
  mappedCorners: import('./sharedCore').CardCorners | null;
  names: NameIndexLoad | null;
  normalizedUri: string | null;
  phase: ScannerPhase;
  qualityBest: number | null;
  qualityPool: number;
  recognitionSource: RecognitionSource | null;
  sourceHeight: number | null;
  sourceLabel: string;
  sourceWidth: number | null;
  textEvidence: 'unavailable' | 'present';
  titleEvidence: 'unavailable' | 'present';
  warpMs: number | null;
}

const emptyDebug = (): SessionDebug => ({
  art: null,
  artCandidates: [],
  artworkDescriptorMs: null,
  artworkMatcherMs: null,
  artworkMs: null,
  captureMs: null,
  convertMs: null,
  footerEvidence: 'unavailable',
  hiresUri: null,
  mappedCorners: null,
  names: null,
  normalizedUri: null,
  phase: 'searching',
  qualityBest: null,
  qualityPool: 0,
  recognitionSource: null,
  sourceHeight: null,
  sourceLabel: 'none',
  sourceWidth: null,
  textEvidence: 'unavailable',
  titleEvidence: 'unavailable',
  warpMs: null,
});

export const useScanSession = (opts: {
  cameraRef: { current: CameraRef | null };
  enabled?: boolean;
  photoOutput: CameraPhotoOutput | null;
  preferredSource?: PreferredSource;
  previewSize: { height: number; width: number };
  takeHiResFrame?: () => Promise<ScanImage>;
}) => {
  const {
    cameraRef,
    enabled = true,
    photoOutput,
    preferredSource = 'snapshot',
    previewSize,
    takeHiResFrame,
  } = opts;
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [debug, setDebug] = useState<SessionDebug>(emptyDebug);
  const [indexes, setIndexes] = useState<{
    art: ArtIndexLoad | null;
    names: NameIndexLoad | null;
  }>({ art: null, names: null });

  const store = useRef(emptyHiResStore());
  const helperState = useRef(createNativeHelperState(store.current));
  helperState.current.preview = previewSize;
  const preferredRef = useRef(preferredSource);
  preferredRef.current = preferredSource;
  const takeFrameRef = useRef(takeHiResFrame);
  takeFrameRef.current = takeHiResFrame;

  const lastDebugAt = useRef(0);
  const lastPhase = useRef<ScannerPhase>('searching');
  const lastCaptureKey = useRef('');

  const capturer = useMemo(
    () => createHiResCapturer({ cameraRef, photoOutput, store: store.current }),
    [cameraRef, photoOutput],
  );

  useEffect(() => {
    store.current.cache = null;
    store.current.lastAttempt = null;
    lastCaptureKey.current = '';
  }, [preferredSource]);

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
      ocr: null,
      textIndex: indexes.art?.text ?? null,
    }),
    [indexes],
  );

  const controller = useMemo(() => createSessionController(deps), [deps]);
  const helpers = useMemo(() => createFrameHelpers(helperState.current, cameraRef), [cameraRef]);

  const publishDebug = useCallback(
    (snap: SessionSnapshot) => {
      const normalized = controller.lastNormalized();
      const cache = store.current.cache;
      let normalizedUri: string | null = null;
      let hiresUri: string | null = null;
      if (normalized && normalized.width === CARD_WIDTH && normalized.height === CARD_HEIGHT) {
        try {
          normalizedUri = scanImageToPngDataUri(normalized);
        } catch {
          normalizedUri = null;
        }
      }
      if (cache?.source && cache.source !== normalized) {
        try {
          hiresUri = scanImageToPngDataUri(cache.source);
        } catch {
          hiresUri = null;
        }
      }
      const timings = snap.recognition?.timings;
      const ocrOn = Boolean(deps.ocr);
      const mode = cache?.attempt.mode ?? store.current.lastAttempt?.mode ?? null;
      setDebug({
        art: indexes.art,
        artCandidates: (snap.recognition?.visualTop ?? []).slice(0, 5).map(c => ({
          name: c.name,
          score: c.visualScore,
        })),
        artworkDescriptorMs: timings?.artworkDescriptorMs ?? null,
        artworkMatcherMs: timings?.artworkMatcherMs ?? null,
        artworkMs: timings?.artworkMs ?? null,
        captureMs: cache?.attempt.acquireMs ?? store.current.lastAttempt?.acquireMs ?? null,
        convertMs: cache?.attempt.convertMs ?? null,
        footerEvidence: ocrOn ? 'present' : 'unavailable',
        hiresUri,
        mappedCorners: cache?.mapped ?? null,
        names: indexes.names,
        normalizedUri,
        phase: snap.phase,
        qualityBest: snap.quality?.score ?? null,
        qualityPool: snap.trackFrames,
        recognitionSource: mode,
        sourceHeight: cache?.attempt.sourceSize?.height ?? null,
        sourceLabel: mode
          ? isTrueHiRes(mode)
            ? 'high-res'
            : 'analysis-fallback'
          : 'none',
        sourceWidth: cache?.attempt.sourceSize?.width ?? null,
        textEvidence: ocrOn ? 'present' : 'unavailable',
        titleEvidence: ocrOn ? 'present' : 'unavailable',
        warpMs: cache?.attempt.warpMs ?? store.current.lastAttempt?.warpMs ?? null,
      });
    },
    [controller, deps.ocr, indexes.art, indexes.names],
  );

  const maybeCapture = useCallback(
    (frame: AnalyzedFrame, phase: ScannerPhase) => {
      if (phase !== 'focusing' && phase !== 'locking') return;
      if (!frame.detection.corners) return;
      if (store.current.cache || store.current.inFlight) return;
      const key = `${Math.round(frame.detection.corners.topLeft.x)}:${Math.round(frame.detection.corners.topLeft.y)}`;
      if (key === lastCaptureKey.current) return;
      lastCaptureKey.current = key;
      store.current.inFlight = true;
      void runPreferredCapture(
        preferredRef.current,
        capturer,
        {
          analysis: frame.image,
          corners: frame.detection.corners,
          score: frame.detection.score,
          spaces: frame.spaces,
        },
        store.current,
        takeFrameRef.current,
      )
        .then(cache => {
          store.current.cache = cache;
          store.current.lastAttempt = cache.attempt;
        })
        .catch(err => {
          store.current.lastAttempt = {
            acquireMs: 0,
            convertMs: 0,
            mode: 'analysis-fallback',
            previewInterrupted: false,
            reason: err instanceof Error ? err.message : String(err),
            sourceSize: { height: frame.image.height, width: frame.image.width },
            warpMs: 0,
          };
        })
        .finally(() => {
          store.current.inFlight = false;
        });
    },
    [capturer],
  );

  const onAnalyzed = useCallback(
    async (frame: AnalyzedFrame) => {
      helperState.current.analysis = frame.image;
      helperState.current.detection = frame.detection;
      helperState.current.spaces = frame.spaces;
      const snap = await controller.onFrame(frame.image, helpers);
      if (snap.phase === 'searching') {
        store.current.cache = null;
        store.current.lastAttempt = null;
        lastCaptureKey.current = '';
      }
      maybeCapture(frame, snap.phase);
      const phaseChanged = snap.phase !== lastPhase.current;
      lastPhase.current = snap.phase;
      const t = Date.now();
      const terminal = snap.phase === 'found' || snap.phase === 'ambiguous';
      if (phaseChanged || terminal || t - lastDebugAt.current >= DEBUG_MS) {
        setSnapshot(snap);
      }

      if (t - lastDebugAt.current < DEBUG_MS) return;
      lastDebugAt.current = t;
      publishDebug(snap);
    },
    [controller, helpers, maybeCapture, publishDebug],
  );

  const reset = useCallback(() => {
    controller.reset();
    store.current.cache = null;
    store.current.inFlight = false;
    store.current.lastAttempt = null;
    lastCaptureKey.current = '';
    helperState.current.analysis = null;
    helperState.current.detection = null;
    helperState.current.spaces = null;
    setSnapshot(controller.snapshot());
    setDebug(emptyDebug());
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
    preferredSources: RECOGNITION_SOURCES,
    reset,
    snapshot,
  };
};
