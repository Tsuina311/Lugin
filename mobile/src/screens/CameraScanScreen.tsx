import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  CommonResolutions,
  useCameraDevices,
  useCameraPermission,
  useOrientation,
  usePhotoOutput,
  type CameraDevice,
  type CameraOutput,
  type CameraRef,
} from 'react-native-vision-camera';

import { CameraDebugPanel } from '../camera/CameraDebugPanel';
import { describeDevice, selectMainRearDevice } from '../camera/selectMainRearDevice';
import { useAppActive } from '../lifecycle/useAppActive';
import {
  BenchmarkHud,
  endBenchmarkSession,
  isBenchmarkToolsEnabled,
  peekBenchmarkHud,
  recordBenchmarkScan,
  restoreBenchmarkSession,
  subscribeBenchmark,
} from '../scan/benchmark';
import { collectionAddFromPrinting } from '../scan/collectionCommand';
import { extractTitleCrop } from '@/lib/scan/ocrInput';
import { tickOverlay } from '../scan/overlayEase';
import { ScanDebugPanel } from '../scan/ScanDebugPanel';
import { ScanResultCard } from '../scan/ScanResultCard';
import { VerifiedScanPanel } from '../scan/VerifiedScanPanel';
import { isGeometryV2Pipeline } from '@/lib/scan/singleCardCapture';
import { mapCornersToOverlay, type CardCorners, type Point2D } from '../scan/sharedCore';
import { RECOGNITION_SOURCES, type PreferredSource } from '../scan/hiresCapture';
import {
  downloadPreparedBundle,
  prepareDebugBundle,
  sharePreparedBundle,
  type PreparedDebugBundle,
  type DebugSharePayload,
} from '../scan/saveDebugBundle';
import { saveTrainingCapture, shareTrainingDetectorPng } from '../scan/saveTrainingCapture';
import { useHiResFrameLatch } from '../scan/useHiResFrame';
import { useScanSession } from '../scan/useScanSession';
import {
  ANALYSIS_LONG_EDGES,
  RESOLUTIONS,
  RUNGS,
  useFrameAnalysis,
} from '../scan/useFrameAnalysis';
import {
  createNativeDetectorEngine,
  createSharedJsDetectorEngine,
  getNativeDetectorImplementationStatus,
  isNativeDetectorLinked,
  setNativeNestedSleeveEnabled,
  type DetectorEngineId,
} from '../scan/detectorEngine';
import {
  applyPerfPreset,
  getPerfBaseline,
  setPerfBaseline,
} from '../scan/perfBaseline';
import {
  cycleRecognitionChannel,
  getRecognitionChannel,
  RECOGNITION_CHANNEL_LABELS,
  setRecognitionChannel,
} from '@/lib/scan/recognitionChannel';
import { ContinuousHud } from '../scan/continuous/ContinuousHud';
import { useContinuousScan } from '../scan/continuous/useContinuousScan';
import {
  cycleSingleScanWorkflow,
  getContinuousFlags,
  getSingleScanWorkflow,
  type SingleScanWorkflow,
} from '../scan/singleScanWorkflow';
import type { HiResSpaces } from '../scan/hiresCapture';
import {
  startJsLagProbe,
  stopJsLagProbe,
  subscribeJsLag,
  type JsLagStats,
} from '../scan/jsLagProbe';

const PERF_BASELINE_HZ = 8;
import {
  getNativeOcrImplementationStatus,
  isNativeOcrLinked,
} from '../scan/mlkitTextRecognizer';
import { getOcrAdapterSnapshot, getOrCreateOcrRecognizer, ocrUnavailableReason } from '../scan/ocrAdapter';
import { useCardSwapTest } from '../scan/swapTest/useCardSwapTest';
import { useDeckBenchmark } from '../scan/deckBenchmark/useDeckBenchmark';
import { DeckBenchmarkHud } from '../scan/deckBenchmark/DeckBenchmarkHud';
import { useBinderBenchmark } from '../scan/binderBenchmark/useBinderBenchmark';
import { BinderBenchmarkHud } from '../scan/binderBenchmark/BinderBenchmarkHud';
import { useGeometryTest } from '../scan/geometryTest/useGeometryTest';
import { GeometryTestHud } from '../scan/geometryTest/GeometryTestHud';
import { listDeckRuns } from '../scan/deckBenchmark/persist';
import { listBinderRuns } from '../scan/binderBenchmark/persist';
import { BinderHud } from '../scan/binder/BinderHud';
import { useBinder } from '../scan/binder/useBinder';
import { isBinderMode } from '@/lib/scan/scannerMode';
import {
  allowsNormalResultPresentation,
  claimScannerMode,
  isExclusiveScannerOwner,
  releaseScannerMode,
  shouldDismissNormalResultOnModeEnter,
  shouldResetSessionOnModeExit,
  showsDiagnosticPolygonsByDefault,
  usesLiveRawPolygon,
  useScannerMode,
} from '../scan/scannerMode';
import { ScannerLabScreen, type LabOpenCapture } from './ScannerLabScreen';
import { getScannerDataStatus } from '../scan/scannerDataStore';
import {
  finishGeometryTrace,
  geometryTraceSampleCount,
  isGeometryTraceActive,
  startGeometryTrace,
} from '../scan/geometryTrace';
import { shareGeometryTrace, writeGeometryTraceFiles } from '../scan/saveGeometryTrace';
import {
  enqueueGeometryTrace,
  enqueuePreparedReport,
  restoreInboxQueue,
  startDeviceReplayWorker,
  subscribeInbox,
} from '../scan/debugInbox';
import type { CaptureQualityRun } from '../scan/captureQuality/runPair';
import type { FocusSeriesRun } from '../scan/focusSeries/runSeries';
import Constants from 'expo-constants';

type FocusState = 'idle' | 'focusing' | 'done' | 'error';
type Panel = 'scan' | 'camera' | 'none';

const LINE_THICKNESS = 3;

/**
 * Milestone C.2 — the shared detector running on native camera frames.
 *
 * Supersedes the Milestone B proof screen, keeping its lens cycling,
 * tap-to-focus and camera debug panel.
 *
 * The "Detector" toggle detaches the frame callback, which is the control for
 * judging whether frame processing costs preview smoothness. Note it isolates
 * the *processing* cost only — the frame output stays configured on the
 * session, so it is not the same as a camera with no frame output at all.
 */
export function CameraScanScreen(props?: {
  surface?: 'scan' | 'binder' | 'geometry';
  onOpenBinder?: () => void;
  onOpenGeometry?: () => void;
  onOpenScan?: () => void;
}) {
  const surface = props?.surface ?? 'scan';
  const scannerMode = useScannerMode();
  const exclusiveOwner = isExclusiveScannerOwner(scannerMode);
  const showNormalResultUi = allowsNormalResultPresentation(scannerMode);
  const [forceDebugOverlay, setForceDebugOverlay] = useState(false);
  const showDiagPolygons = showsDiagnosticPolygonsByDefault(scannerMode) || forceDebugOverlay;
  const liveRawPolygon = usesLiveRawPolygon(scannerMode);

  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const rearDevices = useMemo(() => devices.filter(d => d.position === 'back'), [devices]);

  const preferred = useMemo(() => selectMainRearDevice(rearDevices), [rearDevices]);
  // Keep display on while the camera screen is mounted (scan + binder + geometry).
  useKeepAwake('lugin-camera-scan');
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const device: CameraDevice | undefined = useMemo(() => {
    if (overrideId) return rearDevices.find(d => d.id === overrideId) ?? preferred;
    return preferred;
  }, [overrideId, preferred, rearDevices]);

  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [focusState, setFocusState] = useState<FocusState>('idle');
  const [lastFocusError, setLastFocusError] = useState<string | null>(null);
  const [layout, setLayout] = useState({ height: 0, width: 0 });
  const [detectorOn, setDetectorOn] = useState(true);
  const [panel, setPanel] = useState<Panel>('none');
  const [labOpen, setLabOpen] = useState(false);
  const showGeometryLanding =
    isBenchmarkToolsEnabled() && surface === 'geometry' && !exclusiveOwner && !labOpen;
  const [labOpening, setLabOpening] = useState(false);
  const [labFrozen, setLabFrozen] = useState<LabOpenCapture | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [qualityDraft, setQualityDraft] = useState<CaptureQualityRun | null>(null);
  const [qualityLabel, setQualityLabel] = useState('');
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [seriesDraft, setSeriesDraft] = useState<FocusSeriesRun | null>(null);
  const [seriesLabel, setSeriesLabel] = useState('');
  // Diagnostic controls: how far the transfer ladder climbs, and how big the
  // payload is. Lowering either is how a size limit is told from a hard
  // serialization failure.
  const [rungIndex, setRungIndex] = useState(RUNGS.length - 1);
  const [resolutionIndex, setResolutionIndex] = useState(0);
  const [longEdgeIndex, setLongEdgeIndex] = useState(0);
  const [perfTick, setPerfTick] = useState(0);
  const [jsLag, setJsLag] = useState<JsLagStats | null>(null);
  const [diagnosticRungs, setDiagnosticRungs] = useState(false);
  const [showNumbers, setShowNumbers] = useState(true);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [trainBusy, setTrainBusy] = useState(false);
  const [debugViewer, setDebugViewer] = useState<PreparedDebugBundle | null>(null);
  const [detectorColorOk, setDetectorColorOk] = useState<'yes' | 'no' | 'unverified'>('unverified');
  const [recognitionColorOk, setRecognitionColorOk] = useState<'yes' | 'no' | 'unverified'>(
    'unverified',
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [detectorEngineId, setDetectorEngineId] = useState<DetectorEngineId>(() =>
    isNativeDetectorLinked() && getNativeDetectorImplementationStatus() === 'ready'
      ? 'native'
      : 'shared-js',
  );
  const [requestedDetectorEngine] = useState<DetectorEngineId>(() =>
    isNativeDetectorLinked() && getNativeDetectorImplementationStatus() === 'ready'
      ? 'native'
      : 'shared-js',
  );
  const [detectorFallbackReason, setDetectorFallbackReason] = useState<string | null>(null);
  const [traceBusy, setTraceBusy] = useState(false);
  const [traceDir, setTraceDir] = useState<string | null>(null);
  const [, setTraceCount] = useState(0);
  const [traceElapsedMs, setTraceElapsedMs] = useState(0);
  const [traceUpload, setTraceUpload] = useState<'idle' | 'pending' | 'uploaded' | 'failed'>('idle');
  const [, setTraceId] = useState<string | null>(null);
  const [showAllTools, setShowAllTools] = useState(false);
  const [benchHud, setBenchHud] = useState(() => peekBenchmarkHud());
  const preferredSource: PreferredSource = RECOGNITION_SOURCES[sourceIndex];
  const detectorEngine = useMemo(() => {
    if (detectorEngineId === 'native') {
      try {
        const eng = createNativeDetectorEngine();
        queueMicrotask(() => setDetectorFallbackReason(null));
        return eng;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        queueMicrotask(() => setDetectorFallbackReason(reason));
        console.warn(`[lugin] native detector unavailable → shared-js: ${reason}`);
        return createSharedJsDetectorEngine();
      }
    }
    return createSharedJsDetectorEngine();
  }, [detectorEngineId]);
  const actualDetectorEngine: DetectorEngineId =
    detectorEngineId === 'native' && detectorFallbackReason ? 'shared-js' : detectorEngineId;
  // CameraX / frame outputs stall after backgrounding if isActive stays true.
  // Tab switch remounts the screen (works); AppState pause/resume does the same
  // without leaving Scan.
  const appActive = useAppActive();
  const scanning = detectorOn && appActive && !labOpen && !labOpening;

  useEffect(() => {
    if (!scanning) {
      stopJsLagProbe();
      setJsLag(null);
      return;
    }
    startJsLagProbe();
    return subscribeJsLag(setJsLag);
  }, [scanning]);

  const photoOutput = usePhotoOutput({
    containerFormat: 'jpeg',
    quality: 0.85,
    qualityPrioritization: device?.supportsSpeedQualityPrioritization ? 'speed' : 'balanced',
    targetResolution: CommonResolutions.FHD_4_3,
  });

  const hiResFrame = useHiResFrameLatch({
    enabled: scanning,
    previewSize: layout,
  });
  // Interface, not device: the UI is portrait-locked. Device orientation
  // stays undefined until the phone moves — that was the startup bug.
  const interfaceOrientation = useOrientation('interface');

  const session = useScanSession({
    cameraRef,
    enabled: scanning,
    photoOutput,
    preferredSource,
    previewSize: layout,
    takeHiResFrame: hiResFrame.take,
  });

  const prevModeRef = useRef(scannerMode);
  useEffect(() => {
    const prev = prevModeRef.current;
    if (prev === scannerMode) return;
    prevModeRef.current = scannerMode;
    if (
      shouldDismissNormalResultOnModeEnter(prev, scannerMode) ||
      shouldResetSessionOnModeExit(prev, scannerMode)
    ) {
      setPendingAdd(null);
      session.reset();
    }
  }, [scannerMode, session]);

  const swapTest = useCardSwapTest({
    cameraRef,
    getNameIndex: () => session.indexes.names?.index ?? null,
    getOcr: () => getOrCreateOcrRecognizer(),
    markDebugCardSwapped: () => session.markDebugCardSwapped(),
    peekLive: () => session.peekSwapLive(),
    setLabHold: session.setLabHold,
  });
  const swapActive =
    swapTest.ui.phase !== 'idle' &&
    swapTest.ui.phase !== 'config' &&
    swapTest.ui.phase !== 'done' &&
    swapTest.ui.phase !== 'cancelled';

  const deckBench = useDeckBenchmark({
    markDebugCardSwapped: () => session.markDebugCardSwapped(),
    setLabHold: session.setLabHold,
    // Lightweight peek every tick — no title crop / PNG-sized copies on the hot path.
    peekLive: () => {
      const live = session.peekSwapLive();
      const snap = session.snapshot;
      const readings =
        live.identityOwnedByCurrentSession ? snap?.recognition?.readings ?? [] : [];
      const evidence = session.peekDeckEvidence();
      const adapter = getOcrAdapterSnapshot();
      return {
        gates: live.gates,
        identity: live.identity,
        // CRITICAL: never use React snapshot.phase here — it lags beginCardSession and
        // was the real-run sticky FOUND source (classifyTerminal fell back to phase).
        phase: live.phase,
        recognitionDecision: live.recognitionDecision,
        recognitionStatus: live.recognitionStatus,
        recognizeAttempts: live.recognizeAttempts,
        matchScore: live.identityOwnedByCurrentSession
          ? snap?.fused?.card?.confidence ?? null
          : null,
        ocrTexts: (() => {
          const fromReadings = Array.isArray(readings)
            ? readings
                .map((r: { text?: string }) => r?.text)
                .filter((t): t is string => Boolean(t && t.trim()))
            : [];
          // Fallback: titleRawText is often present when readings were cleared
          // from the owned snapshot after identity publish.
          const raw = live.identityOwnedByCurrentSession
            ? snap?.postLock?.titleRawText ?? null
            : null;
          if (fromReadings.length) return fromReadings;
          if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
          return [];
        })(),
        recognitionSourceChannel: live.identityOwnedByCurrentSession
          ? snap?.fused?.status != null
            ? 'TITLE'
            : 'OTHER'
          : null,
        detectorScore: live.gates?.detectorScore ?? null,
        recognitionSource: session.debug.recognitionSource ?? null,
        lockedAt: live.identityOwnedByCurrentSession ? snap?.lockedAt ?? null : null,
        finalIdentityAt: live.identityOwnedByCurrentSession
          ? snap?.finalIdentityAt ?? null
          : null,
        resultCardSessionId: live.resultCardSessionId ?? null,
        resultPublishedAt: live.resultPublishedAt ?? null,
        resultAttemptId: live.resultAttemptId ?? null,
        identityOwnedByCurrentSession: live.identityOwnedByCurrentSession,
        freshEvidenceCountForSession: live.identityOwnedByCurrentSession
          ? Math.max(1, live.recognizeAttempts ?? 1)
          : 0,
        recognitionAttemptIdsForSession: live.identityOwnedByCurrentSession
          ? live.resultAttemptId != null
            ? [live.resultAttemptId]
            : []
          : [],
        captureCardSessionId: session.lastCaptureProvenance?.()?.captureCardSessionId ?? null,
        captureId: session.lastCaptureProvenance?.()?.captureId ?? null,
        sourceHash: session.lastCaptureProvenance?.()?.sourceImageHash ?? null,
        warpHash: session.lastCaptureProvenance?.()?.warpedCardHash ?? null,
        titleHash: session.lastCaptureProvenance?.()?.titleCropHash ?? null,
        attemptCardSessionId: live.identityOwnedByCurrentSession
          ? live.gates?.cardSessionId ?? null
          : null,
        cardWarp: null,
        title: null,
        source: null,
        detector: null,
        rawCorners: evidence.rawCorners,
        trackedCorners: evidence.trackedCorners,
        presentedCorners: evidence.presentedCorners,
        recognitionCorners: evidence.recognitionCorners,
        ocrAvailable: adapter.textRecognizerCreated,
        ocrTransport: adapter.transport,
      };
    },
    peekArtifacts: () => {
      const evidence = session.peekDeckEvidence();
      const cardWarp = session.lastNormalized();
      let title = null as ReturnType<typeof extractTitleCrop>['image'] | null;
      if (cardWarp) {
        try {
          title = extractTitleCrop(cardWarp).image;
        } catch {
          title = null;
        }
      }
      return {
        cardWarp,
        title,
        source: evidence.source,
        detector: evidence.detector,
      };
    },
  });

  const binderBench = useBinderBenchmark({
    cameraRef,
    setLabHold: session.setLabHold,
    peekLive: () => ({
      gates: session.peekSwapLive().gates,
      focusState: focusState ?? null,
    }),
  });

  const [realBenchStatus, setRealBenchStatus] = useState<{
    deck: string | null;
    binder: string | null;
  }>({ deck: null, binder: null });

  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void (async () => {
      const decks = await listDeckRuns();
      const binders = await listBinderRuns();
      const d = decks[0];
      const b = binders[0];
      setRealBenchStatus({
        deck: d ? `${d.cards}/${d.target} · ${d.phase}` : null,
        binder: b ? `${b.pages}/${b.target} pages · ${b.phase}` : null,
      });
    })();
  }, [deckBench.ui.phase, binderBench.ui.phase]);

  const {
    counters,
    error,
    failure,
    frameMeta,
    frameOutput,
    lastDetectorInput,
    metrics,
    orientation,
    overlay,
    ping,
    preview,
    probeResult,
    resetCounters,
    resolution,
    result,
    testCurrentFrame,
    transfer,
  } = useFrameAnalysis({
    analysisMaxWidth: ANALYSIS_LONG_EDGES[longEdgeIndex],
    debugPreview: panel === 'scan' && getPerfBaseline().liveDebugImages,
    detectorEngine,
    diagnosticRungs,
    enabled: scanning,
    interfaceOrientation,
    onAnalyzed: session.onAnalyzed,
    previewSize: layout,
    resolutionIndex,
    rung: RUNGS[rungIndex],
    targetAnalysisFps: getPerfBaseline().detectorHz,
  });

  const openScannerLab = useCallback(async () => {
    if (labOpening || labOpen) return;
    if (!claimScannerMode('scanner-lab')) return;
    setLabOpening(true);
    try {
      const frozen = await session.acquireLabCapture();
      setLabFrozen(frozen);
      setLabOpen(true);
    } catch (err) {
      session.releaseLabHold();
      releaseScannerMode('scanner-lab');
      setSaveStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLabOpening(false);
    }
  }, [labOpen, labOpening, session]);

  const onCaptureQualityAb = useCallback(() => {
    if (qualityBusy) return;
    setQualityBusy(true);
    setSaveStatus('A/B… keep the card in the preview');
    void session
      .captureQualityPair(focusPoint)
      .then(run => {
        setQualityDraft(run);
        setQualityLabel(run.snapshot.ocr.matchName ?? run.photo.ocr.matchName ?? '');
        setSaveStatus(
          `A/B ready · fast ${run.snapshot.ocr.decision} / photo ${run.photo.ocr.decision}`,
        );
      })
      .catch(err => {
        setSaveStatus(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setQualityBusy(false));
  }, [focusPoint, qualityBusy, session]);

  const onSaveFocusSeries = useCallback(() => {
    if (!seriesDraft) return;
    setSeriesBusy(true);
    void session
      .persistFocusSeries(seriesDraft, seriesLabel)
      .then(saved => {
        setSaveStatus(`Uploaded ${saved.fixtureId}`);
        setSeriesDraft(null);
      })
      .catch(err => setSaveStatus(err instanceof Error ? err.message : String(err)))
      .finally(() => setSeriesBusy(false));
  }, [seriesDraft, seriesLabel, session]);

  const onSaveQualityLabel = useCallback(() => {
    if (!qualityDraft) return;
    setQualityBusy(true);
    void session
      .persistCaptureQualityPair(qualityDraft, qualityLabel)
      .then(saved => {
        setSaveStatus(`Uploaded ${saved.fixtureId}`);
        setQualityDraft(null);
      })
      .catch(err => setSaveStatus(err instanceof Error ? err.message : String(err)))
      .finally(() => setQualityBusy(false));
  }, [qualityDraft, qualityLabel, session]);

  // Re-read baseline when toggled (perfTick).
  void perfTick;

  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void restoreBenchmarkSession().then(() => setBenchHud(peekBenchmarkHud()));
    return subscribeBenchmark(() => setBenchHud(peekBenchmarkHud()));
  }, []);

  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    return startDeviceReplayWorker(() => ({
      nameIndex: session.indexes.names?.index ?? null,
    }));
  }, [session.indexes.names?.index]);

  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void restoreInboxQueue();
    return subscribeInbox(ev => {
      if (ev.kind === 'uploaded') {
        setSaveStatus(`Uploaded ✓ ${ev.traceId}`);
        setTraceId(current => {
          if (current && ev.traceId === current) setTraceUpload('uploaded');
          return current;
        });
      }
      if (ev.kind === 'failed') {
        setTraceUpload(prev => (prev === 'pending' ? 'failed' : prev));
      }
    });
  }, []);

  // Auto-persist every completed recognition during an active benchmark session.
  // Payload is built here (not via buildReportPayload) so this hook can stay
  // above permission early-returns.
  useEffect(() => {
    if (!isBenchmarkToolsEnabled() || !benchHud.active) return;
    if (!allowsNormalResultPresentation(scannerMode)) return;
    const snap = session.snapshot;
    if (!snap || (snap.phase !== 'found' && snap.phase !== 'ambiguous')) return;
    if (!snap.fused) return;
    const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
      ?.lugin;
    const payload: DebugSharePayload = {
      analysisLongEdge: ANALYSIS_LONG_EDGES[longEdgeIndex],
      appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
      detectorEngine: actualDetectorEngine,
      requestedDetectorEngine,
      actualDetectorEngine,
      detectorFallbackReason,
      deviceLine: device ? describeDevice(device) : undefined,
      images: {
        detector: lastDetectorInput(),
        detectorUri: preview,
        hiresUri: session.debug.hiresUri,
        recognition: session.lastNormalized(),
        recognitionUri: session.debug.normalizedUri,
      },
      ocrEngine: isNativeOcrLinked()
        ? `mlkit:${getNativeOcrImplementationStatus() ?? 'linked'}`
        : 'none',
      pixelFormat: frameMeta?.pixelFormat ?? null,
      preferredSource,
      recognitionSource: session.debug.recognitionSource,
      stamp: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      panel: {
        frameMeta,
        session: {
          ...session.debug,
          artEntries: session.indexes.art?.entries ?? null,
          printingEntries: session.indexes.printing?.entries ?? null,
        },
        snapshot: {
          fused: snap.fused,
          phase: snap.phase,
          recognition: snap.recognition,
          earlyShownAt: snap.earlyShownAt ?? null,
          lockedAt: snap.lockedAt ?? null,
          finalIdentityAt: snap.finalIdentityAt ?? null,
          printingShownAt: snap.printingShownAt ?? null,
          userLatency: snap.userLatency ?? null,
        },
      },
    };
    void recordBenchmarkScan({
      payload,
      recognition: session.lastNormalized(),
      snapshot: snap,
    }).then(() => setBenchHud(peekBenchmarkHud()));
  }, [
    benchHud.active,
    scannerMode,
    session.snapshot?.phase,
    session.snapshot?.lockedAt,
    session.snapshot?.earlyShownAt,
    session.snapshot?.finalIdentityAt,
    session.snapshot?.printingShownAt,
  ]);

  // Never leave a second RGB ImageAnalysis (1440×1920) bound on every
  // session — that can prevent CameraX from starting on Samsung.
  // Photo attaches for snapshot/photo so the capture cascade can succeed.
  // Hi-res frame attaches only while the one-shot latch is armed.
  const cameraOutputs = useMemo(() => {
    const outs: CameraOutput[] = [frameOutput];
    const needPhoto =
      preferredSource === 'snapshot' ||
      preferredSource === 'photo' ||
      hiResFrame.armed;
    if (needPhoto) outs.push(photoOutput);
    if (hiResFrame.armed) outs.push(hiResFrame.frameOutput);
    return outs;
  }, [frameOutput, hiResFrame.armed, hiResFrame.frameOutput, photoOutput, preferredSource]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { height, width } = e.nativeEvent.layout;
    setLayout({ height, width });
  };

  const cycleDevice = useCallback(() => {
    if (rearDevices.length === 0) return;
    const currentId = device?.id ?? rearDevices[0].id;
    const idx = rearDevices.findIndex(d => d.id === currentId);
    setOverrideId(rearDevices[(idx + 1) % rearDevices.length].id);
  }, [device?.id, rearDevices]);

  const focusAt = useCallback(async (x: number, y: number) => {
    const cam = cameraRef.current;
    if (!cam) return;
    setFocusPoint({ x, y });
    setFocusState('focusing');
    setLastFocusError(null);
    try {
      await cam.focusTo(
        { x, y },
        { adaptiveness: 'continuous', autoResetAfter: null, responsiveness: 'snappy' },
      );
      setFocusState('done');
    } catch (err) {
      setFocusState('error');
      setLastFocusError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const geometryTest = useGeometryTest({
    cameraRef,
    peekLive: () => session.peekGeometryLive(),
    requestInitialFocus: () => {
      if (layout.width <= 0 || layout.height <= 0) return;
      void focusAt(layout.width / 2, layout.height / 2);
    },
  });

  useEffect(() => {
    if (!showGeometryLanding) return;
    if (geometryTest.ui.phase !== 'idle') return;
    geometryTest.enter();
  }, [showGeometryLanding, geometryTest.ui.phase, geometryTest.enter]);

  useEffect(() => {
    if (scannerMode !== 'geometry-test') return;
    setForceDebugOverlay(geometryTest.ui.debugOverlay);
  }, [scannerMode, geometryTest.ui.debugOverlay]);

  // Leaving Geometry for Scan releases exclusive ownership.
  useEffect(() => {
    if (surface === 'scan' && scannerMode === 'geometry-test') {
      geometryTest.cancel();
    }
  }, [surface, scannerMode, geometryTest.cancel]);

  const onTap = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      session.markTap();
      void focusAt(locationX, locationY);
    },
    [focusAt, session],
  );

  const easeClock = useRef({ display: null as CardCorners | null, targetAt: 0 });
  const [displayCorners, setDisplayCorners] = useState<CardCorners | null>(null);
  useEffect(() => {
    let raf = 0;
    const close = (a: CardCorners | null, b: CardCorners | null) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return Math.hypot(a.topLeft.x - b.topLeft.x, a.topLeft.y - b.topLeft.y) < 0.5;
    };
    const loop = () => {
      const next = tickOverlay(easeClock.current, overlay?.corners ?? null, Date.now());
      const changed = !close(easeClock.current.display, next.display);
      easeClock.current = next;
      if (changed) setDisplayCorners(next.display);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [overlay?.corners]);

  // Detector image is already the preview-visible cover-crop, upright, so
  // overlay is a uniform scale of analysis → dest. Using the same cover mapper
  // as web keeps the math in one place if rounding leaves a sliver of mismatch.
  const analysisSize = overlay?.analysis ?? result?.analysis;

  const [workflow, setWorkflow] = useState<SingleScanWorkflow>(getSingleScanWorkflow());
  const continuousEnabled =
    scannerMode === 'normal' && surface !== 'binder' && workflow === 'continuous';

  // Continuous default: CLIP+OCR channel, no Verified NEXT panel.
  useEffect(() => {
    if (!continuousEnabled) return;
    setRecognitionChannel('VISUAL_PLUS_OCR');
  }, [continuousEnabled]);

  const continuousSpaces: HiResSpaces | null = useMemo(() => {
    const s = result?.spaces;
    if (!s?.detector) return null;
    return {
      detector: s.detector,
      oriented: s.oriented,
      overlay: s.overlay,
      visible: s.visible,
    };
  }, [result?.spaces]);

  const continuous = useContinuousScan({
    cameraRef,
    enabled: continuousEnabled,
    flags: getContinuousFlags(),
    liveCorners: overlay?.rawCorners ?? overlay?.corners ?? null,
    liveScore: overlay?.score ?? result?.score ?? null,
    analysisSize: analysisSize ?? null,
    spaces: continuousSpaces,
    nameIndex: session.indexes.names?.index ?? null,
    runOcr: true,
  });

  useEffect(() => {
    if (!continuousEnabled) return;
    continuous.tick();
  }, [
    continuousEnabled,
    continuous.tick,
    overlay?.corners,
    overlay?.rawCorners,
    overlay?.score,
    analysisSize?.width,
    analysisSize?.height,
  ]);

  const binder = useBinder({
    cameraRef,
    enabled: surface === 'binder',
    liveCorners: overlay?.rawCorners ?? overlay?.corners ?? null,
    liveScore: overlay?.score ?? 0,
    analysisSize: analysisSize ?? null,
  });

  // Capture-flash hooks MUST stay above permission/device early returns — otherwise
  // the first device-ready render adds hooks and React aborts (instant app close).
  const [captureFlash, setCaptureFlash] = useState(false);
  const prevGeomPhase = useRef(geometryTest.ui.phase);
  useEffect(() => {
    const prev = prevGeomPhase.current;
    prevGeomPhase.current = geometryTest.ui.phase;
    if (
      scannerMode === 'geometry-test' &&
      (geometryTest.ui.phase === 'capturing' || geometryTest.ui.phase === 'captured') &&
      prev !== 'capturing' &&
      prev !== 'captured'
    ) {
      setCaptureFlash(true);
      const id = setTimeout(() => setCaptureFlash(false), 180);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [geometryTest.ui.phase, scannerMode]);

  const sessionPhaseForFlash =
    session.snapshot?.phase ??
    (overlay?.detected || result?.detected ? 'detected' : 'searching');
  const prevSessionPhase = useRef(sessionPhaseForFlash);
  useEffect(() => {
    const prev = prevSessionPhase.current;
    prevSessionPhase.current = sessionPhaseForFlash;
    if (
      scannerMode === 'normal' &&
      session.snapshot?.singleCardCapture?.pipeline === 'geometry-v2' &&
      (sessionPhaseForFlash === 'recognizing' || sessionPhaseForFlash === 'found') &&
      prev !== 'recognizing' &&
      prev !== 'found' &&
      prev !== 'ambiguous'
    ) {
      setCaptureFlash(true);
      const id = setTimeout(() => setCaptureFlash(false), 180);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [sessionPhaseForFlash, scannerMode, session.snapshot?.singleCardCapture?.pipeline]);

  // Geometry Test: prefer refined physical-card estimate from the exclusive owner.
  const geometryLiveCorners =
    scannerMode === 'geometry-test' &&
    (geometryTest.ui.phase === 'acquiring' ||
      geometryTest.ui.phase === 'capturing' ||
      geometryTest.ui.phase === 'captured')
      ? geometryTest.ui.lockedQuad ?? geometryTest.ui.liveQuad
      : null;
  const geometryOriginalCorners =
    scannerMode === 'geometry-test' && geometryTest.ui.debugOverlay
      ? geometryTest.ui.sleeveLiveQuad ?? geometryTest.ui.originalLiveQuad
      : null;
  // Diagnostic mode: draw live corners (no ease) so raw/tracked/presented stay honest.
  // Geometry Test: always follow latest refined/plausible — no presentation easing.
  // Normal consumer: ease the green presented quad toward the detector cadence.
  const presentedCorners = geometryLiveCorners
    ? geometryLiveCorners
    : liveRawPolygon
      ? overlay?.rawCorners ?? overlay?.corners ?? displayCorners
      : showDiagPolygons
        ? overlay?.corners ?? displayCorners
        : displayCorners;
  const mappedCorners = useMemo(() => {
    if (!presentedCorners || !analysisSize || layout.width === 0) return null;
    return mapCornersToOverlay(presentedCorners, analysisSize, analysisSize, layout);
  }, [analysisSize, presentedCorners, layout]);

  const mappedGeometryOriginal = useMemo(() => {
    if (!geometryOriginalCorners || !analysisSize || layout.width === 0) return null;
    return mapCornersToOverlay(geometryOriginalCorners, analysisSize, analysisSize, layout);
  }, [analysisSize, geometryOriginalCorners, layout]);

  const mappedRawCorners = useMemo(() => {
    if (!overlay?.rawCorners || !analysisSize || layout.width === 0) return null;
    return mapCornersToOverlay(overlay.rawCorners, analysisSize, analysisSize, layout);
  }, [analysisSize, layout, overlay?.rawCorners]);

  const mappedTrackedCorners = useMemo(() => {
    if (!overlay?.trackedCorners || !analysisSize || layout.width === 0) return null;
    return mapCornersToOverlay(overlay.trackedCorners, analysisSize, analysisSize, layout);
  }, [analysisSize, layout, overlay?.trackedCorners]);

  const mappedRecognitionCorners = useMemo(() => {
    if (!overlay?.recognitionCorners || !analysisSize || layout.width === 0) return null;
    return mapCornersToOverlay(overlay.recognitionCorners, analysisSize, analysisSize, layout);
  }, [analysisSize, layout, overlay?.recognitionCorners]);

  const rawQuad = useMemo(() => {
    if (!mappedRawCorners) return null;
    return [
      [mappedRawCorners.topLeft, mappedRawCorners.topRight],
      [mappedRawCorners.topRight, mappedRawCorners.bottomRight],
      [mappedRawCorners.bottomRight, mappedRawCorners.bottomLeft],
      [mappedRawCorners.bottomLeft, mappedRawCorners.topLeft],
    ] as const;
  }, [mappedRawCorners]);

  const trackedQuad = useMemo(() => {
    if (!mappedTrackedCorners) return null;
    return [
      [mappedTrackedCorners.topLeft, mappedTrackedCorners.topRight],
      [mappedTrackedCorners.topRight, mappedTrackedCorners.bottomRight],
      [mappedTrackedCorners.bottomRight, mappedTrackedCorners.bottomLeft],
      [mappedTrackedCorners.bottomLeft, mappedTrackedCorners.topLeft],
    ] as const;
  }, [mappedTrackedCorners]);

  const recognitionQuad = useMemo(() => {
    if (!mappedRecognitionCorners) return null;
    return [
      [mappedRecognitionCorners.topLeft, mappedRecognitionCorners.topRight],
      [mappedRecognitionCorners.topRight, mappedRecognitionCorners.bottomRight],
      [mappedRecognitionCorners.bottomRight, mappedRecognitionCorners.bottomLeft],
      [mappedRecognitionCorners.bottomLeft, mappedRecognitionCorners.topLeft],
    ] as const;
  }, [mappedRecognitionCorners]);

  const geometryOriginalQuad = useMemo(() => {
    if (!mappedGeometryOriginal) return null;
    return [
      [mappedGeometryOriginal.topLeft, mappedGeometryOriginal.topRight],
      [mappedGeometryOriginal.topRight, mappedGeometryOriginal.bottomRight],
      [mappedGeometryOriginal.bottomRight, mappedGeometryOriginal.bottomLeft],
      [mappedGeometryOriginal.bottomLeft, mappedGeometryOriginal.topLeft],
    ] as const;
  }, [mappedGeometryOriginal]);

  const quad = useMemo(() => {
    if (!mappedCorners) return null;
    return [
      [mappedCorners.topLeft, mappedCorners.topRight],
      [mappedCorners.topRight, mappedCorners.bottomRight],
      [mappedCorners.bottomRight, mappedCorners.bottomLeft],
      [mappedCorners.bottomLeft, mappedCorners.topLeft],
    ] as const;
  }, [mappedCorners]);

  if (!hasPermission) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Camera permission</Text>
        <Text style={styles.body}>
          Lugin needs the camera to scan cards. Microphone is not requested.
        </Text>
        <Pressable onPress={() => void requestPermission()} style={styles.button}>
          <Text style={styles.buttonLabel}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>No rear camera</Text>
        <Text style={styles.body}>
          Waiting for VisionCamera devices… Use a development build (not Expo Go).
        </Text>
      </View>
    );
  }

  const detected = overlay?.detected ?? result?.detected ?? false;
  const phase = session.snapshot?.phase ?? (detected ? 'detected' : 'searching');
  const cardRecognized =
    session.snapshot?.phase === 'found' || session.snapshot?.phase === 'ambiguous';

  /**
   * Capture-readiness polygon colors (Geometry + Normal geometry-v2):
   *   amber  = detected, not capture-safe
   *   green  = capture-safe / confirming / capturing
   *   flash  = just captured
   */
  type PolyReady = 'none' | 'detected' | 'safe' | 'captured';
  const polygonReady: PolyReady = (() => {
    if (scannerMode === 'geometry-test') {
      const g = geometryTest.ui;
      if (g.phase === 'captured' || g.phase === 'complete') return 'captured';
      if (g.phase === 'capturing') return 'safe';
      if (g.phase === 'acquiring' || g.phase === 'ready') {
        if (!g.liveQuad && !g.lockedQuad) return 'none';
        if (g.acquisitionPhase === 'searching') return 'none';
        if (g.captureSafe || g.acquisitionPhase === 'confirming' || g.lockedQuad) return 'safe';
        return 'detected';
      }
      return 'none';
    }
    if (scannerMode === 'normal' && session.snapshot?.singleCardCapture?.pipeline === 'geometry-v2') {
      // Verified result open — no live acquisition polygon.
      if (
        session.verified.phase === 'captured' ||
        session.verified.phase === 'identifying' ||
        session.verified.phase === 'result' ||
        session.verified.phase === 'failed'
      ) {
        return 'none';
      }
      // Snapshot/warp in flight — keep green like Geometry "capturing".
      if (session.verified.phase === 'acquiring') return 'safe';
      const sc = session.snapshot.singleCardCapture;
      if (phase === 'found' || phase === 'ambiguous' || phase === 'recognizing') return 'safe';
      if (phase === 'locking' || sc?.captureSafe) return 'safe';
      if (detected || sc?.phase === 'detected_not_safe' || overlay?.corners) return 'detected';
      return 'none';
    }
    // Legacy / other modes: keep prior green-when-detected behavior.
    if (detected || liveRawPolygon) return 'safe';
    return 'none';
  })();

  const lockWait = session.snapshot?.lockGates?.waiting ?? session.debug.lockGates?.waiting ?? null;
  const badgeText = !detectorOn
    ? 'DETECTOR OFF'
    : !orientation.ready
      ? counters.cameraFrames === 0
        ? 'Waiting for camera'
        : 'Initializing orientation'
      : lockWait &&
          phase !== 'found' &&
          phase !== 'ambiguous' &&
          phase !== 'recognizing' &&
          phase !== 'searching'
        ? `${phase.toUpperCase()}\nWaiting: ${lockWait}`
        : phase.toUpperCase();

  const buildReportPayload = (): DebugSharePayload => {
    const analysisResult = result;
    const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
      ?.lugin;
    return {
      analysisLongEdge: ANALYSIS_LONG_EDGES[longEdgeIndex],
      appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
      detectorEngine: actualDetectorEngine,
      requestedDetectorEngine,
      actualDetectorEngine,
      detectorFallbackReason,
      deviceLine: describeDevice(device),
      images: {
        detector: lastDetectorInput(),
        detectorUri: preview,
        hiresUri: session.debug.hiresUri,
        recognition: session.lastNormalized(),
        recognitionUri: session.debug.normalizedUri,
      },
      ocrEngine: isNativeOcrLinked()
        ? `mlkit:${getNativeOcrImplementationStatus() ?? 'linked'}`
        : 'none',
      pixelFormat: frameMeta?.pixelFormat ?? null,
      preferredSource,
      detectorInputColorCorrect: detectorColorOk,
      recognitionInputColorCorrect: recognitionColorOk,
      recognitionSource: session.debug.recognitionSource,
      stamp: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      panel: {
        counters,
        error,
        failure,
        frameMeta,
        metrics,
        orientation,
        probeResult,
        preferredSource,
        result: analysisResult
          ? {
              analysis: analysisResult.analysis,
              brightness: analysisResult.brightness,
              detected: analysisResult.detected,
              detector: analysisResult.detector,
              score: analysisResult.score,
            }
          : null,
        session: {
          ...session.debug,
          artEntries: session.indexes.art?.entries ?? null,
          artChecksum: session.indexes.art?.checksum ?? null,
          artUniqueOracles: session.indexes.art?.uniqueOracles ?? null,
          printingEntries: session.indexes.printing?.entries ?? null,
          printingChecksum: session.indexes.printing?.checksum ?? null,
          namesCount: session.indexes.names?.names ?? null,
          namesChecksum: session.indexes.names?.checksum ?? null,
        },
        snapshot: session.snapshot
          ? {
              fused: session.snapshot.fused,
              message: session.snapshot.message,
              motion: session.snapshot.motion,
              phase: session.snapshot.phase,
              quality: session.snapshot.quality,
              recognition: session.snapshot.recognition
                ? {
                    timings: session.snapshot.recognition.timings,
                    titleCandidates: session.snapshot.recognition.titleCandidates,
                    readings: session.snapshot.recognition.readings,
                    visualTop: session.snapshot.recognition.visualTop,
                    earlyIdentity: session.snapshot.recognition.earlyIdentity,
                    earlyReason: session.snapshot.recognition.earlyReason,
                    collector: session.snapshot.recognition.collector,
                    printingLookup: session.snapshot.recognition.printingLookup,
                    titleFooterConflict: session.snapshot.recognition.titleFooterConflict,
                    artMode: session.snapshot.recognition.artMode,
                  }
                : null,
              earlyShownAt: session.snapshot.earlyShownAt ?? null,
              recognizingStartedAt: session.snapshot.recognizingStartedAt ?? null,
              lockedAt: session.snapshot.lockedAt ?? null,
              finalIdentityAt: session.snapshot.finalIdentityAt ?? null,
              printingShownAt: session.snapshot.printingShownAt ?? null,
              userLatency: session.snapshot.userLatency ?? null,
              trackFrames: session.snapshot.trackFrames,
              lockGates: session.snapshot.lockGates ?? null,
              lockBlocker: session.snapshot.lockGates?.blocker ?? null,
              phaseTimeline: session.snapshot.phaseTimeline ?? [],
              recognizeInvocations: session.snapshot.recognizeInvocations ?? 0,
              detectorAttempts: session.snapshot.detectorAttempts ?? 0,
              detectorHitRate: session.snapshot.detectorHitRate ?? null,
              detectorInterval: session.snapshot.detectorInterval ?? null,
            }
          : null,
        transfer,
      },
    };
  };

  const openReport = () => {
    void (async () => {
      setReportBusy(true);
      setDebugViewer(null);
      setSaveStatus('Preparing report…');
      try {
        const prepared = await prepareDebugBundle(buildReportPayload());
        if (!prepared.ok) {
          setSaveStatus(`Report failed: ${prepared.reason}`);
          return;
        }
        setDebugViewer(prepared.bundle);
        const parts = [
          prepared.bundle.reportUri || prepared.bundle.jsonUri ? 'text' : null,
          prepared.bundle.pngUri ? 'recognition' : null,
          prepared.bundle.detectorPngUri ? 'detector' : null,
        ].filter(Boolean);
        setSaveStatus(
          parts.length > 0
            ? `Report ready (${parts.join(' + ')}) — Share or Download`
            : 'Report on screen (file write failed — text only)',
        );
        const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
          ?.lugin;
        void enqueuePreparedReport({
          appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
          bundle: prepared.bundle,
          device: device ? describeDevice(device) : null,
          scannerPhase: session.snapshot?.phase ?? phase,
        });
      } catch (err) {
        setSaveStatus(`Report crashed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setReportBusy(false);
      }
    })();
  };

  const shareReport = () => {
    if (!debugViewer) return;
    void (async () => {
      setSaveStatus('Opening share sheet…');
      const shared = await sharePreparedBundle(debugViewer);
      if (!shared.ok) {
        setSaveStatus(`Share failed: ${shared.reason}`);
        return;
      }
      setSaveStatus(
        shared.method === 'sharing'
          ? 'Shared text → recognition → detector (pick same app each time)'
          : 'Text share opened',
      );
    })();
  };

  const downloadReport = () => {
    if (!debugViewer) return;
    void (async () => {
      setSaveStatus('Choose a folder to save…');
      const saved = await downloadPreparedBundle(debugViewer);
      if (!saved.ok) {
        if (saved.cancelled) {
          setSaveStatus('Download cancelled');
          return;
        }
        setSaveStatus(`Download failed: ${saved.reason}`);
        return;
      }
      setSaveStatus(
        saved.method === 'saf'
          ? `Saved ${saved.saved.join(', ')}`
          : `Saved to ${saved.directoryHint}: ${saved.saved.join(', ')}`,
      );
    })();
  };

  const saveMissFrame = () => {
    if (trainBusy) return;
    void (async () => {
      setTrainBusy(true);
      try {
        const det = lastDetectorInput();
        const analysis = result;
        const saved = await saveTrainingCapture({
          detector: det,
          recognition: session.lastNormalized(),
          meta: {
            detected: Boolean(overlay?.detected ?? analysis?.detected),
            detectorEngine: actualDetectorEngine,
            requestedDetectorEngine,
            actualDetectorEngine,
            detectorFallbackReason,
            note: 'manual-save-for-training',
            phase: session.snapshot?.phase ?? phase,
            recognitionSource: session.debug.recognitionSource,
            score: overlay?.score ?? analysis?.score ?? null,
            status: session.snapshot?.fused?.status ?? null,
          },
        });
        if (!saved.ok) {
          setSaveStatus(`Save frame failed: ${saved.reason}`);
          return;
        }
        setSaveStatus(`Training frame saved → ${saved.directoryHint}`);
        const shared = await shareTrainingDetectorPng(saved.directoryHint);
        if (!shared.ok && shared.reason !== 'sharing unavailable') {
          setSaveStatus(`Saved locally (${saved.directoryHint}); share: ${shared.reason}`);
        }
      } catch (err) {
        setSaveStatus(`Save frame crashed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setTrainBusy(false);
      }
    })();
  };

  const captureGeometryTrace = () => {
    if (traceBusy || isGeometryTraceActive()) return;
    const started = startGeometryTrace({
      actualDetectorEngine,
      detectorInput: overlay?.analysis ?? result?.analysis ?? null,
      detectorIntervalP50: metrics?.detectMs.p50 ?? null,
      detectorIntervalP95: metrics?.detectMs.p95 ?? null,
      lockBlocker: session.snapshot?.lockGates?.blocker ?? null,
      orientation: orientation.desired,
      phase: session.snapshot?.phase ?? phase,
      previewCrop: result?.spaces.visible ?? null,
      rowStride: frameMeta?.bytesPerRow ?? null,
    });
    if (!started) return;
    setTraceBusy(true);
    setTraceDir(null);
    setTraceCount(0);
    setTraceElapsedMs(0);
    setTraceUpload('idle');
    setTraceId(null);
    setSaveStatus('Capturing geometry trace… hold the card still');
    const t0 = Date.now();
    const iv = setInterval(() => {
      setTraceElapsedMs(Date.now() - t0);
      const n = geometryTraceSampleCount();
      setTraceCount(n);
      if (n >= 40 || Date.now() - t0 >= 3100) {
        clearInterval(iv);
        void (async () => {
          const bundle = finishGeometryTrace();
          setTraceBusy(false);
          if (!bundle) {
            setSaveStatus('Geometry trace empty — keep the detector on and retry');
            return;
          }
          const saved = await writeGeometryTraceFiles(bundle);
          if (!saved.ok) {
            setSaveStatus(`Geometry trace failed: ${saved.reason}`);
            return;
          }
          setTraceDir(saved.uri);
          setTraceCount(saved.sampleCount);
          setSaveStatus(`Trace saved ✓ · ${saved.sampleCount} detector samples`);
          const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
            ?.lugin;
          const queued = await enqueueGeometryTrace({
            appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
            device: device ? describeDevice(device) : null,
            dirUri: saved.uri,
            scannerPhase: session.snapshot?.phase ?? phase,
          });
          if (queued.queued && queued.traceId) {
            setTraceId(queued.traceId);
            setTraceUpload('pending');
            setSaveStatus(`Trace saved ✓ · uploading ${queued.traceId}…`);
          } else {
            setTraceUpload('failed');
          }
        })();
      }
    }, 80);
  };

  const shareSavedGeometryTrace = () => {
    if (!traceDir) return;
    void shareGeometryTrace(traceDir).then(out => {
      if (!out.ok) setSaveStatus(`Share geometry trace: ${out.reason ?? 'failed'}`);
    });
  };

  return (
    <View onLayout={onLayout} style={styles.root}>
      <Camera
        ref={cameraRef}
        device={device}
        enableNativeTapToFocusGesture={false}
        implementationMode={preferredSource === 'snapshot' ? 'compatible' : 'performance'}
        isActive={appActive}
        orientationSource="interface"
        outputs={cameraOutputs}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        zoom={1}
      />

      {/* Tap-to-focus must not cover exclusive HUDs — it eats START/Retry presses. */}
      {exclusiveOwner ? null : (
        <Pressable onPress={onTap} style={StyleSheet.absoluteFill} />
      )}

      {benchHud.active && showNormalResultUi ? (
        <View style={{ paddingTop: insets.top }}>
          <BenchmarkHud
            count={benchHud.count}
            lastCorrect={benchHud.lastCorrect}
            lastLatencyOracleMs={benchHud.lastLatencyOracleMs}
            lastLatencyPrintingMs={benchHud.lastLatencyPrintingMs}
            lastName={benchHud.lastName}
            onEnd={() => {
              void endBenchmarkSession().then(() => setBenchHud(peekBenchmarkHud()));
            }}
            summaryText={benchHud.summaryText}
            target={benchHud.target}
          />
        </View>
      ) : null}

      {quad || rawQuad || trackedQuad || recognitionQuad || geometryOriginalQuad ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {geometryOriginalQuad
            ? geometryOriginalQuad.map(([a, b], i) => (
                <View
                  key={`gorig-${i}`}
                  style={[styles.edge, edgeStyle(a, b), styles.edgeGeometryOriginal]}
                />
              ))
            : null}
          {showDiagPolygons && rawQuad
            ? rawQuad.map(([a, b], i) => (
                <View key={`raw-${i}`} style={[styles.edge, edgeStyle(a, b), styles.edgeRaw]} />
              ))
            : null}
          {showDiagPolygons && trackedQuad
            ? trackedQuad.map(([a, b], i) => (
                <View key={`trk-${i}`} style={[styles.edge, edgeStyle(a, b), styles.edgeTracked]} />
              ))
            : null}
          {showDiagPolygons && recognitionQuad
            ? recognitionQuad.map(([a, b], i) => (
                <View key={`rec-${i}`} style={[styles.edge, edgeStyle(a, b), styles.edgeRecognition]} />
              ))
            : null}
          {(!isBinderMode(scannerMode) && surface !== 'binder') || forceDebugOverlay
            ? quad
              ? quad.map(([a, b], i) => (
                  <View
                    key={i}
                    style={[
                      styles.edge,
                      edgeStyle(a, b),
                      polygonReady === 'safe' || polygonReady === 'captured'
                        ? styles.edgeOn
                        : polygonReady === 'detected'
                          ? styles.edgeDetected
                          : styles.edgeWeak,
                      captureFlash && styles.edgeCaptureFlash,
                    ]}
                  />
                ))
              : null
            : null}
          {captureFlash ? <View pointerEvents="none" style={styles.captureFlashVeil} /> : null}
          {showDiagPolygons && showNumbers && mappedCorners
            ? (
                [
                  ['1', mappedCorners.topLeft],
                  ['2', mappedCorners.topRight],
                  ['3', mappedCorners.bottomRight],
                  ['4', mappedCorners.bottomLeft],
                ] as const
              ).map(([n, p]) => (
                <Text key={n} style={[styles.cornerNum, { left: p.x - 6, top: p.y - 8 }]}>
                  {n}
                </Text>
              ))
            : null}
        </View>
      ) : null}

      {focusPoint ? (
        <View
          pointerEvents="none"
          style={[
            styles.reticle,
            {
              borderColor:
                focusState === 'error'
                  ? '#FF8A80'
                  : focusState === 'focusing'
                    ? '#F5C542'
                    : '#7CFFB2',
              left: focusPoint.x - 28,
              top: focusPoint.y - 28,
            },
          ]}
        />
      ) : null}

      {/*
        A single flex column rather than separately anchored bars: the previous
        layout floated the metrics panel behind the controls, which made the
        numbers unscreenshottable. Here the panel gets a bounded share of the
        height and the controls always sit below it.
      */}
      <View
        pointerEvents="box-none"
        style={[
          styles.overlay,
          { paddingBottom: Math.max(insets.bottom, 12), paddingTop: insets.top + 8 },
        ]}
      >
        <View pointerEvents="box-none" style={styles.topBar}>
          <Text
            style={[
              styles.badge,
              (detected || phase === 'found' || phase === 'locking') && styles.badgeOn,
              detectorOn && !orientation.ready && styles.badgeWait,
            ]}
          >
            {badgeText}
          </Text>
          <Text numberOfLines={2} style={styles.deviceLine}>
            {describeDevice(device)}
          </Text>
          {forceDebugOverlay &&
          scannerMode === 'normal' &&
          session.snapshot?.singleCardCapture?.pipeline === 'geometry-v2' ? (
            <Text style={styles.saveStatus} numberOfLines={3}>
              {(() => {
                const d = session.snapshot.singleCardCapture?.derivedMs;
                const fmt = (ms: number | null | undefined) =>
                  ms == null || !Number.isFinite(ms) ? '—' : `${Math.round(ms)}ms`;
                return `v2 QUAD ${fmt(d?.sessionToFirstQuadMs)} · SAFE ${fmt(
                  d?.firstQuadToSafeMs != null && d?.sessionToFirstQuadMs != null
                    ? d.sessionToFirstQuadMs + d.firstQuadToSafeMs
                    : null,
                )} · LOCK ${fmt(
                  d?.sessionToFirstQuadMs != null &&
                    d?.firstQuadToSafeMs != null &&
                    d?.safeToLockMs != null
                    ? d.sessionToFirstQuadMs + d.firstQuadToSafeMs + d.safeToLockMs
                    : null,
                )} · CAP ${fmt(d?.lockToCaptureDoneMs)} · OCR→ID ${fmt(d?.recognitionStartToIdentityMs)}`;
              })()}
            </Text>
          ) : null}
          {saveStatus ? (
            <Text style={styles.saveStatus} numberOfLines={2}>
              {saveStatus}
            </Text>
          ) : null}
          {isBenchmarkToolsEnabled() && !labOpen ? (
            exclusiveOwner ? (
              <Pressable
                onPress={() => setForceDebugOverlay(v => !v)}
                style={[styles.abButton, forceDebugOverlay && styles.chipOn]}
              >
                <Text style={styles.abButtonLabel}>
                  Debug overlay {forceDebugOverlay ? 'on' : 'off'}
                </Text>
              </Pressable>
            ) : null
          ) : null}
        </View>

        <View pointerEvents="none" style={styles.spacer} />

        {swapActive || swapTest.ui.phase === 'done' ? (
          <View pointerEvents="box-none" style={styles.swapOverlay}>
            <View
              style={[
                styles.swapBanner,
                swapTest.ui.phase === 'swap-now' ? styles.swapBannerAlert : null,
              ]}
            >
              <Text style={styles.swapTitle}>
                Swap Test {Math.max(1, swapTest.ui.index)} / {swapTest.ui.targetCount}
              </Text>
              <Text style={styles.swapLine}>
                Current: geom {swapTest.ui.geometryTrackId ?? '—'} · session{' '}
                {swapTest.ui.cardSessionId ?? '—'}
              </Text>
              <Text
                style={[
                  styles.swapState,
                  swapTest.ui.phase === 'swap-now' ? styles.swapStateAlert : null,
                ]}
              >
                {swapTest.ui.phase === 'waiting-stable'
                  ? 'waiting for stable card'
                  : swapTest.ui.phase === 'capturing'
                    ? 'captured…'
                    : swapTest.ui.phase === 'swap-now'
                      ? 'SWAP CARD'
                      : swapTest.ui.phase === 'waiting-next'
                        ? 'waiting for next card'
                        : swapTest.ui.phase === 'done'
                          ? swapTest.ui.message || 'done'
                          : swapTest.ui.message}
              </Text>
            </View>
            {swapTest.ui.showMarkSwapped ? (
              <Pressable onPress={swapTest.markSwapped} style={styles.swapMarkBtn}>
                <Text style={styles.swapMarkLabel}>Mark card swapped</Text>
              </Pressable>
            ) : null}
            {swapTest.ui.phase !== 'done' ? (
              <Pressable onPress={swapTest.cancel} style={styles.swapCancelBtn}>
                <Text style={styles.swapCancelLabel}>Cancel</Text>
              </Pressable>
            ) : (
              <Pressable onPress={swapTest.cancel} style={styles.swapCancelBtn}>
                <Text style={styles.swapCancelLabel}>Dismiss</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {showNormalResultUi &&
        surface !== 'binder' &&
        workflow !== 'continuous' &&
        isGeometryV2Pipeline() &&
        session.verified.phase === 'acquiring' ? (
          <View pointerEvents="none" style={styles.verifiedCaptureBanner}>
            <Text style={styles.verifiedCaptureBannerLabel}>CAPTURE</Text>
          </View>
        ) : null}

        {showNormalResultUi &&
        surface !== 'binder' &&
        workflow !== 'continuous' &&
        isGeometryV2Pipeline() &&
        session.verified.phase !== 'ready' &&
        session.verified.phase !== 'acquiring' &&
        (session.verified.warpUri ||
          session.verified.phase === 'captured' ||
          session.verified.phase === 'identifying' ||
          session.verified.phase === 'result' ||
          session.verified.phase === 'failed') ? (
          <View style={styles.resultWrap}>
            <VerifiedScanPanel
              inboxPaired={Boolean(isBenchmarkToolsEnabled())}
              onRetake={() => {
                setPendingAdd(null);
                session.verified.retake();
              }}
              onRetryRecognition={() => {
                void session.verified.retryRecognition();
              }}
              onUploadNext={() => {
                // Clear status immediately — uploadNext advances UI before encode.
                setPendingAdd('Skipping… diagnostics continue');
                void session.verified.uploadNext().then(msg => {
                  setPendingAdd(msg);
                });
              }}
              onWarpLoaded={() => session.verified.armRecognize()}
              snapshot={session.snapshot}
              verifiedPhase={session.verified.phase}
              warpUri={session.verified.warpUri}
            />
          </View>
        ) : showNormalResultUi &&
          !isGeometryV2Pipeline() &&
          session.snapshot &&
          (session.snapshot.phase === 'found' || session.snapshot.phase === 'ambiguous') ? (
          <View style={styles.resultWrap}>
            <ScanResultCard
              nameIndex={session.indexes.names?.index ?? null}
              printingIndex={session.indexes.printing?.index ?? null}
              onAction={(action, extra) => {
                if (!showNormalResultUi) return;
                if (action === 'scan-again') {
                  session.reset();
                  return;
                }
                if (action === 'set-finish' && extra?.finish) {
                  setPendingAdd(`finish: ${extra.finish}`);
                  return;
                }
                if (action === 'add') {
                  const name = session.snapshot?.fused?.card?.name;
                  setPendingAdd(name ? `queued add: ${name}` : 'queued add (unnamed)');
                  const printing = extra?.printing;
                  if (printing) collectionAddFromPrinting(printing);
                }
                if (action === 'wrong-card' && extra?.name) {
                  setPendingAdd(`correction: ${extra.name}`);
                }
                if (action === 'wrong-printing' && extra?.printing) {
                  collectionAddFromPrinting(extra.printing);
                  setPendingAdd(`printing: ${extra.printing.setCode} ${extra.printing.collectorNumber}`);
                }
              }}
              snapshot={session.snapshot}
            />
            <View style={styles.resultActions}>
              <Pressable
                disabled={reportBusy}
                onPress={openReport}
                style={[styles.reportButton, styles.resultActionBtn, reportBusy && styles.reportButtonBusy]}
              >
                <Text style={styles.reportButtonLabel}>
                  {reportBusy ? 'Preparing…' : 'Report'}
                </Text>
              </Pressable>
              <Pressable
                disabled={trainBusy}
                onPress={saveMissFrame}
                style={[
                  styles.reportButton,
                  styles.resultActionBtn,
                  styles.trainButton,
                  trainBusy && styles.reportButtonBusy,
                ]}
              >
                <Text style={styles.reportButtonLabel}>
                  {trainBusy ? 'Saving…' : 'Save frame'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {showNormalResultUi && pendingAdd ? (
          <Text style={styles.pendingAdd}>{pendingAdd}</Text>
        ) : null}

        {/* Prominent save when we have a card in view but no identity yet */}
        {showAllTools && !cardRecognized && (phase === 'locking' || phase === 'recognizing' || detected) ? (
          <View style={styles.missWrap}>
            <Pressable
              disabled={trainBusy}
              onPress={saveMissFrame}
              style={[styles.trainButtonLarge, trainBusy && styles.reportButtonBusy]}
            >
              <Text style={styles.reportButtonLabel}>
                {trainBusy ? 'Saving training frame…' : 'Save detector frame (for training)'}
              </Text>
            </Pressable>
            {panel === 'scan' && detected ? (
              <>
                <Pressable
                  onPress={() => {
                    void (async () => {
                      setSaveStatus('Force snapshot…');
                      const out = await session.forceSnapshot();
                      setSaveStatus(
                        out.ok
                          ? `Force snapshot OK ${out.width ?? '?'}×${out.height ?? '?'} · ${out.captureMs ?? '?'} ms`
                          : `Force snapshot failed: ${out.reason}`,
                      );
                    })();
                  }}
                  style={styles.trainButtonLarge}
                >
                  <Text style={styles.reportButtonLabel}>Force high-res snapshot</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void (async () => {
                      setSaveStatus('Force recognize…');
                      const snap = await session.forceRecognize();
                      const pl = snap.postLock;
                      setSaveStatus(
                        snap.fused?.card?.name
                          ? `Force recognize → ${snap.fused.card.name}`
                          : `Force recognize · ${pl?.recognitionStatus ?? snap.phase} · OCR "${pl?.titleRawText ?? ''}" · ${pl?.titleTopCandidate ?? snap.message} · hi-res ${pl?.highResSuccess ?? 0}/${pl?.highResRequests ?? 0} · IoU ${pl?.quadIouCaptureVsLatest != null ? pl.quadIouCaptureVsLatest.toFixed(2) : '—'}`,
                      );
                    })();
                  }}
                  style={styles.trainButtonLarge}
                >
                  <Text style={styles.reportButtonLabel}>Force recognize current card</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {panel === 'scan' ? (
          <View style={styles.panelWrap}>
            <View style={styles.missWrap}>
              {(() => {
                const adapter = getOcrAdapterSnapshot();
                const last = session.snapshot?.postLock?.recognitionStatus ?? 'not run';
                const ocrLine = !adapter.textRecognizerCreated
                  ? `unavailable${adapter.lastOcrAdapterError ? `: ${adapter.lastOcrAdapterError}` : ''}`
                  : adapter.warmupState === 'warming'
                    ? 'warming'
                    : adapter.lastOcrAdapterError
                      ? `error: ${adapter.lastOcrAdapterError}`
                      : 'ready';
                return (
                  <Text style={styles.saveStatus} numberOfLines={3}>
                    {`OCR: ${ocrLine}\nTransport: ${adapter.transport}\nLast attempt: ${last}`}
                  </Text>
                );
              })()}
              {ocrUnavailableReason() ? (
                <Text style={styles.saveStatus}>{`OCR unavailable: ${ocrUnavailableReason()}`}</Text>
              ) : null}
              {isBenchmarkToolsEnabled() ? (
                <Pressable
                  disabled={labOpening || qualityBusy || seriesBusy || exclusiveOwner}
                  onPress={() => void openScannerLab()}
                  style={[styles.trainButtonLarge, labOpening && styles.reportButtonBusy]}
                >
                  <Text style={styles.reportButtonLabel}>
                    {labOpening ? 'Opening…' : 'Scanner Lab'}
                  </Text>
                </Pressable>
              ) : null}
              {isBenchmarkToolsEnabled() && showAllTools ? (
                <Pressable
                  disabled={qualityBusy || seriesBusy || exclusiveOwner}
                  onPress={onCaptureQualityAb}
                  style={[styles.trainButtonLarge, qualityBusy && styles.reportButtonBusy]}
                >
                  <Text style={styles.reportButtonLabel}>
                    {qualityBusy ? 'A/B… keep card in view' : 'Capture A/B'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={traceBusy || isGeometryTraceActive()}
                onPress={captureGeometryTrace}
                style={[styles.trainButtonLarge, traceBusy && styles.reportButtonBusy]}
              >
                <Text style={styles.reportButtonLabel}>
                  {traceBusy
                    ? `Capturing… ${(traceElapsedMs / 1000).toFixed(1)}s / 3.0s`
                    : traceDir
                      ? `Trace saved ✓${traceUpload === 'uploaded' ? ' · Uploaded ✓' : traceUpload === 'pending' ? ' · Pending' : ''}`
                      : 'Capture geometry trace'}
                </Text>
              </Pressable>
              {showAllTools && traceDir ? (
                <Pressable onPress={shareSavedGeometryTrace} style={styles.trainButtonLarge}>
                  <Text style={styles.reportButtonLabel}>Share geometry trace</Text>
                </Pressable>
              ) : null}
              {showAllTools && detected ? (
                <Pressable
                  onPress={() => {
                    void (async () => {
                      setSaveStatus('Force lock…');
                      const snap = await session.forceLock();
                      setSaveStatus(
                        snap.fused?.card?.name
                          ? `Force lock → ${snap.fused.card.name}`
                          : `Force lock · ${snap.phase} · ${snap.message}`,
                      );
                    })();
                  }}
                  style={styles.trainButtonLarge}
                >
                  <Text style={styles.reportButtonLabel}>Force lock current track</Text>
                </Pressable>
              ) : null}
            </View>
            {showAllTools ? (
            <ScanDebugPanel
              analysisLongEdge={ANALYSIS_LONG_EDGES[longEdgeIndex]}
              counters={counters}
              diagnosticRungs={diagnosticRungs}
              error={error}
              failure={failure}
              frameMeta={frameMeta}
              jsLag={jsLag}
              metrics={metrics}
              orientation={orientation}
              ping={ping}
              preview={preview}
              probeResult={probeResult}
              result={result}
              rung={RUNGS[rungIndex]}
              session={{
                artCandidates: session.debug.artCandidates,
                artEntries: session.indexes.art?.entries ?? null,
                artError: session.debug.artError,
                artGenerated: session.debug.artGenerated,
                artChecksum: session.indexes.art?.checksum ?? null,
                artUniqueOracles: session.indexes.art?.uniqueOracles ?? null,
                artworkDescriptorMs: session.debug.artworkDescriptorMs,
                artworkMatcherMs: session.debug.artworkMatcherMs,
                artworkMs: session.debug.artworkMs,
                captureMs: session.debug.captureMs,
                convertMs: session.debug.convertMs,
                footerEvidence: session.debug.footerEvidence,
                hiresPhase: session.debug.hiresPhase,
                hiresStats: session.debug.hiresStats,
                hiresUri: session.debug.hiresUri,
                hiresWaitMs: session.debug.hiresWaitMs,
                mappedCorners: session.debug.mappedCorners,
                names: session.indexes.names?.names ?? null,
                printingEntries: session.indexes.printing?.entries ?? null,
                normalizedUri: session.debug.normalizedUri,
                phase,
                lockGates: session.snapshot?.lockGates ?? session.debug.lockGates ?? null,
                recognizeInvocations: session.debug.recognizeInvocations ?? 0,
                selectedRole: session.snapshot?.detection?.selectedRole ?? null,
                continuityReason: session.snapshot?.detection?.continuityReason ?? null,
                qualityBest: session.snapshot?.quality?.score ?? session.debug.qualityBest,
                qualityExposure: session.snapshot?.quality?.exposure,
                qualityGlare: session.snapshot?.quality?.glare,
                qualitySharpness: session.snapshot?.quality?.sharpness,
                recognitionSource: session.debug.recognitionSource,
                sourceHeight: session.debug.sourceHeight,
                sourceLabel: session.debug.sourceLabel,
                sourceWidth: session.debug.sourceWidth,
                stable: (session.snapshot?.motion ?? 1) < 0.04 && (session.snapshot?.trackFrames ?? 0) >= 3,
                temporalLeader: session.debug.temporalLeader,
                temporalObservations: session.debug.temporalObservations,
                temporalResetReason: session.debug.temporalResetReason,
                textEvidence: session.debug.textEvidence,
                titleEvidence: session.debug.titleEvidence,
                trackFrames: session.snapshot?.trackFrames ?? 0,
                warpMs: session.debug.warpMs,
                userLatency: session.debug.userLatency,
                earlyReason: session.debug.earlyReason,
                titleMs: session.debug.titleMs,
                titleDoneAt: session.debug.titleDoneAt,
                artDoneAt: session.debug.artDoneAt,
                earlyIdentityAt: session.debug.earlyIdentityAt,
                ocrPipeline: session.debug.ocrPipeline,
                ocrAdapter: session.debug.ocrAdapter,
                acceptance: (() => {
                  const data = getScannerDataStatus();
                  const printing = session.snapshot?.fused?.printing;
                  return {
                    detectorActual: actualDetectorEngine,
                    names: data.names,
                    printing: data.printingEntries,
                    type: data.typeOracles,
                    art: data.artEntries,
                    lastName:
                      session.snapshot?.fused?.card?.name ?? printing?.name ?? null,
                    lastPrinting: printing
                      ? `${(printing.setCode ?? '').toUpperCase()} #${printing.collectorNumber ?? '?'}`
                      : null,
                    lockToOracleMs: session.debug.userLatency?.lockToFirstOracleMs ?? null,
                    lockToPrintingMs: session.debug.userLatency?.lockToPrintingMs ?? null,
                  };
                })(),
              }}
              onStartCardSwapTest={
                isBenchmarkToolsEnabled() && !swapActive && !deckBench.active && !binderBench.active
                  ? () => swapTest.openConfig()
                  : undefined
              }
              onStartDeckBenchmark={
                isBenchmarkToolsEnabled() && !swapActive && !deckBench.active && !binderBench.active
                  ? () => deckBench.openConfig()
                  : undefined
              }
              onStartBinderBenchmark={
                isBenchmarkToolsEnabled() && !swapActive && !deckBench.active && !binderBench.active
                  ? () => binderBench.openConfig()
                  : undefined
              }
              realBenchmarkStatus={realBenchStatus}
              showNumbers={showNumbers}
              transfer={transfer}
            />
            ) : null}
          </View>
        ) : null}

        {panel === 'camera' ? (
          <View style={styles.panelWrap}>
            <CameraDebugPanel
              device={device}
              focusPoint={focusPoint}
              focusState={focusState}
              lastFocusError={lastFocusError}
              rearDeviceCount={rearDevices.length}
            />
          </View>
        ) : null}

        {continuousEnabled ? <ContinuousHud ui={continuous.ui} /> : null}

        {scannerMode === 'geometry-test' ? null : (
        <View style={styles.bottomBar}>
          <Pressable onPress={cycleDevice} style={styles.chip}>
            <Text style={styles.chipLabel}>Lens ({rearDevices.length})</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const next = cycleSingleScanWorkflow();
              setWorkflow(next);
              if (next === 'continuous') {
                setRecognitionChannel('VISUAL_PLUS_OCR');
                continuous.reset();
              }
              setPerfTick(t => t + 1);
            }}
            style={[styles.chip, workflow === 'continuous' && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>
              {workflow === 'continuous' ? 'Continuous' : 'Verified'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDetectorOn(v => !v)}
            style={[styles.chip, detectorOn && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>Detector {detectorOn ? 'on' : 'off'}</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              setPanel(panel === 'scan' ? 'camera' : panel === 'camera' ? 'none' : 'scan')
            }
            style={[styles.chip, panel === 'scan' && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>
              {panel === 'scan' ? 'Scan dbg' : panel === 'camera' ? 'Cam dbg' : 'No panel'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowAllTools(v => !v)}
            style={[styles.chip, showAllTools && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{showAllTools ? 'All tools ON' : 'All tools'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              cycleRecognitionChannel({ includeVisual: true });
              const mode = getRecognitionChannel();
              // Edition needs PrintingIndex; art needs matcher (usually already loaded).
              if (mode === 'EDITION_OCR') {
                setPerfBaseline({ heavyIndexesWhileScanning: true, footerOcr: true });
              } else if (mode === 'ART_ONLY' || mode === 'OCR_AND_ART') {
                setPerfBaseline({ artwork: true });
              }
              setPerfTick(t => t + 1);
            }}
            style={[
              styles.chip,
              getRecognitionChannel() !== 'OCR_ONLY' && styles.chipOn,
            ]}
          >
            <Text style={styles.chipLabel}>
              Rec {RECOGNITION_CHANNEL_LABELS[getRecognitionChannel()]}
            </Text>
          </Pressable>
          {showAllTools ? (
          <>
          <Pressable
            onPress={() => {
              const next =
                getPerfBaseline().detectorHz === PERF_BASELINE_HZ ? 'full' : 'baseline';
              applyPerfPreset(next);
              setNativeNestedSleeveEnabled(getPerfBaseline().nestedSleeve);
              setLongEdgeIndex(
                Math.max(
                  0,
                  ANALYSIS_LONG_EDGES.indexOf(
                    getPerfBaseline().analysisLongEdge as (typeof ANALYSIS_LONG_EDGES)[number],
                  ),
                ),
              );
              setPerfTick(t => t + 1);
            }}
            style={[
              styles.chip,
              getPerfBaseline().detectorHz === PERF_BASELINE_HZ && styles.chipOn,
            ]}
          >
            <Text style={styles.chipLabel}>
              {getPerfBaseline().detectorHz === PERF_BASELINE_HZ ? 'Perf baseline' : 'Perf full'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const on = !getPerfBaseline().ocrWarmup;
              setPerfBaseline({ ocrWarmup: on });
              setPerfTick(t => t + 1);
            }}
            style={[styles.chip, getPerfBaseline().ocrWarmup && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>
              Warmup {getPerfBaseline().ocrWarmup ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const on = !getPerfBaseline().nestedSleeve;
              setPerfBaseline({ nestedSleeve: on });
              setNativeNestedSleeveEnabled(on);
              setPerfTick(t => t + 1);
            }}
            style={[styles.chip, getPerfBaseline().nestedSleeve && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>
              Sleeve {getPerfBaseline().nestedSleeve ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const on = !getPerfBaseline().liveDebugImages;
              setPerfBaseline({ liveDebugImages: on });
              setPerfTick(t => t + 1);
            }}
            style={[styles.chip, getPerfBaseline().liveDebugImages && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>
              Live PNG {getPerfBaseline().liveDebugImages ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              setDetectorEngineId(id => {
                if (id === 'shared-js' && isNativeDetectorLinked()) return 'native';
                return 'shared-js';
              })
            }
            style={[styles.chip, detectorEngineId === 'native' && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>
              Eng {detectorEngineId === 'native' ? 'Native' : 'Shared JS'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDiagnosticRungs(v => !v)}
            style={[styles.chip, diagnosticRungs && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{diagnosticRungs ? 'Ladder on' : 'Fast path'}</Text>
          </Pressable>
          {diagnosticRungs ? (
            <Pressable
              onPress={() => setRungIndex(i => (i + 1) % RUNGS.length)}
              style={styles.chip}
            >
              <Text style={styles.chipLabel}>Rung: {RUNGS[rungIndex]}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setLongEdgeIndex(i => (i + 1) % ANALYSIS_LONG_EDGES.length)}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Long {ANALYSIS_LONG_EDGES[longEdgeIndex]}</Text>
          </Pressable>
          <Pressable
            onPress={() => setSourceIndex(i => (i + 1) % RECOGNITION_SOURCES.length)}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Src {preferredSource}</Text>
          </Pressable>
          <Pressable
            onPress={() => setResolutionIndex(i => (i + 1) % RESOLUTIONS.length)}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>
              {resolution.width}×{resolution.height}
            </Text>
          </Pressable>
          <Pressable onPress={testCurrentFrame} style={styles.chip}>
            <Text style={styles.chipLabel}>Test frame</Text>
          </Pressable>
          <Pressable onPress={() => setShowNumbers(v => !v)} style={styles.chip}>
            <Text style={styles.chipLabel}>Corners {showNumbers ? 'on' : 'off'}</Text>
          </Pressable>
          <Pressable onPress={resetCounters} style={styles.chip}>
            <Text style={styles.chipLabel}>Reset</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setDetectorColorOk(v => (v === 'unverified' ? 'yes' : v === 'yes' ? 'no' : 'unverified'));
            }}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Det color {detectorColorOk}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setRecognitionColorOk(v =>
                v === 'unverified' ? 'yes' : v === 'yes' ? 'no' : 'unverified',
              );
            }}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Rec color {recognitionColorOk}</Text>
          </Pressable>
          {!cardRecognized ? (
            <Pressable
              disabled={reportBusy}
              onPress={openReport}
              style={[styles.chip, styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{reportBusy ? 'Report…' : 'Report'}</Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={trainBusy}
            onPress={saveMissFrame}
            style={[styles.chip, styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{trainBusy ? 'Saving…' : 'Save frame'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (layout.width > 0) void focusAt(layout.width / 2, layout.height / 2);
            }}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Focus center</Text>
          </Pressable>
          </>
          ) : null}
        </View>
        )}
      </View>

      {/* Exclusive HUDs above overlay/chrome so START / Retry / NEXT actually receive presses. */}
      <View
        style={[StyleSheet.absoluteFill, { paddingTop: insets.top, zIndex: 200, elevation: 200 }]}
        pointerEvents="box-none"
      >
        <DeckBenchmarkHud
          ui={deckBench.ui}
          onCancel={deckBench.cancel}
          onManualNext={deckBench.markManualNext}
          onResume={() => void deckBench.resume()}
          onDiscard={() => void deckBench.discardInterrupted()}
          onFinish={() => void deckBench.finishEarly()}
          onRetryUpload={() => void deckBench.retryMissingUpload()}
        />
        <BinderBenchmarkHud
          ui={binderBench.ui}
          onCancel={binderBench.cancel}
          onNextPage={() => void binderBench.nextPage()}
          onResume={() => void binderBench.resume()}
          onDiscard={() => void binderBench.discardInterrupted()}
          onFinish={() => void binderBench.finishEarly()}
          onRetryUpload={() => void binderBench.retryMissingUpload()}
        />
        <GeometryTestHud
          ui={geometryTest.ui}
          onStart={geometryTest.start}
          onNext={geometryTest.next}
          onCancel={geometryTest.cancel}
          onFinish={geometryTest.finish}
          onCaptureCurrent={geometryTest.captureCurrent}
          onRetryUpload={() => void geometryTest.retryMissingUpload()}
          onToggleDebug={() => geometryTest.setDebugOverlay(!geometryTest.ui.debugOverlay)}
          onFocusMode={geometryTest.setFocusMode}
          onPreviewKind={geometryTest.setPreviewKind}
          onPreviewDisplayed={geometryTest.markPreviewDisplayed}
        />
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setDebugViewer(null)}
        transparent
        visible={Boolean(debugViewer)}
      >
        <View style={styles.debugModalBackdrop}>
          <View
            style={[
              styles.debugModal,
              { paddingBottom: Math.max(insets.bottom, 12), paddingTop: insets.top + 8 },
            ]}
          >
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Scan report</Text>
              <Pressable
                onPress={() => setDebugViewer(null)}
                style={[styles.chip, styles.chipOn, styles.debugModalClose]}
              >
                <Text style={styles.chipLabel}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.debugModalHint}>
              Share sends text, then recognition PNG, then detector-input PNG (three sheets).
              Download saves .txt + .json + both PNGs. Use detector PNG to judge detector color.
            </Text>
            <View style={styles.debugModalActions}>
              <Pressable onPress={shareReport} style={[styles.reportButton, styles.reportAction]}>
                <Text style={styles.reportButtonLabel}>Share</Text>
              </Pressable>
              <Pressable
                onPress={downloadReport}
                style={[styles.reportButton, styles.reportAction, styles.reportSecondary]}
              >
                <Text style={styles.reportButtonLabel}>Download</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.debugModalScroll}
              style={styles.debugModalScrollView}
            >
              {debugViewer?.imageUri ? (
                <>
                  <Text style={styles.debugModalCaption}>Recognition (744×1039)</Text>
                  <Image
                    resizeMode="contain"
                    source={{ uri: debugViewer.imageUri }}
                    style={styles.debugModalImage}
                  />
                </>
              ) : (
                <Text style={styles.debugModalHint}>
                  No recognition image yet — lock a card first, then Report again.
                </Text>
              )}
              {debugViewer?.detectorImageUri ? (
                <>
                  <Text style={styles.debugModalCaption}>Detector input (analysis FOV)</Text>
                  <Image
                    resizeMode="contain"
                    source={{ uri: debugViewer.detectorImageUri }}
                    style={styles.debugModalImage}
                  />
                </>
              ) : (
                <Text style={styles.debugModalHint}>
                  No detector input latched — keep scanning a moment, then Report again.
                </Text>
              )}
              <Text selectable style={styles.debugModalText}>
                {(debugViewer?.reportText ?? '').slice(0, 4000)}
                {(debugViewer?.reportText?.length ?? 0) > 4000
                  ? '\n…(truncated on screen)'
                  : ''}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!qualityBusy) setQualityDraft(null);
        }}
        transparent
        visible={Boolean(qualityDraft)}
      >
        <View style={styles.debugModalBackdrop}>
          <View
            style={[
              styles.debugModal,
              { paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12 },
            ]}
          >
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Capture A/B</Text>
              <Pressable
                disabled={qualityBusy}
                onPress={() => setQualityDraft(null)}
                style={[styles.chip, styles.chipOn, styles.debugModalClose]}
              >
                <Text style={styles.chipLabel}>Discard</Text>
              </Pressable>
            </View>
            <Text style={styles.debugModalHint}>
              Snapshot and still already taken from the live preview. Label, then save to inbox.
            </Text>
            {qualityDraft ? (
              <Text selectable style={styles.debugModalText}>
                {`FAST ${qualityDraft.snapshot.decodedWidth}×${qualityDraft.snapshot.decodedHeight}` +
                  `\nOCR ${qualityDraft.snapshot.ocr.rawOcrFirst || '(empty)'}` +
                  `\n${qualityDraft.snapshot.ocr.decision}` +
                  `${qualityDraft.snapshot.ocr.firstPassExact ? ' · first-pass exact' : ''}` +
                  `\nsharp ${qualityDraft.snapshot.metrics.titleSharpness.toFixed(1)} · ${Math.round(qualityDraft.snapshot.timings.totalCaptureToIdentityMs)}ms` +
                  `\n\nPHOTO ${qualityDraft.photo.decodedWidth}×${qualityDraft.photo.decodedHeight}` +
                  `\nOCR ${qualityDraft.photo.ocr.rawOcrFirst || '(empty)'}` +
                  `\n${qualityDraft.photo.ocr.decision}` +
                  `${qualityDraft.photo.ocr.firstPassExact ? ' · first-pass exact' : ''}` +
                  `\nsharp ${qualityDraft.photo.metrics.titleSharpness.toFixed(1)} · ${Math.round(qualityDraft.photo.timings.totalCaptureToIdentityMs)}ms`}
              </Text>
            ) : null}
            <TextInput
              autoCapitalize="words"
              onChangeText={setQualityLabel}
              placeholder="label (card name, foil, language…)"
              placeholderTextColor="#6b7"
              style={styles.qualityInput}
              value={qualityLabel}
            />
            <Pressable
              disabled={qualityBusy || !qualityDraft}
              onPress={onSaveQualityLabel}
              style={[styles.reportButton, qualityBusy && styles.reportButtonBusy]}
            >
              <Text style={styles.reportButtonLabel}>
                {qualityBusy ? 'Saving…' : 'Save + upload'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!swapActive) {
            swapTest.cancel();
          }
        }}
        transparent
        visible={swapTest.configOpen}
      >
        <View style={styles.debugModalBackdrop}>
          <View
            style={[
              styles.debugModal,
              { paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12 },
            ]}
          >
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Card Swap Test</Text>
              <Pressable
                onPress={() => swapTest.cancel()}
                style={[styles.chip, styles.chipOn, styles.debugModalClose]}
              >
                <Text style={styles.chipLabel}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.debugModalHint}>
              Keep the phone fixed. One Start → auto-capture → swap cards under the camera. No typing
              between swaps.
            </Text>
            <Text style={styles.debugModalHint}>Number of swaps</Text>
            <View style={styles.swapCountRow}>
              {swapTest.swapCounts.map(n => (
                <Pressable
                  key={n}
                  onPress={() => swapTest.setDraftCount(n)}
                  style={[styles.chip, swapTest.draftCount === n && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.debugModalHint}>
              Optional expected labels (one per line, once before Start)
            </Text>
            <TextInput
              autoCapitalize="words"
              multiline
              numberOfLines={5}
              onChangeText={swapTest.setDraftLabels}
              placeholder={'Wand of Wonder\nTeferi\'s Veil\nLivaan\nNegate\nIsland'}
              placeholderTextColor="#6b7"
              style={[styles.qualityInput, styles.swapLabelsInput]}
              value={swapTest.draftLabels}
            />
            <Pressable
              onPress={() => swapTest.start()}
              style={styles.reportButton}
            >
              <Text style={styles.reportButtonLabel}>Start Card Swap Test</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!deckBench.active) deckBench.cancel();
        }}
        transparent
        visible={deckBench.configOpen}
      >
        <View style={styles.debugModalBackdrop}>
          <View
            style={[
              styles.debugModal,
              { paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12 },
            ]}
          >
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Deck Benchmark</Text>
              <Pressable
                onPress={() => deckBench.cancel()}
                style={[styles.chip, styles.chipOn, styles.debugModalClose]}
              >
                <Text style={styles.chipLabel}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.debugModalHint}>
              Keep camera open. Place card → wait → NEXT CARD → replace. No names between cards.
            </Text>
            <Text style={styles.debugModalHint}>Target card count</Text>
            <View style={styles.swapCountRow}>
              {deckBench.counts.map(n => (
                <Pressable
                  key={n}
                  onPress={() => deckBench.setDraftCount(n)}
                  style={[styles.chip, deckBench.draftCount === n && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => void deckBench.start({ count: deckBench.draftCount })}
              style={styles.reportButton}
            >
              <Text style={styles.reportButtonLabel}>START DECK BENCHMARK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!binderBench.active) binderBench.cancel();
        }}
        transparent
        visible={binderBench.configOpen}
      >
        <View style={styles.debugModalBackdrop}>
          <View
            style={[
              styles.debugModal,
              { paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12 },
            ]}
          >
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Binder Benchmark</Text>
              <Pressable
                onPress={() => binderBench.cancel()}
                style={[styles.chip, styles.chipOn, styles.debugModalClose]}
              >
                <Text style={styles.chipLabel}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.debugModalHint}>
              Capture-only. Move phone slowly over each page (~3s). Geometry replay is on Mac — phone
              will not show fake 9/9.
            </Text>
            <Text style={styles.debugModalHint}>Pages · layout 3×3</Text>
            <View style={styles.swapCountRow}>
              {binderBench.counts.map(n => (
                <Pressable
                  key={n}
                  onPress={() => binderBench.setDraftPages(n)}
                  style={[styles.chip, binderBench.draftPages === n && styles.chipOn]}
                >
                  <Text style={styles.chipLabel}>{n}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={() => void binderBench.start({ pages: binderBench.draftPages })}
              style={styles.reportButton}
            >
              <Text style={styles.reportButtonLabel}>START BINDER BENCHMARK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (!seriesBusy) setSeriesDraft(null);
        }}
        transparent
        visible={Boolean(seriesDraft)}
      >
        <View style={styles.debugModalBackdrop}>
          <View
            style={[
              styles.debugModal,
              { paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12 },
            ]}
          >
            <View style={styles.debugModalHeader}>
              <Text style={styles.debugModalTitle}>Focus series</Text>
              <Pressable
                disabled={seriesBusy}
                onPress={() => setSeriesDraft(null)}
                style={[styles.chip, styles.chipOn, styles.debugModalClose]}
              >
                <Text style={styles.chipLabel}>Discard</Text>
              </Pressable>
            </View>
            <Text style={styles.debugModalHint}>
              Four fast snapshots after one focus request. Label, then save. Does not change live capture.
            </Text>
            {seriesDraft ? (
              <Text selectable style={styles.debugModalText}>
                {seriesDraft.samples
                  .map(
                    s =>
                      `T${s.nominalDelayMs} actual ${Math.round(s.actualDelayFromFocusRequestMs)}ms` +
                      `  age ${s.quadAgeAtCaptureMs == null ? '—' : Math.round(s.quadAgeAtCaptureMs)}` +
                      `  iou ${s.geometry ? s.geometry.iouVsT0.toFixed(2) : '—'}` +
                      `\ncard ${s.metrics.cardSharpness.toFixed(0)}  title ${s.metrics.titleSharpness.toFixed(0)}  ${s.failureClass ?? '—'}` +
                      `\nOCR ${s.ocr.rawOcrFirst || '(empty)'}  ${s.ocr.firstPassExact ? 'exact' : s.ocr.decision}` +
                      `  ${s.ocr.matchName ?? s.ocr.status}`,
                  )
                  .join('\n\n')}
              </Text>
            ) : null}
            <TextInput
              autoCapitalize="words"
              onChangeText={setSeriesLabel}
              placeholder="label (card name, foil, language…)"
              placeholderTextColor="#6b7"
              style={styles.qualityInput}
              value={seriesLabel}
            />
            <Pressable
              disabled={seriesBusy || !seriesDraft}
              onPress={onSaveFocusSeries}
              style={[styles.reportButton, seriesBusy && styles.reportButtonBusy]}
            >
              <Text style={styles.reportButtonLabel}>
                {seriesBusy ? 'Saving…' : 'Save + upload'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {labOpen && isBenchmarkToolsEnabled() ? (
        <View style={StyleSheet.absoluteFill}>
          <ScannerLabScreen
            frozenCapture={labFrozen}
            nameIndex={session.indexes.names?.index ?? null}
            onCaptureFocusSeries={async labLabel => {
              const run = await session.captureFocusSeries();
              const saved = await session.persistFocusSeries(run, labLabel);
              return saved;
            }}
            onClose={() => {
              session.releaseLabHold();
              releaseScannerMode('scanner-lab');
              setLabOpen(false);
              setLabFrozen(null);
            }}
          />
        </View>
      ) : null}
      {surface === 'binder' && binder.ui.active ? (
        <View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { paddingTop: insets.top, zIndex: 40 }]}
        >
          <BinderHud
            candidateSource={binder.ui.candidateSource}
            hud={binder.ui.hud}
            inspectTrack={binder.getInspectTrack()}
            layout={
              analysisSize && layout.width > 0
                ? {
                    width: layout.width,
                    height: layout.height,
                    mapQuad: q => {
                      const mapped = mapCornersToOverlay(q, analysisSize, analysisSize, layout);
                      return [
                        mapped.topLeft,
                        mapped.topRight,
                        mapped.bottomRight,
                        mapped.bottomLeft,
                      ];
                    },
                  }
                : null
            }
            message={binder.ui.message}
            onCloseInspect={() => binder.setInspect(null)}
            onFinishPage={binder.finishPage}
            onNextPage={binder.nextPage}
            onTapTrack={id => binder.setInspect(id)}
            overlays={binder.ui.overlays}
            pageIndex={binder.ui.pageIndex}
            showDebug={forceDebugOverlay}
            showUpload={isBenchmarkToolsEnabled()}
            uploadBusy={binder.ui.uploadBusy}
            uploadIncomplete={binder.ui.uploadIncomplete}
            uploadMessage={binder.ui.uploadMessage}
            autoUploadOnPageDone={binder.ui.autoUploadOnPageDone}
            onUploadDiagnostics={() => void binder.uploadDiagnostics()}
            onRetryUpload={() => void binder.retryUpload()}
            onToggleAutoUpload={() =>
              binder.setAutoUploadOnPageDone(!binder.ui.autoUploadOnPageDone)
            }
            snapshotInFlight={binder.ui.snapshotInFlight}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Position a thin view as the segment a→b.
 *
 * Placed at the segment's midpoint and rotated about its own centre, which
 * avoids needing a transform origin (React Native has none).
 */
const edgeStyle = (a: Point2D, b: Point2D) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return {
    left: a.x + dx / 2 - length / 2,
    top: a.y + dy / 2 - LINE_THICKNESS / 2,
    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
    width: length,
  };
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5C542',
    borderRadius: 4,
    color: '#0B1220',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeOn: {
    backgroundColor: '#7CFFB2',
  },
  badgeWait: {
    backgroundColor: '#8A97AD',
    color: '#0B1220',
  },
  body: {
    color: '#A8B3C7',
    lineHeight: 20,
    textAlign: 'center',
  },
  abButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#C47A12',
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  abButtonLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  swapOverlay: {
    alignItems: 'center',
    left: 12,
    position: 'absolute',
    right: 12,
    top: 72,
    zIndex: 40,
  },
  swapBanner: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(12, 18, 32, 0.88)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  swapBannerAlert: {
    backgroundColor: 'rgba(180, 40, 20, 0.92)',
    borderColor: '#FFD080',
  },
  swapTitle: {
    color: '#F5C542',
    fontSize: 18,
    fontWeight: '800',
  },
  swapLine: {
    color: '#E8EEF7',
    fontFamily: 'Courier',
    fontSize: 12,
    marginTop: 4,
  },
  swapState: {
    color: '#7CFFB2',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 8,
  },
  swapStateAlert: {
    color: '#FFF6C8',
    fontSize: 28,
  },
  swapMarkBtn: {
    alignSelf: 'stretch',
    backgroundColor: '#F5C542',
    borderRadius: 12,
    marginTop: 12,
    paddingVertical: 18,
  },
  swapMarkLabel: {
    color: '#0B1220',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  swapCancelBtn: {
    marginTop: 10,
    padding: 10,
  },
  swapCancelLabel: {
    color: '#A8B3C7',
    fontSize: 14,
    textAlign: 'center',
  },
  swapCountRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  swapLabelsInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  qualityInput: {
    backgroundColor: '#162033',
    borderRadius: 8,
    color: '#E8EEF7',
    fontSize: 15,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bottomBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  button: {
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: '#0B1220',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  chip: {
    backgroundColor: 'rgba(20,28,44,0.9)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  chipLabel: {
    color: '#E8EEF7',
    fontSize: 12,
    fontWeight: '600',
  },
  chipOn: {
    borderColor: 'rgba(124,255,178,0.6)',
  },
  cornerNum: {
    color: '#7CFFB2',
    fontSize: 12,
    fontWeight: '800',
    position: 'absolute',
    textShadowColor: '#000',
    textShadowRadius: 3,
  },
  deviceLine: {
    color: '#F4F7FB',
    fontSize: 12,
    fontWeight: '600',
  },
  edge: {
    borderRadius: LINE_THICKNESS,
    height: LINE_THICKNESS,
    position: 'absolute',
  },
  edgeOn: {
    // Capture-safe / confirming / capturing
    backgroundColor: '#7CFFB2',
  },
  edgeDetected: {
    // Card detected, not capture-safe yet
    backgroundColor: '#F5C542',
  },
  edgeCaptureFlash: {
    backgroundColor: '#FFFFFF',
    opacity: 1,
  },
  captureFlashVeil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  edgeRaw: {
    backgroundColor: '#2878FF',
  },
  edgeGeometryOriginal: {
    // OUTER SLEEVE / detector seed (debug)
    backgroundColor: '#FF9F43',
    opacity: 0.75,
  },
  edgeTracked: {
    backgroundColor: '#F5C542',
    opacity: 0.85,
  },
  edgeRecognition: {
    backgroundColor: '#DC3CDC',
    opacity: 0.95,
  },
  edgeWeak: {
    backgroundColor: 'rgba(245,197,66,0.55)',
  },
  pendingAdd: {
    color: '#7CFFB2',
    fontSize: 11,
    marginTop: 4,
  },
  saveStatus: {
    color: '#7CFFB2',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  debugModalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  debugModal: {
    backgroundColor: '#0B1220',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    flexGrow: 0,
    maxHeight: '88%',
    paddingHorizontal: 12,
  },
  debugModalClose: {
    marginLeft: 8,
  },
  debugModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  debugModalCaption: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    marginTop: 4,
  },
  debugModalHint: {
    color: '#A8B3C7',
    fontSize: 12,
    marginBottom: 8,
  },
  debugModalImage: {
    alignSelf: 'center',
    backgroundColor: '#000',
    height: 280,
    marginBottom: 10,
    width: 200,
  },
  debugModalScroll: {
    paddingBottom: 16,
  },
  debugModalScrollView: {
    flexGrow: 0,
    maxHeight: 480,
  },
  debugModalText: {
    color: '#C5D0E0',
    fontFamily: 'Courier',
    fontSize: 9,
    lineHeight: 12,
  },
  debugModalTitle: {
    color: '#F5C542',
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  resultWrap: {
    marginBottom: 8,
  },
  verifiedCaptureBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(12,18,28,0.72)',
    borderRadius: 12,
    marginBottom: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  verifiedCaptureBannerLabel: {
    color: '#E8F0FF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  reportAction: {
    flex: 1,
    marginTop: 0,
  },
  reportButton: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  reportButtonBusy: {
    opacity: 0.6,
  },
  reportButtonLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  resultActions: {
    flexDirection: 'row',
    gap: 8,
  },
  resultActionBtn: {
    flex: 1,
    marginTop: 8,
  },
  trainButton: {
    backgroundColor: '#C47A12',
  },
  trainButtonLarge: {
    alignItems: 'center',
    backgroundColor: '#C47A12',
    borderRadius: 10,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  missWrap: {
    marginBottom: 4,
  },
  reportSecondary: {
    backgroundColor: '#1E2A3D',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
  },
  debugModalActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  overlay: {
    bottom: 0,
    flexDirection: 'column',
    left: 0,
    paddingHorizontal: 12,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  panelWrap: {
    // Bounded so the camera preview and the card stay visible above it.
    height: '52%',
  },
  reticle: {
    borderRadius: 4,
    borderWidth: 2,
    height: 56,
    position: 'absolute',
    width: 56,
  },
  root: {
    backgroundColor: '#000',
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  title: {
    color: '#F4F7FB',
    fontSize: 22,
    fontWeight: '700',
  },
  topBar: {
    gap: 4,
  },
});
