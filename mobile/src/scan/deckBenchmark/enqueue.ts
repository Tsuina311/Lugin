import {
  buildDeckUploadManifest,
  runBenchmarkUploadSession,
} from '../benchmarkUpload/session';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import type { DeckBenchmarkBundle } from '@/lib/scan/deckBenchmark';
import {
  formatUploadCompleteMessage,
  formatUploadIncompleteMessage,
} from '@/lib/scan/benchmarkUpload';

type LegacyFS = typeof import('expo-file-system/legacy');

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

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

export type DeckUploadManifest = {
  expectedFiles: string[];
  uploadedFiles: string[];
  missingFiles: string[];
  skippedEmpty: string[];
};

/** Resolve which allowlisted artifact names exist on disk with non-zero bytes. */
export const resolveDeckUploadFiles = async (
  dirUri: string,
  names: string[],
): Promise<DeckUploadManifest> => {
  const root = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
  const expected = [...new Set(names.filter(n => typeof n === 'string' && n.length > 0))];
  const uploaded: string[] = [];
  const missing: string[] = [];
  const skippedEmpty: string[] = [];
  for (const name of expected) {
    if (!(name in ALLOWED_FILES)) {
      missing.push(name);
      continue;
    }
    const bytes = await fileBytes(`${root}${name}`);
    if (bytes == null) missing.push(name);
    else if (bytes <= 0) skippedEmpty.push(name);
    else uploaded.push(name);
  }
  return { expectedFiles: expected, uploadedFiles: uploaded, missingFiles: missing, skippedEmpty };
};

/** Upload summary + card artifacts with server ACK (shared BenchmarkUploadSession). */
export const enqueueDeckBenchmark = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  bundle: DeckBenchmarkBundle;
  runtimeFingerprint?: string | null;
}): Promise<{
  queued: boolean;
  reason?: string;
  manifest: DeckUploadManifest;
  uploadStatus: 'COMPLETE' | 'INCOMPLETE' | 'PENDING';
  message: string;
}> => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const allNames: string[] = ['summary.json'];
  for (const c of args.bundle.cards) {
    for (const v of Object.values(c.files)) {
      if (typeof v === 'string' && v) allNames.push(v);
    }
  }
  const disk = await resolveDeckUploadFiles(root, allNames);

  for (const c of args.bundle.cards) {
    const missing: string[] = [];
    const nextFiles: typeof c.files = { metadata: c.files.metadata };
    for (const [key, name] of Object.entries(c.files) as Array<[keyof typeof c.files, string]>) {
      if (!name) continue;
      if (disk.uploadedFiles.includes(name)) {
        (nextFiles as Record<string, string>)[key] = name;
      } else if (key !== 'metadata') {
        missing.push(name);
      } else {
        nextFiles.metadata = name;
      }
    }
    c.files = nextFiles;
    c.missingFiles = missing.length ? missing : undefined;
  }

  // Artifacts first (exclude summary), then finalize summary with uploadStatus.
  const artifactNames = disk.uploadedFiles.filter(n => n !== 'summary.json');
  const artifactManifest = await buildDeckUploadManifest({
    runId: args.bundle.fixtureId,
    dirUri: root,
    fileNames: artifactNames,
  });
  const artifacts = await runBenchmarkUploadSession({
    manifest: artifactManifest,
    dirUri: root,
    concurrency: 2,
    appStamp: args.appStamp,
    device: args.device,
    runtimeFingerprint: args.runtimeFingerprint,
  });

  const uploadManifest = {
    expectedFiles: disk.expectedFiles,
    uploadedFiles: artifacts.acknowledged,
    missingFiles: [
      ...disk.missingFiles,
      ...artifacts.missingRequired,
      ...disk.skippedEmpty,
    ],
    skippedEmpty: disk.skippedEmpty,
  };
  args.bundle.uploadManifest = uploadManifest;
  args.bundle.uploadStatus = artifacts.uploadStatus;
  args.bundle.missingFiles = uploadManifest.missingFiles;

  try {
    const FileSystem = await fs();
    await FileSystem.writeAsStringAsync(
      `${root}summary.json`,
      JSON.stringify(
        {
          ...args.bundle,
          uploadStatus: artifacts.uploadStatus,
          uploadManifest,
        },
        null,
        2,
      ),
    );
  } catch {
    /* best effort */
  }

  const summaryManifest = await buildDeckUploadManifest({
    runId: args.bundle.fixtureId,
    dirUri: root,
    fileNames: ['summary.json'],
  });
  await runBenchmarkUploadSession({
    manifest: summaryManifest,
    dirUri: root,
    concurrency: 1,
    appStamp: args.appStamp,
    device: args.device,
    runtimeFingerprint: args.runtimeFingerprint,
  });

  const message =
    artifacts.uploadStatus === 'COMPLETE'
      ? formatUploadCompleteMessage(args.bundle.cards.length, 'deck-benchmark')
      : formatUploadIncompleteMessage(artifacts.ack);

  return {
    queued: artifacts.uploadStatus === 'COMPLETE',
    reason: artifacts.reason,
    manifest: uploadManifest,
    uploadStatus: artifacts.uploadStatus,
    message,
  };
};
