import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Pressable,
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
  type CameraRef,
} from 'react-native-vision-camera';

import { CameraDebugPanel } from '../camera/CameraDebugPanel';
import { describeDevice, selectMainRearDevice } from '../camera/selectMainRearDevice';
import { collectionAddFromPrinting } from '../scan/collectionCommand';
import { tickOverlay } from '../scan/overlayEase';
import { ScanDebugPanel } from '../scan/ScanDebugPanel';
import { ScanResultCard } from '../scan/ScanResultCard';
import { mapCornersToOverlay, type CardCorners, type Point2D } from '../scan/sharedCore';
import { RECOGNITION_SOURCES, type PreferredSource } from '../scan/hiresCapture';
import { useHiResFrameLatch } from '../scan/useHiResFrame';
import { useScanSession } from '../scan/useScanSession';
import {
  ANALYSIS_LONG_EDGES,
  RESOLUTIONS,
  RUNGS,
  useFrameAnalysis,
} from '../scan/useFrameAnalysis';

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
  const [sourceIndex, setSourceIndex] = useState(0);
  const preferredSource: PreferredSource = RECOGNITION_SOURCES[sourceIndex];

  const photoOutput = usePhotoOutput({
    containerFormat: 'jpeg',
    quality: 0.85,
    qualityPrioritization: device?.supportsSpeedQualityPrioritization ? 'speed' : 'balanced',
    targetResolution: CommonResolutions.FHD_4_3,
  });

  const hiResFrame = useHiResFrameLatch({
    enabled: detectorOn,
    previewSize: layout,
  });
  // Interface, not device: the UI is portrait-locked. Device orientation
  // stays undefined until the phone moves — that was the startup bug.
  const interfaceOrientation = useOrientation('interface');

  const session = useScanSession({
    cameraRef,
    enabled: detectorOn,
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
    diagnosticRungs,
    enabled: detectorOn,
    interfaceOrientation,
    onAnalyzed: session.onAnalyzed,
    previewSize: layout,
    resolutionIndex,
    rung: RUNGS[rungIndex],
  });

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
  const badgeText = !detectorOn
    ? 'DETECTOR OFF'
    : !orientation.ready
      ? 'Initializing orientation'
      : phase.toUpperCase();

  return (
    <View onLayout={onLayout} style={styles.root}>
      <Camera
        ref={cameraRef}
        device={device}
        enableNativeTapToFocusGesture={false}
        implementationMode="compatible"
        isActive
        orientationSource="interface"
        outputs={[frameOutput, photoOutput, hiResFrame.frameOutput]}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        zoom={1}
      />

      <Pressable onPress={onTap} style={StyleSheet.absoluteFill} />

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
        </View>

        <View pointerEvents="none" style={styles.spacer} />

        {session.snapshot &&
        (session.snapshot.phase === 'found' || session.snapshot.phase === 'ambiguous') ? (
          <View style={styles.resultWrap}>
            <ScanResultCard
              nameIndex={session.indexes.names?.index ?? null}
              onAction={(action, extra) => {
                if (action === 'scan-again') {
                  session.reset();
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
                artworkDescriptorMs: session.debug.artworkDescriptorMs,
                artworkMatcherMs: session.debug.artworkMatcherMs,
                artworkMs: session.debug.artworkMs,
                captureMs: session.debug.captureMs,
                convertMs: session.debug.convertMs,
                footerEvidence: session.debug.footerEvidence,
                hiresUri: session.debug.hiresUri,
                mappedCorners: session.debug.mappedCorners,
                names: session.indexes.names?.names ?? null,
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
                textEvidence: session.debug.textEvidence,
                titleEvidence: session.debug.titleEvidence,
                trackFrames: session.snapshot?.trackFrames ?? 0,
                warpMs: session.debug.warpMs,
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
              if (layout.width > 0) void focusAt(layout.width / 2, layout.height / 2);
            }}
            style={styles.chip}
          >
            <Text style={styles.chipLabel}>Focus center</Text>
          </Pressable>
        </View>
      </View>
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
  resultWrap: {
    marginBottom: 8,
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
