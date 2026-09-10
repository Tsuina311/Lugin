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
  planLabAcquire,
  type HiResCache,
  type HiResPhase,
  type HiResSourceStats,
  type HiResSpaces,
  type PreferredSource,
  type RecognitionSource,
} from './hiresCapture';
import { loadArtworkIndex, loadNameIndex, type ArtIndexLoad, type NameIndexLoad, type PrintingIndexLoad, type TypeIndexLoad } from './indexLoader';
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
  cloneScanImage,
  createSessionController,
  describeArtwork,
  type DetectResult,
  type FrameHelpers,
  type RecognizeDeps,
  type ScanImage,
  type ScannerPhase,
  type SessionSnapshot,
} from './sharedCore';
import { isBenchmarkToolsEnabled } from './benchmark/isBenchmarkEnabled';
import {
  getOcrAdapterSnapshot,
  getOrCreateLegacyOcrRecognizer,
  getOrCreateOcrRecognizer,
  startOcrWarmupIfEnabled,
} from './ocrAdapter';
import { saveRecognitionOcrDebug } from './saveOcrDebugAttempt';
import { saveLastLiveAttempt } from './scannerLab/lastLive';
import { createHiResCapturer, runPreferredCapture } from './useHiResCapture';
import { getPerfBaseline } from './perfBaseline';
import { setGeometryTraceContext } from './geometryTrace';
import type { LabQuadSet } from '@/lib/scan/scannerLab/types';
import { durationMs, monoNow } from '@/lib/scan/timing';

const DEBUG_MS = 1200;
/** Debug thumbs only — full-res PNG encode on device freezes the JS thread. */
const DEBUG_THUMB_MAX = 140;
/** Defer large PrintingIndex/TypeIndex until scanner is idle (or baseline allows). */
const INDEX_FORCE_FETCH_DELAY_MS = 12_000;

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
  lockGates: import('./sharedCore').LockGates | null;
  recognizeInvocations: number;
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
  /** Title/footer OCR transport waterfall (stage-local ms + bytes). */
  ocrPipeline: {
    schedule: string | null;
    titleBytes: number | null;
    titleCropW: number | null;
    titleCropH: number | null;
    titleEncodeMs: number | null;
    titleJsBridgeMs: number | null;
    titleMlkitMs: number | null;
    titleNativeMs: number | null;
    titleTransport: string | null;
    footerBytes: number | null;
    footerCropW: number | null;
    footerCropH: number | null;
    footerMlkitMs: number | null;
    footerNativeMs: number | null;
    footerTransport: string | null;
  } | null;
  ocrAdapter: {
    lastError: string | null;
    lastAttempt: string | null;
    nativeModuleAvailable: boolean;
    ready: boolean;
    textRecognizerCreated: boolean;
    transport: string;
    warmupState: string;
  } | null;
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
  lockGates: null,
  recognizeInvocations: 0,
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
  ocrPipeline: null,
  ocrAdapter: null,
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
    type: TypeIndexLoad | null;
  }>({ art: null, artError: null, names: null, printing: null, type: null });

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
  const labHoldRef = useRef(false);
  const lastGoodLab = useRef<{
    detector: ScanImage | null;
    detectorCorners: import('./sharedCore').CardCorners | null;
    orientation: string | null;
    quads: LabQuadSet;
    recognitionResult: string | null;
    source: ScanImage;
    spaces: HiResSpaces | null;
  } | null>(null);
  const previousDetectorCorners = useRef<import('./sharedCore').CardCorners | null>(null);
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
    lastGoodLab.current = null;
    labHoldRef.current = false;
    temporalMeta.current = {
      resetAt: Date.now(),
      resetReason: `source → ${preferredSource}`,
    };
  }, [preferredSource]);

  // Optional warmup — must not gate deps.ocr.
  useEffect(() => {
    if (!enabled) return;
    startOcrWarmupIfEnabled(getPerfBaseline().ocrWarmup);
  }, [enabled]);

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

    const typeFromActive = (
      next: NonNullable<ReturnType<typeof peekActiveScannerIndexes>>,
    ): TypeIndexLoad | null =>
      next.type && next.typeIndex
        ? {
            checksum: next.typeChecksum,
            coldMs: 0,
            data: next.type,
            generated: next.type.generated ?? null,
            index: next.typeIndex,
            oracles: next.type.oracles.length,
            signatures: Object.keys(next.type.signatures ?? {}).length,
            source: 'memory',
            subtypes: next.type.subtypes.length,
            version: next.type.version,
            warmMs: 0,
          }
        : null;

    void (async () => {
      // Local disk / bundled seed first — names+art only (skip ~30MB printing parse).
      const local = await loadScannerIndexesLocal({ includeHeavy: false });
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
          type: typeFromActive(local),
        });
      } else {
        // First install: names+art only; printing/type deferred.
        const [names, art] = await Promise.all([loadNameIndex(), loadArtworkIndex()]);
        if (cancelled) return;
        setIndexes({
          art,
          artError: art ? null : 'art index missing or rejected (fixture/too small?)',
          names,
          printing: null,
          type: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Heavy PrintingIndex/TypeIndex — never while scanner is active unless baseline allows.
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

    const typeFromActive = (
      next: NonNullable<ReturnType<typeof peekActiveScannerIndexes>>,
    ): TypeIndexLoad | null =>
      next.type && next.typeIndex
        ? {
            checksum: next.typeChecksum,
            coldMs: 0,
            data: next.type,
            generated: next.type.generated ?? null,
            index: next.typeIndex,
            oracles: next.type.oracles.length,
            signatures: Object.keys(next.type.signatures ?? {}).length,
            source: 'memory',
            subtypes: next.type.subtypes.length,
            version: next.type.version,
            warmMs: 0,
          }
        : null;

    void (async () => {
      // Pause heavy parse while live scanner is active (emergency baseline).
      if (enabled && !getPerfBaseline().heavyIndexesWhileScanning) return;

      await new Promise<void>(resolve => {
        setTimeout(resolve, enabled ? INDEX_FORCE_FETCH_DELAY_MS : 400);
      });
      if (cancelled) return;
      if (enabled && !getPerfBaseline().heavyIndexesWhileScanning) return;

      const heavy = await loadScannerIndexesLocal({ includeHeavy: true });
      if (cancelled) return;
      if (heavy?.nameIndex) {
        setIndexes(prev => ({
          ...prev,
          printing: printingFromActive(heavy) ?? prev.printing,
          type: typeFromActive(heavy) ?? prev.type,
          art: heavy.art
            ? {
                checksum: heavy.artChecksum,
                coldMs: 0,
                data: heavy.art,
                entries: heavy.art.entries.length,
                generated: heavy.artGenerated,
                matcher: heavy.artMatcher!,
                source: 'memory',
                text: heavy.text,
                uniqueOracles: heavy.artUniqueOracles,
                version: heavy.art.version,
                warmMs: 0,
              }
            : prev.art,
          artError: heavy.art ? null : prev.artError,
        }));
      }

      if (!peekActiveScannerIndexes()?.printingIndex || !peekActiveScannerIndexes()?.typeIndex) {
        await checkScannerDataUpdates({ force: true });
        if (cancelled) return;
        const next = peekActiveScannerIndexes();
        if (!next?.nameIndex) return;
        setIndexes(prev => ({
          ...prev,
          printing: printingFromActive(next) ?? prev.printing,
          type: typeFromActive(next) ?? prev.type,
          artError: next.art ? null : prev.artError,
        }));
      } else {
        void checkScannerDataUpdates({ force: false }).then(() => {
          if (cancelled) return;
          const next = peekActiveScannerIndexes();
          if (!next?.nameIndex) return;
          setIndexes(prev => ({
            ...prev,
            printing: printingFromActive(next) ?? prev.printing,
            type: typeFromActive(next) ?? prev.type,
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
              : prev.art,
          }));
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const earlyIdentityRef = useRef<((snap: SessionSnapshot) => void) | null>(null);
  const controllerRef = useRef<ReturnType<typeof createSessionController> | null>(null);
  const indexesRef = useRef(indexes);
  indexesRef.current = indexes;

  // Live deps via Proxy so index loads never recreate the session controller
  // (recreate wiped track/phase and made the polygon jump / disappear).
  const depsRef = useRef<RecognizeDeps>(null!);
  depsRef.current = {
    artwork: indexes.art?.matcher ?? null,
    artworkIndex: indexes.art?.data ?? null,
    nameIndex: indexes.names?.index ?? null,
    printingIndex: indexes.printing?.index ?? null,
    typeIndex: getPerfBaseline().typeOcr ? (indexes.type?.index ?? null) : null,
    ocr: getOrCreateOcrRecognizer(),
    resolveOcr: () => getOrCreateOcrRecognizer(),
    textIndex: indexes.art?.text ?? null,
    recognizeOptions: () => {
      const b = getPerfBaseline();
      return {
        skipArtwork: !b.artwork,
        skipFooter: !b.footerOcr,
        skipTypeLine: !b.typeOcr,
        wantTypeLine: false,
        runOcrDebugMatrix: isBenchmarkToolsEnabled(),
        legacyOcr: isBenchmarkToolsEnabled() ? getOrCreateLegacyOcrRecognizer() : null,
      };
    },
    onEarlyIdentity: () => {
      const snap = controllerRef.current?.snapshot();
      if (!snap) return;
      earlyIdentityRef.current?.(snap);
    },
  };

  const depsProxy = useMemo(
    () =>
      new Proxy({} as RecognizeDeps, {
        get(_target, prop) {
          if (prop === 'ocr' || prop === 'resolveOcr') {
            return prop === 'resolveOcr'
              ? () => getOrCreateOcrRecognizer()
              : getOrCreateOcrRecognizer();
          }
          return depsRef.current[prop as keyof RecognizeDeps];
        },
        has(_target, prop) {
          return prop === 'ocr' || prop === 'resolveOcr' || prop in depsRef.current;
        },
        ownKeys() {
          return [...new Set(['ocr', 'resolveOcr', ...Reflect.ownKeys(depsRef.current as object)])];
        },
        getOwnPropertyDescriptor(_target, prop) {
          if (prop === 'ocr') {
            return {
              configurable: true,
              enumerable: true,
              value: getOrCreateOcrRecognizer(),
            };
          }
          if (prop === 'resolveOcr') {
            return {
              configurable: true,
              enumerable: true,
              value: () => getOrCreateOcrRecognizer(),
            };
          }
          return Reflect.getOwnPropertyDescriptor(depsRef.current as object, prop);
        },
      }),
    [],
  );

  const controller = useMemo(() => createSessionController(depsProxy), [depsProxy]);
  controllerRef.current = controller;
  const helpers: FrameHelpers = useMemo(() => {
    const base = createFrameHelpers(helperState.current, cameraRef);
    return {
      ...base,
      invalidateCapture: (reason: string) => {
        base.invalidateCapture?.(reason);
        lastCaptureKey.current = '';
      },
      onRecognitionAttempt: info => {
        void saveRecognitionOcrDebug(info);
      },
      onCanonicalRecognition: info => {
        void saveLastLiveAttempt({
          published: info.published,
          recognitionQuad: info.recognitionQuad,
          rejectReason: info.rejectReason,
          result: info.result,
          source: info.source,
        });
      },
    };
  }, [cameraRef]);

  const lastEncodedKey = useRef<string | null>(null);

  const publishDebug = useCallback(
    (snap: SessionSnapshot, opts?: { encodeImages?: boolean }) => {
      const normalized = controller.lastNormalized();
      const cache = store.current.cache;
      const encode =
        opts?.encodeImages === true ||
        (getPerfBaseline().liveDebugImages &&
          (snap.phase === 'found' || snap.phase === 'ambiguous'));

      let normalizedUri: string | null | undefined;
      let hiresUri: string | null | undefined;
      if (snap.phase === 'searching') {
        lastEncodedKey.current = null;
        normalizedUri = null;
        hiresUri = null;
      } else if (
        encode &&
        normalized &&
        normalized.width === CARD_WIDTH &&
        normalized.height === CARD_HEIGHT
      ) {
        const key = `${snap.lockedAt ?? 0}:${normalized.width}x${normalized.height}`;
        if (key !== lastEncodedKey.current) {
          lastEncodedKey.current = key;
          try {
            normalizedUri = scanImageToPngDataUri(normalized, DEBUG_THUMB_MAX);
          } catch {
            normalizedUri = null;
          }
          if (cache?.source && cache.source !== normalized) {
            try {
              hiresUri = scanImageToPngDataUri(cache.source, DEBUG_THUMB_MAX);
            } catch {
              hiresUri = null;
            }
          } else {
            hiresUri = null;
          }
        }
        // else: leave undefined → keep previous thumbs for this lock
      }

      const timings = snap.recognition?.timings;
      const ocrOn = Boolean(getOrCreateOcrRecognizer());
      const adapter = getOcrAdapterSnapshot();
      const mode = cache?.attempt.mode ?? store.current.lastAttempt?.mode ?? null;
      const temporal = snap.temporal;
      const leader = temporal?.observations?.[temporal.observations.length - 1]?.topOracleId ?? null;
      const idx = indexesRef.current;
      setDebug(prev => ({
        art: idx.art,
        artCandidates: (snap.recognition?.visualTop ?? []).slice(0, 5).map(c => ({
          name: c.name,
          score: c.visualScore,
        })),
        artError: idx.artError,
        artGenerated: idx.art?.generated ?? null,
        artworkDescriptorMs: timings?.artworkDescriptorMs ?? null,
        artworkMatcherMs: timings?.artworkMatcherMs ?? null,
        artworkMs: timings?.artworkMs ?? null,
        captureMs: cache?.attempt.acquireMs ?? store.current.lastAttempt?.acquireMs ?? null,
        convertMs: cache?.attempt.convertMs ?? null,
        footerEvidence: ocrOn ? 'present' : 'unavailable',
        hiresPhase: store.current.phase,
        hiresStats: { ...store.current.stats },
        hiresUri: hiresUri === undefined ? prev.hiresUri : hiresUri,
        hiresWaitMs: HIRES_WAIT_MS,
        mappedCorners: cache?.mapped ?? null,
        names: idx.names,
        printing: idx.printing,
        normalizedUri: normalizedUri === undefined ? prev.normalizedUri : normalizedUri,
        phase: snap.phase,
        lockGates: snap.lockGates ?? null,
        recognizeInvocations: snap.recognizeInvocations ?? 0,
        qualityBest: snap.quality?.score ?? null,
        qualityPool: snap.lockGates?.poolSize ?? 0,
        recognitionSource: mode,
        sourceHeight: cache?.attempt.sourceSize?.height ?? null,
        sourceLabel: mode
          ? isTrueHiRes(mode)
            ? 'high-res'
            : 'analysis-fallback'
          : store.current.inFlight ||
              store.current.phase === 'requested' ||
              store.current.phase === 'capturing'
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
        ocrPipeline: {
          schedule: typeof timings?.ocrSchedule === 'string' ? timings.ocrSchedule : 'title-first',
          titleBytes: typeof timings?.titleBytes === 'number' ? timings.titleBytes : null,
          titleCropW: typeof timings?.titleCropW === 'number' ? timings.titleCropW : null,
          titleCropH: typeof timings?.titleCropH === 'number' ? timings.titleCropH : null,
          titleEncodeMs: typeof timings?.titleEncodeMs === 'number' ? timings.titleEncodeMs : null,
          titleJsBridgeMs:
            typeof timings?.titleJsBridgeMs === 'number' ? timings.titleJsBridgeMs : null,
          titleMlkitMs: typeof timings?.titleMlkitMs === 'number' ? timings.titleMlkitMs : null,
          titleNativeMs: typeof timings?.titleNativeMs === 'number' ? timings.titleNativeMs : null,
          titleTransport:
            typeof timings?.titleTransport === 'string' ? timings.titleTransport : null,
          footerBytes: typeof timings?.footerBytes === 'number' ? timings.footerBytes : null,
          footerCropW: typeof timings?.footerCropW === 'number' ? timings.footerCropW : null,
          footerCropH: typeof timings?.footerCropH === 'number' ? timings.footerCropH : null,
          footerMlkitMs: typeof timings?.footerMlkitMs === 'number' ? timings.footerMlkitMs : null,
          footerNativeMs:
            typeof timings?.footerNativeMs === 'number' ? timings.footerNativeMs : null,
          footerTransport:
            typeof timings?.footerTransport === 'string' ? timings.footerTransport : null,
        },
        ocrAdapter: {
          lastError: adapter.lastOcrAdapterError,
          lastAttempt: snap.postLock?.recognitionStatus ?? null,
          nativeModuleAvailable: adapter.nativeModuleAvailable,
          ready: adapter.textRecognizerCreated,
          textRecognizerCreated: adapter.textRecognizerCreated,
          transport: adapter.transport,
          warmupState: adapter.warmupState,
        },
      }));
    },
    [controller],
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
      const lock =
        frame.detection.trackedCorners ?? frame.detection.lockCorners ?? frame.detection.corners;
      const recognition = frame.detection.recognitionCorners ?? lock;
      if (!lock || !recognition) return;
      if (labHoldRef.current) return;
      if (store.current.inFlight) return;
      if (store.current.cache && isTrueHiRes(store.current.cache.attempt.mode)) return;
      const key = `${Math.round(recognition.topLeft.x)}:${Math.round(recognition.topLeft.y)}`;
      if (key === lastCaptureKey.current && store.current.cache) return;
      lastCaptureKey.current = key;
      store.current.inFlight = true;
      store.current.waitStartedAt = store.current.waitStartedAt ?? Date.now();
      store.current.phase = 'requested';
      void runPreferredCapture(
        preferredRef.current,
        capturer,
        {
          analysis: frame.image,
          corners: recognition,
          score: frame.detection.score,
          spaces: frame.spaces,
        },
        store.current,
        takeFrameRef.current,
      )
        .then(cache => {
          store.current.cache = cache;
          store.current.lastAttempt = cache.attempt;
          // Do not replace a locked Lab frame with a snapshot that finished after tap.
          if (!labHoldRef.current && isTrueHiRes(cache.attempt.mode)) {
            lastGoodLab.current = {
              detector: helperState.current.analysis,
              detectorCorners: cache.corners,
              orientation: null,
              quads: {
                raw: cache.mapped,
                recognition: cache.mapped,
                tracked: cache.mapped,
              },
              recognitionResult: controller.snapshot().fused?.card?.name ?? null,
              source: cache.source,
              spaces: helperState.current.spaces,
            };
          }
        })
        .catch(err => {
          lastCaptureKey.current = '';
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
          if (!store.current.cache) lastCaptureKey.current = '';
        });
    },
    [capturer],
  );

  // Controller may call allowRecognize before our phase-based kick; wire it.
  helperState.current.requestCapture = () => {
    const analysis = helperState.current.analysis;
    const detection = helperState.current.detection;
    const spaces = helperState.current.spaces;
    if (!analysis || !(detection?.lockCorners ?? detection?.trackedCorners ?? detection?.corners) || !spaces) return;
    startCapture({ detection, image: analysis, spaces });
  };

  const onAnalyzed = useCallback(
    async (frame: AnalyzedFrame) => {
      const nextCorners =
        frame.detection.recognitionCorners ??
        frame.detection.trackedCorners ??
        frame.detection.lockCorners ??
        frame.detection.corners;
      if (nextCorners) {
        previousDetectorCorners.current =
          helperState.current.detection?.recognitionCorners ??
          helperState.current.detection?.trackedCorners ??
          helperState.current.detection?.corners ??
          previousDetectorCorners.current;
      }
      helperState.current.analysis = frame.image;
      helperState.current.detection = frame.detection;
      helperState.current.spaces = frame.spaces;
      // Lab / series hold pauses live recognize + hi-res, not detector latch.
      if (labHoldRef.current) return;

      // Kick hi-res once we are focusing/locking so capture is not raced
      // by an immediate analysis-fallback recognize on the first lock frame.
      if (
        (lastPhase.current === 'focusing' || lastPhase.current === 'locking') &&
        (frame.detection.lockCorners ?? frame.detection.trackedCorners ?? frame.detection.corners)
      ) {
        if (store.current.waitStartedAt == null) store.current.waitStartedAt = Date.now();
        startCapture(frame);
      }

      const snap = await controller.onFrame(frame.image, helpers);
      const pl = snap.postLock;
      setGeometryTraceContext({
        consecutiveStable: snap.lockGates?.consecutiveStable ?? null,
        focusKind: snap.lockGates?.focusKind ?? null,
        focusReentries: snap.lockGates?.focusReentries ?? null,
        focusRequests: snap.lockGates?.focusRequests ?? null,
        focusSuccesses: snap.lockGates?.focusSuccesses ?? null,
        focusTimedOut: snap.lockGates?.focusTimedOut ?? null,
        focusTimeouts: snap.lockGates?.focusTimeouts ?? null,
        focusWaitMs: snap.lockGates?.focusWaitMs ?? null,
        highResFailure: pl?.highResFailure ?? snap.lockGates?.highResFailure ?? null,
        highResRequests: snap.lockGates?.highResRequests ?? null,
        highResSuccess: pl?.highResSuccess ?? snap.lockGates?.highResSuccess ?? null,
        lastHighResError: pl?.lastHighResError ?? null,
        lastHitAgeMs: snap.lockGates?.lastHitAgeMs ?? null,
        lockBlocker: snap.lockGates?.blocker ?? null,
        phase: snap.phase,
        phaseAfterRecognition: pl?.phaseAfterRecognition ?? null,
        postLockStall: pl?.postLockStall ?? snap.lockGates?.postLockStall ?? null,
        recognizeInvocations: snap.recognizeInvocations ?? null,
        recognitionStatus: pl?.recognitionStatus ?? snap.lockGates?.recognitionStatus ?? null,
        retryReason: pl?.retryReason ?? snap.lockGates?.retryReason ?? null,
        retryScheduledAt: pl?.retryScheduledAt ?? snap.lockGates?.retryScheduledAt ?? null,
        stableDurationMs: snap.lockGates?.stableDurationMs ?? null,
        titleRawText: pl?.titleRawText ?? null,
        titleTopCandidate: pl?.titleTopCandidate ?? null,
        trackHoldReason: pl?.trackHoldReason ?? frame.detection.debug.trackHoldReason ?? null,
        trackUpdateReason: pl?.trackUpdateReason ?? frame.detection.debug.trackUpdateReason ?? null,
        trackedQuadUpdatedAt: pl?.trackedQuadUpdatedAt ?? frame.detection.debug.trackedQuadUpdatedAt ?? null,
      });
      if (snap.phase === 'searching') {
        store.current.cache = null;
        store.current.lastAttempt = null;
        store.current.waitStartedAt = null;
        store.current.phase = 'idle';
        lastCaptureKey.current = '';
        temporalMeta.current = { resetAt: Date.now(), resetReason: 'card gone / searching' };
        // Keep lastGoodLab — Lab must reuse the locked frame if the track
        // drops while reaching for the button.
      }
      if (snap.phase === 'focusing' || snap.phase === 'locking') {
        if (store.current.waitStartedAt == null) store.current.waitStartedAt = Date.now();
        startCapture(frame);
      }
      const phaseChanged = snap.phase !== lastPhase.current;
      lastPhase.current = snap.phase;
      const t = Date.now();
      const terminal = snap.phase === 'found' || snap.phase === 'ambiguous';
      // Always publish the controller snapshot — lock-gate waiting text is live.
      setSnapshot(snap);

      // Phase changes (detected → locking → recognizing) must refresh lock gates.
      if (phaseChanged || (terminal && phaseChanged)) {
        lastDebugAt.current = t;
        publishDebug(snap, { encodeImages: terminal });
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
    lastGoodLab.current = null;
    labHoldRef.current = false;
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

  const forceSnapshot = useCallback(async (): Promise<{
    captureMs: number | null;
    height: number | null;
    ok: boolean;
    reason: string;
    width: number | null;
  }> => {
    const detection = helperState.current.detection;
    const spaces = helperState.current.spaces;
    const analysis = helperState.current.analysis;
    if (!detection?.corners || !spaces) {
      return { captureMs: null, height: null, ok: false, reason: 'no quad', width: null };
    }
    lastCaptureKey.current = '';
    startCapture({
      detection,
      image: analysis ?? {
        data: new Uint8ClampedArray(4),
        height: 1,
        width: 1,
      },
      spaces,
    });
    const t0 = Date.now();
    while (store.current.inFlight && Date.now() - t0 < 2500) {
      await new Promise(r => setTimeout(r, 40));
    }
    const attempt = store.current.lastAttempt;
    const ok = Boolean(store.current.cache);
    return {
      captureMs: attempt?.acquireMs ?? Date.now() - t0,
      height: attempt?.sourceSize?.height ?? null,
      ok,
      reason: ok
        ? `${attempt?.mode ?? 'snapshot'} ${attempt?.sourceSize?.width ?? '?'}×${attempt?.sourceSize?.height ?? '?'}`
        : (attempt?.reason ?? store.current.phase),
      width: attempt?.sourceSize?.width ?? null,
    };
  }, [startCapture]);

  const forceRecognize = useCallback(async (): Promise<SessionSnapshot> => {
    await forceSnapshot();
    await controller.forceRecognize(helpers);
    const snap = controller.snapshot();
    setSnapshot(snap);
    publishDebug(snap, { encodeImages: true });
    return snap;
  }, [controller, forceSnapshot, helpers, publishDebug]);

  const lastNormalized = useCallback((): ScanImage | null => {
    const image = controller.lastNormalized();
    if (!image || image.width !== CARD_WIDTH || image.height !== CARD_HEIGHT) return null;
    return image;
  }, [controller]);

  const rememberCacheForLab = (cache: HiResCache) => {
    if (!isTrueHiRes(cache.attempt.mode) || !cache.source) return;
    lastGoodLab.current = {
      detector: helperState.current.analysis,
      detectorCorners: cache.corners,
      orientation: null,
      quads: {
        raw: cache.mapped,
        recognition: cache.mapped,
        tracked: cache.mapped,
      },
      recognitionResult: controller.snapshot().fused?.card?.name ?? null,
      source: cache.source,
      spaces: helperState.current.spaces,
    };
  };

  const peekLabCapture = useCallback((): {
    detector: ScanImage | null;
    orientation: string | null;
    quads: LabQuadSet;
    recognitionResult: string | null;
    source: ScanImage;
  } | null => {
    const cache = store.current.cache;
    if (cache?.source && isTrueHiRes(cache.attempt.mode)) rememberCacheForLab(cache);
    return lastGoodLab.current;
  }, [controller]);

  const freezeLabCapture = useCallback((): {
    detector: ScanImage | null;
    orientation: string | null;
    quads: LabQuadSet;
    recognitionResult: string | null;
    source: ScanImage;
  } | null => {
    const cap = peekLabCapture();
    if (!cap) return null;
    return {
      detector: cap.detector ? cloneScanImage(cap.detector) : null,
      orientation: cap.orientation,
      quads: {
        raw: cap.quads.raw,
        recognition: cap.quads.recognition,
        tracked: cap.quads.tracked,
      },
      recognitionResult: cap.recognitionResult,
      source: cloneScanImage(cap.source),
    };
  }, [peekLabCapture]);

  const acquireLabCapture = useCallback(async () => {
    labHoldRef.current = true;
    const cache = store.current.cache;
    if (cache?.source && isTrueHiRes(cache.attempt.mode)) rememberCacheForLab(cache);
    if (!lastGoodLab.current && planLabAcquire(store.current) === 'wait-inflight') {
      const t0 = Date.now();
      while (store.current.inFlight && Date.now() - t0 < 2500) {
        await new Promise(r => setTimeout(r, 40));
      }
      if (store.current.cache) rememberCacheForLab(store.current.cache);
    }
    return freezeLabCapture();
  }, [freezeLabCapture]);

  const releaseLabHold = useCallback(() => {
    labHoldRef.current = false;
  }, []);

  const setLabHold = useCallback((held: boolean) => {
    labHoldRef.current = held;
  }, []);

  const peekSwapLive = useCallback(() => {
    const snap = controller.snapshot();
    const gates = snap.lockGates ?? null;
    const det = helperState.current.detection;
    const spaces = helperState.current.spaces;
    const rec = det?.recognitionCorners;
    const latch =
      spaces && rec && det.recognitionQuadValid !== false
        ? {
            detectorCorners: rec,
            spaces,
            trackId: det.debug.trackId ?? gates?.currentTrackId ?? null,
          }
        : null;
    return {
      gates,
      identity: snap.fused?.card?.name ?? snap.postLock?.titleTopCandidate ?? null,
      latch,
      recognitionDecision: snap.postLock?.recognitionStatus ?? null,
      recognitionStatus: snap.postLock?.recognitionStatus ?? snap.phase,
      recognizeAttempts: snap.postLock?.recognizeAttemptsForTrack ?? null,
    };
  }, [controller]);

  /** Best-effort live evidence for Deck Benchmark failure fixtures. */
  const peekDeckEvidence = useCallback(() => {
    const det = helperState.current.detection;
    const lab = lastGoodLab.current;
    return {
      detector: lab?.detector ?? null,
      presentedCorners: det?.corners ?? null,
      rawCorners: det?.rawCorners ?? null,
      recognitionCorners: det?.recognitionCorners ?? null,
      source: lab?.source ?? null,
      trackedCorners: det?.trackedCorners ?? det?.lockCorners ?? null,
    };
  }, []);

  const captureQualityPair = useCallback(
    async (focusPoint: { x: number; y: number } | null = null) => {
      const det =
        helperState.current.detection?.recognitionCorners ??
        helperState.current.detection?.trackedCorners ??
        helperState.current.detection?.lockCorners ??
        helperState.current.detection?.corners;
      const spaces = helperState.current.spaces;
      if (!det || !spaces) throw new Error('point at a card first — preview must still be up');
      labHoldRef.current = true;
      const gates = controller.snapshot().lockGates;
      const { runCaptureQualityPair: run } = await import('./captureQuality/runPair');
      try {
        return await run(
          {
            cameraRef,
            detectorCorners: det,
            focus: {
              currentTrackId: gates?.currentTrackId ?? null,
              focusAgeMs: gates?.focusAgeMs ?? null,
              focusAttemptId: gates?.focusAttemptId ?? null,
              focusPoint,
              focusRequested: (gates?.focusRequests ?? 0) > 0,
              focusRequestedAt: gates?.focusRequestedAt ?? null,
              focusResolvedAt: gates?.focusResolvedAt ?? null,
              focusSucceeded: (gates?.focusSuccesses ?? 0) > 0,
              focusTimedOut: Boolean(gates?.focusTimedOut),
              focusTimedOutAt: gates?.focusTimedOutAt ?? null,
              focusTrackId: gates?.focusTrackId ?? null,
              sameTrackFocus: Boolean(gates?.sameTrackFocus),
              timeSinceFocusRequestMs: gates?.focusWaitMs ?? null,
            },
            lockToCaptureStartMs: durationMs(gates?.lockCommittedAt, monoNow()),
            motion: null,
            nameIndex: indexesRef.current.names?.index ?? null,
            ocr: getOrCreateOcrRecognizer(),
            photoOutput,
            previousDetectorCorners: previousDetectorCorners.current,
            spaces,
          },
          '',
        );
      } finally {
        labHoldRef.current = false;
      }
    },
    [cameraRef, controller, photoOutput],
  );

  const captureFocusSeries = useCallback(async () => {
    const det =
      helperState.current.detection?.recognitionCorners ??
      helperState.current.detection?.trackedCorners ??
      helperState.current.detection?.lockCorners ??
      helperState.current.detection?.corners;
    const spaces = helperState.current.spaces;
    if (!det || !spaces) throw new Error('point at a card first — preview must still be up');
    const preview = helperState.current.preview;
    const c = det;
    const nx =
      (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) /
      (4 * Math.max(1, spaces.detector.width));
    const ny =
      (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) /
      (4 * Math.max(1, spaces.detector.height));
    labHoldRef.current = true;
    const gates = controller.snapshot().lockGates;
    controller.mintDebugFocusAttempt();
    const peekLatest = () => {
      const d = helperState.current.detection;
      const nextSpaces = helperState.current.spaces;
      const rec = d?.recognitionCorners;
      if (!nextSpaces || !rec || d.recognitionQuadValid === false) return null;
      return {
        detectorCorners: rec,
        quadTimestamp: d.debug.trackedQuadUpdatedAt ?? null,
        recognitionQuadSource: d.recognitionQuadSource ?? d.debug.recognitionQuadSource ?? null,
        recognitionQuadValid: d.recognitionQuadValid ?? d.debug.recognitionQuadValid ?? true,
        spaces: nextSpaces,
        trackId: d.debug.trackId ?? gates?.currentTrackId ?? null,
      };
    };
    const { runFocusSeries } = await import('./focusSeries/runSeries');
    try {
      return await runFocusSeries(
        {
          cameraRef,
          currentTrackId: gates?.currentTrackId ?? helperState.current.detection?.debug?.trackId ?? null,
          focusAttemptId: controller.snapshot().lockGates?.focusAttemptId ?? gates?.focusAttemptId ?? null,
          focusNorm: { x: nx, y: ny },
          focusTrackId: gates?.focusTrackId ?? null,
          nameIndex: indexesRef.current.names?.index ?? null,
          ocr: getOrCreateOcrRecognizer(),
          peekLatest,
          preview,
        },
        '',
      );
    } finally {
      labHoldRef.current = false;
    }
  }, [cameraRef, controller]);

  const persistFocusSeries = useCallback(
    async (run: import('./focusSeries/runSeries').FocusSeriesRun, label: string) => {
      const { tagsFromLabel } = await import('./captureQuality/runPair');
      const { saveFocusSeriesRun } = await import('./focusSeries/persist');
      const { enqueueFocusSeries } = await import('./debugInbox/enqueueFocusSeries');
      const named = { ...run, label: label.trim() || run.label, tags: tagsFromLabel(label) };
      const saved = await saveFocusSeriesRun(named);
      await enqueueFocusSeries({ dirUri: saved.dirUri, fixtureId: named.fixtureId });
      return named;
    },
    [],
  );

  const persistCaptureQualityPair = useCallback(
    async (run: import('./captureQuality/runPair').CaptureQualityRun, label: string) => {
      const { tagsFromLabel } = await import('./captureQuality/runPair');
      const { saveCaptureQualityRun } = await import('./captureQuality/persist');
      const { enqueueCaptureQuality } = await import('./debugInbox/enqueueCaptureQuality');
      const named = { ...run, label: label.trim() || run.label, tags: tagsFromLabel(label) };
      const saved = await saveCaptureQualityRun(named);
      await enqueueCaptureQuality({ dirUri: saved.dirUri, fixtureId: named.fixtureId });
      return named;
    },
    [],
  );

  return {
    debug,
    describeLastArt: () => {
      const image = controller.lastNormalized();
      if (!image) return null;
      return describeArtwork(image);
    },
    exportRecognitionInput,
    forceLock: forceRecognize,
    forceRecognize,
    forceSnapshot,
    focusNorm,
    indexes,
    lastNormalized,
    acquireLabCapture,
    freezeLabCapture,
    peekLabCapture,
    releaseLabHold,
    captureQualityPair,
    persistCaptureQualityPair,
    captureFocusSeries,
    persistFocusSeries,
    peekSwapLive,
    peekDeckEvidence,
    setLabHold,
    markDebugCardSwapped: () => {
      controller.markDebugCardSwapped();
      setSnapshot(controller.snapshot());
    },
    markTap,
    onAnalyzed: enabled ? onAnalyzed : undefined,
    preferredSources: RECOGNITION_SOURCES,
    reset,
    snapshot,
  };
};
