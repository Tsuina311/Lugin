import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DetectorInputThumb } from './DetectorInputThumb';
import { formatCorner } from './analysisGeometry';
import type { CardCorners } from './sharedCore';
import type { AnalysisMetrics, StageStats } from './analysisStats';
import type {
  AnalysisResult,
  FrameMetadata,
  FrameProbeResult,
  OrientationDebug,
  PingEcho,
  Rung,
  StageCounters,
  TransferCheck,
  WorkletFailure,
} from './useFrameAnalysis';
import type { JsLagStats } from './jsLagProbe';
import { getPerfBaseline } from './perfBaseline';

type SessionBits = {
  artCandidates: { name: string; score: number }[];
  artEntries: number | null;
  artError: string | null;
  artGenerated: string | null;
  artChecksum: string | null;
  artUniqueOracles: number | null;
  artworkDescriptorMs: number | null;
  artworkMatcherMs: number | null;
  artworkMs: number | null;
  captureMs: number | null;
  convertMs: number | null;
  footerEvidence: string;
  hiresPhase: string;
  hiresStats: Record<
    string,
    {
      failure: number;
      lastError: string | null;
      requested: number;
      started: number;
      success: number;
      timeout: number;
    }
  > | null;
  hiresUri: string | null;
  hiresWaitMs: number | null;
  mappedCorners: CardCorners | null;
  names: number | null;
  printingEntries: number | null;
  normalizedUri: string | null;
  phase: string;
  lockGates?: {
    bestFrame: boolean;
    bestFrameSource: string;
    bestQuality: number | null;
    blocker: string;
    consecutiveStable: number;
    cornerOrderCorrections: number;
    cornerOrderValid: boolean;
    detectorHits: number;
    detectorMisses: number;
    detectorScore: number;
    detectorThreshold: number;
    currentTrackId?: number | null;
    geometryTrackId?: number | null;
    cardSessionId?: number;
    focusCardSessionId?: number | null;
    sameCardSessionFocus?: boolean;
    sessionResetReason?: string | null;
    visualChange?: string;
    fingerprintDelta?: number | null;
    visualConfirmPending?: number;
    cardChangeState?: string | null;
    cardChangeEvidence?: string | null;
    changeWatchDelta?: number | null;
    changeWatchBand?: string | null;
    changeWatchConfirmCount?: number | null;
    swapSuspicion?: number | null;
    resultCardSessionId?: number | null;
    resultPossiblyStale?: boolean;
    previousSessionIdentity?: string | null;
    currentSessionIdentity?: string | null;
    focusAgeMs: number | null;
    focusAttemptId?: number;
    focusKind: string;
    focusOk: boolean;
    focusRequestedAt?: number | null;
    focusResolvedAt?: number | null;
    focusTimedOutAt?: number | null;
    focusTrackId?: number | null;
    sameTrackFocus?: boolean;
    focusReentries?: number;
    focusRequests?: number;
    focusSuccesses?: number;
    focusTimedOut?: boolean;
    focusTimeouts?: number;
    focusWaitMs?: number | null;
    highResFailure?: number;
    highResRequests?: number;
    highResSuccess?: number;
    lastHighResError?: string | null;
    postLockStall?: boolean;
    recognitionStatus?: string | null;
    retryReason?: string | null;
    retryScheduledAt?: number | null;
    geometryDetected: boolean;
    highResEligible: boolean;
    lastHitAgeMs: number | null;
    motionScore: number;
    motionThreshold: number;
    poolSize: number;
    qualityGating: boolean;
    qualityInput: string;
    qualityOk: boolean;
    qualityScore: number | null;
    qualityThreshold: number;
    recognitionPending: boolean;
    requiredStable: number;
    sharpness: number | null;
    sharpnessThreshold: number;
    stable: boolean;
    stableDurationMs: number | null;
    staleClearThresholdMs: number;
    waiting: string;
  } | null;
  recognizeInvocations?: number;
  selectedRole?: string | null;
  continuityReason?: string | null;
  qualityBest: number | null;
  qualityExposure?: number;
  qualityGlare?: number;
  qualitySharpness?: number;
  recognitionSource: string | null;
  sourceHeight: number | null;
  sourceLabel: string;
  sourceWidth: number | null;
  stable: boolean;
  temporalLeader: string | null;
  temporalObservations: number;
  temporalResetReason: string | null;
  textEvidence: string;
  titleEvidence: string;
  trackFrames: number;
  warpMs: number | null;
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
  ocrAdapter?: {
    lastAttempt: string | null;
    lastError: string | null;
    nativeModuleAvailable: boolean;
    ready: boolean;
    textRecognizerCreated: boolean;
    transport: string;
    warmupState: string;
  } | null;
  /** Compact Samsung acceptance snapshot (debug only). */
  acceptance?: {
    detectorActual: string | null;
    names: number | null;
    printing: number | null;
    type: number | null;
    art: number | null;
    lastName: string | null;
    lastPrinting: string | null;
    lockToOracleMs: number | null;
    lockToPrintingMs: number | null;
  } | null;
};

type Props = {
  analysisLongEdge: number;
  counters: StageCounters;
  diagnosticRungs: boolean;
  error: string | null;
  failure: WorkletFailure | null;
  frameMeta: FrameMetadata | null;
  jsLag?: JsLagStats | null;
  metrics: AnalysisMetrics | null;
  orientation: OrientationDebug;
  ping: PingEcho | null;
  preview: string | null;
  probeResult: FrameProbeResult | null;
  result: AnalysisResult | null;
  rung: Rung;
  session?: SessionBits | null;
  showNumbers: boolean;
  transfer: TransferCheck | null;
  onStartCardSwapTest?: () => void;
  onStartDeckBenchmark?: () => void;
  onStartBinderBenchmark?: () => void;
  realBenchmarkStatus?: {
    deck?: string | null;
    binder?: string | null;
  };
};

const ms = (s: StageStats) =>
  s.count === 0 ? 'n/a' : `${s.p50.toFixed(1)}/${s.p95.toFixed(1)}`;
const latMs = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(0)} ms`;
const fps = (n: number) => n.toFixed(1);

/**
 * The transfer ladder, in execution order.
 *
 * Reading down the list, the last row that counts up is the last thing that
 * works — so the break is the row after it. Each rung is scheduled separately
 * inside the worklet, so a failure at one does not suppress the rows above it.
 */
export function ScanDebugPanel({
  analysisLongEdge,
  counters,
  diagnosticRungs,
  error,
  failure,
  frameMeta,
  jsLag,
  metrics,
  orientation,
  ping,
  preview,
  probeResult,
  result,
  rung,
  session,
  showNumbers,
  transfer,
  onStartCardSwapTest,
  onStartDeckBenchmark,
  onStartBinderBenchmark,
  realBenchmarkStatus,
}: Props) {
  const baseline = getPerfBaseline();
  const lagWarn = jsLag != null && jsLag.p95 > 100;
  const ladder: [string, number][] = diagnosticRungs
    ? [
        ['camera out', counters.cameraFrames],
        ['worklet sampled', counters.sampled],
        ['pixel buffer read', counters.pixelBufferRead],
        ['buffer copied', counters.bufferCopied],
        ['schedule attempted', counters.scheduleAttempted],
        ['RN ping', counters.rnPing],
        ['RN meta', counters.rnMeta],
        ['RN tiny buffer', counters.rnTiny],
        ['RN full frame', counters.rnFull],
        ['received', counters.received],
        ['processed', counters.processed],
        ['ScanImages', counters.scanImages],
        ['detector calls', counters.detectorCalls],
        ['detector hits', counters.detectorHits],
      ]
    : [
        // Fast path never climbs ping/meta/tiny — those zeros are expected.
        ['camera out', counters.cameraFrames],
        ['worklet sampled', counters.sampled],
        ['pixel buffer / Y copy', counters.bufferCopied],
        ['schedule attempted', counters.scheduleAttempted],
        ['RN received', counters.received],
        ['RN full / Y', counters.rnFull],
        ['processed', counters.processed],
        ['ScanImages', counters.scanImages],
        ['detector calls', counters.detectorCalls],
        ['detector hits', counters.detectorHits],
      ];

  // Flag the first rung that has nothing while the rung above it has something.
  // Detector hits may stay 0 without being a plumbing fault.
  const breakAt = ladder.findIndex(
    ([, value], i) => i > 0 && i < ladder.length - 1 && value === 0 && ladder[i - 1][1] > 0,
  );

  return (
    <View style={styles.panel}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {failure ? (
          <Text style={styles.error}>
            worklet threw in {failure.stage} (×{failure.count}): {failure.message}
          </Text>
        ) : null}
        {lagWarn ? (
          <Text style={styles.error}>
            JS event-loop p95 {jsLag!.p95.toFixed(0)} ms &gt; 100 — UI starved
          </Text>
        ) : null}

        <View style={styles.row}>
          <View style={styles.column}>
            <Text style={styles.title}>Perf · {baseline.detectorHz} Hz · long {analysisLongEdge}</Text>
            {jsLag ? (
              <Text style={[styles.line, lagWarn && styles.bad]}>
                JS lag p50/p95/max: {jsLag.p50.toFixed(0)}/{jsLag.p95.toFixed(0)}/
                {jsLag.max.toFixed(0)} ms (n={jsLag.samples})
              </Text>
            ) : null}
            <Text style={styles.line}>
              nativeDetect {counters.nativeDetectCalls} · sharedJs {counters.sharedJsDetectCalls}
              {counters.sharedJsDetectCalls > 0 && counters.nativeDetectCalls > 0
                ? '  ← DUAL ENGINE?'
                : ''}
            </Text>
            <Text style={styles.line}>
              submitted {counters.submitted} · processed {counters.processed} · droppedBusy{' '}
              {counters.droppedBusy} · superseded {counters.superseded}
            </Text>
            <Text style={styles.dim}>
              warmup {baseline.ocrWarmup ? 'ON' : 'OFF'} · sleeve{' '}
              {baseline.nestedSleeve ? 'ON' : 'OFF'} · livePNG{' '}
              {baseline.liveDebugImages ? 'ON' : 'OFF'} · heavyIdx while scan{' '}
              {baseline.heavyIndexesWhileScanning ? 'ON' : 'OFF'}
            </Text>
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.column}>
            <Text style={styles.title}>
              Ladder ({diagnosticRungs ? `diag · rung: ${rung}` : 'fast path'}) · long{' '}
              {analysisLongEdge}
            </Text>
            {!diagnosticRungs ? (
              <Text style={styles.dim}>
                Fast path skips ping/meta/tiny — enable “Ladder on” only to isolate bridge faults.
              </Text>
            ) : null}
            {ladder.map(([label, value], i) => (
              <Text key={label} style={[styles.line, i === breakAt && styles.bad]}>
                {label}: {value}
                {i === breakAt ? '  ← BREAKS HERE' : ''}
              </Text>
            ))}
            <Text style={styles.line}>
              skip: cad {counters.skippedForCadence} · orient {counters.skippedForOrientation} ·
              nobuf {counters.skippedNoPixelBuffer} · planar {counters.skippedPlanar}
            </Text>
            {counters.pixelBufferFromPlane > 0 ? (
              <Text style={[styles.line, styles.warn]}>
                via plane 0: {counters.pixelBufferFromPlane}
              </Text>
            ) : null}
            <Text style={styles.line}>
              dropped {counters.droppedByCamera} · supersededJs {counters.supersededOnJs} ·
              busyDrop {counters.droppedBusy}
            </Text>
            {ping ? (
              <Text style={styles.line}>
                ping echo: seq {ping.sequence} · {ping.width}×{ping.height}
              </Text>
            ) : null}
          </View>

          <DetectorInputThumb
            corners={result?.corners ?? null}
            height={result?.analysis.height ?? 0}
            label={
              result
                ? `${result.analysis.width}×${result.analysis.height} · luma ${result.brightness.toFixed(0)}`
                : 'waiting'
            }
            showNumbers={showNumbers}
            uri={preview}
            width={result?.analysis.width ?? 0}
          />
        </View>

        {metrics ? (
          <>
            <Text style={styles.title}>Rates (per second)</Text>
            <Text style={styles.line}>
              camera {fps(metrics.frameRate)} · sample {fps(metrics.sampleRate)} · RN{' '}
              {fps(metrics.deliveryRate)} · detect {fps(metrics.analysisRate)}
            </Text>
            <Text style={styles.title}>Timings p50/p95 ms</Text>
            <Text style={styles.line}>
              convert {ms(metrics.convertMs)} · transfer {ms(metrics.transferMs)}
            </Text>
            <Text style={styles.line}>
              detect {ms(metrics.detectMs)} · total {ms(metrics.totalMs)}
            </Text>
            {metrics.latency ? (
              <>
                <Text style={styles.title}>Frame age p50/p95 ms</Text>
                <Text style={styles.line}>
                  cam→RN {ms(metrics.latency.cameraToRn)} · RN→Scan {ms(metrics.latency.rnToScan)}
                </Text>
                <Text style={styles.line}>
                  Scan→detect {ms(metrics.latency.scanToDetect)} · cam→detect{' '}
                  {ms(metrics.latency.cameraToDetect)}
                </Text>
                <Text style={styles.ok}>
                  cam→polygon {ms(metrics.latency.cameraToOverlay)} last{' '}
                  {metrics.latency.cameraToOverlay.last.toFixed(0)}
                </Text>
                {metrics.processedFrameAgeMs ? (
                  <Text style={styles.line}>
                    processed-frame age {ms(metrics.processedFrameAgeMs)} last{' '}
                    {metrics.processedFrameAgeMs.last.toFixed(0)}
                  </Text>
                ) : null}
              </>
            ) : null}
            {metrics.lastDropReason ? (
              <Text style={styles.line}>last drop: {metrics.lastDropReason}</Text>
            ) : null}
          </>
        ) : null}

        <Text style={styles.title}>Frame metadata (actual)</Text>
        {frameMeta ? (
          <>
            <Text style={styles.line}>
              {frameMeta.width}×{frameMeta.height} · {frameMeta.pixelFormat}
            </Text>
            <Text style={styles.line}>
              bytesPerRow {frameMeta.bytesPerRow} · packed w×h×4 {frameMeta.expectedPacked}
            </Text>
            <Text
              style={[
                styles.line,
                frameMeta.copiedByteLength !== frameMeta.sourceByteLength && styles.bad,
              ]}
            >
              source {frameMeta.sourceByteLength} · copied {frameMeta.copiedByteLength}
            </Text>
            <Text style={styles.line}>
              orientation {frameMeta.orientation} · mirrored {String(frameMeta.isMirrored)}
            </Text>
            <Text style={styles.line}>timestamp {frameMeta.timestamp}</Text>
            <Text style={styles.line}>pixels received as {frameMeta.bytesKind}</Text>
            <Text style={[styles.line, frameMeta.bufferSource !== 'frame buffer' && styles.warn]}>
              pixels read from {frameMeta.bufferSource}
            </Text>
          </>
        ) : (
          <Text style={styles.dim}>no metadata delivered yet</Text>
        )}

        <Text style={styles.title}>Tiny ArrayBuffer rung</Text>
        {transfer ? (
          <>
            <Text
              style={[styles.line, transfer.matched === transfer.probed ? styles.ok : styles.bad]}
            >
              {transfer.byteLength} bytes · {transfer.matched}/{transfer.probed} sample bytes match
            </Text>
            <Text style={styles.line}>first bytes: {transfer.firstBytes}</Text>
          </>
        ) : (
          <Text style={styles.dim}>no tiny buffer delivered yet</Text>
        )}

        <Text style={styles.title}>Orientation</Text>
        <Text style={[styles.line, orientation.ready ? styles.ok : styles.warn]}>
          ready {orientation.ready ? 'yes' : 'NO'} · desired output {orientation.desired}
        </Text>
        <Text style={styles.line}>
          Frame.orientation {orientation.frameOrientation ?? '—'}
        </Text>
        <Text style={styles.line}>{orientation.detectorRotation}</Text>
        <Text style={styles.line}>
          last update{' '}
          {orientation.lastUpdateAt ? new Date(orientation.lastUpdateAt).toISOString().slice(11, 23) : '—'}
        </Text>

        <Text style={styles.title}>Coordinate spaces</Text>
        {result ? (
          <>
            <Text style={styles.line}>
              raw: {result.spaces.raw.width}×{result.spaces.raw.height} / orientation=
              {frameMeta?.orientation ?? '?'}
              {frameMeta?.isMirrored ? ' · mirrored' : ''}
            </Text>
            <Text style={styles.line}>
              oriented: {result.spaces.oriented.width}×{result.spaces.oriented.height}
            </Text>
            <Text style={styles.line}>
              visible crop: {result.spaces.visible.width.toFixed(0)}×
              {result.spaces.visible.height.toFixed(0)} @ {result.spaces.visible.x.toFixed(0)},
              {result.spaces.visible.y.toFixed(0)}
            </Text>
            <Text style={styles.ok}>
              detector: {result.spaces.detector.width}×{result.spaces.detector.height} / upright
            </Text>
            <Text style={styles.line}>
              overlay: {result.spaces.overlay.width.toFixed(0)}×{result.spaces.overlay.height.toFixed(0)}
            </Text>
          </>
        ) : (
          <Text style={styles.dim}>no analysis yet</Text>
        )}

        <Text style={styles.title}>Detector (raw detectCardQuad)</Text>
        {result ? (
          <>
            <Text style={[styles.line, result.detected ? styles.ok : styles.warn]}>
              detected {result.detected ? 'YES' : 'no'} · score {result.score.toFixed(3)} ·{' '}
              {result.detector.detectMs.toFixed(1)} ms
            </Text>
            {result.quad ? (
              <Text style={styles.line}>
                area {(result.quad.areaRatio * 100).toFixed(1)}% · aspect {result.quad.aspect.toFixed(3)}{' '}
                (card 0.716)
              </Text>
            ) : null}
            {result.corners ? (
              <Text style={styles.line}>
                1 TL {formatCorner(result.corners.topLeft)} · 2 TR{' '}
                {formatCorner(result.corners.topRight)}
              </Text>
            ) : null}
            {result.corners ? (
              <Text style={styles.line}>
                3 BR {formatCorner(result.corners.bottomRight)} · 4 BL{' '}
                {formatCorner(result.corners.bottomLeft)}
              </Text>
            ) : null}
            <Text style={styles.line}>
              work {result.detector.workSize.width}×{result.detector.workSize.height} · candidates{' '}
              {result.detector.candidates} · selected {result.detector.selectedIndex}
            </Text>
            <Text style={styles.line}>
              best candidate {result.detector.bestCandidateScore.toFixed(3)}
            </Text>
            {result.detector.rejectReasons.length > 0 ? (
              <Text style={styles.line}>rejects: {result.detector.rejectReasons.join(', ')}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.dim}>no detector result yet</Text>
        )}

        {probeResult ? (
          <>
            <Text style={styles.title}>Test current frame (one shot)</Text>
            <Text style={[styles.line, probeResult.rawDetected ? styles.ok : styles.warn]}>
              raw detect {probeResult.rawDetected ? 'YES' : 'no'} · score{' '}
              {probeResult.rawScore.toFixed(3)} · {probeResult.rawMs.toFixed(1)} ms
            </Text>
            <Text style={styles.line}>
              {probeResult.size} · luma {probeResult.brightness.toFixed(0)}
            </Text>
            <Text style={styles.line}>controller phase {probeResult.controllerPhase}</Text>
            {probeResult.rejectReasons.length > 0 ? (
              <Text style={styles.line}>rejects: {probeResult.rejectReasons.join(', ')}</Text>
            ) : null}
          </>
        ) : null}

        {session ? (
          <>
            {onStartDeckBenchmark || onStartBinderBenchmark || onStartCardSwapTest ? (
              <>
                <Text style={styles.title}>REAL BENCHMARKS</Text>
                {realBenchmarkStatus?.deck ? (
                  <Text style={styles.dim}>Deck: {realBenchmarkStatus.deck}</Text>
                ) : null}
                {realBenchmarkStatus?.binder ? (
                  <Text style={styles.dim}>Binder: {realBenchmarkStatus.binder}</Text>
                ) : null}
                {onStartDeckBenchmark ? (
                  <Pressable onPress={onStartDeckBenchmark} style={styles.swapStart}>
                    <Text style={styles.swapStartLabel}>Deck Benchmark</Text>
                  </Pressable>
                ) : null}
                {onStartBinderBenchmark ? (
                  <Pressable onPress={onStartBinderBenchmark} style={[styles.swapStart, { marginTop: 6 }]}>
                    <Text style={styles.swapStartLabel}>Binder Benchmark</Text>
                  </Pressable>
                ) : null}
                {onStartCardSwapTest ? (
                  <Pressable onPress={onStartCardSwapTest} style={[styles.swapStart, { marginTop: 6 }]}>
                    <Text style={styles.swapStartLabel}>Card Swap Test</Text>
                  </Pressable>
                ) : null}
                <Text style={styles.dim}>
                  Hands-free capture → upload → Mac analysis. No production detector change.
                </Text>
              </>
            ) : null}
            <Text style={styles.title}>LOCK GATES</Text>
            {session.lockGates ? (
              <>
                <Text
                  style={[
                    styles.line,
                    session.lockGates.blocker === 'none' ? styles.ok : styles.warn,
                  ]}
                >
                  blocker {session.lockGates.blocker} · {session.lockGates.waiting}
                </Text>
                <Text
                  style={[styles.line, session.lockGates.geometryDetected ? styles.ok : styles.bad]}
                >
                  geometry detected {session.lockGates.geometryDetected ? 'YES' : 'NO'} · score{' '}
                  {session.lockGates.detectorScore.toFixed(2)} /{' '}
                  {session.lockGates.detectorThreshold.toFixed(2)}
                </Text>
                <Text style={[styles.line, session.lockGates.stable ? styles.ok : styles.bad]}>
                  stable {session.lockGates.stable ? 'YES' : 'NO'} · motion{' '}
                  {session.lockGates.motionScore.toFixed(3)} /{' '}
                  {session.lockGates.motionThreshold.toFixed(3)} · consecutive{' '}
                  {session.lockGates.consecutiveStable}/{session.lockGates.requiredStable}
                </Text>
                <Text style={styles.line}>
                  stable duration{' '}
                  {session.lockGates.stableDurationMs != null
                    ? `${session.lockGates.stableDurationMs.toFixed(0)} ms`
                    : '—'}{' '}
                  · last hit{' '}
                  {session.lockGates.lastHitAgeMs != null
                    ? `${session.lockGates.lastHitAgeMs.toFixed(0)} ms`
                    : '—'}{' '}
                  / stale {session.lockGates.staleClearThresholdMs} ms
                </Text>
                <Text
                  style={[
                    styles.line,
                    session.lockGates.qualityGating && !session.lockGates.qualityOk
                      ? styles.bad
                      : styles.ok,
                  ]}
                >
                  quality {session.lockGates.qualityOk ? 'YES' : 'NO'}{' '}
                  {session.lockGates.qualityScore != null
                    ? session.lockGates.qualityScore.toFixed(2)
                    : '—'}{' '}
                  / {session.lockGates.qualityThreshold.toFixed(2)} · {session.lockGates.qualityInput}
                  {session.lockGates.qualityGating ? '' : ' (geometry only)'}
                </Text>
                <Text style={[styles.line, session.lockGates.focusOk ? styles.ok : styles.warn]}>
                  focus {session.lockGates.focusOk ? 'YES' : 'NO'} · {session.lockGates.focusKind}
                  {session.lockGates.focusAgeMs != null
                    ? ` · ${session.lockGates.focusAgeMs.toFixed(0)} ms`
                    : ''}
                  {session.lockGates.focusTimedOut ? ' · timed out' : ''}
                  {session.lockGates.focusAttemptId != null
                    ? ` · attempt ${session.lockGates.focusAttemptId}`
                    : ''}
                  {session.lockGates.sameCardSessionFocus
                    ? ' · same-session'
                    : ' · new-session/unknown'}
                </Text>
                <Text style={styles.line}>
                  Geometry track: {session.lockGates.geometryTrackId ?? session.lockGates.currentTrackId ?? '—'}
                  {' · '}Card session: {session.lockGates.cardSessionId ?? '—'}
                  {session.lockGates.focusCardSessionId != null
                    ? ` · focusSession ${session.lockGates.focusCardSessionId}`
                    : ''}
                </Text>
                <Text style={styles.line}>
                  Visual change: {session.lockGates.visualChange ?? '—'}
                  {session.lockGates.fingerprintDelta != null
                    ? ` · delta ${session.lockGates.fingerprintDelta.toFixed(3)}`
                    : ''}
                  {session.lockGates.changeWatchDelta != null
                    ? ` · watchΔ ${session.lockGates.changeWatchDelta.toFixed(3)}`
                    : ''}
                  {session.lockGates.cardChangeState
                    ? ` · change ${session.lockGates.cardChangeState}`
                    : ''}
                  {session.lockGates.sessionResetReason
                    ? ` · reset ${session.lockGates.sessionResetReason}`
                    : ''}
                  {session.lockGates.resultPossiblyStale ? ' · result STALE?' : ''}
                </Text>
                <Text style={styles.line}>
                  Previous identity: {session.lockGates.previousSessionIdentity ?? '—'}
                </Text>
                <Text style={styles.line}>
                  Current identity: {session.lockGates.currentSessionIdentity ?? '—'}
                </Text>
                <Text style={styles.line}>
                  focus req {session.lockGates.focusRequests ?? 0} · ok{' '}
                  {session.lockGates.focusSuccesses ?? 0} · timeout{' '}
                  {session.lockGates.focusTimeouts ?? 0} · reenter{' '}
                  {session.lockGates.focusReentries ?? 0}
                  {session.lockGates.focusWaitMs != null
                    ? ` · wait ${session.lockGates.focusWaitMs.toFixed(0)} ms`
                    : ''}
                </Text>
                <Text
                  style={[
                    styles.line,
                    session.lockGates.postLockStall ? styles.bad : styles.ok,
                  ]}
                >
                  high-res req {session.lockGates.highResRequests ?? 0} · ok{' '}
                  {session.lockGates.highResSuccess ?? 0} · fail{' '}
                  {session.lockGates.highResFailure ?? 0}
                  {session.lockGates.lastHighResError
                    ? ` · ${session.lockGates.lastHighResError}`
                    : ''}
                  {session.lockGates.postLockStall ? ' · POST_LOCK_STALL' : ''}
                </Text>
                <Text style={styles.line}>
                  recognize {session.recognizeInvocations ?? 0}
                  {session.lockGates.recognitionStatus
                    ? ` · ${session.lockGates.recognitionStatus}`
                    : ''}
                  {session.lockGates.retryReason
                    ? ` · retry ${session.lockGates.retryReason}`
                    : ''}
                </Text>
                <Text style={[styles.line, session.lockGates.bestFrame ? styles.ok : styles.warn]}>
                  best frame {session.lockGates.bestFrame ? 'YES' : 'NO'} · pool{' '}
                  {session.lockGates.poolSize} ·{' '}
                  {session.lockGates.bestQuality != null
                    ? session.lockGates.bestQuality.toFixed(2)
                    : '—'}{' '}
                  · {session.lockGates.bestFrameSource}
                </Text>
                <Text
                  style={[styles.line, session.lockGates.highResEligible ? styles.ok : styles.bad]}
                >
                  high-res eligible {session.lockGates.highResEligible ? 'YES' : 'NO'} · pending{' '}
                  {session.lockGates.recognitionPending ? 'YES' : 'NO'}
                </Text>
                <Text
                  style={[
                    styles.line,
                    session.lockGates.cornerOrderValid ? styles.ok : styles.warn,
                  ]}
                >
                  corner order {session.lockGates.cornerOrderValid ? 'TL TR BR BL' : 'CORRECTED'} ·
                  fixes {session.lockGates.cornerOrderCorrections} · hits{' '}
                  {session.lockGates.detectorHits} / miss {session.lockGates.detectorMisses}
                </Text>
              </>
            ) : (
              <Text style={styles.dim}>no lock-gate snapshot yet</Text>
            )}
            <Text style={styles.title}>SessionController</Text>
            <Text style={styles.ok}>
              phase {session.phase}
              {session.lockGates?.waiting ? ` · ${session.lockGates.waiting}` : ''}
            </Text>
            <Text style={styles.line}>
              recognizeCard ×{session.recognizeInvocations ?? 0}
              {session.selectedRole ? ` · role ${session.selectedRole}` : ''}
              {session.continuityReason ? ` · ${session.continuityReason}` : ''}
            </Text>
            <Text style={styles.line}>
              stable {session.stable ? 'yes' : 'no'} · track {session.trackFrames}
              {session.qualityBest != null ? ` · quality ${session.qualityBest.toFixed(2)}` : ''}
            </Text>
            {session.qualitySharpness != null ? (
              <Text style={styles.line}>
                sharp {session.qualitySharpness.toFixed(0)} · glare{' '}
                {(session.qualityGlare ?? 0).toFixed(3)} · exp{' '}
                {(session.qualityExposure ?? 0).toFixed(0)}
              </Text>
            ) : null}
            <Text style={styles.line}>
              names {session.names ?? '—'} · printing {session.printingEntries ?? '—'} · art{' '}
              {session.artEntries ?? '—'}
              {session.artUniqueOracles != null ? ` · oracles ${session.artUniqueOracles}` : ''}
              {session.artGenerated ? ` · built ${session.artGenerated.slice(0, 10)}` : ''}
            </Text>
            {session.artChecksum ? (
              <Text style={styles.line}>art checksum {session.artChecksum}</Text>
            ) : null}
            {session.artError ? <Text style={styles.bad}>{session.artError}</Text> : null}
            {session.artCandidates.length ? (
              <Text style={styles.line}>
                art candidate pool {session.artCandidates.length} (matcher top-N, not index size)
              </Text>
            ) : null}
            <Text style={styles.line}>
              title {session.titleEvidence} · text {session.textEvidence} · footer{' '}
              {session.footerEvidence}
            </Text>
            <Text style={styles.line}>
              temporal obs {session.temporalObservations} · leader{' '}
              {session.temporalLeader ?? '—'}
              {session.temporalResetReason ? ` · reset: ${session.temporalResetReason}` : ''}
            </Text>
            <Text style={styles.title}>Recognition source</Text>
            <Text style={session.sourceLabel === 'high-res' ? styles.ok : styles.warn}>
              source: {session.recognitionSource ?? 'none'} ({session.sourceLabel}) · phase{' '}
              {session.hiresPhase}
            </Text>
            <Text style={styles.line}>
              wait {session.hiresWaitMs ?? '—'} ms · native {session.sourceWidth ?? '—'}×
              {session.sourceHeight ?? '—'} · warp 744×1039
            </Text>
            <Text style={styles.line}>
              capture {session.captureMs?.toFixed(0) ?? '—'} ms · convert{' '}
              {session.convertMs?.toFixed(0) ?? '—'} ms · warp {session.warpMs?.toFixed(0) ?? '—'} ms
            </Text>
            {session.hiresStats
              ? (['snapshot', 'photo', 'high-res-frame'] as const).map(key => {
                  const s = session.hiresStats![key];
                  if (!s) return null;
                  return (
                    <Text key={key} style={styles.line}>
                      {key} req {s.requested} ok {s.success} fail {s.failure}
                      {s.timeout ? ` to ${s.timeout}` : ''}
                      {s.lastError ? ` · ${s.lastError}` : ''}
                    </Text>
                  );
                })
              : null}
            <Text style={styles.title}>High-res source</Text>
            {session.hiresUri && session.sourceWidth && session.sourceHeight ? (
              <DetectorInputThumb
                corners={session.mappedCorners}
                height={session.sourceHeight}
                label={`${session.sourceWidth}×${session.sourceHeight} · ${session.recognitionSource}`}
                maxEdge={200}
                showNumbers
                title="High-res source"
                uri={session.hiresUri}
                width={session.sourceWidth}
              />
            ) : (
              <Text style={styles.dim}>no high-res source yet — hold a card until locking</Text>
            )}
            {session.artCandidates.length ? (
              <>
                <Text style={styles.title}>Artwork candidates</Text>
                {session.artCandidates.map((c, i) => (
                  <Text key={`${c.name}:${i}`} style={styles.line}>
                    {i + 1}. {c.name} — {c.score.toFixed(3)}
                  </Text>
                ))}
                <Text style={styles.line}>
                  descriptor {session.artworkDescriptorMs?.toFixed(1) ?? '—'} ms · matcher{' '}
                  {session.artworkMatcherMs?.toFixed(1) ?? '—'} ms · art stage{' '}
                  {session.artworkMs?.toFixed(1) ?? '—'} ms
                </Text>
              </>
            ) : (
              <Text style={styles.dim}>no artwork candidates yet</Text>
            )}
            <Text style={styles.title}>User latency (lock → result)</Text>
            {session.userLatency ? (
              <>
                <Text style={styles.line}>
                  lock→first oracle {latMs(session.userLatency.lockToFirstOracleMs)} · lock→final{' '}
                  {latMs(session.userLatency.lockToFinalOracleMs)}
                </Text>
                <Text style={styles.line}>
                  lock→printing {latMs(session.userLatency.lockToPrintingMs)} · recognize→name{' '}
                  {latMs(session.userLatency.recognizeToFirstOracleMs)}
                </Text>
                <Text style={styles.line}>
                  early {session.earlyReason ?? '—'} · titleDone{' '}
                  {latMs(session.titleDoneAt)} · artDone {latMs(session.artDoneAt)} · earlyAt{' '}
                  {latMs(session.earlyIdentityAt)}
                </Text>
              </>
            ) : (
              <Text style={styles.dim}>no lock→oracle timing yet</Text>
            )}
            <Text style={styles.title}>OCR adapter</Text>
            <Text style={styles.line}>
              OCR:{' '}
              {session.ocrAdapter
                ? !session.ocrAdapter.textRecognizerCreated
                  ? `unavailable${session.ocrAdapter.lastError ? `: ${session.ocrAdapter.lastError}` : ''}`
                  : session.ocrAdapter.warmupState === 'warming'
                    ? 'warming'
                    : session.ocrAdapter.lastError
                      ? `error: ${session.ocrAdapter.lastError}`
                      : 'ready'
                : '—'}
            </Text>
            <Text style={styles.line}>
              Transport: {session.ocrAdapter?.transport ?? '—'} · Last attempt:{' '}
              {session.ocrAdapter?.lastAttempt ?? 'not run'}
            </Text>
            <Text style={styles.title}>OCR pipeline</Text>
            {session.ocrPipeline ? (
              <>
                <Text style={styles.line}>
                  schedule {session.ocrPipeline.schedule ?? '—'} · title{' '}
                  {session.ocrPipeline.titleCropW ?? '—'}×{session.ocrPipeline.titleCropH ?? '—'} ·{' '}
                  {session.ocrPipeline.titleBytes != null
                    ? `${(session.ocrPipeline.titleBytes / 1024).toFixed(1)} KB`
                    : '—'}{' '}
                  · {session.ocrPipeline.titleTransport ?? '—'}
                </Text>
                <Text style={styles.line}>
                  title encode {latMs(session.ocrPipeline.titleEncodeMs)} · bridge+native{' '}
                  {latMs(session.ocrPipeline.titleJsBridgeMs)} · native{' '}
                  {latMs(session.ocrPipeline.titleNativeMs)} · mlkit{' '}
                  {latMs(session.ocrPipeline.titleMlkitMs)}
                </Text>
                <Text style={styles.line}>
                  footer {session.ocrPipeline.footerCropW ?? '—'}×
                  {session.ocrPipeline.footerCropH ?? '—'} ·{' '}
                  {session.ocrPipeline.footerBytes != null
                    ? `${(session.ocrPipeline.footerBytes / 1024).toFixed(1)} KB`
                    : '—'}{' '}
                  · {session.ocrPipeline.footerTransport ?? '—'} · mlkit{' '}
                  {latMs(session.ocrPipeline.footerMlkitMs)}
                </Text>
              </>
            ) : (
              <Text style={styles.dim}>no OCR stage timings yet</Text>
            )}
            {session.acceptance ? (
              <>
                <Text style={styles.title}>Samsung acceptance</Text>
                <Text style={styles.line}>
                  ENGINE {session.acceptance.detectorActual ?? '—'} · OCR{' '}
                  {session.ocrPipeline?.titleTransport ?? '—'}
                </Text>
                <Text style={styles.line}>
                  DATA Names {session.acceptance.names ?? '—'} · Printing{' '}
                  {session.acceptance.printing ?? '—'} · Type {session.acceptance.type ?? '—'} · Art{' '}
                  {session.acceptance.art ?? '—'}
                </Text>
                <Text style={styles.line}>
                  LAST {session.acceptance.lastName ?? '—'}
                  {session.acceptance.lastPrinting ? ` · ${session.acceptance.lastPrinting}` : ''}
                </Text>
                <Text style={styles.line}>
                  lock→oracle {latMs(session.acceptance.lockToOracleMs)} · lock→printing{' '}
                  {latMs(session.acceptance.lockToPrintingMs)}
                </Text>
                <Text style={styles.line}>
                  title MLKit {latMs(session.ocrPipeline?.titleMlkitMs ?? null)} · footer MLKit{' '}
                  {latMs(session.ocrPipeline?.footerMlkitMs ?? null)}
                </Text>
              </>
            ) : null}
            <Text style={styles.title}>
              Recognition input — {session.sourceLabel === 'high-res' ? 'HIGH RES' : 'analysis fallback'}
            </Text>
            {session.normalizedUri ? (
              <DetectorInputThumb
                corners={null}
                height={1039}
                label={`744×1039 · ${session.recognitionSource ?? 'unknown'} · readable preview`}
                maxEdge={320}
                showNumbers={false}
                title="Recognition input"
                uri={session.normalizedUri}
                width={744}
              />
            ) : (
              <Text style={styles.dim}>no normalized card yet — lock a stable card</Text>
            )}
          </>
        ) : (
          <Text style={styles.dim}>SessionController not attached</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bad: {
    color: '#FF8A80',
  },
  column: {
    flex: 1,
  },
  dim: {
    color: '#8A97AD',
    fontSize: 10,
  },
  error: {
    color: '#FF8A80',
    fontSize: 11,
    marginBottom: 4,
  },
  line: {
    color: '#E8EEF7',
    fontFamily: 'Courier',
    fontSize: 10,
    lineHeight: 14,
  },
  ok: {
    color: '#7CFFB2',
  },
  panel: {
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  scroll: {
    padding: 8,
  },
  swapStart: {
    alignSelf: 'stretch',
    backgroundColor: '#C47A12',
    borderRadius: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  swapStartLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  title: {
    color: '#F5C542',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
  },
  warn: {
    color: '#F5C542',
  },
});
