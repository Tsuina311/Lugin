// Development-only Scanner Lab. Ugly on purpose.

import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';

import { getOcrAdapterSnapshot, ocrUnavailableReason } from '../scan/ocrAdapter';
import { enqueueLabFixture } from '../scan/debugInbox/enqueueLab';
import { listLabFixtures, saveLabFixture, type LabFixtureMeta } from '../scan/scannerLab/store';
import {
  replayLastLiveAttempt,
  runFixtureAb,
  runLivePipelineOnFixture,
  type LabTableRow,
} from '../scan/scannerLab/replay';
import { scanImageToPngDataUri } from '../scan/debug/scanImagePng';
import type { CardNameIndex, ScanImage } from '../scan/sharedCore';
import type { LabQuadSet } from '@/lib/scan/scannerLab/types';
import { PROVEN_RECOGNITION_BASELINE } from '@/lib/scan/scannerLab/types';
import type { FocusSeriesRun } from '../scan/focusSeries/runSeries';

export type LabOpenCapture = {
  detector: ScanImage | null;
  orientation: string | null;
  quads: LabQuadSet;
  recognitionResult: string | null;
  source: ScanImage;
};

export function ScannerLabScreen(props: {
  frozenCapture: LabOpenCapture | null;
  nameIndex: CardNameIndex | null;
  onCaptureFocusSeries?: (label: string) => Promise<FocusSeriesRun>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(props.frozenCapture?.recognitionResult ?? '');
  const [status, setStatus] = useState('Idle');
  const [fixtures, setFixtures] = useState<LabFixtureMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<LabTableRow[]>([]);
  const [json, setJson] = useState<string>('');
  const [sourceUri, setSourceUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [series, setSeries] = useState<FocusSeriesRun | null>(null);
  const adapter = getOcrAdapterSnapshot();

  const refresh = useCallback(async () => {
    setFixtures(await listLabFixtures());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const cap = props.frozenCapture;
    if (!cap) {
      setStatus('No capture at open — lock a card, then tap Scanner Lab again');
      return;
    }
    setSourceUri(scanImageToPngDataUri(cap.source, 280));
    setStatus(
      `Frozen at open · ${cap.source.width}×${cap.source.height}` +
        (cap.recognitionResult ? ` · ${cap.recognitionResult}` : '') +
        ' · camera paused',
    );
  }, [props.frozenCapture]);

  const saveCurrent = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cap = props.frozenCapture;
      if (!cap) {
        setStatus('No capture at open — close Lab, lock a card, tap Scanner Lab');
        return;
      }
      const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
        ?.lugin;
      const saved = await saveLabFixture({
        appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
        detector: cap.detector,
        expectedName: label || null,
        label: label || 'card',
        orientation: cap.orientation,
        quads: cap.quads,
        recognitionResult: cap.recognitionResult,
        source: cap.source,
      });
      setSelectedId(saved.fixtureId);
      setSourceUri(scanImageToPngDataUri(cap.source, 280));
      setStatus(`Saved ${saved.fixtureId} · ${cap.source.width}×${cap.source.height}`);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const queueFixture = async (fixtureId: string, note: string): Promise<string> => {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return `${note} · no documentDirectory`;
    const lugin = (Constants.expoConfig?.extra as { lugin?: { buildLabel?: string } } | undefined)
      ?.lugin;
    const queued = await enqueueLabFixture({
      appStamp: lugin?.buildLabel ?? Constants.expoConfig?.version ?? null,
      dirUri: `${root}lugin-scanner-lab/fixtures/${fixtureId}/`,
      fixtureId,
    });
    return queued.queued
      ? `${note} · upload queued ${queued.traceId ?? fixtureId}`
      : `${note} · upload not queued: ${queued.reason ?? 'unknown'}`;
  };

  const runAb = async (fixtureId: string) => {
    if (busy) return;
    setBusy(true);
    setStatus(`Running A/B on ${fixtureId}…`);
    try {
      const out = await runFixtureAb({ fixtureId, nameIndex: props.nameIndex });
      setSelectedId(fixtureId);
      setRows(out.rows);
      setJson(JSON.stringify(out.json, null, 2));
      setSourceUri(scanImageToPngDataUri(out.fixture.source, 280));
      setStatus(
        await queueFixture(
          fixtureId,
          `A/B done · baseline ${out.baseline.matchName ?? 'none'} / current ${out.current.matchName ?? 'none'} · same text ${out.compare.sameTitleText}`,
        ),
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runLiveOrch = async (fixtureId: string) => {
    if (busy) return;
    setBusy(true);
    setStatus(`Live orch on ${fixtureId}…`);
    try {
      const out = await runLivePipelineOnFixture({ fixtureId, nameIndex: props.nameIndex });
      setSelectedId(fixtureId);
      setRows(out.rows);
      setJson(JSON.stringify(out.json, null, 2));
      setStatus(
        await queueFixture(
          fixtureId,
          `Live orch · lab ${String((out.json.lab as { matchName?: string } | undefined)?.matchName ?? 'none')} / live ${String((out.json.liveOrch as { name?: string } | undefined)?.name ?? 'none')}`,
        ),
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const replayLast = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('Replaying last live attempt…');
    try {
      const out = await replayLastLiveAttempt({ nameIndex: props.nameIndex });
      setRows(out.rows);
      setJson(JSON.stringify(out.json, null, 2));
      setStatus(
        out.replay
          ? `Replay ${out.replay.matchName ?? 'none'} · live ${out.live?.matchName ?? 'none'}`
          : 'No last live attempt saved',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const list = await listLabFixtures();
      const meta = list.find(f => f.fixtureId === selectedId);
      if (!meta) {
        setStatus('select a fixture');
        return;
      }
      const FileSystem = await import('expo-file-system/legacy');
      const root = FileSystem.documentDirectory;
      if (!root) return;
      const queued = await enqueueLabFixture({
        dirUri: `${root}lugin-scanner-lab/fixtures/${selectedId}/`,
        fixtureId: selectedId,
      });
      setStatus(
        queued.queued
          ? `Uploaded queued ${queued.traceId ?? selectedId}`
          : `Upload not queued: ${queued.reason ?? 'unknown'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.title}>SCANNER LAB</Text>
        <Pressable onPress={props.onClose} style={styles.btn}>
          <Text style={styles.btnText}>Close</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>OCR ADAPTER</Text>
        <Text style={styles.mono}>
          native {adapter.nativeModuleAvailable ? 'yes' : 'no'} · rgba-bytes{' '}
          {adapter.recognizeFromRgbaBytesAvailable ? 'yes' : 'no'} · controller{' '}
          {adapter.controllerHasOcrDependency ? 'yes' : 'no'} · warmup {adapter.warmupState} ·{' '}
          {adapter.transport}
        </Text>
        {ocrUnavailableReason() ? (
          <Text style={styles.warn}>OCR unavailable: {ocrUnavailableReason()}</Text>
        ) : null}

        <Text style={styles.section}>SOURCE</Text>
        <TextInput
          onChangeText={setLabel}
          placeholder="label / expected name"
          placeholderTextColor="#6b7"
          style={styles.input}
          value={label}
        />
        <Pressable disabled={busy || !props.frozenCapture} onPress={() => void saveCurrent()} style={styles.btnWide}>
          <Text style={styles.btnText}>Save frozen capture as replay fixture</Text>
        </Pressable>
        <Text style={styles.hint}>
          Frozen from the last locked hi-res frame. Opening Lab does not take a new photo.
          Live scanning is paused until you close.
        </Text>

        <Text style={styles.section}>FOCUS SERIES</Text>
        <Text style={styles.hint}>
          Prefer the live-preview Focus series button so you can keep the card in view.
          This still uses takeSnapshot() on the camera underneath Lab.
        </Text>
        <Pressable
          disabled={busy || !props.onCaptureFocusSeries}
          onPress={() => {
            if (!props.onCaptureFocusSeries || busy) return;
            setBusy(true);
            setStatus('Focus series… keep the card under the camera');
            void props
              .onCaptureFocusSeries(label || 'card')
              .then(next => {
                setSeries(next);
                setStatus(`Uploaded ${next.fixtureId}`);
              })
              .catch(err => setStatus(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
          style={styles.btnWide}
        >
          <Text style={styles.btnText}>Capture Focus Series</Text>
        </Pressable>
        {series ? (
          <Text style={styles.mono}>
            {series.samples
              .map(
                s =>
                  `T${s.nominalDelayMs} ${Math.round(s.actualDelayFromFocusRequestMs)}ms  sharp ${s.metrics.titleSharpness.toFixed(1)}  ${s.ocr.rawOcrFirst || '(empty)'}  ${s.ocr.matchName ?? s.ocr.status}`,
              )
              .join('\n')}
          </Text>
        ) : null}

        <Text style={styles.section}>REPLAY FIXTURES</Text>
        {fixtures.length === 0 ? <Text style={styles.dim}>none yet</Text> : null}
        {fixtures.map(f => (
          <Pressable
            key={f.fixtureId}
            onPress={() => setSelectedId(f.fixtureId)}
            style={[styles.fix, selectedId === f.fixtureId && styles.fixOn]}
          >
            <Text style={styles.btnText}>
              {f.label} · {f.sourceWidth}×{f.sourceHeight}
            </Text>
            <Text style={styles.dim}>{f.fixtureId}</Text>
          </Pressable>
        ))}

        <Text style={styles.section}>PIPELINES</Text>
        <Text style={styles.dim}>
          Proven baseline = {PROVEN_RECOGNITION_BASELINE}. Current is the accuracy path. Legacy
          1dd4932 is diagnostic only.
        </Text>
        <Pressable
          disabled={busy || !selectedId}
          onPress={() => selectedId && void runAb(selectedId)}
          style={styles.btnWide}
        >
          <Text style={styles.btnText}>Run Legacy + Current</Text>
        </Pressable>
        <Pressable
          disabled={busy || !selectedId}
          onPress={() => selectedId && void runLiveOrch(selectedId)}
          style={styles.btnWide}
        >
          <Text style={styles.btnText}>Run live pipeline on fixture</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => void replayLast()} style={styles.btnWide}>
          <Text style={styles.btnText}>Replay last live attempt</Text>
        </Pressable>
        <Pressable disabled={busy || !selectedId} onPress={() => void upload()} style={styles.btnWide}>
          <Text style={styles.btnText}>Upload fixture / last A/B</Text>
        </Pressable>

        <Text style={styles.status}>{status}</Text>

        {sourceUri ? (
          <>
            <Text style={styles.section}>ORIGINAL HIGH-RES</Text>
            <Pressable onPress={() => setEnlarged(sourceUri)}>
              <Image source={{ uri: sourceUri }} style={styles.thumbWide} />
            </Pressable>
          </>
        ) : null}

        <Text style={styles.section}>RESULTS</Text>
        {rows.map(row => (
          <View key={row.path} style={styles.row}>
            <Text style={styles.btnText}>
              {row.path} · {row.warp} · {row.enhance} · {row.ocr}
            </Text>
            <Text style={styles.mono}>
              text: {row.text}
              {'\n'}match: {row.match} · {row.timeMs}ms
              {row.error ? `\nerror: ${row.error}` : ''}
            </Text>
            <View style={styles.thumbs}>
              {row.warpUri ? (
                <Pressable onPress={() => setEnlarged(row.warpUri)}>
                  <Image source={{ uri: row.warpUri }} style={styles.thumb} />
                </Pressable>
              ) : null}
              {row.cropUri ? (
                <Pressable onPress={() => setEnlarged(row.cropUri)}>
                  <Image source={{ uri: row.cropUri }} style={styles.thumbCrop} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}

        {json ? (
          <>
            <Text style={styles.section}>DIAGNOSTIC JSON</Text>
            <Text selectable style={styles.json}>
              {json}
            </Text>
          </>
        ) : null}
      </ScrollView>
      {enlarged ? (
        <Pressable onPress={() => setEnlarged(null)} style={styles.overlay}>
          <Image resizeMode="contain" source={{ uri: enlarged }} style={styles.big} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  big: { flex: 1, width: '100%' },
  body: { gap: 8, padding: 10, paddingBottom: 40 },
  btn: { backgroundColor: '#243044', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8 },
  btnText: { color: '#E8EEF7', fontSize: 13, fontWeight: '600' },
  btnWide: { backgroundColor: '#243044', borderRadius: 6, padding: 12 },
  dim: { color: '#8A97AD', fontSize: 12 },
  fix: { backgroundColor: '#162033', borderRadius: 6, padding: 8 },
  fixOn: { borderColor: '#3D7EFF', borderWidth: 1 },
  hint: { color: '#8A97AD', fontSize: 11 },
  input: {
    backgroundColor: '#162033',
    borderRadius: 6,
    color: '#E8EEF7',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  json: { color: '#C9D4E5', fontFamily: 'Menlo', fontSize: 10 },
  mono: { color: '#C9D4E5', fontFamily: 'Menlo', fontSize: 11 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: '#000c', padding: 12 },
  root: { backgroundColor: '#0B1220', flex: 1 },
  row: { backgroundColor: '#121a28', borderRadius: 6, gap: 6, padding: 8 },
  section: { color: '#7EB0FF', fontSize: 12, fontWeight: '800', marginTop: 6 },
  status: { color: '#F4D35E', fontSize: 12 },
  thumb: { backgroundColor: '#000', height: 140, width: 100 },
  thumbCrop: { backgroundColor: '#000', height: 40, width: 220 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWide: { backgroundColor: '#000', height: 180, width: '100%' },
  title: { color: '#E8EEF7', fontSize: 16, fontWeight: '800' },
  warn: { color: '#FF8A8A', fontSize: 12 },
});
