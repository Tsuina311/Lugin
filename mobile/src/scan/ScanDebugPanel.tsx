import { ScrollView, StyleSheet, Text, View } from 'react-native';

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

type SessionBits = {
  artCandidates: { name: string; score: number }[];
  artEntries: number | null;
  artError: string | null;
  artGenerated: string | null;
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
  normalizedUri: string | null;
  phase: string;
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
};

type Props = {
  analysisLongEdge: number;
  counters: StageCounters;
  diagnosticRungs: boolean;
  error: string | null;
  failure: WorkletFailure | null;
  frameMeta: FrameMetadata | null;
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
};

const ms = (s: StageStats) =>
  s.count === 0 ? 'n/a' : `${s.p50.toFixed(1)}/${s.p95.toFixed(1)}`;
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
}: Props) {
  const ladder: [string, number][] = [
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
  ];

  // Flag the first rung that has nothing while the rung above it has something.
  // The last two rows are allowed to be zero without being a plumbing fault:
  // a detector that runs and finds no card is a different problem.
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

        <View style={styles.row}>
          <View style={styles.column}>
            <Text style={styles.title}>
              Ladder ({diagnosticRungs ? `rung: ${rung}` : 'fast path'}) · long {analysisLongEdge}
            </Text>
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
              dropped {counters.droppedByCamera} · superseded {counters.supersededOnJs}
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
            <Text style={styles.title}>SessionController</Text>
            <Text style={styles.ok}>phase {session.phase}</Text>
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
              names {session.names ?? '—'} · art index {session.artEntries ?? '—'}
              {session.artGenerated ? ` · built ${session.artGenerated.slice(0, 10)}` : ''}
            </Text>
            {session.artError ? <Text style={styles.bad}>{session.artError}</Text> : null}
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
