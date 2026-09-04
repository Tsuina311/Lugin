import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
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
import { tickOverlay } from '../scan/overlayEase';
import { ScanDebugPanel } from '../scan/ScanDebugPanel';
import { ScanResultCard } from '../scan/ScanResultCard';
import { mapCornersToOverlay, type CardCorners, type Point2D } from '../scan/sharedCore';
import { RECOGNITION_SOURCES, type PreferredSource } from '../scan/hiresCapture';
import {
  downloadPreparedBundle,
  prepareDebugBundle,
  sharePreparedBundle,
  type PreparedDebugBundle,
  type DebugSharePayload,
} from '../scan/saveDebugBundle';
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
  isNativeDetectorLinked,
  type DetectorEngineId,
} from '../scan/detectorEngine';
import {
  getNativeOcrImplementationStatus,
  isNativeOcrLinked,
} from '../scan/mlkitTextRecognizer';
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
export function CameraScanScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const rearDevices = useMemo(() => devices.filter(d => d.position === 'back'), [devices]);

  const preferred = useMemo(() => selectMainRearDevice(rearDevices), [rearDevices]);
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
  const [panel, setPanel] = useState<Panel>('scan');
  // Diagnostic controls: how far the transfer ladder climbs, and how big the
  // payload is. Lowering either is how a size limit is told from a hard
  // serialization failure.
  const [rungIndex, setRungIndex] = useState(RUNGS.length - 1);
  const [resolutionIndex, setResolutionIndex] = useState(0);
  const [longEdgeIndex, setLongEdgeIndex] = useState(1);
  const [diagnosticRungs, setDiagnosticRungs] = useState(false);
  const [showNumbers, setShowNumbers] = useState(true);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [debugViewer, setDebugViewer] = useState<PreparedDebugBundle | null>(null);
  const [detectorColorOk, setDetectorColorOk] = useState<'yes' | 'no' | 'unverified'>('unverified');
  const [recognitionColorOk, setRecognitionColorOk] = useState<'yes' | 'no' | 'unverified'>(
    'unverified',
  );
  const [sourceIndex, setSourceIndex] = useState(0);
  const [detectorEngineId, setDetectorEngineId] = useState<DetectorEngineId>('shared-js');
  const [benchHud, setBenchHud] = useState(() => peekBenchmarkHud());
  const preferredSource: PreferredSource = RECOGNITION_SOURCES[sourceIndex];
  const detectorEngine = useMemo(() => {
    if (detectorEngineId === 'native') {
      try {
        return createNativeDetectorEngine();
      } catch {
        return createSharedJsDetectorEngine();
      }
    }
    return createSharedJsDetectorEngine();
  }, [detectorEngineId]);
  // CameraX / frame outputs stall after backgrounding if isActive stays true.
  // Tab switch remounts the screen (works); AppState pause/resume does the same
  // without leaving Scan.
  const appActive = useAppActive();
  const scanning = detectorOn && appActive;

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
    debugPreview: panel === 'scan',
    detectorEngine,
    diagnosticRungs,
    enabled: scanning,
    interfaceOrientation,
    onAnalyzed: session.onAnalyzed,
    previewSize: layout,
    resolutionIndex,
    rung: RUNGS[rungIndex],
  });

  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void restoreBenchmarkSession().then(() => setBenchHud(peekBenchmarkHud()));
    return subscribeBenchmark(() => setBenchHud(peekBenchmarkHud()));
  }, []);

  // Auto-persist every completed recognition during an active benchmark session.
  // Payload is built here (not via buildReportPayload) so this hook can stay
  // above permission early-returns.
  useEffect(() => {
    if (!isBenchmarkToolsEnabled() || !benchHud.active) return;
    const snap = session.snapshot;
    if (!snap || (snap.phase !== 'found' && snap.phase !== 'ambiguous')) return;
    if (!snap.fused) return;
    const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
      ?.lugin;
    const payload: DebugSharePayload = {
      analysisLongEdge: ANALYSIS_LONG_EDGES[longEdgeIndex],
      appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
      detectorEngine: detectorEngineId,
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
  const mappedCorners = useMemo(() => {
    if (!displayCorners || !analysisSize || layout.width === 0) return null;
    return mapCornersToOverlay(displayCorners, analysisSize, analysisSize, layout);
  }, [analysisSize, displayCorners, layout]);

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
  const badgeText = !detectorOn
    ? 'DETECTOR OFF'
    : !orientation.ready
      ? counters.cameraFrames === 0
        ? 'Waiting for camera'
        : 'Initializing orientation'
      : phase.toUpperCase();

  const buildReportPayload = (): DebugSharePayload => {
    const analysisResult = result;
    const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
      ?.lugin;
    return {
      analysisLongEdge: ANALYSIS_LONG_EDGES[longEdgeIndex],
      appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
      detectorEngine: detectorEngineId,
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

      <Pressable onPress={onTap} style={StyleSheet.absoluteFill} />

      {benchHud.active ? (
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

      {quad ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {quad.map(([a, b], i) => (
            <View
              key={i}
              style={[styles.edge, edgeStyle(a, b), detected ? styles.edgeOn : styles.edgeWeak]}
            />
          ))}
          {showNumbers && mappedCorners
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
          {saveStatus ? (
            <Text style={styles.saveStatus} numberOfLines={2}>
              {saveStatus}
            </Text>
          ) : null}
        </View>

        <View pointerEvents="none" style={styles.spacer} />

        {session.snapshot &&
        (session.snapshot.phase === 'found' || session.snapshot.phase === 'ambiguous') ? (
          <View style={styles.resultWrap}>
            <ScanResultCard
              nameIndex={session.indexes.names?.index ?? null}
              printingIndex={session.indexes.printing?.index ?? null}
              onAction={(action, extra) => {
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
            {pendingAdd ? <Text style={styles.pendingAdd}>{pendingAdd}</Text> : null}
            <Pressable
              disabled={reportBusy}
              onPress={openReport}
              style={[styles.reportButton, reportBusy && styles.reportButtonBusy]}
            >
              <Text style={styles.reportButtonLabel}>
                {reportBusy ? 'Preparing…' : 'Report'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {panel === 'scan' ? (
          <View style={styles.panelWrap}>
            <ScanDebugPanel
              analysisLongEdge={ANALYSIS_LONG_EDGES[longEdgeIndex]}
              counters={counters}
              diagnosticRungs={diagnosticRungs}
              error={error}
              failure={failure}
              frameMeta={frameMeta}
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
              }}
              showNumbers={showNumbers}
              transfer={transfer}
            />
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

        <View style={styles.bottomBar}>
          <Pressable onPress={cycleDevice} style={styles.chip}>
            <Text style={styles.chipLabel}>Lens ({rearDevices.length})</Text>
          </Pressable>
          <Pressable
            onPress={() => setDetectorOn(v => !v)}
            style={[styles.chip, detectorOn && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>Detector {detectorOn ? 'on' : 'off'}</Text>
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
            onPress={() =>
              setPanel(panel === 'scan' ? 'camera' : panel === 'camera' ? 'none' : 'scan')
            }
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>
              {panel === 'scan' ? 'Scan dbg' : panel === 'camera' ? 'Cam dbg' : 'No panel'}
            </Text>
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
            onPress={() => {
              if (layout.width > 0) void focusAt(layout.width / 2, layout.height / 2);
            }}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Focus center</Text>
          </Pressable>
        </View>
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
    backgroundColor: '#7CFFB2',
  },
  edgeWeak: {
    backgroundColor: 'rgba(245,197,66,0.75)',
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
