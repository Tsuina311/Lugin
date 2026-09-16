/**
 * Unified pending / incomplete upload inventory (dev tools).
 * Scans ACK files + active-run pointers + binder-diag summaries + inbox queue.
 */

import type { BenchmarkUploadAckState, BenchmarkUploadKind, BenchmarkUploadManifest } from '@/lib/scan/benchmarkUpload';
import type { BinderSessionDiagBundle } from '@/lib/scan/binder';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import {
  peekUploadQueueLength,
  retryFailedBenchmarkUploads,
} from '../benchmark/uploadQueue';
import {
  loadUploadAckState,
  runBenchmarkUploadSession,
} from '../benchmarkUpload/session';
import {
  retryBinderBenchmarkUpload,
} from '../binderBenchmark/enqueue';
import { loadBinderBundle, loadBinderActiveMeta, binderRunDir } from '../binderBenchmark/persist';
import {
  binderDiagDirUri,
  loadBinderDiagActiveMeta,
  listBinderDiagSessions,
  persistBinderDiagActiveMeta,
} from '../binder/persist';
import { retryBinderDiagnosticsUpload } from '../binder/enqueue';
import { enqueueDeckBenchmark } from '../deckBenchmark/enqueue';
import { deckRunDir, loadDeckActiveMeta, loadDeckBundle } from '../deckBenchmark/persist';
import {
  getInboxSnapshot,
  restoreInboxQueue,
  retryInboxUploads,
} from '../debugInbox/queue';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import { enqueueGeometryTest } from '../geometryTest/enqueue';
import {
  geometryRunDir,
  loadGeometryActiveMeta,
  loadGeometryBundle,
} from '../geometryTest/persist';
import { isInboxConfigured, loadInboxSettings } from '../debugInbox/settings';

type LegacyFS = typeof import('expo-file-system/legacy');
const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export type PendingUploadKind =
  | BenchmarkUploadKind
  | 'inbox'
  | 'legacy-benchmark';

export type PendingUploadItem = {
  id: string;
  kind: PendingUploadKind;
  runId: string;
  label: string;
  missingCount: number;
  acknowledgedCount: number;
  status: string;
  dirUri: string | null;
  detail: string | null;
};

const kindLabel = (kind: PendingUploadKind): string => {
  switch (kind) {
    case 'binder':
      return 'Binder diagnostics';
    case 'binder-benchmark':
      return 'Binder benchmark';
    case 'deck-benchmark':
      return 'Deck benchmark';
    case 'geometry-test':
      return 'Geometry test';
    case 'normal-scan':
      return 'Single Scan diagnostics';
    case 'inbox':
      return 'Debug inbox queue';
    case 'legacy-benchmark':
      return 'Legacy benchmark uploads';
    default:
      return kind;
  }
};

const resolveDirForAck = async (
  kind: BenchmarkUploadKind,
  runId: string,
): Promise<string | null> => {
  try {
    if (kind === 'binder') return await binderDiagDirUri(runId);
    if (kind === 'binder-benchmark') return await binderRunDir(runId);
    if (kind === 'deck-benchmark') return await deckRunDir(runId);
    if (kind === 'geometry-test') return await geometryRunDir(runId);
    if (kind === 'normal-scan') {
      const FileSystem = await fs();
      const root = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
      if (!root) return null;
      const dir = `${root}normal-scan/${runId}/`;
      const info = await FileSystem.getInfoAsync(dir);
      return info.exists ? dir : null;
    }
  } catch {
    return null;
  }
  return null;
};

const collectAckUris = async (dir: string, out: string[]): Promise<void> => {
  const FileSystem = await fs();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const names = await FileSystem.readDirectoryAsync(dir);
  for (const name of names) {
    const uri = `${dir}${name}`;
    if (name.endsWith('-ack.json')) {
      out.push(uri);
      continue;
    }
    const child = await FileSystem.getInfoAsync(uri);
    if (child.exists && child.isDirectory) {
      await collectAckUris(`${uri}/`, out);
    }
  }
};

const readAckFile = async (uri: string): Promise<BenchmarkUploadAckState | null> => {
  try {
    const FileSystem = await fs();
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as BenchmarkUploadAckState;
  } catch {
    return null;
  }
};

const pushUnique = (items: PendingUploadItem[], next: PendingUploadItem) => {
  if (items.some(i => i.id === next.id)) return;
  items.push(next);
};

/** Scan device for everything still needing upload / ACK. */
export const listIncompleteUploads = async (): Promise<PendingUploadItem[]> => {
  if (!isBenchmarkToolsEnabled()) return [];
  await loadInboxSettings();
  const items: PendingUploadItem[] = [];

  try {
    const FileSystem = await fs();
    const root = FileSystem.documentDirectory;
    if (root) {
      const ackDir = `${root}lugin-benchmark-upload/`;
      const uris: string[] = [];
      await collectAckUris(ackDir, uris);
      for (const uri of uris) {
        const ack = await readAckFile(uri);
        if (!ack || ack.uploadStatus === 'COMPLETE') continue;
        const dirUri = await resolveDirForAck(ack.kind, ack.runId);
        const why = (ack.failReasons ?? []).filter(Boolean).slice(0, 2).join(' · ');
        pushUnique(items, {
          id: `ack:${ack.kind}:${ack.runId}`,
          kind: ack.kind,
          runId: ack.runId,
          label: kindLabel(ack.kind),
          missingCount: ack.missingRequired.length,
          acknowledgedCount: ack.acknowledged.length,
          status: ack.uploadStatus,
          dirUri,
          detail:
            why ||
            ack.missingRequired.slice(0, 4).join(', ') ||
            null,
        });
      }
    }
  } catch {
    /* ignore listing failures */
  }

  // Active-run pointers (may exist even if ACK was cleared).
  const actives: { kind: PendingUploadKind; load: () => Promise<{ fixtureId: string } | null> }[] =
    [
      { kind: 'deck-benchmark', load: loadDeckActiveMeta },
      { kind: 'binder-benchmark', load: loadBinderActiveMeta },
      { kind: 'geometry-test', load: loadGeometryActiveMeta },
      { kind: 'binder', load: loadBinderDiagActiveMeta },
    ];
  for (const a of actives) {
    try {
      const meta = await a.load();
      if (!meta?.fixtureId) continue;
      const ack = await loadUploadAckState(meta.fixtureId);
      if (ack?.uploadStatus === 'COMPLETE') continue;
      const dirUri = await resolveDirForAck(a.kind as BenchmarkUploadKind, meta.fixtureId);
      pushUnique(items, {
        id: `active:${a.kind}:${meta.fixtureId}`,
        kind: a.kind,
        runId: meta.fixtureId,
        label: kindLabel(a.kind),
        missingCount: ack?.missingRequired.length ?? 0,
        acknowledgedCount: ack?.acknowledged.length ?? 0,
        status: ack?.uploadStatus ?? 'INCOMPLETE',
        dirUri,
        detail: ack?.missingRequired.slice(0, 4).join(', ') || 'active run pending upload',
      });
    } catch {
      /* continue */
    }
  }

  // Binder diag dirs with incomplete summary.json
  try {
    for (const session of await listBinderDiagSessions()) {
      if (session.uploadStatus === 'COMPLETE') continue;
      pushUnique(items, {
        id: `binder-diag:${session.fixtureId}`,
        kind: 'binder',
        runId: session.fixtureId,
        label: kindLabel('binder'),
        missingCount: session.missingFiles?.length ?? 0,
        acknowledgedCount: 0,
        status: session.uploadStatus ?? 'INCOMPLETE',
        dirUri: session.dirUri,
        detail: session.missingFiles?.slice(0, 4).join(', ') ?? null,
      });
    }
  } catch {
    /* ignore */
  }

  await restoreInboxQueue();
  const inbox = getInboxSnapshot();
  if (inbox.pending > 0) {
    pushUnique(items, {
      id: 'inbox:queue',
      kind: 'inbox',
      runId: 'inbox-queue',
      label: kindLabel('inbox'),
      missingCount: inbox.pending,
      acknowledgedCount: 0,
      status: inbox.connection === 'connected' ? 'PENDING' : 'INCOMPLETE',
      dirUri: null,
      detail: inbox.lastError,
    });
  }

  const legacy = peekUploadQueueLength();
  if (legacy > 0) {
    pushUnique(items, {
      id: 'legacy:benchmark',
      kind: 'legacy-benchmark',
      runId: 'legacy-benchmark',
      label: kindLabel('legacy-benchmark'),
      missingCount: legacy,
      acknowledgedCount: 0,
      status: 'PENDING',
      dirUri: null,
      detail: `${legacy} queued`,
    });
  }

  items.sort((a, b) => a.label.localeCompare(b.label) || a.runId.localeCompare(b.runId));
  return items;
};

export type PendingRetryResult = {
  ok: boolean;
  message: string;
  stillIncomplete: boolean;
};

/** Retry one pending item using the real mode uploader (ACK / missing-only). */
export const retryPendingUpload = async (
  item: PendingUploadItem,
  onProgress?: (msg: string) => void,
): Promise<PendingRetryResult> => {
  if (!isBenchmarkToolsEnabled()) {
    return { ok: false, message: 'Debug tools disabled', stillIncomplete: true };
  }
  await loadInboxSettings();
  if (item.kind !== 'legacy-benchmark' && item.kind !== 'inbox' && !isInboxConfigured()) {
    return { ok: false, message: 'Receiver not configured — pair Debug receiver first', stillIncomplete: true };
  }

  onProgress?.(`Retrying ${item.label}…`);

  try {
    if (item.kind === 'inbox') {
      const n = await retryInboxUploads();
      const left = getInboxSnapshot().pending;
      return {
        ok: left === 0,
        message: left === 0 ? `Inbox UPLOADED ✓ (${n} retried)` : `Inbox still pending: ${left}`,
        stillIncomplete: left > 0,
      };
    }
    if (item.kind === 'legacy-benchmark') {
      const n = await retryFailedBenchmarkUploads();
      const left = peekUploadQueueLength();
      return {
        ok: left === 0,
        message: left === 0 ? `Legacy uploads done (${n})` : `Legacy still queued: ${left}`,
        stillIncomplete: left > 0,
      };
    }
    if (item.kind === 'binder') {
      const dirUri = item.dirUri ?? (await binderDiagDirUri(item.runId));
      const FileSystem = await fs();
      const raw = await FileSystem.readAsStringAsync(
        `${dirUri.endsWith('/') ? dirUri : `${dirUri}/`}summary.json`,
      );
      const bundle = JSON.parse(raw) as BinderSessionDiagBundle;
      const out = await retryBinderDiagnosticsUpload({
        dirUri,
        bundle,
        onProgress: (a, t) => onProgress?.(`${a} / ${t} files`),
      });
      await persistBinderDiagActiveMeta(out.uploadStatus === 'COMPLETE' ? null : item.runId);
      return {
        ok: out.uploadStatus === 'COMPLETE',
        message: out.message,
        stillIncomplete: out.uploadStatus !== 'COMPLETE',
      };
    }
    if (item.kind === 'binder-benchmark') {
      const bundle = await loadBinderBundle(item.runId);
      if (!bundle) return { ok: false, message: 'Binder benchmark bundle missing', stillIncomplete: true };
      const dirUri = item.dirUri ?? (await binderRunDir(item.runId));
      const out = await retryBinderBenchmarkUpload({
        dirUri,
        bundle,
        onProgress: (a, t) => onProgress?.(`${a} / ${t} files`),
      });
      return {
        ok: out.uploadStatus === 'COMPLETE',
        message: out.message,
        stillIncomplete: out.uploadStatus !== 'COMPLETE',
      };
    }
    if (item.kind === 'deck-benchmark') {
      const bundle = await loadDeckBundle(item.runId);
      if (!bundle) return { ok: false, message: 'Deck bundle missing', stillIncomplete: true };
      const dirUri = item.dirUri ?? (await deckRunDir(item.runId));
      const out = await enqueueDeckBenchmark({
        dirUri,
        bundle,
      });
      return {
        ok: out.uploadStatus === 'COMPLETE',
        message: out.message,
        stillIncomplete: out.uploadStatus !== 'COMPLETE',
      };
    }
    if (item.kind === 'geometry-test') {
      const bundle = await loadGeometryBundle(item.runId);
      if (!bundle) return { ok: false, message: 'Geometry bundle missing', stillIncomplete: true };
      const dirUri = item.dirUri ?? (await geometryRunDir(item.runId));
      const out = await enqueueGeometryTest({ dirUri, bundle });
      return {
        ok: out.uploadStatus === 'COMPLETE',
        message: out.message,
        stillIncomplete: out.uploadStatus !== 'COMPLETE',
      };
    }
    if (item.kind === 'normal-scan') {
      const dirUri = item.dirUri;
      if (!dirUri) return { ok: false, message: 'Normal-scan dir missing', stillIncomplete: true };
      const FileSystem = await fs();
      const names = await FileSystem.readDirectoryAsync(dirUri);
      const files = names.filter(n => n in ALLOWED_FILES);
      const manifest: BenchmarkUploadManifest = {
        runId: item.runId,
        kind: 'normal-scan',
        files: files.map(relativePath => ({
          relativePath,
          required: relativePath === 'metadata.json' || relativePath === 'recognition-card.png',
        })),
        createdAt: new Date().toISOString(),
      };
      const out = await runBenchmarkUploadSession({ manifest, dirUri });
      return {
        ok: out.uploadStatus === 'COMPLETE',
        message:
          out.uploadStatus === 'COMPLETE'
            ? 'Single Scan diagnostics UPLOADED ✓'
            : `INCOMPLETE · ${out.acknowledged.length} uploaded, ${out.missingRequired.length} missing`,
        stillIncomplete: out.uploadStatus !== 'COMPLETE',
      };
    }
    return { ok: false, message: `Unknown kind ${item.kind}`, stillIncomplete: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      stillIncomplete: true,
    };
  }
};

/** Retry every incomplete item sequentially. */
export const retryAllPendingUploads = async (
  onProgress?: (msg: string) => void,
): Promise<{ total: number; complete: number; failed: number; lastMessage: string | null }> => {
  const list = await listIncompleteUploads();
  let complete = 0;
  let failed = 0;
  let lastMessage: string | null = null;
  for (const item of list) {
    const out = await retryPendingUpload(item, onProgress);
    lastMessage = out.message;
    if (out.ok) complete += 1;
    else failed += 1;
  }
  return { total: list.length, complete, failed, lastMessage };
};
