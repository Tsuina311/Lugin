// Local-first debug inbox upload. Never runs on the detector hot path.
// Save files first, enqueue refs, return immediately, upload later.

import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { ALLOWED_FILES, isSafeId, makeSessionId, makeTraceId, sanitizeId } from './protocol';
import { getInboxSettings, isInboxConfigured, loadInboxSettings } from './settings';

export type InboxFileRef = {
  kind: 'text' | 'base64';
  name: keyof typeof ALLOWED_FILES;
  uri: string;
};

export type InboxQueueItem = {
  attempts: number;
  createdAt: string;
  files: InboxFileRef[];
  lastError: string | null;
  meta: {
    appStamp: string | null;
    device: string | null;
    runtimeFingerprint: string | null;
    scannerPhase: string | null;
    traceType: string;
  };
  sessionId: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  traceId: string;
  uploadedAt: string | null;
};

export type InboxSnapshot = {
  connection: 'not_configured' | 'unknown' | 'connected' | 'failed';
  lastError: string | null;
  lastUpload: { at: string; traceId: string } | null;
  pending: number;
  receiverVersion: string | null;
  serverTime: string | null;
};

export type InboxEvent =
  | { kind: 'queued'; pending: number; traceId: string }
  | { kind: 'uploaded'; pending: number; traceId: string }
  | { kind: 'failed'; error: string; pending: number; traceId: string }
  | { kind: 'state'; snapshot: InboxSnapshot };

const QUEUE_FILE = 'lugin-debug-inbox/queue.json';
const MAX_ATTEMPTS = 8;
const HEALTH_FETCH_MS = 15_000;
/** Focus-series / A/B JSON is large; 15s aborts mid-POST and Cloudflare then shows 502. */
const UPLOAD_FETCH_MS = 90_000;
/** Quick tunnels drop multi-megabyte JSON. Receiver already merges same traceId. */
const CHUNK_JSON_BYTES = 1_200_000;

const listeners = new Set<(event: InboxEvent) => void>();

const state = {
  connection: 'unknown' as InboxSnapshot['connection'],
  items: [] as InboxQueueItem[],
  lastError: null as string | null,
  lastUpload: null as InboxSnapshot['lastUpload'],
  loaded: false,
  nextTrace: 1,
  receiverVersion: null as string | null,
  running: false,
  serverTime: null as string | null,
};

const fs = async () => import('expo-file-system/legacy');

const queueUri = async (): Promise<string | null> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  await FileSystem.makeDirectoryAsync(`${root}lugin-debug-inbox/`, { intermediates: true });
  return `${root}${QUEUE_FILE}`;
};

const notify = (event: InboxEvent): void => {
  for (const fn of listeners) fn(event);
};

export const subscribeInbox = (fn: (event: InboxEvent) => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const getInboxSnapshot = (): InboxSnapshot => ({
  connection: isInboxConfigured() ? state.connection : 'not_configured',
  lastError: state.lastError,
  lastUpload: state.lastUpload,
  pending: state.items.filter(i => i.status !== 'uploaded').length,
  receiverVersion: state.receiverVersion,
  serverTime: state.serverTime,
});

const persistQueue = async (): Promise<void> => {
  const FileSystem = await fs();
  const uri = await queueUri();
  if (!uri) return;
  await FileSystem.writeAsStringAsync(
    uri,
    JSON.stringify({
      items: state.items,
      lastUpload: state.lastUpload,
      nextTrace: state.nextTrace,
    }),
  );
};

export const restoreInboxQueue = async (): Promise<InboxSnapshot> => {
  if (!isBenchmarkToolsEnabled()) return getInboxSnapshot();
  await loadInboxSettings();
  if (state.loaded) {
    void kickInboxQueue();
    return getInboxSnapshot();
  }
  try {
    const FileSystem = await fs();
    const uri = await queueUri();
    if (uri) {
      const raw = await FileSystem.readAsStringAsync(uri);
      const parsed = JSON.parse(raw) as {
        items?: InboxQueueItem[];
        lastUpload?: InboxSnapshot['lastUpload'];
        nextTrace?: number;
      };
      state.items = Array.isArray(parsed.items) ? parsed.items : [];
      state.nextTrace = Number(parsed.nextTrace) > 0 ? Number(parsed.nextTrace) : 1;
      state.lastUpload = parsed.lastUpload ?? null;
      for (const item of state.items) {
        stripPoisonFiles(item);
        if (item.status === 'uploading') item.status = 'pending';
      }
    }
  } catch {
    /* first run */
  }
  state.loaded = true;
  if (!isInboxConfigured()) state.connection = 'not_configured';
  notify({ kind: 'state', snapshot: getInboxSnapshot() });
  void kickInboxQueue();
  return getInboxSnapshot();
};

const fileExists = async (uri: string): Promise<boolean> => {
  try {
    const FileSystem = await fs();
    const info = await FileSystem.getInfoAsync(uri);
    return Boolean(info.exists);
  } catch {
    return false;
  }
};

const sleep = (ms: number) => {
  const g = globalThis as { __LUGIN_INBOX_NO_SLEEP?: boolean };
  if (g.__LUGIN_INBOX_NO_SLEEP) return Promise.resolve();
  return new Promise<void>(r => setTimeout(r, ms));
};

const backoffMs = (attempts: number): number =>
  Math.min(20_000, 800 * 2 ** Math.min(Math.max(0, attempts - 1), 5));

const authHeaders = (): Record<string, string> => {
  const { token } = getInboxSettings();
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = HEALTH_FETCH_MS,
): Promise<Response> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

type InboxFilePayload = { mime: string; text?: string; base64?: string };

export const chunkInboxFiles = (
  files: Record<string, InboxFilePayload>,
  maxBytes = CHUNK_JSON_BYTES,
): Record<string, InboxFilePayload>[] => {
  const chunks: Record<string, InboxFilePayload>[] = [];
  let current: Record<string, InboxFilePayload> = {};
  let size = 0;
  const entryBytes = (name: string, file: InboxFilePayload): number =>
    name.length + (file.text?.length ?? 0) + (file.base64?.length ?? 0) + 80;
  for (const [name, file] of Object.entries(files)) {
    const n = entryBytes(name, file);
    if (Object.keys(current).length > 0 && size + n > maxBytes) {
      chunks.push(current);
      current = {};
      size = 0;
    }
    current[name] = file;
    size += n;
  }
  if (Object.keys(current).length) chunks.push(current);
  return chunks;
};

const classifyNetworkError = (err: unknown, url: string): string => {
  const message = err instanceof Error ? err.message : String(err);
  if (url.startsWith('http://') && /cleartext|plaintext|CLEARTEXT|Network request failed/i.test(message)) {
    return `${message} — current APK may block cleartext LAN HTTP. See docs/SCAN-DEBUG-INBOX.md`;
  }
  if (/upload HTTP 502|HTTP 530|502/.test(message)) {
    return `${message} — Cloudflare dropped a large POST. Retry after the chunked-upload JS reload; keep the current tunnel Pair.`;
  }
  return message;
};

export const testInboxConnection = async (): Promise<InboxSnapshot> => {
  await loadInboxSettings();
  const { url, token } = getInboxSettings();
  if (!url || !token || !isBenchmarkToolsEnabled()) {
    state.connection = 'not_configured';
    state.lastError = 'Receiver URL and token required';
    notify({ kind: 'state', snapshot: getInboxSnapshot() });
    return getInboxSnapshot();
  }
  try {
    const res = await fetchWithTimeout(`${url}/health`, {
      headers: authHeaders(),
      method: 'GET',
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      serverTime?: string;
      version?: string;
    } | null;
    if (!res.ok) {
      state.connection = 'failed';
      state.lastError = res.status === 401 ? 'Unauthorized — check token' : `Health HTTP ${res.status}`;
    } else {
      state.connection = 'connected';
      state.lastError = null;
      state.receiverVersion = json?.version ?? null;
      state.serverTime = json?.serverTime ?? null;
    }
  } catch (err) {
    state.connection = 'failed';
    state.lastError = classifyNetworkError(err, url);
  }
  notify({ kind: 'state', snapshot: getInboxSnapshot() });
  return getInboxSnapshot();
};

const fileKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const unexpectedFileName = (reason: string): string | null => {
  const match = /unexpected file\s+(.+?)$/i.exec(reason.trim());
  const raw = match?.[1]?.replace(/[.,;]+$/, '').trim();
  return raw || null;
};

const sameFileName = (name: string, reported: string): boolean => {
  const a = fileKey(name);
  const b = fileKey(reported);
  return a === b || a === `${b}png` || `${a}png` === b;
};

const dropReportedFile = (item: InboxQueueItem, reported: string): boolean => {
  const next = item.files.filter(f => !sameFileName(f.name, reported));
  if (next.length === item.files.length) return false;
  item.files = next;
  return true;
};

const stripPoisonFiles = (_item: InboxQueueItem): void => {
  /* receiver allowlist now includes attempt crops */
};

const buildBody = async (item: InboxQueueItem): Promise<Record<string, unknown>> => {
  const FileSystem = await fs();
  const files: Record<string, InboxFilePayload> = {};
  for (const file of item.files) {
    const mime = ALLOWED_FILES[file.name];
    if (!mime) continue;
    if (!(await fileExists(file.uri))) continue;
    if (file.kind === 'text') {
      files[file.name] = {
        mime,
        text: await FileSystem.readAsStringAsync(file.uri),
      };
    } else {
      files[file.name] = {
        base64: await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' }),
        mime,
      };
    }
  }
  if (!Object.keys(files).length) {
    throw new Error('no uploadable files on disk');
  }
  return {
    appStamp: item.meta.appStamp,
    createdAt: item.createdAt,
    device: item.meta.device,
    files,
    runtimeFingerprint: item.meta.runtimeFingerprint,
    scannerPhase: item.meta.scannerPhase,
    sessionId: item.sessionId,
    traceId: item.traceId,
    traceType: item.meta.traceType,
  };
};

const uploadOne = async (item: InboxQueueItem): Promise<void> => {
  const { url } = getInboxSettings();
  if (!url) throw new Error('receiver not configured');
  const body = await buildBody(item);
  const files = (body.files ?? {}) as Record<string, InboxFilePayload>;
  const chunks = chunkInboxFiles(files);
  for (const part of chunks) {
    const res = await fetchWithTimeout(
      `${url}/api/scans`,
      {
        body: JSON.stringify({ ...body, files: part }),
        headers: authHeaders(),
        method: 'POST',
      },
      UPLOAD_FETCH_MS,
    );
    const json = (await res.json().catch(() => null)) as {
      already?: boolean;
      ok?: boolean;
      reason?: string;
    } | null;
    if (!res.ok || !json?.ok) {
      throw new Error(json?.reason ?? `upload HTTP ${res.status}`);
    }
  }
};

export const kickInboxQueue = async (): Promise<void> => {
  if (!isBenchmarkToolsEnabled()) return;
  if (state.running) return;
  await loadInboxSettings();
  if (!isInboxConfigured()) return;
  state.running = true;
  try {
    while (true) {
      const item = state.items.find(
        i => i.status === 'pending' || (i.status === 'failed' && i.attempts < MAX_ATTEMPTS),
      );
      if (!item) break;
      stripPoisonFiles(item);
      if (!item.files.length) {
        item.status = 'uploaded';
        item.lastError = 'skipped files the running receiver rejects';
        item.uploadedAt = new Date().toISOString();
        await persistQueue();
        notify({ kind: 'state', snapshot: getInboxSnapshot() });
        continue;
      }
      item.status = 'uploading';
      notify({ kind: 'state', snapshot: getInboxSnapshot() });
      try {
        await uploadOne(item);
        item.status = 'uploaded';
        item.lastError = null;
        item.uploadedAt = new Date().toISOString();
        item.attempts += 1;
        state.lastError = null;
        state.lastUpload = { at: item.uploadedAt, traceId: item.traceId };
        state.connection = 'connected';
        await persistQueue();
        notify({ kind: 'uploaded', pending: getInboxSnapshot().pending, traceId: item.traceId });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const bad = unexpectedFileName(raw);
        if (bad && dropReportedFile(item, bad)) {
          if (!item.files.length) {
            item.status = 'uploaded';
            item.lastError = `${raw} — skipped`;
            item.uploadedAt = new Date().toISOString();
            state.lastError = item.lastError;
            await persistQueue();
            notify({ kind: 'state', snapshot: getInboxSnapshot() });
            continue;
          }
          item.status = 'pending';
          item.lastError = `${raw} — dropped, retrying without it`;
          state.lastError = item.lastError;
          await persistQueue();
          continue;
        }
        item.attempts += 1;
        item.status = 'failed';
        item.lastError = classifyNetworkError(err, getInboxSettings().url);
        state.lastError = item.lastError;
        state.connection = 'failed';
        await persistQueue();
        notify({
          error: item.lastError,
          kind: 'failed',
          pending: getInboxSnapshot().pending,
          traceId: item.traceId,
        });
        if (item.attempts < MAX_ATTEMPTS) {
          await sleep(backoffMs(item.attempts));
          item.status = 'pending';
        } else {
          break;
        }
      }
    }
  } finally {
    state.running = false;
  }
};

export type EnqueueInboxArgs = {
  appStamp?: string | null;
  device?: string | null;
  files: InboxFileRef[];
  runtimeFingerprint?: string | null;
  scannerPhase?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  traceType: string;
};

/**
 * Enqueue an already-persisted local bundle. Never deletes source files.
 * Returns immediately after the queue record is written.
 */
export const enqueueInboxUpload = async (
  args: EnqueueInboxArgs,
): Promise<{ queued: boolean; reason?: string; traceId: string | null }> => {
  if (!isBenchmarkToolsEnabled()) {
    return { queued: false, reason: 'debug tools disabled', traceId: null };
  }
  await restoreInboxQueue();
  if (!isInboxConfigured()) {
    return { queued: false, reason: 'receiver not configured', traceId: null };
  }

  const existing = args.files.filter(f => ALLOWED_FILES[f.name]);
  if (!existing.length) {
    return { queued: false, reason: 'no allowlisted files', traceId: null };
  }

  const sessionId = sanitizeId(args.sessionId, makeSessionId());
  let traceId = sanitizeId(args.traceId);
  if (!traceId) {
    traceId = makeTraceId(state.nextTrace);
    state.nextTrace += 1;
  }
  if (!sessionId || !isSafeId(traceId)) {
    return { queued: false, reason: 'invalid ids', traceId: null };
  }

  const present: InboxFileRef[] = [];
  for (const file of existing) {
    if (await fileExists(file.uri)) present.push(file);
  }
  if (!present.length) {
    return { queued: false, reason: 'files missing on disk', traceId };
  }

  const already = state.items.find(i => i.sessionId === sessionId && i.traceId === traceId);
  if (already) {
    already.files = present;
    already.status = 'pending';
    already.attempts = 0;
    already.lastError = null;
    await persistQueue();
    notify({ kind: 'queued', pending: getInboxSnapshot().pending, traceId });
    void kickInboxQueue();
    return { queued: true, traceId };
  }

  const item: InboxQueueItem = {
    attempts: 0,
    createdAt: new Date().toISOString(),
    files: present,
    lastError: null,
    meta: {
      appStamp: args.appStamp ?? null,
      device: args.device ?? null,
      runtimeFingerprint: args.runtimeFingerprint ?? null,
      scannerPhase: args.scannerPhase ?? null,
      traceType: args.traceType,
    },
    sessionId,
    status: 'pending',
    traceId,
    uploadedAt: null,
  };
  state.items.push(item);
  await persistQueue();
  notify({ kind: 'queued', pending: getInboxSnapshot().pending, traceId });
  void kickInboxQueue();
  return { queued: true, traceId };
};

export const retryInboxUploads = async (): Promise<number> => {
  await restoreInboxQueue();
  let n = 0;
  for (const item of state.items) {
    if (item.status === 'failed' || item.status === 'pending') {
      stripPoisonFiles(item);
      item.status = 'pending';
      item.attempts = 0;
      n += 1;
    }
  }
  await persistQueue();
  void kickInboxQueue();
  return n;
};

/** Drop uploaded queue records. Never deletes a file that has not been acknowledged. */
export const clearUploadedInboxTraces = async (): Promise<number> => {
  await restoreInboxQueue();
  const before = state.items.length;
  const kept = state.items.filter(i => i.status !== 'uploaded');
  const removed = before - kept.length;
  state.items = kept;
  await persistQueue();
  notify({ kind: 'state', snapshot: getInboxSnapshot() });
  return removed;
};

export const peekInboxQueueLength = (): number => state.items.length;

/** Test hook — inspect whether any uploaded item lost its local files. */
export const peekInboxUploadedStillHaveFiles = (): boolean =>
  state.items.filter(i => i.status === 'uploaded').every(i => i.files.length > 0);
