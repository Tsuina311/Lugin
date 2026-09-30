// SessionController on the live native path.
//
// Acquisition stays in useFrameAnalysis. This hook owns phases, tracking,
// focus, quality pool, and recognition — all via the portable controller.
// High-res capture starts as soon as we enter focusing/locking and recognition
// waits a bounded interval before labeled analysis-fallback.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraPhotoOutput, CameraRef } from 'react-native-vision-camera';

import { evaluateMtgFastAccept, perspectiveAspect } from '@/lib/scan/detection/mtgFastPath';
import { quadArea } from '@/lib/scan/recognitionQuad';
import { scanImageToPngDataUri, scanImageToThumbnailPngDataUri } from './debug/scanImagePng';
import { isBenchmarkToolsEnabled } from './benchmark/isBenchmarkEnabled';
import {
  HIRES_WAIT_MS,
  RECOGNITION_SOURCES,
  emptyHiResStore,
  invalidateHiResCache,
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
  recognizeCapturedCard,
  sharpnessScore,
  type DetectResult,
  type FrameHelpers,
  type RecognizeDeps,
  type ScanImage,
  type ScannerPhase,
  type ScryfallPrinting,
  type SessionSnapshot,
} from './sharedCore';
import { getScannerMode, suspendsNormalRecognition } from './scannerMode';
import {
  getOcrAdapterSnapshot,
  getOrCreateLegacyOcrRecognizer,
  getOrCreateOcrRecognizer,
  startOcrWarmupIfEnabled,
} from './ocrAdapter';
import { saveRecognitionOcrDebug } from './saveOcrDebugAttempt';
import { saveLastLiveAttempt } from './scannerLab/lastLive';
import { createHiResCapturer, runPreferredCapture } from './useHiResCapture';
import { isGeometryV2Pipeline } from '@/lib/scan/singleCardCapture';
import {
  createRecognitionAttempt,
  emptyVerifiedScanTiming,
  finalizeAttempt,
  markAttemptAdvancedEarly,
  markAttemptAwaitingPaint,
  markAttemptRecognizing,
  markAttemptRecognitionStarted,
  markFirstVerified,
  matchAttemptByArtifacts,
  mayPublishAttemptToUi,
  assessWarpSuspect,
  validateWarpInput,
  classifyGeometryFailure,
  freezeCorners,
  msDelta,
  MAPPING_VERSION,
  WARP_VERSION,
  CAPTURE_PIPELINE_VERSION,
  type FrozenCaptureProvenance,
  type RecognitionAttempt,
  type VerifiedScanPhase,
  type VerifiedScanTiming,
} from '@/lib/scan/verifiedScan';
import { getPerfBaseline } from './perfBaseline';
import {
  channelIsNewVisual,
  channelToRecognizeOptions,
  channelUsesTitleFastPath,
  getRecognitionChannel,
} from '@/lib/scan/recognitionChannel';
import { fuseContinuousEvidence } from '@/lib/scan/continuous';
import { extractArtCropFromCard } from '@/lib/scan/regions';
import {
  initializeVisualRecognizer,
  recognizeArtCropRgba,
  getVisualRecognizerState,
} from './visualRecognizer';
import { getSingleScanWorkflow } from './singleScanWorkflow';
import { setGeometryTraceContext } from './geometryTrace';
import type { LabQuadSet } from '@/lib/scan/scannerLab/types';
import { durationMs, monoNow } from '@/lib/scan/timing';
import {
  createNormalScanParentSession,
  nextNormalScanChildId,
  printingRef,
  recordAttemptCreated,
  recordAttemptTerminal,
  recordRetake,
  telemetryFromAttempt,
  type NormalScanParentSession,
} from './verifiedScan/diagnostics';
import {
  enqueueNormalScanDiagnostic,
  finalizeNormalScanDiagnostic,
} from './verifiedScan/enqueue';
import {
  applyCapturedToAttempt,
  applyRecognizeResultToAttempt,
  ocrEvidenceFromCaptured,
} from './verifiedScan/lifecycle';
import * as attemptRegistry from './verifiedScan/registry';
import { getScanBackgroundQueue } from '@/lib/scan/backgroundQueue';
import { recognizeCard } from './sharedCore';

/** Verified result UI max width — readable on phone, not a debug thumb. */
/** Display-only preview width — keep lean so encode doesn't block first paint. */
const VERIFIED_WARP_MAX = 280;

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

  /** Verified Scan — one card at a time; NEXT is the session boundary. */
  const [verifiedPhase, setVerifiedPhase] = useState<VerifiedScanPhase>('ready');
  const [verifiedWarpUri, setVerifiedWarpUri] = useState<string | null>(null);
  const [verifiedSelectedPrinting, setVerifiedSelectedPrinting] =
    useState<ScryfallPrinting | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [autoUploadDiagnostics, setAutoUploadDiagnostics] = useState(true);
  const verifiedTiming = useRef<VerifiedScanTiming>(emptyVerifiedScanTiming());
  const verifiedHoldActive = useRef(false);
  const parentSessionRef = useRef<NormalScanParentSession | null>(null);
  const proposedCardRef = useRef<string | null>(null);
  const proposedPrintingRef = useRef<ReturnType<typeof printingRef>>(null);
  const nextPressedAtRef = useRef<number | null>(null);
  /** Diagnostic attempt ids — independent of controller attemptIdSeq, always >= 1. */
  const verifiedAttemptIdSeq = useRef(0);
  const activeAttemptIdRef = useRef<number | null>(null);
  const paintArmedForAttemptRef = useRef<number | null>(null);
  /** Frozen at capture request — never replaced by live detector after snapshot starts. */
  const pendingCaptureMetaRef = useRef<{
    analysisQuad: import('./sharedCore').CardCorners;
    analysisDimensions: { width: number; height: number };
    quadSelectionSource: import('@/lib/scan/verifiedScan').QuadSelectionSource;
    quadSelectionScore: number | null;
    selectedQuadAt: number;
  } | null>(null);

  const store = useRef(emptyHiResStore());
  const controllerRef = useRef<ReturnType<typeof createSessionController> | null>(null);
  const captureIdSeq = useRef(0);
  const helperState = useRef(
    createNativeHelperState(
      store.current,
      () => controllerRef.current?.snapshot().lockGates?.cardSessionId ?? null,
    ),
  );
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
      const channel = getRecognitionChannel();
      const channelOpts = channelToRecognizeOptions(channel);
      return {
        // Channel mode wins for skipArtwork / skipFooter / skipOcr.
        skipArtwork: channelOpts.skipArtwork ?? !b.artwork,
        skipFooter: channelOpts.skipFooter ?? !b.footerOcr,
        skipOcr: channelOpts.skipOcr,
        skipTypeLine: channelOpts.skipTypeLine ?? !b.typeOcr,
        wantFooter: channelOpts.wantFooter,
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
        // Pin OCR evidence onto the attempt that owned these pixels — survives NEXT.
        // Match by pinned artifacts only. Never use active UI cardSessionId (that is B after NEXT).
        const match = matchAttemptByArtifacts(attemptRegistry.listPendingAttempts(), {
          source: info.source,
          warp: info.result.warp,
        });
        const attemptId =
          match?.attemptId ??
          (activeAttemptIdRef.current != null &&
          attemptRegistry.getAttempt(activeAttemptIdRef.current)?.terminalStatus == null
            ? activeAttemptIdRef.current
            : null);
        if (attemptId == null) return;
        // Printing from controller snap is only trustworthy when this attempt still owns the UI.
        const snap = controllerRef.current?.snapshot() ?? null;
        const activeSession = snap?.lockGates?.cardSessionId ?? null;
        const attemptForPublish = attemptRegistry.getAttempt(attemptId);
        const mayPublish =
          attemptForPublish != null &&
          mayPublishAttemptToUi(attemptForPublish, activeSession) &&
          info.published;
        const phase =
          mayPublish && (snap?.phase === 'found' || snap?.phase === 'ambiguous')
            ? snap.phase
            : null;
        const printing = mayPublish ? snap?.fused?.printing ?? null : null;
        const updated = attemptRegistry.updateAttempt(attemptId, a =>
          applyCapturedToAttempt(a, info.result, {
            phase,
            printing: printing
              ? {
                  setCode: printing.setCode,
                  collectorNumber: printing.collectorNumber,
                  lang: printing.lang,
                }
              : null,
          }),
        );
        if (!updated || updated.terminalStatus == null) return;
        const parent = parentSessionRef.current;
        if (parent) recordAttemptTerminal(parent, updated);
        // Finalize via bounded encode queue — never pile concurrent PNG work on Skip.
        getScanBackgroundQueue().enqueue({
          id: `encode-${attemptId}-final`,
          kind: 'encode',
          priority: 3,
          attemptId,
          enqueuedAt: monoNow(),
          run: async () => {
            const latest = attemptRegistry.getAttempt(attemptId) ?? updated;
            await finalizeNormalScanDiagnostic({
              source: latest.artifacts.source,
              warp: latest.artifacts.warp,
              titleCrop: latest.artifacts.titleCrop,
              recognitionQuad: latest.artifacts.recognitionQuad,
              provenance: latest.provenance,
              telemetry: telemetryFromAttempt(latest),
              parentSummary: parentSessionRef.current?.summary ?? null,
            });
            attemptRegistry.releaseAttempt(attemptId);
          },
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

  const ensureParentSession = useCallback(() => {
    if (!parentSessionRef.current) {
      parentSessionRef.current = createNormalScanParentSession();
    }
    return parentSessionRef.current;
  }, []);

  const syncVerifiedPhaseFromSnap = useCallback((snap: SessionSnapshot) => {
    if (!verifiedHoldActive.current) return;
    const now = monoNow();
    if (snap.phase === 'recognizing') {
      verifiedTiming.current = markFirstVerified(verifiedTiming.current, 'recognitionStartAt', now);
      setVerifiedPhase(prev => (prev === 'result' || prev === 'failed' ? prev : 'identifying'));
      return;
    }
    if (snap.phase === 'found' || snap.phase === 'ambiguous') {
      verifiedTiming.current = markFirstVerified(
        markFirstVerified(verifiedTiming.current, 'identityAt', now),
        'resultShownAt',
        now,
      );
      if (snap.fused?.printing && snap.printingShownAt != null) {
        verifiedTiming.current = markFirstVerified(
          verifiedTiming.current,
          'printingResolvedAt',
          now,
        );
      }
      const name = snap.fused?.card?.name ?? null;
      if (name && proposedCardRef.current == null) {
        proposedCardRef.current = name;
        proposedPrintingRef.current = printingRef(snap.fused?.printing ?? null);
      }
      const failed =
        snap.phase === 'ambiguous' &&
        (!snap.fused ||
          snap.fused.status === 'insufficient-confidence' ||
          Boolean(snap.message?.includes("Couldn't identify")));
      setVerifiedPhase(failed ? 'failed' : 'result');
    }
  }, []);

  const enterVerifiedCaptured = useCallback(
    (cache: HiResCache) => {
      if (!isGeometryV2Pipeline()) return;
      if (getScannerMode() !== 'normal') return;
      if (!isTrueHiRes(cache.attempt.mode) || !cache.prepared?.image || !cache.source) return;
      if (cache.captureId == null || cache.cardSessionId == null) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          throw new Error(
            `verified capture missing ownership captureId=${cache.captureId} cardSessionId=${cache.cardSessionId}`,
          );
        }
        return;
      }
      const parent = ensureParentSession();
      const childId = nextNormalScanChildId(parent);
      const attemptId = (verifiedAttemptIdSeq.current += 1);
      const now = monoNow();
      const warpMs = cache.attempt.warpMs ?? 0;
      // Honest stage stamps: warp finished at resolve; capture/convert before warp.
      verifiedTiming.current = markFirstVerified(
        markFirstVerified(
          markFirstVerified(
            markFirstVerified(verifiedTiming.current, 'warpDoneAt', now),
            'captureDoneAt',
            now - Math.max(0, warpMs),
          ),
          'warpStartedAt',
          now - Math.max(0, warpMs),
        ),
        'cardSessionStartedAt',
        verifiedTiming.current.cardSessionStartedAt ?? now,
      );
      if (verifiedTiming.current.lockAt != null) {
        verifiedTiming.current = markFirstVerified(
          verifiedTiming.current,
          'captureLockedAt',
          verifiedTiming.current.lockAt,
        );
      }
      if (nextPressedAtRef.current != null) {
        verifiedTiming.current = markFirstVerified(
          verifiedTiming.current,
          'nextFirstQuadAt',
          verifiedTiming.current.nextFirstQuadAt ?? now,
        );
      }

      const analysisQuad = freezeCorners(
        pendingCaptureMetaRef.current?.analysisQuad ?? cache.corners,
      );
      const projectedSourceQuad = freezeCorners(cache.mapped);
      const warpInput = validateWarpInput({
        quad: projectedSourceQuad,
        source: { width: cache.source.width, height: cache.source.height },
      });
      const warpSuspect = assessWarpSuspect({
        warp: cache.prepared.image,
        sourceQuad: projectedSourceQuad,
        source: { width: cache.source.width, height: cache.source.height },
      });
      const meta = pendingCaptureMetaRef.current;
      pendingCaptureMetaRef.current = null;
      const selectedQuadAt =
        meta?.selectedQuadAt ??
        verifiedTiming.current.captureLockedAt ??
        verifiedTiming.current.lockAt ??
        now - Math.max(0, warpMs);
      const captureRequestedAt = verifiedTiming.current.captureRequestedAt;
      const captureDoneAt = verifiedTiming.current.captureDoneAt ?? now - Math.max(0, warpMs);
      const analysisDims =
        meta?.analysisDimensions ??
        (helperState.current.analysis
          ? {
              width: helperState.current.analysis.width,
              height: helperState.current.analysis.height,
            }
          : null);
      const analysisMinMarginNorm = (() => {
        if (!analysisQuad || !analysisDims) return null;
        const pts = [
          analysisQuad.topLeft,
          analysisQuad.topRight,
          analysisQuad.bottomRight,
          analysisQuad.bottomLeft,
        ];
        let m = Infinity;
        for (const p of pts) {
          m = Math.min(
            m,
            p.x / analysisDims.width,
            p.y / analysisDims.height,
            (analysisDims.width - p.x) / analysisDims.width,
            (analysisDims.height - p.y) / analysisDims.height,
          );
        }
        return Number.isFinite(m) ? m : null;
      })();
      const sourceMinMarginPx = (() => {
        const pts = [
          projectedSourceQuad.topLeft,
          projectedSourceQuad.topRight,
          projectedSourceQuad.bottomRight,
          projectedSourceQuad.bottomLeft,
        ];
        let m = Infinity;
        for (const p of pts) {
          m = Math.min(
            m,
            p.x,
            p.y,
            cache.source.width - p.x,
            cache.source.height - p.y,
          );
        }
        return Number.isFinite(m) ? m : null;
      })();
      const provenance: FrozenCaptureProvenance = {
        attemptId,
        cardSessionId: cache.cardSessionId,
        captureId: cache.captureId,
        analysisDimensions: analysisDims,
        sourceDimensions: { width: cache.source.width, height: cache.source.height },
        analysisQuad,
        projectedSourceQuad,
        mappingKind: 'same-fov',
        mappingVersion: MAPPING_VERSION,
        warpVersion: WARP_VERSION,
        capturePipelineVersion: CAPTURE_PIPELINE_VERSION,
        orientation: null,
        rotation: null,
        mirror: false,
        quadSelectionSource: meta?.quadSelectionSource ?? 'OTHER',
        candidateScore: meta?.quadSelectionScore ?? cache.prepared.score ?? null,
        captureSafe: true,
        selectedQuadAt,
        captureRequestedAt,
        captureDoneAt,
        sourceAvailableAt: captureDoneAt,
        warpStartedAt: verifiedTiming.current.warpStartedAt,
        warpDoneAt: verifiedTiming.current.warpDoneAt ?? now,
        quadAgeAtCaptureMs: msDelta(selectedQuadAt, captureRequestedAt),
        captureLatencyMs: msDelta(captureRequestedAt, captureDoneAt),
        sourceVsQuadAgeMs: msDelta(selectedQuadAt, captureDoneAt),
        warpInputStatus: warpInput.status,
        warpSuspectStatus: warpSuspect.status,
        warpSuspectReasons: warpSuspect.reasons,
        geometryFailureClass: classifyGeometryFailure({
          warpInput: warpInput.status,
          warpSuspect: warpSuspect.status,
          analysisMinMarginNorm,
          sourceMinMarginPx,
          sourceVsQuadAgeMs: msDelta(selectedQuadAt, captureDoneAt),
        }),
        analysisMinMarginNorm,
        sourceMinMarginPx,
      };

      const attempt = createRecognitionAttempt({
        attemptId,
        cardSessionId: cache.cardSessionId,
        captureId: cache.captureId,
        childId,
        parentSessionId: parent.id,
        source: cache.source,
        warp: cache.prepared.image,
        recognitionQuad: projectedSourceQuad,
        analysisQuad,
        provenance,
        timing: { ...verifiedTiming.current },
        // Observe-only quality telemetry — not a hard gate.
        sharpness: sharpnessScore(cache.prepared.image),
      });
      attemptRegistry.putAttempt(attempt);
      recordAttemptCreated(parent, attemptId);
      activeAttemptIdRef.current = attemptId;
      paintArmedForAttemptRef.current = null;

      verifiedHoldActive.current = true;
      controller.setVerifiedRecognizeReady(false);
      controller.setVerifiedHold(true);
      setVerifiedWarpUri(null);
      setVerifiedPhase(prev =>
        prev === 'result' || prev === 'failed' ? prev : 'captured',
      );
      setVerifiedSelectedPrinting(null);
      proposedCardRef.current = null;
      proposedPrintingRef.current = null;

      const card = cache.prepared.image;
      // Paint handshake: commit preview state, then double-rAF before OCR (no 400ms sleep).
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (activeAttemptIdRef.current !== attemptId) return;
          const encStart = monoNow();
          verifiedTiming.current = markFirstVerified(
            verifiedTiming.current,
            'previewEncodeStartAt',
            encStart,
          );
          attemptRegistry.updateAttempt(attemptId, a => ({
            ...a,
            timing: markFirstVerified(a.timing, 'previewEncodeStartAt', encStart),
          }));
          try {
            const uri = scanImageToThumbnailPngDataUri(card, VERIFIED_WARP_MAX);
            const encDone = monoNow();
            verifiedTiming.current = markFirstVerified(
              markFirstVerified(verifiedTiming.current, 'previewEncodeDoneAt', encDone),
              'previewStateCommittedAt',
              encDone,
            );
            attemptRegistry.updateAttempt(attemptId, a =>
              markAttemptAwaitingPaint(
                {
                  ...a,
                  timing: markFirstVerified(a.timing, 'previewEncodeDoneAt', encDone),
                },
                encDone,
              ),
            );
            setVerifiedWarpUri(uri);
            // Double-rAF ≈ one committed paint after setState.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (activeAttemptIdRef.current !== attemptId) return;
                if (paintArmedForAttemptRef.current === attemptId) return;
                paintArmedForAttemptRef.current = attemptId;
                const paintAt = monoNow();
                verifiedTiming.current = markFirstVerified(
                  markFirstVerified(
                    markFirstVerified(
                      verifiedTiming.current,
                      'previewPaintBarrierPassedAt',
                      paintAt,
                    ),
                    'previewPaintConfirmedAt',
                    paintAt,
                  ),
                  'previewDisplayedAt',
                  paintAt,
                );
                attemptRegistry.updateAttempt(attemptId, a =>
                  markAttemptRecognizing(
                    {
                      ...a,
                      timing: markFirstVerified(
                        markFirstVerified(
                          markFirstVerified(a.timing, 'previewPaintBarrierPassedAt', paintAt),
                          'previewPaintConfirmedAt',
                          paintAt,
                        ),
                        'previewDisplayedAt',
                        paintAt,
                      ),
                    },
                    paintAt,
                  ),
                );
                if (verifiedHoldActive.current) {
                  const recogAt = monoNow();
                  attemptRegistry.updateAttempt(attemptId, a =>
                    markAttemptRecognitionStarted(a, recogAt),
                  );
                  verifiedTiming.current = markFirstVerified(
                    verifiedTiming.current,
                    'recognitionStartAt',
                    recogAt,
                  );
                  controller.setVerifiedRecognizeReady(true);
                }
              });
            });
          } catch {
            setVerifiedWarpUri(null);
            paintArmedForAttemptRef.current = attemptId;
            controller.setVerifiedRecognizeReady(true);
          }
          // Bounded fallback only if rAF/onLoad path never armed (~250ms).
          setTimeout(() => {
            if (activeAttemptIdRef.current !== attemptId) return;
            if (paintArmedForAttemptRef.current === attemptId) return;
            paintArmedForAttemptRef.current = attemptId;
            const paintAt = monoNow();
            verifiedTiming.current = markFirstVerified(
              markFirstVerified(
                markFirstVerified(
                  verifiedTiming.current,
                  'previewPaintBarrierPassedAt',
                  paintAt,
                ),
                'previewPaintConfirmedAt',
                paintAt,
              ),
              'previewDisplayedAt',
              paintAt,
            );
            attemptRegistry.updateAttempt(attemptId, a => markAttemptRecognizing(a, paintAt));
            if (verifiedHoldActive.current) {
              const recogAt = monoNow();
              attemptRegistry.updateAttempt(attemptId, a =>
                markAttemptRecognitionStarted(a, recogAt),
              );
              verifiedTiming.current = markFirstVerified(
                verifiedTiming.current,
                'recognitionStartAt',
                recogAt,
              );
              controller.setVerifiedRecognizeReady(true);
            }
          }, 250);
        }, 0);
      });
    },
    [controller, ensureParentSession],
  );

  const armVerifiedRecognize = useCallback(() => {
    // Image.onLoad is telemetry only — rAF handshake arms recognition.
    if (!verifiedHoldActive.current) return;
    const attemptId = activeAttemptIdRef.current;
    if (attemptId == null) return;
    const at = monoNow();
    verifiedTiming.current = markFirstVerified(verifiedTiming.current, 'previewDisplayedAt', at);
    attemptRegistry.updateAttempt(attemptId, a => ({
      ...a,
      timing: markFirstVerified(a.timing, 'previewDisplayedAt', at),
    }));
  }, []);

  // Publish provisional found/ambiguous as soon as title (or strong art) wins the race.
  earlyIdentityRef.current = snap => {
    lastPhase.current = snap.phase;
    setSnapshot(snap);
    lastDebugAt.current = Date.now();
    publishDebug(snap);
    if (verifiedHoldActive.current && isGeometryV2Pipeline()) {
      syncVerifiedPhaseFromSnap(snap);
    }
  };

  const startCapture = useCallback(
    (frame: AnalyzedFrame) => {
      // Continuous owns identity — do not run Verified capture / NEXT panel.
      if (getSingleScanWorkflow() === 'continuous') return;
      const snap = controllerRef.current?.snapshot();
      const scc = isGeometryV2Pipeline() ? snap?.singleCardCapture ?? null : null;
      const v2Frozen =
        scc?.frozenQuad ?? null;
      const lock =
        v2Frozen ??
        (isGeometryV2Pipeline() ? snap?.corners : null) ??
        frame.detection.trackedCorners ??
        frame.detection.lockCorners ??
        frame.detection.corners;
      const recognition =
        v2Frozen ??
        (isGeometryV2Pipeline() ? snap?.corners : null) ??
        frame.detection.recognitionCorners ??
        lock;
      if (!lock || !recognition) return;
      if (labHoldRef.current) return;
      if (suspendsNormalRecognition(getScannerMode())) return;
      if (store.current.inFlight) return;
      // geometry-v2: only capture after short confirmation lock (not on focusing).
      if (isGeometryV2Pipeline()) {
        const phase = snap?.phase;
        if (phase !== 'locking' && phase !== 'recognizing') return;
      }
      const sessionId = snap?.lockGates?.cardSessionId ?? null;
      const existing = store.current.cache;
      if (existing && isTrueHiRes(existing.attempt.mode)) {
        if (sessionId != null && existing.cardSessionId === sessionId) return;
        // Prior-session / untagged cache must not block a fresh capture.
        invalidateHiResCache(store.current, 'stale-capture-before-request');
        lastCaptureKey.current = '';
      }
      // Freeze the selected analysis quad BEFORE snapshot — never re-read live detector.
      const frozenAnalysisQuad = freezeCorners(recognition);
      const key = `${Math.round(frozenAnalysisQuad.topLeft.x)}:${Math.round(frozenAnalysisQuad.topLeft.y)}:s${sessionId ?? 'x'}`;
      if (key === lastCaptureKey.current && store.current.cache?.cardSessionId === sessionId) {
        return;
      }
      lastCaptureKey.current = key;
      const captureId = (captureIdSeq.current += 1);
      const requestSessionId = sessionId ?? 0;
      store.current.inFlight = true;
      store.current.waitStartedAt = store.current.waitStartedAt ?? Date.now();
      store.current.phase = 'requested';
      const lockAt = monoNow();
      pendingCaptureMetaRef.current = {
        analysisQuad: frozenAnalysisQuad,
        quadSelectionSource:
          (scc?.quadSelectionSource as import('@/lib/scan/verifiedScan').QuadSelectionSource | null) ??
          (v2Frozen ? 'BEST_RECENT_SAFE' : 'RAW_SELECTED'),
        quadSelectionScore: scc?.quadSelectionScore ?? null,
        selectedQuadAt: scc?.captureLockedAt ?? lockAt,
        analysisDimensions: {
          width: frame.image.width,
          height: frame.image.height,
        },
      };
      // Geometry-style feedback: show CAPTURE while snapshot+warp run (~0.6–0.9s).
      if (isGeometryV2Pipeline() && getScannerMode() === 'normal') {
        verifiedTiming.current = markFirstVerified(
          markFirstVerified(
            markFirstVerified(verifiedTiming.current, 'captureLockedAt', lockAt),
            'lockAt',
            lockAt,
          ),
          'captureRequestedAt',
          lockAt,
        );
        setVerifiedPhase(prev =>
          prev === 'result' || prev === 'failed' || prev === 'captured' || prev === 'identifying'
            ? prev
            : 'acquiring',
        );
      }
      void runPreferredCapture(
        preferredRef.current,
        capturer,
        {
          analysis: frame.image,
          cardSessionId: requestSessionId,
          captureId,
          corners: frozenAnalysisQuad,
          score: frame.detection.score,
          spaces: frame.spaces,
        },
        store.current,
        takeFrameRef.current,
      )
        .then(next => {
          const current = controllerRef.current?.snapshot().lockGates?.cardSessionId ?? null;
          // Late resolve from a previous session must not overwrite current-session pixels.
          if (
            current != null &&
            next.cardSessionId != null &&
            next.cardSessionId !== current
          ) {
            return;
          }
          store.current.cache = next;
          store.current.lastAttempt = next.attempt;
          // Do not replace a locked Lab frame with a snapshot that finished after tap.
          if (!labHoldRef.current && isTrueHiRes(next.attempt.mode)) {
            lastGoodLab.current = {
              detector: helperState.current.analysis,
              detectorCorners: next.corners,
              orientation: null,
              quads: {
                raw: next.mapped,
                recognition: next.mapped,
                tracked: next.mapped,
              },
              recognitionResult: controller.snapshot().fused?.card?.name ?? null,
              source: next.source,
              spaces: helperState.current.spaces,
            };
            // Verified Scan: freeze UI on warp immediately (before OCR).
            if (isGeometryV2Pipeline() && getScannerMode() === 'normal') {
              enterVerifiedCaptured(next);
            }
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
          if (isGeometryV2Pipeline() && getScannerMode() === 'normal') {
            setVerifiedPhase(prev => (prev === 'acquiring' ? 'ready' : prev));
          }
        })
        .finally(() => {
          store.current.inFlight = false;
          if (!store.current.cache) lastCaptureKey.current = '';
        });
    },
    [capturer, controller, enterVerifiedCaptured],
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
      // Binder / Lab / Focus Series: keep detection latch, skip controller.
      if (suspendsNormalRecognition(getScannerMode())) return;

      // Verified result open: keep camera mounted, pause new captures; onFrame holds.
      if (verifiedHoldActive.current) {
        const snap = await controller.onFrame(frame.image, helpers);
        syncVerifiedPhaseFromSnap(snap);
        setSnapshot(snap);
        if (Date.now() - lastDebugAt.current >= DEBUG_MS) {
          lastDebugAt.current = Date.now();
          publishDebug(snap);
        }
        return;
      }

      // Kick hi-res: legacy on focusing/locking; geometry-v2 only once locking.
      const kickPhases = isGeometryV2Pipeline()
        ? lastPhase.current === 'locking'
        : lastPhase.current === 'focusing' || lastPhase.current === 'locking';
      if (
        kickPhases &&
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
      if (snap.phase === 'locking' || (!isGeometryV2Pipeline() && snap.phase === 'focusing')) {
        if (store.current.waitStartedAt == null) store.current.waitStartedAt = Date.now();
        startCapture(frame);
      }
      // Verified: if hi-res already ready and controller hasn't held yet, enter capture UI.
      if (
        isGeometryV2Pipeline() &&
        getScannerMode() === 'normal' &&
        !verifiedHoldActive.current &&
        store.current.cache &&
        isTrueHiRes(store.current.cache.attempt.mode) &&
        (snap.phase === 'locking' || snap.phase === 'recognizing' || snap.phase === 'found')
      ) {
        enterVerifiedCaptured(store.current.cache);
      }
      if (verifiedHoldActive.current) {
        syncVerifiedPhaseFromSnap(snap);
        // Timing: first quad after NEXT
        if (
          nextPressedAtRef.current != null &&
          snap.corners &&
          verifiedTiming.current.nextFirstQuadAt == null
        ) {
          verifiedTiming.current = markFirstVerified(
            verifiedTiming.current,
            'nextFirstQuadAt',
            monoNow(),
          );
        }
      } else if (snap.corners && verifiedTiming.current.firstQuadAt == null) {
        verifiedTiming.current = markFirstVerified(
          verifiedTiming.current,
          'firstQuadAt',
          monoNow(),
        );
      }
      if (snap.singleCardCapture?.captureSafe && verifiedTiming.current.firstCaptureSafeAt == null) {
        verifiedTiming.current = markFirstVerified(
          verifiedTiming.current,
          'firstCaptureSafeAt',
          monoNow(),
        );
      }
      if (snap.phase === 'locking' && verifiedTiming.current.lockAt == null) {
        verifiedTiming.current = markFirstVerified(verifiedTiming.current, 'lockAt', monoNow());
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
    [controller, enterVerifiedCaptured, helpers, publishDebug, startCapture, syncVerifiedPhaseFromSnap],
  );

  const reset = useCallback(() => {
    controller.setVerifiedRecognizeReady(false);
    controller.setVerifiedHold(false);
    verifiedHoldActive.current = false;
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
    verifiedTiming.current = emptyVerifiedScanTiming();
    nextPressedAtRef.current = null;
    setVerifiedPhase('ready');
    setVerifiedWarpUri(null);
    setVerifiedSelectedPrinting(null);
    setAddedCount(0);
    parentSessionRef.current = null;
    setSnapshot(controller.snapshot());
    setDebug(emptyDebug());
  }, [controller]);

  const clearVerifiedForNext = useCallback(
    (reason: 'verified-next' | 'verified-add-next' | 'verified-retake') => {
      const now = monoNow();
      verifiedHoldActive.current = false;
      setVerifiedWarpUri(null);
      setVerifiedSelectedPrinting(null);
      proposedCardRef.current = null;
      proposedPrintingRef.current = null;
      nextPressedAtRef.current = reason === 'verified-retake' ? null : now;
      verifiedTiming.current = {
        ...emptyVerifiedScanTiming(),
        nextPressedAt: reason === 'verified-retake' ? null : now,
        cardSessionStartedAt: now,
      };
      store.current.cache = null;
      store.current.inFlight = false;
      store.current.waitStartedAt = null;
      store.current.phase = 'idle';
      lastCaptureKey.current = '';
      const snap = controller.verifiedAdvance(reason);
      setVerifiedPhase(reason === 'verified-retake' ? 'acquiring' : 'ready');
      setSnapshot(snap);
      publishDebug(snap);
    },
    [controller, publishDebug],
  );

  const scheduleAttemptEncode = useCallback(
    (attempt: RecognitionAttempt, uploadNow: boolean) => {
      const q = getScanBackgroundQueue();
      const snap = attemptRegistry.getAttempt(attempt.attemptId) ?? attempt;
      q.enqueue({
        id: `encode-${snap.attemptId}-${uploadNow ? 'final' : 'early'}`,
        kind: 'encode',
        priority: 3,
        attemptId: snap.attemptId,
        enqueuedAt: monoNow(),
        run: async () => {
          const latest = attemptRegistry.getAttempt(snap.attemptId) ?? snap;
          const parent = parentSessionRef.current;
          if (uploadNow || latest.terminalStatus != null) {
            await finalizeNormalScanDiagnostic({
              source: latest.artifacts.source,
              warp: latest.artifacts.warp,
              titleCrop: latest.artifacts.titleCrop,
              recognitionQuad: latest.artifacts.recognitionQuad,
              provenance: latest.provenance,
              telemetry: telemetryFromAttempt(latest),
              parentSummary: parent?.summary ?? null,
            });
            attemptRegistry.releaseAttempt(latest.attemptId);
          } else {
            await enqueueNormalScanDiagnostic({
              source: latest.artifacts.source,
              warp: latest.artifacts.warp,
              titleCrop: latest.artifacts.titleCrop,
              recognitionQuad: latest.artifacts.recognitionQuad,
              provenance: latest.provenance,
              telemetry: telemetryFromAttempt(latest),
              parentSummary: parent?.summary ?? null,
              uploadNow: false,
            });
          }
        },
      });
    },
    [],
  );

  const runBackgroundRecognize = useCallback(
    async (attempt: RecognitionAttempt): Promise<void> => {
      if (attempt.terminalStatus != null) return;
      const ocr = getOrCreateOcrRecognizer();
      const nameIndex = indexesRef.current.names?.index ?? null;
      const art = indexesRef.current.art;
      const printing = indexesRef.current.printing;
      attemptRegistry.updateAttempt(attempt.attemptId, a =>
        markAttemptRecognizing(a, monoNow()),
      );
      try {
        const channel = getRecognitionChannel();
        let updated: RecognitionAttempt | null = null;
        if (channelIsNewVisual(channel)) {
          // Verified CLIP / CLIP+OCR — native visual retrieval + optional title OCR.
          if (getVisualRecognizerState() !== 'READY') {
            await initializeVisualRecognizer();
          }
          const warp = attempt.artifacts.warp;
          const artCrop = extractArtCropFromCard(warp, { variant: 'PRIMARY' });
          const rgba = new Uint8Array(
            artCrop.crop.data.buffer,
            artCrop.crop.data.byteOffset,
            artCrop.crop.data.byteLength,
          );
          const tVis0 = monoNow();
          const clipP = recognizeArtCropRgba(rgba, artCrop.crop.width, artCrop.crop.height, 5);
          const ocrP =
            channel === 'VISUAL_PLUS_OCR' && ocr
              ? recognizeCapturedCard({
                  alreadyWarped: true,
                  attemptId: attempt.attemptId,
                  captureAt: attempt.timing.captureDoneAt,
                  nameIndex,
                  ocr,
                  recognitionQuad: attempt.artifacts.recognitionQuad,
                  source: warp,
                  trackId: null,
                })
              : Promise.resolve(null);
          const [clip, captured] = await Promise.all([clipP, ocrP]);
          const visual = clip.hits[0]
            ? {
                name: clip.hits[0].name,
                oracleId: clip.hits[0].oracleId,
                score: clip.hits[0].score,
                margin: clip.hits[0].margin,
              }
            : null;
          const ocrEv = captured?.matchName
            ? {
                name: captured.matchName,
                oracleId: captured.oracleId,
                score: captured.matchScore ?? 0,
                exact: captured.status === 'identified',
              }
            : null;
          const fused = fuseContinuousEvidence({ visual, ocr: ocrEv });
          const at = monoNow();
          const titleMs = captured?.timings.ocrMs ?? null;
          const artworkMs = clip.latencyMs ?? at - tVis0;
          updated = attemptRegistry.updateAttempt(attempt.attemptId, a =>
            finalizeAttempt(
              {
                ...a,
                channelTiming: {
                  mode: channel,
                  titleMs,
                  artworkMs,
                  artworkDescriptorMs: clip.encoderMs,
                  artworkMatcherMs: clip.searchMs,
                  footerMs: null,
                  footerLookupMs: null,
                  totalMs: Math.max(artworkMs ?? 0, titleMs ?? 0),
                  earlyReason: fused.reason,
                  artMode: 'CLIP_VIT_B32',
                },
              },
              {
                terminalStatus: fused.publish
                  ? 'FOUND'
                  : visual || ocrEv
                    ? 'AMBIGUOUS'
                    : 'NO_MATCH',
                at,
                finalCard: fused.identity?.name ?? visual?.name ?? ocrEv?.name ?? null,
                proposedCard: fused.identity?.name ?? visual?.name ?? ocrEv?.name ?? null,
                ocr: captured
                  ? ocrEvidenceFromCaptured(captured)
                  : {
                      titleCropDimensions: null,
                      ocrRawText: null,
                      ocrNormalizedText: null,
                      ocrVariants: [],
                      bestCandidateName: visual?.name ?? null,
                      bestCandidateScore: visual?.score ?? null,
                      runnerUpName: clip.hits[1]?.name ?? null,
                      runnerUpScore: clip.hits[1]?.score ?? null,
                      candidateMargin: visual?.margin ?? null,
                      recognitionStatus: fused.publish ? 'identified' : 'insufficient',
                    },
                printing: {
                  printingStatus: 'NOT_RESOLVED',
                  proposedSet: null,
                  proposedCollectorNumber: null,
                  proposedLanguage: null,
                  printingConfidence: null,
                },
                titleCrop: captured?.titleRaw ?? null,
              },
            ),
          );
        } else if (channelUsesTitleFastPath(channel)) {
          const captured = await recognizeCapturedCard({
            alreadyWarped: true,
            attemptId: attempt.attemptId,
            captureAt: attempt.timing.captureDoneAt,
            nameIndex,
            ocr,
            recognitionQuad: attempt.artifacts.recognitionQuad,
            source: attempt.artifacts.warp,
            trackId: null,
          });
          updated = attemptRegistry.updateAttempt(attempt.attemptId, a =>
            applyCapturedToAttempt(a, captured),
          );
        } else {
          const { result } = await recognizeCard(
            attempt.artifacts.warp,
            {
              artwork: art?.matcher ?? null,
              artworkIndex: art?.data ?? null,
              nameIndex,
              printingIndex: printing?.index ?? null,
              ocr,
              resolveOcr: () => getOrCreateOcrRecognizer(),
              textIndex: art?.text ?? null,
            },
            channelToRecognizeOptions(channel),
          );
          updated = attemptRegistry.updateAttempt(attempt.attemptId, a =>
            applyRecognizeResultToAttempt(a, result),
          );
        }
        if (!updated || updated.terminalStatus == null) return;
        const parent = parentSessionRef.current;
        if (parent) recordAttemptTerminal(parent, updated);
        // Encode/upload via bounded queue — do not hold recognize slot for PNG work.
        scheduleAttemptEncode(updated, true);
      } catch (err) {
        const at = monoNow();
        const updated = attemptRegistry.updateAttempt(attempt.attemptId, a =>
          finalizeAttempt(a, {
            terminalStatus: 'OCR_ERROR',
            at,
            ocr: {
              recognitionStatus: 'ocr-native-error',
              ocrRawText: err instanceof Error ? err.message : String(err),
            },
          }),
        );
        if (updated) {
          const parent = parentSessionRef.current;
          if (parent) recordAttemptTerminal(parent, updated);
          scheduleAttemptEncode(updated, true);
        }
      }
    },
    [scheduleAttemptEncode],
  );

  const scheduleBackgroundRecognize = useCallback(
    (attempt: RecognitionAttempt) => {
      getScanBackgroundQueue().enqueue({
        id: `recog-${attempt.attemptId}`,
        kind: 'recognize',
        priority: 2,
        attemptId: attempt.attemptId,
        enqueuedAt: monoNow(),
        run: async () => {
          await runBackgroundRecognize(attempt);
        },
      });
    },
    [runBackgroundRecognize],
  );

  const verifiedUploadNext = useCallback(async (): Promise<string> => {
    const attemptId = activeAttemptIdRef.current;
    const attempt = attemptId != null ? attemptRegistry.getAttempt(attemptId) : null;
    if (!attempt) {
      clearVerifiedForNext('verified-next');
      return 'Upload failed: no frozen attempt';
    }
    const at = monoNow();
    attemptRegistry.updateAttempt(attemptId!, a => markAttemptAdvancedEarly(a, at));
    const advanced = attemptRegistry.getAttempt(attemptId!)!;

    // Advance UI FIRST — never block Skip on PNG encode / upload / OCR.
    clearVerifiedForNext('verified-next');
    activeAttemptIdRef.current = null;

    const q = getScanBackgroundQueue();
    const depth = q.snapshot();

    if (advanced.terminalStatus == null) {
      if (advanced.phase === 'captured' || advanced.phase === 'awaiting-paint') {
        scheduleBackgroundRecognize(advanced);
      }
      // Pin warp early at low priority; source encode shares this job.
      // Final metadata waits for terminal (controller OCR or background recog).
      scheduleAttemptEncode(advanced, false);
    } else {
      scheduleAttemptEncode(advanced, true);
    }

    const after = q.snapshot();
    return (
      `Queued attempt ${advanced.attemptId}` +
      ` · bg recog ${after.activeRecognitionJobs}/${after.pendingRecognitionJobs}` +
      ` enc ${after.activeEncodeJobs}/${after.pendingEncodeJobs}` +
      (depth.backgroundDeferredCount || after.backgroundDeferredCount
        ? ` deferred=${after.backgroundDeferredCount}`
        : '')
    );
  }, [clearVerifiedForNext, scheduleAttemptEncode, scheduleBackgroundRecognize]);

  const verifiedNextCard = useCallback(async () => {
    return verifiedUploadNext();
  }, [verifiedUploadNext]);

  const verifiedAddNext = useCallback(
    async (_printing: ScryfallPrinting | null) => {
      return verifiedUploadNext();
    },
    [verifiedUploadNext],
  );

  const verifiedRetake = useCallback(() => {
    const attemptId = activeAttemptIdRef.current;
    if (attemptId != null) {
      const at = monoNow();
      const updated = attemptRegistry.updateAttempt(attemptId, a =>
        finalizeAttempt(markAttemptAdvancedEarly(a, at), {
          terminalStatus: 'SKIPPED',
          at,
        }),
      );
      if (updated) {
        const parent = parentSessionRef.current;
        if (parent) {
          recordRetake(parent);
          recordAttemptTerminal(parent, updated);
        }
        attemptRegistry.releaseAttempt(attemptId);
      }
    }
    activeAttemptIdRef.current = null;
    clearVerifiedForNext('verified-retake');
  }, [clearVerifiedForNext]);

  const verifiedRetryRecognition = useCallback(async () => {
    setVerifiedPhase('identifying');
    const snap = await controller.retryFrozenRecognition(helpers);
    setSnapshot(snap);
    syncVerifiedPhaseFromSnap(snap);
    publishDebug(snap);
  }, [controller, helpers, publishDebug, syncVerifiedPhaseFromSnap]);

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
    const cardSessionId = gates?.cardSessionId ?? null;
    const resultCardSessionId = snap.resultCardSessionId ?? gates?.resultCardSessionId ?? null;
    const identityOwnedByCurrentSession =
      cardSessionId != null &&
      resultCardSessionId != null &&
      cardSessionId === resultCardSessionId;
    const ownedIdentity = identityOwnedByCurrentSession
      ? snap.fused?.card?.name ?? null
      : null;
    // Never fall back to titleTopCandidate / React caches for CURRENT identity.
    const rawStatus = identityOwnedByCurrentSession
      ? snap.postLock?.recognitionStatus ?? snap.phase
      : snap.phase === 'found' || snap.phase === 'ambiguous'
        ? 'focusing'
        : snap.postLock?.recognitionStatus &&
            snap.postLock.recognitionStatus !== 'found' &&
            snap.postLock.recognitionStatus !== 'ambiguous' &&
            snap.postLock.recognitionStatus !== 'identified'
          ? snap.postLock.recognitionStatus
          : snap.phase;
    return {
      gates,
      identity: ownedIdentity,
      identityOwnedByCurrentSession,
      latch,
      recognitionDecision: identityOwnedByCurrentSession
        ? snap.postLock?.recognitionStatus ?? null
        : null,
      recognitionStatus: rawStatus,
      recognizeAttempts: snap.postLock?.recognizeAttemptsForTrack ?? null,
      resultCardSessionId,
      resultPublishedAt: identityOwnedByCurrentSession
        ? snap.postLock?.resultPublishedAt ?? null
        : null,
      resultAttemptId: identityOwnedByCurrentSession
        ? snap.postLock?.recognitionAttemptId ?? null
        : null,
      // Diagnostics only — never treat as current.
      diagnosticLastIdentity: snap.lockGates?.previousSessionIdentity ?? null,
      diagnosticLastResultCardSessionId: resultCardSessionId,
      phase: snap.phase,
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

  /** Geometry Test peek — raw/plausible + spaces; no recognition identity. */
  const peekGeometryLive = useCallback(() => {
    const det = helperState.current.detection;
    const spaces = helperState.current.spaces;
    const analysis = helperState.current.analysis;
    const snap = controller.snapshot();
    const gates = snap.lockGates ?? null;
    const raw = det?.rawCorners ?? null;
    const plausible =
      det?.rawCorners ??
      (det?.recognitionQuadValid !== false ? det?.recognitionCorners ?? null : null) ??
      det?.corners ??
      null;
    const scoreRaw = det?.score ?? gates?.detectorScore ?? 0;
    const score = typeof scoreRaw === 'number' && Number.isFinite(scoreRaw) ? scoreRaw : 0;
    const frame = analysis
      ? { width: analysis.width, height: analysis.height }
      : spaces?.detector ?? { width: 1, height: 1 };
    let aspect: number | null = null;
    let occupancy: number | null = null;
    let fastAccept = false;
    if (plausible) {
      aspect = perspectiveAspect(plausible);
      occupancy = quadArea(plausible) / Math.max(1, frame.width * frame.height);
      // Geometry Test must not depend on SessionController gates (often 0 while
      // recognition is suspended). Prefer detection score; if corners exist, treat
      // as at least lock-eligible for the experiment.
      const lockScore = Math.max(score, 0.75);
      fastAccept = evaluateMtgFastAccept({
        corners: plausible,
        score: lockScore,
        frame,
        runnerUpScore: 0,
      }).accept;
    }
    return {
      detectorScore: plausible ? Math.max(score, 0.75) : score,
      rawCorners: raw,
      plausibleCorners: plausible,
      spaces,
      frame,
      analysisImage: analysis,
      aspect,
      occupancy,
      focusReportedSuccess:
        gates == null ? null : gates.focusSuccesses > 0 || gates.focusOk === true,
      focusTimedOut: gates?.focusTimedOut ?? null,
      fastAccept,
      rawCandidateCount:
        typeof det?.debug?.candidates?.length === 'number'
          ? det.debug.candidates.length
          : typeof det?.debug?.selectedIndex === 'number' && det.debug.selectedIndex >= 0
            ? Math.max(1, det.debug.candidates?.length ?? 1)
            : null,
      selectedCandidateScore:
        typeof det?.debug?.selectedIndex === 'number' &&
        det.debug.selectedIndex >= 0 &&
        det.debug.candidates?.[det.debug.selectedIndex]
          ? det.debug.candidates[det.debug.selectedIndex]!.score
          : plausible
            ? Math.max(score, 0.75)
            : null,
      selectedRole: det?.debug?.selectedRole ?? det?.recognitionQuadSource ?? null,
    };
  }, [controller]);

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
    peekGeometryLive,
    lastCaptureProvenance: () => controller.lastCaptureProvenance(),
    lastNormalizedCardSessionId: () => controller.lastNormalizedCardSessionId(),
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
    verified: {
      addedCount,
      autoUploadDiagnostics,
      phase: verifiedPhase,
      selectedPrinting: verifiedSelectedPrinting,
      setAutoUploadDiagnostics,
      setSelectedPrinting: setVerifiedSelectedPrinting,
      timing: verifiedTiming.current,
      warpUri: verifiedWarpUri,
      addNext: verifiedAddNext,
      armRecognize: armVerifiedRecognize,
      nextCard: verifiedNextCard,
      uploadNext: verifiedUploadNext,
      retake: verifiedRetake,
      retryRecognition: verifiedRetryRecognition,
      parentSessionId: parentSessionRef.current?.id ?? null,
    },
  };
};
