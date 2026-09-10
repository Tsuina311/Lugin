// Local-first Scanner Benchmark Session persistence (dev builds only).
// Recognition completes → immutable JSON + full 744×1039 PNG on disk.
// Upload is fire-and-forget via uploadQueue — never blocks scanning.

import type { ScanImage, SessionSnapshot } from '../sharedCore';
import { CARD_HEIGHT, CARD_WIDTH } from '../sharedCore';
import { scanImageToPngBytes } from '../debug/scanImagePng';
import { buildDebugReport, type DebugSharePayload } from '../saveDebugBundle';
import { parseExpectedManifest, type ExpectedCard } from './expectedManifest';
import { isBenchmarkToolsEnabled } from './isBenchmarkEnabled';
import {
  collectFlags,
  latencyFromSnapshot,
  mapWinningChannel,
  ocrTimingFromReport,
  scoreAgainstExpected,
  type ScoreableResult,
} from './scoreScan';
import { buildSessionSummary, formatSummaryText } from './summary';
import {
  DEFAULT_BENCHMARK_TARGET,
  type BenchmarkScanRecord,
  type BenchmarkSession,
  type BenchmarkSettings,
  type UploadStatus,
} from './types';
import { buildStoreZip, bytesToBase64, type ZipEntry } from './zipExport';
import { enqueueBenchmarkUpload, kickUploadQueue } from './uploadQueue';
import { enqueueBenchmarkInboxScan, isInboxConfigured, loadInboxSettings } from '../debugInbox';

type LegacyFS = typeof import('expo-file-system/legacy');

const META_FILE = 'active-session.json';
const SETTINGS_FILE = 'settings.json';

const state = {
  active: null as BenchmarkSession | null,
  listeners: new Set<() => void>(),
  recordingKey: null as string | null,
  settings: {
    ingestionUrl: '',
    targetCount: DEFAULT_BENCHMARK_TARGET,
  } as BenchmarkSettings,
};

const notify = () => {
  for (const l of state.listeners) l();
};

export const subscribeBenchmark = (fn: () => void): (() => void) => {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
};

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

const rootDir = async (): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('documentDirectory unavailable');
  const dir = `${root}lugin-benchmark/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const sessionDir = async (sessionId: string): Promise<string> => {
  const FileSystem = await fs();
  const dir = `${await rootDir()}${sessionId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.makeDirectoryAsync(`${dir}scans/`, { intermediates: true });
  await FileSystem.makeDirectoryAsync(`${dir}failures/`, { intermediates: true });
  return dir;
};

const writeJson = async (uri: string, value: unknown): Promise<void> => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(value, null, 2));
};

const readJson = async <T>(uri: string): Promise<T | null> => {
  try {
    const FileSystem = await fs();
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as T;
  } catch {
    return null;
  }
};

const randomId = (): string => {
  const a = Math.random().toString(36).slice(2, 10);
  const b = Math.random().toString(36).slice(2, 10);
  return `b${Date.now().toString(36)}-${a}${b}`;
};

const persistActiveMeta = async (): Promise<void> => {
  const FileSystem = await fs();
  const uri = `${await rootDir()}${META_FILE}`;
  if (!state.active) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }
  await writeJson(uri, { sessionId: state.active.sessionId });
};

const persistSession = async (session: BenchmarkSession): Promise<void> => {
  const dir = await sessionDir(session.sessionId);
  await writeJson(`${dir}session.json`, session);
};

export const loadBenchmarkSettings = async (): Promise<BenchmarkSettings> => {
  if (!isBenchmarkToolsEnabled()) return state.settings;
  const raw = await readJson<Partial<BenchmarkSettings>>(`${await rootDir()}${SETTINGS_FILE}`);
  if (raw) {
    state.settings = {
      ingestionUrl: typeof raw.ingestionUrl === 'string' ? raw.ingestionUrl : '',
      targetCount:
        typeof raw.targetCount === 'number' && raw.targetCount > 0
          ? Math.floor(raw.targetCount)
          : DEFAULT_BENCHMARK_TARGET,
    };
  }
  return state.settings;
};

export const saveBenchmarkSettings = async (
  patch: Partial<BenchmarkSettings>,
): Promise<BenchmarkSettings> => {
  if (!isBenchmarkToolsEnabled()) return state.settings;
  state.settings = {
    ingestionUrl:
      patch.ingestionUrl != null ? String(patch.ingestionUrl).trim() : state.settings.ingestionUrl,
    targetCount:
      patch.targetCount != null && patch.targetCount > 0
        ? Math.floor(patch.targetCount)
        : state.settings.targetCount,
  };
  await writeJson(`${await rootDir()}${SETTINGS_FILE}`, state.settings);
  if (state.active && patch.ingestionUrl != null) {
    state.active.ingestionUrl = state.settings.ingestionUrl || null;
    await persistSession(state.active);
  }
  if (state.active && patch.targetCount != null) {
    state.active.targetCount = state.settings.targetCount;
    await persistSession(state.active);
  }
  notify();
  return state.settings;
};

export const getBenchmarkSettings = (): BenchmarkSettings => state.settings;

export const getActiveBenchmarkSession = (): BenchmarkSession | null => state.active;

export const restoreBenchmarkSession = async (): Promise<BenchmarkSession | null> => {
  if (!isBenchmarkToolsEnabled()) return null;
  await loadBenchmarkSettings();
  const meta = await readJson<{ sessionId?: string }>(`${await rootDir()}${META_FILE}`);
  if (!meta?.sessionId) return null;
  const session = await readJson<BenchmarkSession>(
    `${await rootDir()}${meta.sessionId}/session.json`,
  );
  if (!session) return null;
  state.active = session;
  notify();
  void kickUploadQueue();
  return session;
};

export const startBenchmarkSession = async (opts?: {
  expectedManifest?: ExpectedCard[] | null;
  targetCount?: number;
  environment?: BenchmarkSession['environment'];
}): Promise<BenchmarkSession> => {
  if (!isBenchmarkToolsEnabled()) {
    throw new Error('Benchmark tools are disabled outside development builds');
  }
  await loadBenchmarkSettings();
  const session: BenchmarkSession = {
    createdAt: new Date().toISOString(),
    endedAt: null,
    environment: opts?.environment ?? null,
    expectedManifest: opts?.expectedManifest ?? null,
    ingestionUrl: state.settings.ingestionUrl || null,
    scans: [],
    sessionId: randomId(),
    summary: null,
    targetCount: opts?.targetCount ?? state.settings.targetCount,
  };
  state.active = session;
  state.recordingKey = null;
  await sessionDir(session.sessionId);
  await persistSession(session);
  await persistActiveMeta();
  notify();
  return session;
};

export const setBenchmarkExpectedManifest = async (
  raw: unknown,
): Promise<ExpectedCard[]> => {
  if (!isBenchmarkToolsEnabled()) throw new Error('benchmark disabled');
  const cards = parseExpectedManifest(raw);
  if (!state.active) throw new Error('no active benchmark session');
  state.active.expectedManifest = cards;
  await persistSession(state.active);
  notify();
  return cards;
};

export const endBenchmarkSession = async (): Promise<BenchmarkSession | null> => {
  if (!state.active) return null;
  const session = state.active;
  session.endedAt = new Date().toISOString();
  session.summary = buildSessionSummary(session.scans, session.targetCount, {
    printingEntries: session.environment?.printingEntries ?? null,
  });
  // Also write plain-text summary beside session.json for quick share/screenshot.
  try {
    const dir = await sessionDir(session.sessionId);
    await writeJson(`${dir}session-summary.json`, session.summary);
    const FileSystem = await fs();
    await FileSystem.writeAsStringAsync(
      `${dir}session-summary.txt`,
      formatSummaryText(session.summary),
    );
  } catch {
    /* non-fatal */
  }
  await persistSession(session);
  await persistActiveMeta();
  notify();
  return session;
};

export const clearActiveBenchmarkSession = async (): Promise<void> => {
  state.active = null;
  state.recordingKey = null;
  await persistActiveMeta();
  notify();
};

const scoreableFromSnapshot = (
  snapshot: SessionSnapshot,
  payload: DebugSharePayload,
): ScoreableResult => {
  const fused = snapshot.fused;
  const rec = snapshot.recognition;
  const printing = fused?.printing;
  const ocrPresent = Boolean(
    rec?.readings?.length ||
      rec?.collector?.setCode ||
      rec?.collector?.collectorNumber ||
      rec?.collector?.raw,
  );
  const finish =
    Array.isArray(printing?.finishes) && printing!.finishes.length === 1
      ? printing!.finishes[0]
      : null;
  const timings = rec?.timings as Record<string, unknown> | undefined;
  const ocrTransport =
    (typeof timings?.titleTransport === 'string' && timings.titleTransport) ||
    (typeof timings?.footerTransport === 'string' && timings.footerTransport) ||
    null;
  return {
    artConflict: Boolean(fused?.artConflict),
    earlyReason: rec?.earlyReason ?? null,
    finish,
    name: fused?.card?.name ?? printing?.name ?? null,
    ocrPresent,
    printing: printing
      ? {
          collectorNumber: printing.collectorNumber,
          setCode: printing.setCode,
        }
      : rec?.collector
        ? {
            collectorNumber: rec.collector.collectorNumber ?? null,
            setCode: rec.collector.setCode ?? null,
          }
        : null,
    status: fused?.status ?? null,
    titleFooterConflict: Boolean(rec?.titleFooterConflict),
    userLatency: snapshot.userLatency ?? null,
    detectorEngine:
      (payload.requestedDetectorEngine as string | undefined) ??
      (payload.detectorEngine as string | undefined) ??
      null,
    actualDetectorEngine:
      (payload.actualDetectorEngine as string | undefined) ??
      (payload.detectorEngine as string | undefined) ??
      null,
    ocrTransport,
  };
};

const retainAsFixture = async (
  session: BenchmarkSession,
  record: BenchmarkScanRecord,
  dir: string,
): Promise<void> => {
  if (!record.flags.length) return;
  const FileSystem = await fs();
  const dest = `${dir}failures/`;
  await FileSystem.makeDirectoryAsync(dest, { intermediates: true });
  const stem = String(record.seq).padStart(4, '0');
  try {
    await FileSystem.copyAsync({
      from: `${dir}${record.reportRelativePath}`,
      to: `${dest}${stem}.json`,
    });
  } catch {
    /* report may be missing */
  }
  try {
    await FileSystem.copyAsync({
      from: `${dir}${record.pngRelativePath}`,
      to: `${dest}${stem}-recognition.png`,
    });
  } catch {
    /* png may be missing */
  }
  await writeJson(`${dest}${stem}-meta.json`, {
    flags: record.flags,
    name: record.name,
    score: record.score,
    seq: record.seq,
    sessionId: session.sessionId,
    stamp: record.stamp,
    latency: record.latency,
  });
};

export interface RecordBenchmarkArgs {
  payload: DebugSharePayload;
  recognition: ScanImage | null | undefined;
  snapshot: SessionSnapshot;
}

/**
 * Persist one completed recognition. Idempotent per lock (one physical scan).
 * Always writes locally first; upload is queued asynchronously.
 */
export const recordBenchmarkScan = async (
  args: RecordBenchmarkArgs,
): Promise<BenchmarkScanRecord | null> => {
  if (!isBenchmarkToolsEnabled() || !state.active) return null;
  const session = state.active;
  if (session.endedAt) return null;
  if (session.scans.length >= session.targetCount) return null;

  const phase = args.snapshot.phase;
  if (phase !== 'found' && phase !== 'ambiguous') return null;

  // One record per lock — early→final→printing must not create duplicates.
  const key = `lock:${args.snapshot.lockedAt ?? 0}`;
  if (key === state.recordingKey) return null;
  // Also ignore if we already recorded this lock (session restart mid-card).
  if (
    args.snapshot.lockedAt != null &&
    session.scans.some(s => s.lockedAt === args.snapshot.lockedAt)
  ) {
    return null;
  }
  state.recordingKey = key;

  const seq = session.scans.length + 1;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = await sessionDir(session.sessionId);
  const stem = String(seq).padStart(4, '0');
  const reportRel = `scans/${stem}.json`;
  const pngRel = `scans/${stem}-recognition.png`;

  const scoreable = scoreableFromSnapshot(args.snapshot, args.payload);
  const expected =
    session.expectedManifest && session.expectedManifest[seq - 1]
      ? session.expectedManifest[seq - 1]
      : null;
  const score = scoreAgainstExpected(scoreable, expected);
  const latency = latencyFromSnapshot(scoreable);
  const flags = collectFlags(scoreable, score, latency);
  const winningChannel = mapWinningChannel(scoreable.earlyReason);

  const report = {
    ...buildDebugReport({ ...args.payload, stamp }),
    benchmark: {
      expected,
      flags,
      latency,
      score,
      seq,
      sessionId: session.sessionId,
      winningChannel,
      artConflict: scoreable.artConflict ?? false,
      titleFooterConflict: scoreable.titleFooterConflict ?? false,
    },
  };
  await writeJson(`${dir}${reportRel}`, report);

  const FileSystem = await fs();
  const image = args.recognition;
  if (image && image.width === CARD_WIDTH && image.height === CARD_HEIGHT) {
    // Async encode — do not block identity; await only for local persist.
    const png = scanImageToPngBytes(image, CARD_WIDTH);
    await FileSystem.writeAsStringAsync(`${dir}${pngRel}`, bytesToBase64(png), {
      encoding: 'base64',
    });
  } else {
    await writeJson(`${dir}${pngRel}.missing.json`, {
      reason: 'no 744×1039 recognition image at record time',
    });
  }

  const titleBlock = (report as { TITLE?: Record<string, unknown> }).TITLE;
  const footerBlock = (report as { FOOTER?: Record<string, unknown> }).FOOTER;
  const typeBlock = (report as { TYPE?: Record<string, unknown> }).TYPE;

  const record: BenchmarkScanRecord = {
    earlyReason: scoreable.earlyReason ?? null,
    flags,
    latency,
    lockedAt: args.snapshot.lockedAt ?? null,
    name: scoreable.name ?? null,
    pngRelativePath: pngRel,
    reportRelativePath: reportRel,
    score,
    seq,
    stamp,
    status: scoreable.status ?? null,
    uploadAttempts: 0,
    uploadError: null,
    uploadStatus: session.ingestionUrl ? 'pending' : 'skipped',
    winningChannel,
    ocrTitle: ocrTimingFromReport(titleBlock),
    ocrFooter: ocrTimingFromReport(footerBlock),
    ocrType: ocrTimingFromReport(typeBlock),
    detectorEngine: scoreable.detectorEngine ?? null,
    actualDetectorEngine: scoreable.actualDetectorEngine ?? null,
    detectorFallbackReason:
      (args.payload.detectorFallbackReason as string | undefined) ?? null,
    artConflict: Boolean(scoreable.artConflict),
    titleFooterConflict: Boolean(scoreable.titleFooterConflict),
  };

  session.scans.push(record);
  await persistSession(session);
  await retainAsFixture(session, record, dir);
  notify();

  if (session.ingestionUrl && record.uploadStatus === 'pending') {
    enqueueBenchmarkUpload(session.sessionId, record.seq);
    void kickUploadQueue();
  }

  await loadInboxSettings();
  if (isInboxConfigured()) {
    void enqueueBenchmarkInboxScan({
      pngUri: image && image.width === CARD_WIDTH && image.height === CARD_HEIGHT
        ? `${dir}${pngRel}`
        : null,
      reportUri: `${dir}${reportRel}`,
      scannerPhase: phase,
      seq,
      sessionId: session.sessionId,
    });
  }

  if (session.scans.length >= session.targetCount) {
    await endBenchmarkSession();
  }

  return record;
};

export const updateScanUploadStatus = async (
  sessionId: string,
  seq: number,
  status: UploadStatus,
  error?: string | null,
): Promise<void> => {
  const session =
    state.active?.sessionId === sessionId
      ? state.active
      : await readJson<BenchmarkSession>(`${await rootDir()}${sessionId}/session.json`);
  if (!session) return;
  const scan = session.scans.find(s => s.seq === seq);
  if (!scan) return;
  scan.uploadStatus = status;
  if (status === 'failed' || status === 'ok') {
    scan.uploadAttempts += 1;
  }
  scan.uploadError = error ?? null;
  if (state.active?.sessionId === sessionId) {
    state.active = session;
    notify();
  }
  await persistSession(session);
};

export const getSessionDirPath = async (sessionId: string): Promise<string> =>
  sessionDir(sessionId);

export const readSessionScanFiles = async (
  sessionId: string,
  seq: number,
): Promise<{ reportJson: string | null; pngBase64: string | null }> => {
  const FileSystem = await fs();
  const session =
    state.active?.sessionId === sessionId
      ? state.active
      : await readJson<BenchmarkSession>(`${await rootDir()}${sessionId}/session.json`);
  const scan = session?.scans.find(s => s.seq === seq);
  if (!scan) return { pngBase64: null, reportJson: null };
  const dir = await sessionDir(sessionId);
  let reportJson: string | null = null;
  let pngBase64: string | null = null;
  try {
    reportJson = await FileSystem.readAsStringAsync(`${dir}${scan.reportRelativePath}`);
  } catch {
    reportJson = null;
  }
  try {
    pngBase64 = await FileSystem.readAsStringAsync(`${dir}${scan.pngRelativePath}`, {
      encoding: 'base64',
    });
  } catch {
    pngBase64 = null;
  }
  return { pngBase64, reportJson };
};

export const exportBenchmarkSessionZip = async (
  sessionId?: string,
): Promise<{ ok: true; uri: string; bytes: number } | { ok: false; reason: string }> => {
  if (!isBenchmarkToolsEnabled()) return { ok: false, reason: 'benchmark disabled' };
  const id = sessionId ?? state.active?.sessionId;
  if (!id) return { ok: false, reason: 'no session' };
  const FileSystem = await fs();
  const dir = await sessionDir(id);
  const session =
    state.active?.sessionId === id
      ? state.active
      : await readJson<BenchmarkSession>(`${dir}session.json`);
  if (!session) return { ok: false, reason: 'session.json missing' };

  // Ensure summary exists for export.
  if (!session.summary) {
    session.summary = buildSessionSummary(session.scans, session.targetCount, {
      printingEntries: session.environment?.printingEntries ?? null,
    });
    await persistSession(session);
  }

  const entries: ZipEntry[] = [];
  entries.push({
    data: new TextEncoder().encode(JSON.stringify(session, null, 2)),
    name: 'session.json',
  });
  entries.push({
    data: new TextEncoder().encode(JSON.stringify(session.summary, null, 2)),
    name: 'session-summary.json',
  });
  entries.push({
    data: new TextEncoder().encode(formatSummaryText(session.summary)),
    name: 'session-summary.txt',
  });
  entries.push({
    data: new TextEncoder().encode(formatSummaryText(session.summary)),
    name: 'summary.txt',
  });

  for (const scan of session.scans) {
    try {
      const report = await FileSystem.readAsStringAsync(`${dir}${scan.reportRelativePath}`);
      entries.push({
        data: new TextEncoder().encode(report),
        name: scan.reportRelativePath,
      });
    } catch {
      /* skip */
    }
    try {
      const b64 = await FileSystem.readAsStringAsync(`${dir}${scan.pngRelativePath}`, {
        encoding: 'base64',
      });
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      entries.push({ data: bytes, name: scan.pngRelativePath });
    } catch {
      /* skip missing png */
    }
  }

  // Failure corpus copies (if present on disk).
  try {
    const failDir = `${dir}failures/`;
    const failInfo = await FileSystem.getInfoAsync(failDir);
    if (failInfo.exists) {
      const names = await FileSystem.readDirectoryAsync(failDir);
      for (const name of names) {
        try {
          if (name.endsWith('.png')) {
            const b64 = await FileSystem.readAsStringAsync(`${failDir}${name}`, {
              encoding: 'base64',
            });
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            entries.push({ data: bytes, name: `failures/${name}` });
          } else {
            const text = await FileSystem.readAsStringAsync(`${failDir}${name}`);
            entries.push({
              data: new TextEncoder().encode(text),
              name: `failures/${name}`,
            });
          }
        } catch {
          /* skip one file */
        }
      }
    }
  } catch {
    /* no failures dir */
  }

  const zipBytes = buildStoreZip(entries);
  const outUri = `${dir}benchmark-${id}.zip`;
  await FileSystem.writeAsStringAsync(outUri, bytesToBase64(zipBytes), { encoding: 'base64' });
  return { ok: true, bytes: zipBytes.length, uri: outUri };
};

export const shareBenchmarkZip = async (
  sessionId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const built = await exportBenchmarkSessionZip(sessionId);
  if (!built.ok) return built;
  try {
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, reason: 'sharing unavailable' };
    }
    await Sharing.shareAsync(built.uri, {
      dialogTitle: 'Export benchmark session',
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};

export const peekBenchmarkHud = (): {
  count: number;
  lastCorrect: boolean | null;
  lastLatencyOracleMs: number | null;
  lastLatencyPrintingMs: number | null;
  lastName: string | null;
  summaryText: string | null;
  target: number;
  active: boolean;
} => {
  const s = state.active;
  if (!s) {
    return {
      active: false,
      count: 0,
      lastCorrect: null,
      lastLatencyOracleMs: null,
      lastLatencyPrintingMs: null,
      lastName: null,
      summaryText: null,
      target: state.settings.targetCount,
    };
  }
  const last = s.scans[s.scans.length - 1];
  let lastCorrect: boolean | null = null;
  if (last?.score) {
    lastCorrect = last.score.oracleOk && last.score.printingOk;
  }
  return {
    active: true,
    count: s.scans.length,
    lastCorrect,
    lastLatencyOracleMs:
      last?.latency.lockToFirstOracleMs ?? last?.latency.lockToFinalOracleMs ?? null,
    lastLatencyPrintingMs: last?.latency.lockToPrintingMs ?? null,
    lastName: last?.name ?? null,
    summaryText: s.summary ? formatSummaryText(s.summary) : null,
    target: s.targetCount,
  };
};
