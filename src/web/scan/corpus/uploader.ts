// Drain the IndexedDB corpus queue into the user's Google Drive.
//
// No Cloudflare endpoint. Uploads use the existing Google OAuth TokenProvider.
// Scanner never depends on Drive being available — failures stay queued.

import { bumpContributed } from './consent';
import {
  listPendingCorpus,
  markUploadFailed,
  removeCorpusSample,
  type QueuedCorpusSample,
} from './queue';

import { AuthError } from '@/core/sync/auth';
import { DriveError } from '@/core/sync/drive';
import { createDriveCorpusRepository, type DriveCorpusRepository } from '@/core/sync/driveCorpus';
import { validateMetaStrict } from '@/lib/scan/corpus/validate';
import { webGoogleAuth } from '@/platform/web/googleAuth';

const googleConfigured = (): boolean =>
  Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

export const corpusUploadConfigured = (): boolean => googleConfigured();

export const corpusDriveConnected = (): boolean =>
  googleConfigured() && webGoogleAuth.isConnected();

let repo: DriveCorpusRepository | null = null;
const getRepo = (): DriveCorpusRepository => {
  repo ??= createDriveCorpusRepository({ token: webGoogleAuth });
  return repo;
};

let paused = false;
let pumping = false;
/** Global backoff until (ms) after rate limits / transient failures. */
let backoffUntil = 0;

export const setCorpusUploadPaused = (value: boolean): void => {
  paused = value;
};

export const isCorpusUploadPaused = (): boolean => paused;

/** Open Lugin/Scanner Corpus in Drive when a webViewLink is available. */
export const openCorpusDriveFolder = async (): Promise<boolean> => {
  if (!corpusDriveConnected()) return false;
  try {
    const link = await getRepo().ensureCorpusRootLink();
    if (!link) return false;
    window.open(link, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
};

const uploadOne = async (
  row: QueuedCorpusSample,
): Promise<'ok' | 'retry' | 'drop'> => {
  const invalid = validateMetaStrict(row.meta);
  if (invalid) {
    await removeCorpusSample(row.id);
    return 'drop';
  }

  try {
    await getRepo().uploadSample({
      contributorId: row.meta.contributorId,
      createdAt: row.meta.createdAt,
      image: row.image,
      meta: row.meta,
      mimeType: row.mimeType,
      sampleId: row.meta.sampleId,
    });
    await removeCorpusSample(row.id);
    bumpContributed();
    return 'ok';
  } catch (err) {
    if (err instanceof AuthError) {
      // Needs user gesture to reconnect — do not hot-loop.
      backoffUntil = Date.now() + 60_000;
      await markUploadFailed(row.id);
      return 'retry';
    }
    if (err instanceof DriveError) {
      if (err.status === 429) {
        const fail = Math.min(6, (row.uploadsFailed || 0) + 1);
        backoffUntil = Date.now() + Math.min(120_000, 15_000 * fail * fail);
        await markUploadFailed(row.id);
        return 'retry';
      }
      if (err.status === 403 || err.status === 401) {
        backoffUntil = Date.now() + 60_000;
        await markUploadFailed(row.id);
        return 'retry';
      }
      if (err.status === 400) {
        await removeCorpusSample(row.id);
        return 'drop';
      }
      if (err.status >= 500 || err.status === 0) {
        backoffUntil = Date.now() + 20_000;
        await markUploadFailed(row.id);
        return 'retry';
      }
    }
    backoffUntil = Date.now() + 15_000;
    await markUploadFailed(row.id);
    return 'retry';
  }
};

/** Drain the queue best-effort. Never throws into the scanner. */
export const pumpCorpusUploads = async (): Promise<void> => {
  if (paused || pumping || !googleConfigured()) return;
  if (!webGoogleAuth.isConnected()) return;
  if (Date.now() < backoffUntil) return;
  pumping = true;
  try {
    const rows = await listPendingCorpus();
    rows.sort((a, b) => {
      const rank = { high: 0, low: 2, medium: 1 };
      return rank[a.priority] - rank[b.priority] || a.uploadsFailed - b.uploadsFailed;
    });
    // Conservative: one sample per pump tick to avoid Drive API bursts.
    for (const row of rows.slice(0, 1)) {
      if (paused || Date.now() < backoffUntil) break;
      if (row.uploadsFailed >= 12) {
        await removeCorpusSample(row.id);
        continue;
      }
      const result = await uploadOne(row);
      if (result === 'retry') break;
    }
  } finally {
    pumping = false;
  }
};
