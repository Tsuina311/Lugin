/**
 * Benchmark upload session — server-ACK semantics with resume.
 * Shared by Deck + Binder. Does not claim success until required files are ACKed.
 */

import {
  emptyAckState,
  filesToUpload,
  reconcileUploadAck,
  type BenchmarkUploadAckState,
  type BenchmarkUploadFileSpec,
  type BenchmarkUploadKind,
  type BenchmarkUploadManifest,
} from '@/lib/scan/benchmarkUpload';
import {
  assertGeometryCardArtifactDims,
  classifyGeometryArtifact,
  GEOMETRY_CARD_ARTIFACT_HEIGHT,
  GEOMETRY_CARD_ARTIFACT_WIDTH,
  type GeometryTestItemRecord,
} from '@/lib/scan/geometryTest';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { ALLOWED_FILES, isSafeId, sanitizeId } from '../debugInbox/protocol';
import { getInboxSettings, isInboxConfigured, loadInboxSettings } from '../debugInbox/settings';
import { pngIhdrDimensionsFromBase64 } from '../debug/scanImagePng';

type LegacyFS = typeof import('expo-file-system/legacy');

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

const UPLOAD_FETCH_MS = 90_000;
/** Conservative for large PNGs over Quick Tunnel. */
const DEFAULT_CONCURRENCY = 2;

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
  timeoutMs = UPLOAD_FETCH_MS,
): Promise<Response> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fileBytes = async (uri: string): Promise<number | null> => {
  try {
    const FileSystem = await fs();
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return 'size' in info && typeof info.size === 'number' ? info.size : 0;
  } catch {
    return null;
  }
};

const traceIdForPath = (relativePath: string): string => {
  const stem = relativePath.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
  const id = sanitizeId(stem.slice(0, 80)) ?? `f-${stem.slice(0, 60)}`;
  return isSafeId(id) ? id : `file-${Math.abs(hashStr(relativePath))}`;
};

const hashStr = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

const ackStateUri = async (runId: string): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('documentDirectory unavailable');
  const dir = `${root}lugin-benchmark-upload/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return `${dir}${runId}-ack.json`;
};

export const loadUploadAckState = async (
  runId: string,
): Promise<BenchmarkUploadAckState | null> => {
  try {
    const FileSystem = await fs();
    const uri = await ackStateUri(runId);
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as BenchmarkUploadAckState;
  } catch {
    return null;
  }
};

export const persistUploadAckState = async (state: BenchmarkUploadAckState): Promise<void> => {
  const FileSystem = await fs();
  const uri = await ackStateUri(state.runId);
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(state, null, 2));
};

export const buildBinderUploadManifest = async (args: {
  runId: string;
  dirUri: string;
  pages: number;
  fileNames: string[];
}): Promise<BenchmarkUploadManifest> => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: BenchmarkUploadFileSpec[] = [];
  for (const name of args.fileNames) {
    if (!(name in ALLOWED_FILES)) continue;
    const bytes = await fileBytes(`${root}${name}`);
    if (bytes == null || bytes <= 0) {
      // Still required if we expected it — missing on disk surfaces as incomplete.
      files.push({ relativePath: name, bytes: bytes ?? 0, required: true });
      continue;
    }
    const pageMatch = /^p(\d+)-/.exec(name);
    const frameMatch = /-f(\d+)\./.exec(name);
    files.push({
      relativePath: name,
      bytes,
      required: true,
      pageIndex: pageMatch ? Number(pageMatch[1]) : undefined,
      frameIndex: frameMatch ? Number(frameMatch[1]) : undefined,
    });
  }
  return {
    runId: args.runId,
    kind: 'binder-benchmark',
    pages: args.pages,
    files,
    createdAt: new Date().toISOString(),
  };
};

export const buildDeckUploadManifest = async (args: {
  runId: string;
  dirUri: string;
  fileNames: string[];
}): Promise<BenchmarkUploadManifest> => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: BenchmarkUploadFileSpec[] = [];
  for (const name of [...new Set(args.fileNames)]) {
    if (!(name in ALLOWED_FILES)) continue;
    const bytes = await fileBytes(`${root}${name}`);
    if (bytes == null || bytes <= 0) continue; // deck optional artifacts may be absent
    files.push({
      relativePath: name,
      bytes,
      required: name === 'summary.json' || name.endsWith('-metadata.json') || name.endsWith('-card.png'),
    });
  }
  // Always require summary if present in names.
  if (args.fileNames.includes('summary.json') && !files.some(f => f.relativePath === 'summary.json')) {
    files.push({ relativePath: 'summary.json', bytes: 0, required: true });
  }
  return {
    runId: args.runId,
    kind: 'deck-benchmark',
    files,
    createdAt: new Date().toISOString(),
  };
};

/** Geometry Test manifest. Downscaled sources are skipped (not thrown). */
export const buildGeometryUploadManifest = async (args: {
  runId: string;
  dirUri: string;
  fileNames: string[];
  items?: GeometryTestItemRecord[];
}): Promise<{
  manifest: BenchmarkUploadManifest;
  skippedReasons: string[];
}> => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const FileSystem = await fs();
  const itemByStem = new Map(
    (args.items ?? []).map(it => {
      const stem = `geom-${String(it.itemIndex).padStart(3, '0')}`;
      return [stem, it] as const;
    }),
  );
  const files: BenchmarkUploadFileSpec[] = [];
  const skippedReasons: string[] = [];
  for (const name of [...new Set(args.fileNames)]) {
    if (!(name in ALLOWED_FILES)) continue;
    if (name.includes('-thumbnail')) continue;
    const uri = `${root}${name}`;
    const bytes = await fileBytes(uri);
    if (bytes == null || bytes <= 0) {
      if (
        name === 'summary.json' ||
        name.endsWith('-metadata.json') ||
        name.endsWith('-card.png') ||
        name.endsWith('-source.png')
      ) {
        files.push({ relativePath: name, bytes: bytes ?? 0, required: true });
      }
      continue;
    }

    let role: BenchmarkUploadFileSpec['role'];
    let logicalWidth: number | null = null;
    let logicalHeight: number | null = null;
    let encodedWidth: number | null = null;
    let encodedHeight: number | null = null;

    if (name.endsWith('-card.png') || name.endsWith('-source.png')) {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const ihdr = pngIhdrDimensionsFromBase64(b64);
      if (!ihdr) {
        skippedReasons.push(`${name}: missing IHDR`);
        files.push({ relativePath: name, bytes: 0, required: true });
        continue;
      }
      encodedWidth = ihdr.width;
      encodedHeight = ihdr.height;
      const stem = name.replace(/-card\.png$/, '').replace(/-source\.png$/, '');
      const item = itemByStem.get(stem);
      if (name.endsWith('-card.png')) {
        role = 'card-warp';
        logicalWidth = item?.warpWidth ?? GEOMETRY_CARD_ARTIFACT_WIDTH;
        logicalHeight = item?.warpHeight ?? GEOMETRY_CARD_ARTIFACT_HEIGHT;
        const status = classifyGeometryArtifact({
          role: 'card-warp',
          logicalWidth,
          logicalHeight,
          encodedWidth,
          encodedHeight,
          bytes,
        });
        if (status !== 'ARTIFACT_OK') {
          skippedReasons.push(
            `${name}: ${status} (want ${GEOMETRY_CARD_ARTIFACT_WIDTH}×${GEOMETRY_CARD_ARTIFACT_HEIGHT}, got ${encodedWidth}×${encodedHeight})`,
          );
          files.push({
            relativePath: name,
            bytes: 0,
            required: true,
            role,
            logicalWidth,
            logicalHeight,
            encodedWidth,
            encodedHeight,
          });
          continue;
        }
        assertGeometryCardArtifactDims({ encodedWidth, encodedHeight, bytes });
      } else {
        role = 'source';
        logicalWidth = item?.sourceWidth ?? encodedWidth;
        logicalHeight = item?.sourceHeight ?? encodedHeight;
        const status = classifyGeometryArtifact({
          role: 'source',
          logicalWidth,
          logicalHeight,
          encodedWidth,
          encodedHeight,
          bytes,
        });
        if (status === 'ARTIFACT_DOWNSCALED' || status === 'ARTIFACT_DIMENSION_MISMATCH') {
          skippedReasons.push(
            `${name}: thumbnail trap — metadata ${logicalWidth}×${logicalHeight}, file ${encodedWidth}×${encodedHeight} (re-capture)`,
          );
          // Omit from upload list entirely — never POST thumbnail bytes as source.
          continue;
        }
      }
    } else if (name.endsWith('-metadata.json')) {
      role = 'metadata';
    } else if (name === 'summary.json') {
      role = 'summary';
    }

    files.push({
      relativePath: name,
      bytes,
      required:
        name === 'summary.json' ||
        name.endsWith('-metadata.json') ||
        name.endsWith('-card.png') ||
        name.endsWith('-source.png'),
      role,
      logicalWidth,
      logicalHeight,
      encodedWidth,
      encodedHeight,
    });
  }
  if (args.fileNames.includes('summary.json') && !files.some(f => f.relativePath === 'summary.json')) {
    files.push({ relativePath: 'summary.json', bytes: 0, required: true, role: 'summary' });
  }
  return {
    manifest: {
      runId: args.runId,
      kind: 'geometry-test',
      files,
      createdAt: new Date().toISOString(),
    },
    skippedReasons,
  };
};

const listServerFiles = async (runId: string): Promise<string[]> => {
  const { url } = getInboxSettings();
  if (!url) return [];
  try {
    const res = await fetchWithTimeout(
      `${url}/api/sessions/${encodeURIComponent(runId)}`,
      { headers: authHeaders(), method: 'GET' },
      20_000,
    );
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      files?: Array<{ name: string }>;
    } | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.files)) return [];
    return json.files.map(f => f.name).filter(Boolean);
  } catch {
    return [];
  }
};

const uploadSingleFile = async (args: {
  runId: string;
  kind: BenchmarkUploadKind;
  relativePath: string;
  uri: string;
  appStamp?: string | null;
  device?: string | null;
  runtimeFingerprint?: string | null;
}): Promise<{ ok: boolean; already?: boolean; reason?: string }> => {
  const { url } = getInboxSettings();
  if (!url) return { ok: false, reason: 'receiver not configured' };
  const name = args.relativePath;
  const mime = ALLOWED_FILES[name as keyof typeof ALLOWED_FILES];
  if (!mime) return { ok: false, reason: `not allowlisted: ${name}` };
  const FileSystem = await fs();
  const kind = name.endsWith('.png') || name.endsWith('.jpg') ? 'base64' : 'text';
  const payload =
    kind === 'text'
      ? { mime, text: await FileSystem.readAsStringAsync(args.uri) }
      : {
          mime,
          base64: await FileSystem.readAsStringAsync(args.uri, { encoding: 'base64' }),
        };
  const body = {
    appStamp: args.appStamp ?? null,
    createdAt: new Date().toISOString(),
    device: args.device ?? null,
    files: { [name]: payload },
    runtimeFingerprint: args.runtimeFingerprint ?? null,
    scannerPhase: args.kind,
    sessionId: sanitizeId(args.runId, args.runId.slice(0, 80)) ?? args.runId.slice(0, 80),
    traceId: traceIdForPath(name),
    traceType: args.kind,
  };
  const res = await fetchWithTimeout(
    `${url}/api/scans`,
    { body: JSON.stringify(body), headers: authHeaders(), method: 'POST' },
    UPLOAD_FETCH_MS,
  );
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    already?: boolean;
    reason?: string;
    receivedFiles?: string[];
  } | null;
  if (!res.ok || !json?.ok) {
    return { ok: false, reason: json?.reason ?? `HTTP ${res.status}` };
  }
  return { ok: true, already: Boolean(json.already) };
};

const mapPool = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
};

export type BenchmarkUploadResult = {
  queued: boolean;
  uploadStatus: 'COMPLETE' | 'INCOMPLETE' | 'PENDING';
  acknowledged: string[];
  missingRequired: string[];
  reason?: string;
  ack: BenchmarkUploadAckState;
};

/**
 * Upload required files with bounded concurrency. Waits for server ACK per file.
 * Retries only missing files. Survives tunnel URL changes (same runId).
 */
export const runBenchmarkUploadSession = async (args: {
  manifest: BenchmarkUploadManifest;
  dirUri: string;
  concurrency?: number;
  appStamp?: string | null;
  device?: string | null;
  runtimeFingerprint?: string | null;
  /** Called after each ACK update (for HUD progress). */
  onProgress?: (ack: BenchmarkUploadAckState) => void;
}): Promise<BenchmarkUploadResult> => {
  if (!isBenchmarkToolsEnabled()) {
    const ack = emptyAckState(args.manifest);
    return {
      queued: false,
      uploadStatus: 'INCOMPLETE',
      acknowledged: [],
      missingRequired: ack.missingRequired,
      reason: 'debug tools disabled',
      ack,
    };
  }
  await loadInboxSettings();
  if (!isInboxConfigured()) {
    const ack = emptyAckState(args.manifest);
    return {
      queued: false,
      uploadStatus: 'INCOMPLETE',
      acknowledged: [],
      missingRequired: ack.missingRequired,
      reason: 'receiver not configured',
      ack,
    };
  }

  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const { url } = getInboxSettings();
  const prior = await loadUploadAckState(args.manifest.runId);
  const serverListed = await listServerFiles(args.manifest.runId);
  const seedAck = new Set<string>([
    ...(prior?.acknowledged ?? []),
    ...serverListed,
  ]);

  let ack = reconcileUploadAck({
    manifest: args.manifest,
    acknowledged: seedAck,
    endpointUrl: url,
  });
  await persistUploadAckState(ack);
  args.onProgress?.(ack);

  // Include zero-byte / unknown-size missing files so we record "missing on device"
  // instead of silently skipping and exiting still-INCOMPLETE with no work done.
  const pending = filesToUpload(args.manifest, seedAck);
  const failReasons = new Set<string>();
  const failedPaths = new Set<string>();

  if (pending.length === 0 && ack.missingRequired.length > 0) {
    for (const name of ack.missingRequired) {
      failedPaths.add(name);
      failReasons.add(`missing on device: ${name}`);
    }
    ack = {
      ...ack,
      failed: [...failedPaths],
      failReasons: [...failReasons],
      updatedAt: new Date().toISOString(),
    };
    await persistUploadAckState(ack);
    args.onProgress?.(ack);
    return {
      queued: false,
      uploadStatus: 'INCOMPLETE',
      acknowledged: ack.acknowledged,
      missingRequired: ack.missingRequired,
      reason: [...failReasons][0] ?? 'missing required files on device',
      ack,
    };
  }

  // Fail fast if the paired receiver is unreachable (dead Quick Tunnel).
  if (pending.length > 0) {
    try {
      const health = await fetchWithTimeout(
        `${url.replace(/\/+$/, '')}/health`,
        { headers: authHeaders(), method: 'GET' },
        8_000,
      );
      if (!health.ok) {
        const reason = `receiver unreachable (HTTP ${health.status}) — re-pair Debug receiver / restart tunnel`;
        ack = {
          ...ack,
          failed: pending.map(f => f.relativePath),
          failReasons: [reason],
          updatedAt: new Date().toISOString(),
        };
        await persistUploadAckState(ack);
        args.onProgress?.(ack);
        return {
          queued: false,
          uploadStatus: 'INCOMPLETE',
          acknowledged: ack.acknowledged,
          missingRequired: ack.missingRequired,
          reason,
          ack,
        };
      }
    } catch (err) {
      const reason = `receiver unreachable — re-pair Debug receiver / restart tunnel (${
        err instanceof Error ? err.message : String(err)
      })`;
      ack = {
        ...ack,
        failed: pending.map(f => f.relativePath),
        failReasons: [reason],
        updatedAt: new Date().toISOString(),
      };
      await persistUploadAckState(ack);
      args.onProgress?.(ack);
      return {
        queued: false,
        uploadStatus: 'INCOMPLETE',
        acknowledged: ack.acknowledged,
        missingRequired: ack.missingRequired,
        reason,
        ack,
      };
    }
  }

  const concurrency = args.concurrency ?? DEFAULT_CONCURRENCY;

  await mapPool(pending, concurrency, async file => {
    const uri = `${root}${file.relativePath}`;
    const bytes = await fileBytes(uri);
    if (bytes == null || bytes <= 0) {
      failedPaths.add(file.relativePath);
      failReasons.add(`missing on device: ${file.relativePath}`);
      return;
    }
    try {
      const res = await uploadSingleFile({
        runId: args.manifest.runId,
        kind: args.manifest.kind,
        relativePath: file.relativePath,
        uri,
        appStamp: args.appStamp,
        device: args.device,
        runtimeFingerprint: args.runtimeFingerprint,
      });
      if (res.ok) {
        seedAck.add(file.relativePath);
        ack = reconcileUploadAck({
          manifest: args.manifest,
          acknowledged: seedAck,
          endpointUrl: url,
        });
        await persistUploadAckState(ack);
        args.onProgress?.(ack);
      } else {
        failedPaths.add(file.relativePath);
        failReasons.add(res.reason ?? `upload failed: ${file.relativePath}`);
        ack = {
          ...ack,
          failed: [...failedPaths],
          failReasons: [...failReasons],
          updatedAt: new Date().toISOString(),
        };
        await persistUploadAckState(ack);
      }
    } catch (err) {
      failedPaths.add(file.relativePath);
      failReasons.add(err instanceof Error ? err.message : String(err));
      ack = {
        ...ack,
        failed: [...failedPaths],
        failReasons: [...failReasons],
        updatedAt: new Date().toISOString(),
      };
      await persistUploadAckState(ack);
    }
  });

  // Final server verification (tunnel may have dropped ACKs).
  const verified = await listServerFiles(args.manifest.runId);
  for (const name of verified) seedAck.add(name);
  ack = {
    ...reconcileUploadAck({
      manifest: args.manifest,
      acknowledged: seedAck,
      endpointUrl: url,
    }),
    failed: [...failedPaths].filter(p => !seedAck.has(p)),
    failReasons: [...failReasons],
  };
  await persistUploadAckState(ack);
  args.onProgress?.(ack);

  return {
    queued: ack.uploadStatus === 'COMPLETE',
    uploadStatus: ack.uploadStatus,
    acknowledged: ack.acknowledged,
    missingRequired: ack.missingRequired,
    reason:
      ack.uploadStatus === 'COMPLETE'
        ? undefined
        : [...failReasons][0] ?? 'missing required files',
    ack,
  };
};
