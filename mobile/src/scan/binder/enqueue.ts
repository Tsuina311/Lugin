/**
 * Binder diagnostic upload — ACK/retry via BenchmarkUploadSession.
 * Never fire-and-forget for Binder product diagnostics.
 */

import {
  formatUploadCompleteMessage,
  formatUploadIncompleteMessage,
  type BenchmarkUploadManifest,
} from '@/lib/scan/benchmarkUpload';
import type { BinderSessionDiagBundle } from '@/lib/scan/binder';
import { CARD_HEIGHT, CARD_WIDTH } from '../sharedCore';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import {
  buildBinderUploadManifest,
  runBenchmarkUploadSession,
  type BenchmarkUploadResult,
} from '../benchmarkUpload/session';
import { pngIhdrDimensionsFromBase64 } from '../debug/scanImagePng';
import { persistBinderDiagnosticSession, persistBinderDiagActiveMeta, type ArchivedBinderPage } from './persist';

type LegacyFS = typeof import('expo-file-system/legacy');
const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export type BinderDiagUploadOutcome = BenchmarkUploadResult & {
  message: string;
  bundle: BinderSessionDiagBundle;
  dirUri: string;
};

const writeSummary = async (dirUri: string, bundle: BinderSessionDiagBundle) => {
  const FileSystem = await fs();
  const root = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
  await FileSystem.writeAsStringAsync(`${root}summary.json`, JSON.stringify(bundle, null, 2));
};

/** Build manifest with card-warp dimension checks for *-tNN-card.png. */
export const buildBinderDiagUploadManifest = async (args: {
  runId: string;
  dirUri: string;
  pages: number;
  fileNames: string[];
}): Promise<BenchmarkUploadManifest> => {
  const base = await buildBinderUploadManifest(args);
  const FileSystem = await fs();
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files = [];
  for (const f of base.files) {
    if (/-t\d+-card\.png$/.test(f.relativePath)) {
      try {
        const b64 = await FileSystem.readAsStringAsync(`${root}${f.relativePath}`, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const ihdr = pngIhdrDimensionsFromBase64(b64);
        files.push({
          ...f,
          role: 'card-warp' as const,
          logicalWidth: CARD_WIDTH,
          logicalHeight: CARD_HEIGHT,
          encodedWidth: ihdr?.width ?? null,
          encodedHeight: ihdr?.height ?? null,
          required: true,
        });
      } catch {
        files.push({ ...f, role: 'card-warp' as const, required: true });
      }
    } else {
      files.push(f);
    }
  }
  return {
    ...base,
    kind: 'binder',
    files,
  };
};

export const enqueueBinderDiagnostics = async (args: {
  fixtureId: string;
  createdAt: string;
  pages: ArchivedBinderPage[];
  appStamp?: string | null;
  device?: string | null;
  runtimeFingerprint?: string | null;
  onProgress?: (acked: number, total: number) => void;
}): Promise<BinderDiagUploadOutcome> => {
  const persisted = await persistBinderDiagnosticSession({
    fixtureId: args.fixtureId,
    createdAt: args.createdAt,
    pages: args.pages,
  });
  const names = persisted.fileNames.filter(n => n in ALLOWED_FILES);
  const artifactNames = names.filter(n => n !== 'summary.json');

  const artifactManifest = await buildBinderDiagUploadManifest({
    runId: args.fixtureId,
    dirUri: persisted.dirUri,
    pages: args.pages.length,
    fileNames: artifactNames,
  });

  const artifacts = await runBenchmarkUploadSession({
    manifest: artifactManifest,
    dirUri: persisted.dirUri,
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

  const bundle = persisted.bundle;
  bundle.uploadStatus = artifacts.uploadStatus;
  bundle.missingFiles = artifacts.missingRequired;
  bundle.uploadManifest = {
    expectedFiles: artifactNames,
    uploadedFiles: artifacts.acknowledged,
    missingFiles: artifacts.missingRequired,
  };
  await writeSummary(persisted.dirUri, bundle);

  await runBenchmarkUploadSession({
    manifest: await buildBinderDiagUploadManifest({
      runId: args.fixtureId,
      dirUri: persisted.dirUri,
      pages: args.pages.length,
      fileNames: ['summary.json'],
    }),
    dirUri: persisted.dirUri,
    concurrency: 1,
    appStamp: args.appStamp,
    device: args.device,
    runtimeFingerprint: args.runtimeFingerprint,
  });

  const message =
    artifacts.uploadStatus === 'COMPLETE'
      ? formatUploadCompleteMessage(args.pages.length, 'binder')
      : formatUploadIncompleteMessage(artifacts.ack);

  await persistBinderDiagActiveMeta(
    artifacts.uploadStatus === 'COMPLETE' ? null : args.fixtureId,
  );

  return { ...artifacts, message, bundle, dirUri: persisted.dirUri };
};

export const retryBinderDiagnosticsUpload = async (args: {
  dirUri: string;
  bundle: BinderSessionDiagBundle;
  onProgress?: (acked: number, total: number) => void;
}): Promise<BinderDiagUploadOutcome> => {
  const FileSystem = await fs();
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const names = new Set<string>(['summary.json']);
  for (const page of args.bundle.pages) {
    names.add(`p${String(page.pageIndex + 1).padStart(2, '0')}-metadata.json`);
    names.add(`p${String(page.pageIndex + 1).padStart(2, '0')}-tracks.json`);
    for (const snap of page.snapshots) names.add(snap.file);
    for (const tr of page.tracks) {
      if (tr.bestCardFile) names.add(tr.bestCardFile);
    }
  }
  const fileNames = [...names].filter(n => n in ALLOWED_FILES);
  // Re-read summary if present for freshest missing list.
  try {
    const raw = await FileSystem.readAsStringAsync(`${root}summary.json`);
    const parsed = JSON.parse(raw) as BinderSessionDiagBundle;
    args.bundle = { ...args.bundle, ...parsed, fixtureId: args.bundle.fixtureId };
  } catch {
    /* use provided bundle */
  }

  const artifactNames = fileNames.filter(n => n !== 'summary.json');
  const artifacts = await runBenchmarkUploadSession({
    manifest: await buildBinderDiagUploadManifest({
      runId: args.bundle.fixtureId,
      dirUri: args.dirUri,
      pages: args.bundle.pages.length,
      fileNames: artifactNames,
    }),
    dirUri: args.dirUri,
    concurrency: 2,
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
  await runBenchmarkUploadSession({
    manifest: await buildBinderDiagUploadManifest({
      runId: args.bundle.fixtureId,
      dirUri: args.dirUri,
      pages: args.bundle.pages.length,
      fileNames: ['summary.json'],
    }),
    dirUri: args.dirUri,
    concurrency: 1,
  });

  const message =
    artifacts.uploadStatus === 'COMPLETE'
      ? formatUploadCompleteMessage(args.bundle.pages.length, 'binder')
      : formatUploadIncompleteMessage(artifacts.ack);

  await persistBinderDiagActiveMeta(
    artifacts.uploadStatus === 'COMPLETE' ? null : args.bundle.fixtureId,
  );

  return { ...artifacts, message, bundle: args.bundle, dirUri: args.dirUri };
};
