import {
  buildGeometryUploadManifest,
  runBenchmarkUploadSession,
} from '../benchmarkUpload/session';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import type { GeometryTestBundle } from '@/lib/scan/geometryTest';
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

export const enqueueGeometryTest = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  bundle: GeometryTestBundle;
  runtimeFingerprint?: string | null;
}): Promise<{
  queued: boolean;
  reason?: string;
  uploadStatus: 'COMPLETE' | 'INCOMPLETE' | 'PENDING';
  message: string;
}> => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const allNames: string[] = ['summary.json'];
  for (const it of args.bundle.items) {
    for (const v of Object.values(it.files)) {
      if (typeof v === 'string' && v) allNames.push(v);
    }
  }
  const present: string[] = [];
  for (const name of [...new Set(allNames)]) {
    if (!(name in ALLOWED_FILES)) continue;
    const bytes = await fileBytes(`${root}${name}`);
    if (bytes != null && bytes > 0) present.push(name);
  }

  const artifactNames = present.filter(n => n !== 'summary.json');
  const skippedAll: string[] = [];
  try {
    const { manifest: artifactManifest, skippedReasons: skip1 } =
      await buildGeometryUploadManifest({
        runId: args.bundle.fixtureId,
        dirUri: root,
        fileNames: artifactNames,
        items: args.bundle.items,
      });
    skippedAll.push(...skip1);
    const art = await runBenchmarkUploadSession({
      manifest: artifactManifest,
      dirUri: root,
      appStamp: args.appStamp,
      device: args.device,
      runtimeFingerprint: args.runtimeFingerprint,
    });

    args.bundle.uploadStatus = art.ack.uploadStatus;
    args.bundle.uploadManifest = {
      expectedFiles: artifactManifest.files.map(f => f.relativePath).concat(['summary.json']),
      uploadedFiles: art.ack.acknowledged,
      missingFiles: art.ack.missingRequired,
      skippedEmpty: skippedAll,
    };
    args.bundle.missingFiles = art.ack.missingRequired;
    const FileSystem = await fs();
    await FileSystem.writeAsStringAsync(`${root}summary.json`, JSON.stringify(args.bundle, null, 2));

    const { manifest: summaryManifest, skippedReasons: skip2 } =
      await buildGeometryUploadManifest({
        runId: args.bundle.fixtureId,
        dirUri: root,
        fileNames: [...artifactNames, 'summary.json'],
        items: args.bundle.items,
      });
    skippedAll.push(...skip2.filter(s => !skippedAll.includes(s)));
    const final = await runBenchmarkUploadSession({
      manifest: summaryManifest,
      dirUri: root,
      appStamp: args.appStamp,
      device: args.device,
      runtimeFingerprint: args.runtimeFingerprint,
    });

    // Thumbnail-trap sources were omitted from the manifest (never uploaded).
    // Keep the session INCOMPLETE until the operator re-captures full-res sources.
    if (skippedAll.length) {
      const skippedNames = skippedAll
        .map(s => s.split(':')[0]?.trim())
        .filter((n): n is string => Boolean(n));
      final.ack = {
        ...final.ack,
        uploadStatus: 'INCOMPLETE',
        missingRequired: [...new Set([...final.ack.missingRequired, ...skippedNames])],
        failReasons: [...new Set([...(final.ack.failReasons ?? []), ...skippedAll.slice(0, 6)])],
      };
    }

    args.bundle.uploadStatus = final.ack.uploadStatus;
    args.bundle.uploadManifest = {
      expectedFiles: summaryManifest.files.map(f => f.relativePath),
      uploadedFiles: final.ack.acknowledged,
      missingFiles: final.ack.missingRequired,
      skippedEmpty: skippedAll,
    };
    args.bundle.missingFiles = final.ack.missingRequired;
    await FileSystem.writeAsStringAsync(`${root}summary.json`, JSON.stringify(args.bundle, null, 2));

    const n = args.bundle.items.length;
    const base =
      final.ack.uploadStatus === 'COMPLETE'
        ? formatUploadCompleteMessage(n, 'geometry-test')
        : formatUploadIncompleteMessage(final.ack);
    const tip = skippedAll.length
      ? `\n${skippedAll.slice(0, 2).join('\n')} — re-capture those cards`
      : '';
    return {
      queued: true,
      uploadStatus: final.ack.uploadStatus,
      message: `${base}${tip}`,
      reason: skippedAll[0],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    args.bundle.uploadStatus = 'INCOMPLETE';
    args.bundle.missingFiles = artifactNames;
    const FileSystem = await fs();
    await FileSystem.writeAsStringAsync(`${root}summary.json`, JSON.stringify(args.bundle, null, 2));
    return {
      queued: false,
      reason,
      uploadStatus: 'INCOMPLETE',
      message: `UPLOAD BLOCKED · ${reason}`,
    };
  }
};
