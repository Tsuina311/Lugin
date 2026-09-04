// SessionController on the live native path.
//
// Acquisition stays in useFrameAnalysis. This hook owns phases, tracking,
// focus, quality pool, and recognition — all via the portable controller.
// High-res capture starts as soon as we enter focusing/locking and recognition
// waits a bounded interval before labeled analysis-fallback.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraPhotoOutput, CameraRef } from 'react-native-vision-camera';

import { scanImageToPngDataUri } from './debug/scanImagePng';
import {
  HIRES_WAIT_MS,
  RECOGNITION_SOURCES,
  emptyHiResStore,
  isTrueHiRes,
  type HiResPhase,
  type HiResSourceStats,
  type HiResSpaces,
  type PreferredSource,
  type RecognitionSource,
} from './hiresCapture';
import { loadArtworkIndex, loadNameIndex, loadPrintingIndex, type ArtIndexLoad, type NameIndexLoad, type PrintingIndexLoad } from './indexLoader';
import {
  checkScannerDataUpdates,
  loadScannerIndexesLocal,
  peekActiveScannerIndexes,
} from './scannerDataStore';
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
import { createMlkitTextRecognizer, isNativeOcrLinked } from './mlkitTextRecognizer';
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
  artError: string | null;
  artGenerated: string | null;
  artworkDescriptorMs: number | null;
  artworkMatcherMs: number | null;
  artworkMs: number | null;
  captureMs: number | null;
  convertMs: number | null;
  footerEvidence: 'unavailable' | 'present';
  hiresPhase: HiResPhase;
  hiresStats: Record<string, HiResSourceStats>;
  hiresUri: string | null;
  hiresWaitMs: number;
  mappedCorners: import('./sharedCore').CardCorners | null;
  names: NameIndexLoad | null;
  printing: PrintingIndexLoad | null;
  normalizedUri: string | null;
  phase: ScannerPhase;
  qualityBest: number | null;
  qualityPool: number;
  recognitionSource: RecognitionSource | null;
  sourceHeight: number | null;
  sourceLabel: string;
  sourceWidth: number | null;
  temporalLeader: string | null;
  temporalObservations: number;
  temporalResetAt: number | null;
  temporalResetReason: string | null;
  textEvidence: 'unavailable' | 'present';
  titleEvidence: 'unavailable' | 'present';
  warpMs: number | null;
  /** User-facing lock→oracle / printing latency (ms). */
  userLatency: {
    lockToFirstOracleMs: number | null;
    lockToFinalOracleMs: number | null;
    lockToPrintingMs: number | null;
    recognizeToFirstOracleMs: number | null;
  } | null;
  earlyReason: string | null;
  titleMs: number | null;
  titleDoneAt: number | null;
  artDoneAt: number | null;
  earlyIdentityAt: number | null;
}

const emptyDebug = (): SessionDebug => ({
  art: null,
  artCandidates: [],
  artError: null,
  artGenerated: null,
  artworkDescriptorMs: null,
  artworkMatcherMs: null,
  artworkMs: null,
  captureMs: null,
  convertMs: null,
  footerEvidence: 'unavailable',
  hiresPhase: 'idle',
  hiresStats: emptyHiResStore().stats,
  hiresUri: null,
  hiresWaitMs: HIRES_WAIT_MS,
  mappedCorners: null,
  names: null,
  printing: null,
  normalizedUri: null,
  phase: 'searching',
  qualityBest: null,
  qualityPool: 0,
  recognitionSource: null,
  sourceHeight: null,
  sourceLabel: 'none',
  sourceWidth: null,
  temporalLeader: null,
  temporalObservations: 0,
  temporalResetAt: null,
  temporalResetReason: null,
  textEvidence: 'unavailable',
  titleEvidence: 'unavailable',
  warpMs: null,
  userLatency: null,
  earlyReason: null,
  titleMs: null,
  titleDoneAt: null,
  artDoneAt: null,
  earlyIdentityAt: null,
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
    artError: string | null;
    names: NameIndexLoad | null;
    printing: PrintingIndexLoad | null;
  }>({ art: null, artError: null, names: null, printing: null });

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
  const temporalMeta = useRef<{ resetAt: number | null; resetReason: string | null }>({
    resetAt: null,
    resetReason: null,
  });

  const capturer = useMemo(
    () => createHiResCapturer({ cameraRef, photoOutput, store: store.current }),
    [cameraRef, photoOutput],
  );

  useEffect(() => {
    store.current.cache = null;
    store.current.lastAttempt = null;
    store.current.waitStartedAt = null;
    store.current.phase = 'idle';
    lastCaptureKey.current = '';
    temporalMeta.current = {
      resetAt: Date.now(),
      resetReason: `source → ${preferredSource}`,
    };
  }, [preferredSource]);

  useEffect(() => {
    let cancelled = false;
    const printingFromActive = (
      next: NonNullable<ReturnType<typeof peekActiveScannerIndexes>>,
    ): PrintingIndexLoad | null =>
      next.printing && next.printingIndex
        ? {
            checksum: next.printingChecksum,
            coldMs: 0,
            data: next.printing,
            entries: next.printing.entries.length,
            index: next.printingIndex,
            source: 'memory',
            version: next.printing.version,
            warmMs: 0,
          }
        : null;

    void (async () => {
      // Local disk / bundled seed first — scanner usable offline immediately.
      const local = await loadScannerIndexesLocal();
      if (cancelled) return;
      if (local?.nameIndex) {
        setIndexes({
          art: local.art
            ? {
                checksum: local.artChecksum,
                coldMs: 0,
                data: local.art,
                entries: local.art.entries.length,
                generated: local.artGenerated,
                matcher: local.artMatcher!,
                source: local.artOrigin === 'disk' ? 'memory' : 'memory',
                text: local.text,
                uniqueOracles: local.artUniqueOracles,
                version: local.art.version,
                warmMs: 0,
              }
            : null,
          artError: local.art
            ? null
            : 'art index not on disk yet — title-only until background update',
          names: {
            checksum: local.nameChecksum,
            coldMs: 0,
            data: local.nameData!,
            index: local.nameIndex,
            names: local.names,
            source: 'memory',
            version: local.nameData!.version,
            warmMs: 0,
          },
          printing: printingFromActive(local),
        });
      } else {
        // First install: fetch Pages indexes (same as before), then persist via updater.
        const [names, art, printing] = await Promise.all([
          loadNameIndex(),
          loadArtworkIndex(),
          loadPrintingIndex(),
        ]);
        if (cancelled) return;
        setIndexes({
          art,
          artError: art ? null : 'art index missing or rejected (fixture/too small?)',
          names,
          printing,
        });
      }
      // Background manifest check — never blocks first scan.
      void checkScannerDataUpdates({ force: false }).then(() => {
        if (cancelled) return;
        const next = peekActiveScannerIndexes();
        if (!next?.nameIndex) return;
        setIndexes({
          art: next.art
            ? {
                checksum: next.artChecksum,
                coldMs: 0,
                data: next.art,
                entries: next.art.entries.length,
                generated: next.artGenerated,
                matcher: next.artMatcher!,
                source: 'memory',
                text: next.text,
                uniqueOracles: next.artUniqueOracles,
                version: next.art.version,
                warmMs: 0,
              }
            : null,
          artError: next.art ? null : 'art index not on disk yet',
          names: {
            checksum: next.nameChecksum,
            coldMs: 0,
            data: next.nameData!,
            index: next.nameIndex,
            names: next.names,
            source: 'memory',
            version: next.nameData!.version,
            warmMs: 0,
          },
          printing: printingFromActive(next),
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const earlyIdentityRef = useRef<((snap: SessionSnapshot) => void) | null>(null);
  const controllerRef = useRef<ReturnType<typeof createSessionController> | null>(null);

  const deps: RecognizeDeps = useMemo(
    () => ({
      artwork: indexes.art?.matcher ?? null,
      artworkIndex: indexes.art?.data ?? null,
      nameIndex: indexes.names?.index ?? null,
      printingIndex: indexes.printing?.index ?? null,
      // Feature-detect: old APKs without lugin-ocr stay ocr:null (unavailable).
      // Linked binaries get ML Kit Latin via createMlkitTextRecognizer.
      ocr: isNativeOcrLinked() ? createMlkitTextRecognizer() : null,
      textIndex: indexes.art?.text ?? null,
      onEarlyIdentity: () => {
        // Controller already updated lastRecognition/phase; publish snapshot now
        // so title-only / footer-printing identity is not gated on slow channels.
        const snap = controllerRef.current?.snapshot();
        if (!snap) return;
        earlyIdentityRef.current?.(snap);
      },
    }),
    [indexes],
  );

  const controller = useMemo(() => createSessionController(deps), [deps]);
  controllerRef.current = controller;
  const helpers = useMemo(() => createFrameHelpers(helperState.current, cameraRef), [cameraRef]);

  const publishDebug = useCallback(
    (snap: SessionSnapshot) => {
      const normalized = controller.lastNormalized();
      const cache = store.current.cache;
      let normalizedUri: string | null = null;
      let hiresUri: string | null = null;
      if (normalized && normalized.width === CARD_WIDTH && normalized.height === CARD_HEIGHT) {
        try {
          // Large enough to read title / rules in the panel (~half card width).
          normalizedUri = scanImageToPngDataUri(normalized, 372);
        } catch {
          normalizedUri = null;
        }
      }
      if (cache?.source && cache.source !== normalized) {
        try {
          hiresUri = scanImageToPngDataUri(cache.source, 280);
        } catch {
          hiresUri = null;
        }
      }
      const timings = snap.recognition?.timings;
      const ocrOn = Boolean(deps.ocr);
      const mode = cache?.attempt.mode ?? store.current.lastAttempt?.mode ?? null;
      const temporal = snap.temporal;
      const leader = temporal?.observations?.[temporal.observations.length - 1]?.topOracleId ?? null;
      setDebug({
        art: indexes.art,
        artCandidates: (snap.recognition?.visualTop ?? []).slice(0, 5).map(c => ({
          name: c.name,
          score: c.visualScore,
        })),
        artError: indexes.artError,
        artGenerated: indexes.art?.generated ?? null,
        artworkDescriptorMs: timings?.artworkDescriptorMs ?? null,
        artworkMatcherMs: timings?.artworkMatcherMs ?? null,
        artworkMs: timings?.artworkMs ?? null,
        captureMs: cache?.attempt.acquireMs ?? store.current.lastAttempt?.acquireMs ?? null,
        convertMs: cache?.attempt.convertMs ?? null,
        footerEvidence: ocrOn ? 'present' : 'unavailable',
        hiresPhase: store.current.phase,
        hiresStats: { ...store.current.stats },
        hiresUri,
        hiresWaitMs: HIRES_WAIT_MS,
        mappedCorners: cache?.mapped ?? null,
        names: indexes.names,
        printing: indexes.printing,
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
          : store.current.inFlight || store.current.phase === 'requested' || store.current.phase === 'capturing'
            ? 'waiting'
            : 'none',
        sourceWidth: cache?.attempt.sourceSize?.width ?? null,
        temporalLeader: leader,
        temporalObservations: temporal?.observations?.length ?? 0,
        temporalResetAt: temporalMeta.current.resetAt,
        temporalResetReason: temporalMeta.current.resetReason,
        textEvidence: ocrOn ? 'present' : 'unavailable',
        titleEvidence: ocrOn ? 'present' : 'unavailable',
        warpMs: cache?.attempt.warpMs ?? store.current.lastAttempt?.warpMs ?? null,
        userLatency: snap.userLatency ?? null,
        earlyReason: snap.recognition?.earlyReason ?? null,
        titleMs: timings?.titleMs ?? null,
        titleDoneAt: timings?.titleDoneAt ?? null,
        artDoneAt: timings?.artDoneAt ?? null,
        earlyIdentityAt: timings?.earlyIdentityAt ?? null,
      });
    },
    [controller, deps.ocr, indexes.art, indexes.artError, indexes.names, indexes.printing],
  );

  // Publish provisional found/ambiguous as soon as title (or strong art) wins the race.
  earlyIdentityRef.current = snap => {
    lastPhase.current = snap.phase;
    setSnapshot(snap);
    lastDebugAt.current = Date.now();
    publishDebug(snap);
  };

  const startCapture = useCallback(
    (frame: AnalyzedFrame) => {
      if (!frame.detection.corners) return;
      if (store.current.cache || store.current.inFlight) return;
      const key = `${Math.round(frame.detection.corners.topLeft.x)}:${Math.round(frame.detection.corners.topLeft.y)}`;
      if (key === lastCaptureKey.current) return;
      lastCaptureKey.current = key;
      store.current.inFlight = true;
      store.current.waitStartedAt = store.current.waitStartedAt ?? Date.now();
      store.current.phase = 'requested';
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
          store.current.phase = 'failed';
        })
        .finally(() => {
          store.current.inFlight = false;
        });
    },
    [capturer],
  );

  // Controller may call allowRecognize before our phase-based kick; wire it.
  helperState.current.requestCapture = () => {
    const analysis = helperState.current.analysis;
    const detection = helperState.current.detection;
    const spaces = helperState.current.spaces;
    if (!analysis || !detection?.corners || !spaces) return;
    startCapture({ detection, image: analysis, spaces });
  };

  const onAnalyzed = useCallback(
    async (frame: AnalyzedFrame) => {
      helperState.current.analysis = frame.image;
      helperState.current.detection = frame.detection;
      helperState.current.spaces = frame.spaces;

      // Kick hi-res once we are focusing/locking so capture is not raced
      // by an immediate analysis-fallback recognize on the first lock frame.
      if (
        (lastPhase.current === 'focusing' || lastPhase.current === 'locking') &&
        frame.detection.corners
      ) {
        if (store.current.waitStartedAt == null) store.current.waitStartedAt = Date.now();
        startCapture(frame);
      }

      const snap = await controller.onFrame(frame.image, helpers);
      if (snap.phase === 'searching') {
        store.current.cache = null;
        store.current.lastAttempt = null;
        store.current.waitStartedAt = null;
        store.current.phase = 'idle';
        lastCaptureKey.current = '';
        temporalMeta.current = { resetAt: Date.now(), resetReason: 'card gone / searching' };
      }
      if (snap.phase === 'focusing' || snap.phase === 'locking') {
        if (store.current.waitStartedAt == null) store.current.waitStartedAt = Date.now();
        startCapture(frame);
      }
      const phaseChanged = snap.phase !== lastPhase.current;
      lastPhase.current = snap.phase;
      const t = Date.now();
      const terminal = snap.phase === 'found' || snap.phase === 'ambiguous';
      if (phaseChanged || terminal || t - lastDebugAt.current >= DEBUG_MS) {
        setSnapshot(snap);
      }

      // Always refresh debug thumbs/URIs on terminal lock so Report does not
      // reuse a previous card's normalized preview.
      if (terminal && phaseChanged) {
        lastDebugAt.current = t;
        publishDebug(snap);
        return;
      }

      if (t - lastDebugAt.current < DEBUG_MS) return;
      lastDebugAt.current = t;
      publishDebug(snap);
    },
    [controller, helpers, publishDebug, startCapture],
  );

  const reset = useCallback(() => {
    controller.reset();
    store.current.cache = null;
    store.current.inFlight = false;
    store.current.lastAttempt = null;
    store.current.waitStartedAt = null;
    store.current.phase = 'idle';
    lastCaptureKey.current = '';
    helperState.current.analysis = null;
    helperState.current.detection = null;
    helperState.current.spaces = null;
    temporalMeta.current = { resetAt: Date.now(), resetReason: 'scan again' };
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

  const exportRecognitionInput = useCallback(async () => {
    const image = controller.lastNormalized();
    if (!image || image.width !== CARD_WIDTH || image.height !== CARD_HEIGHT) {
      return { ok: false as const, reason: 'no 744×1039 recognition input yet' };
    }
    const { shareDebugBundle } = await import('./saveDebugBundle');
    const result = await shareDebugBundle({
      images: { recognition: image },
      panel: {
        note: 'recognition-input-only export',
        recognitionSource: store.current.cache?.attempt.mode ?? null,
      },
    });
    return result.ok
      ? { ok: true as const, meta: { height: image.height, width: image.width }, uri: '' }
      : { ok: false as const, reason: result.reason };
  }, [controller]);

  const lastNormalized = useCallback((): ScanImage | null => {
    const image = controller.lastNormalized();
    if (!image || image.width !== CARD_WIDTH || image.height !== CARD_HEIGHT) return null;
    return image;
  }, [controller]);

  return {
    debug,
    describeLastArt: () => {
      const image = controller.lastNormalized();
      if (!image) return null;
      return describeArtwork(image);
    },
    exportRecognitionInput,
    focusNorm,
    indexes,
    lastNormalized,
    markTap,
    onAnalyzed: enabled ? onAnalyzed : undefined,
    preferredSources: RECOGNITION_SOURCES,
    reset,
    snapshot,
  };
};
