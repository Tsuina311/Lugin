import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { AnalysisMetrics, StageStats } from './analysisStats';
import type {
  AnalysisResult,
  FrameMetadata,
  FrameProbeResult,
  PingEcho,
  Rung,
  StageCounters,
  TransferCheck,
  WorkletFailure,
} from './useFrameAnalysis';

type Props = {
  counters: StageCounters;
  error: string | null;
  failure: WorkletFailure | null;
  frameMeta: FrameMetadata | null;
  metrics: AnalysisMetrics | null;
  ping: PingEcho | null;
  preview: string | null;
  probeResult: FrameProbeResult | null;
  result: AnalysisResult | null;
  rung: Rung;
  transfer: TransferCheck | null;
};

const ms = (s: StageStats) => `${s.p50.toFixed(1)}/${s.p95.toFixed(1)}`;
const fps = (n: number) => n.toFixed(1);

/**
 * The transfer ladder, in execution order.
 *
 * Reading down the list, the last row that counts up is the last thing that
 * works — so the break is the row after it. Each rung is scheduled separately
 * inside the worklet, so a failure at one does not suppress the rows above it.
 */
export function ScanDebugPanel({
  counters,
  error,
  failure,
  frameMeta,
  metrics,
  ping,
  preview,
  probeResult,
  result,
  rung,
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
            <Text style={styles.title}>Ladder (rung: {rung})</Text>
            {ladder.map(([label, value], i) => (
              <Text key={label} style={[styles.line, i === breakAt && styles.bad]}>
                {label}: {value}
                {i === breakAt ? '  ← BREAKS HERE' : ''}
              </Text>
            ))}
            <Text style={styles.line}>
              skip: cad {counters.skippedForCadence} · nobuf {counters.skippedNoPixelBuffer} ·
              planar {counters.skippedPlanar}
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

          <View style={styles.thumbBox}>
            <Text style={styles.thumbLabel}>Detector input</Text>
            {preview ? (
              <Image resizeMode="contain" source={{ uri: preview }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Text style={styles.dim}>none</Text>
              </View>
            )}
            {result ? (
              <Text style={styles.dim}>
                {result.analysis.width}×{result.analysis.height} · luma{' '}
                {result.brightness.toFixed(0)}
              </Text>
            ) : null}
          </View>
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

        <Text style={styles.title}>Detector (raw detectCardQuad)</Text>
        {result ? (
          <>
            <Text style={[styles.line, result.detected ? styles.ok : styles.warn]}>
              detected {result.detected ? 'YES' : 'no'} · score {result.score.toFixed(3)} ·{' '}
              {result.detector.detectMs.toFixed(1)} ms
            </Text>
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

        <Text style={styles.dim}>
          Overlay is driven directly by detectCardQuad; SessionController is not in the live path.
        </Text>
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
  thumb: {
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1,
    height: 132,
    width: 100,
  },
  thumbBox: {
    alignItems: 'center',
    gap: 2,
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLabel: {
    color: '#F5C542',
    fontSize: 10,
    fontWeight: '700',
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
