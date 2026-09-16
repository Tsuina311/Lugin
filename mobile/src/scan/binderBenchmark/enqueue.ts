import {
  buildBinderUploadManifest,
  runBenchmarkUploadSession,
  type BenchmarkUploadResult,
} from '../benchmarkUpload/session';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import type { BinderBenchmarkBundle } from '@/lib/scan/binderBenchmark';
import {
  formatUploadCompleteMessage,
  formatUploadIncompleteMessage,
} from '@/lib/scan/benchmarkUpload';

type LegacyFS = typeof import('expo-file-system/legacy');
const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export type BinderUploadOutcome = BenchmarkUploadResult & {
  message: string;
};

const collectBinderNames = (bundle: BinderBenchmarkBundle): string[] => {
  const allNames = new Set<string>(['summary.json']);
  for (const page of bundle.pages) {
    allNames.add(`p${String(page.pageIndex).padStart(2, '0')}-metadata.json`);
    for (const fr of page.frames) allNames.add(fr.file);
  }
  return [...allNames].filter(n => n in ALLOWED_FILES);
};

const writeSummary = async (dirUri: string, bundle: BinderBenchmarkBundle) => {
  const FileSystem = await fs();
  const root = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
  await FileSystem.writeAsStringAsync(`${root}summary.json`, JSON.stringify(bundle, null, 2));
};

/** Upload binder frames with server ACK; never claims COMPLETE on local queue alone. */
export const enqueueBinderBenchmark = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  bundle: BinderBenchmarkBundle;
  runtimeFingerprint?: string | null;
  onProgress?: (acked: number, total: number) => void;
}): Promise<BinderUploadOutcome> => {
  const names = collectBinderNames(args.bundle);
  // 1) Upload artifacts excluding summary first so summary never claims COMPLETE early.
  const artifactNames = names.filter(n => n !== 'summary.json');
  const artifactManifest = await buildBinderUploadManifest({
    runId: args.bundle.fixtureId,
    dirUri: args.dirUri,
    pages: args.bundle.pages.length,
    fileNames: artifactNames,
  });

  const artifacts = await runBenchmarkUploadSession({
    manifest: artifactManifest,
    dirUri: args.dirUri,
    concurrency: 2,
    appStamp: args.appStamp,
    device: args.device,
    runtimeFingerprint: args.runtimeFingerprint,
    onProgress: ack => {
      args.onProgress?.(
        ack.acknowledged.length,
        ack.acknowledged.length + ack.missingRequired.length,
      );
    },
  });

  args.bundle.uploadStatus = artifacts.uploadStatus;
  args.bundle.missingFiles = artifacts.missingRequired;
  args.bundle.uploadManifest = {
    expectedFiles: artifactNames,
    uploadedFiles: artifacts.acknowledged,
    missingFiles: artifacts.missingRequired,
  };
  await writeSummary(args.dirUri, args.bundle);

  // 2) Upload summary last (reflects COMPLETE or INCOMPLETE).
  const summaryManifest = await buildBinderUploadManifest({
    runId: args.bundle.fixtureId,
    dirUri: args.dirUri,
    pages: args.bundle.pages.length,
    fileNames: ['summary.json'],
  });
  await runBenchmarkUploadSession({
    manifest: summaryManifest,
    dirUri: args.dirUri,
    concurrency: 1,
    appStamp: args.appStamp,
    device: args.device,
    runtimeFingerprint: args.runtimeFingerprint,
  });

  const message =
    artifacts.uploadStatus === 'COMPLETE'
      ? formatUploadCompleteMessage(args.bundle.pages.length, 'binder-benchmark')
      : formatUploadIncompleteMessage(artifacts.ack);

  return { ...artifacts, message };
};

/** Retry only missing required files for an existing binder run. */
export const retryBinderBenchmarkUpload = async (args: {
  dirUri: string;
  bundle: BinderBenchmarkBundle;
  onProgress?: (acked: number, total: number) => void;
}): Promise<BinderUploadOutcome> => enqueueBinderBenchmark(args);
