/**
 * Persist Binder diagnostic session to disk (background — not on hot path).
 */

import {
  BINDER_POLICY,
  binderDiagCardFile,
  binderDiagFrameFile,
  binderDiagPageMetaFile,
  binderDiagTracksFile,
  pageTimingsFromTracks,
  trackDiagFromLive,
  type BinderPageSession,
  type BinderSessionDiagBundle,
  type BinderSnapshotDiagMeta,
} from '@/lib/scan/binder';
import { CARD_HEIGHT, CARD_WIDTH, type ScanImage } from '../sharedCore';
import { bytesToBase64, pngIhdrDimensionsFromBase64, scanImageToPngBytes } from '../debug/scanImagePng';

type LegacyFS = typeof import('expo-file-system/legacy');
const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export type RetainedBinderSnapshot = {
  snapshotId: number;
  sourceFrameId: number;
  capturedAt: number;
  width: number;
  height: number;
  source: ScanImage;
  candidates: { score: number; corners: BinderPageSession['tracks'][0]['currentQuad'] }[];
};

export type ArchivedBinderPage = {
  session: BinderPageSession;
  snapshots: RetainedBinderSnapshot[];
  completedAt: number | null;
  status: 'IN_PROGRESS' | 'DONE' | 'INCOMPLETE';
};

const rootDir = async (): Promise<string> => {
  const FileSystem = await fs();
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
  return `${base}lugin-binder-diag/`;
};

export const binderDiagDirUri = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const dir = `${await rootDir()}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const writePng = async (uri: string, image: ScanImage, maxW: number): Promise<number> => {
  const FileSystem = await fs();
  const png = scanImageToPngBytes(image, maxW);
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return png.byteLength;
};

export const persistBinderDiagnosticSession = async (args: {
  fixtureId: string;
  createdAt: string;
  pages: ArchivedBinderPage[];
}): Promise<{ dirUri: string; bundle: BinderSessionDiagBundle; fileNames: string[] }> => {
  const FileSystem = await fs();
  const dirUri = await binderDiagDirUri(args.fixtureId);
  const root = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
  const fileNames: string[] = [];
  const pageMetas: BinderSessionDiagBundle['pages'] = [];

  for (const page of args.pages) {
    const pageIndex = page.session.pageIndex;
    const snapMetas: BinderSnapshotDiagMeta[] = [];
    let frameIndex = 0;
    for (const snap of page.snapshots) {
      frameIndex += 1;
      const file = binderDiagFrameFile(pageIndex, frameIndex);
      const bytes = await writePng(`${root}${file}`, snap.source, Math.min(snap.source.width, 1920));
      fileNames.push(file);
      snapMetas.push({
        snapshotId: snap.snapshotId,
        sourceFrameId: snap.sourceFrameId,
        pageIndex,
        capturedAt: snap.capturedAt,
        width: snap.width,
        height: snap.height,
        file,
        bytes,
        candidateCount: snap.candidates.length,
        candidates: snap.candidates,
      });
    }

    const tracksExport = [];
    let ordinal = 0;
    for (const track of page.session.tracks) {
      ordinal += 1;
      let artifactOk: boolean | null = null;
      let bestCardFile: string | null = null;
      if (track.best?.warp) {
        bestCardFile = binderDiagCardFile(pageIndex, ordinal);
        const bytes = await writePng(`${root}${bestCardFile}`, track.best.warp, CARD_WIDTH);
        fileNames.push(bestCardFile);
        const b64 = await FileSystem.readAsStringAsync(`${root}${bestCardFile}`, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const ihdr = pngIhdrDimensionsFromBase64(b64);
        artifactOk =
          ihdr != null &&
          ihdr.width === CARD_WIDTH &&
          ihdr.height === CARD_HEIGHT &&
          bytes > 0;
      }
      const meta = trackDiagFromLive(track, {
        trackOrdinal: ordinal,
        pageIndex,
        artifactOk,
      });
      meta.bestCardFile = bestCardFile;
      tracksExport.push(meta);
    }

    const active = page.session.tracks.filter(t => t.phase !== 'lost');
    const acquired = active.filter(t => t.acquired);
    const timings = pageTimingsFromTracks(page.session, page.snapshots, page.completedAt);
    const pageMeta = {
      pageIndex,
      pageSessionId: page.session.pageId,
      startedAt: page.session.startedAt,
      completedAt: page.completedAt,
      status: page.status,
      gridRows: page.session.gridRows,
      gridCols: page.session.gridCols,
      snapshotsRequested: page.snapshots.length,
      snapshotsCompleted: page.snapshots.length,
      trackCount: active.length,
      acquiredTrackCount: acquired.length,
      unresolvedTrackCount: active.length - acquired.length,
      ...timings,
      policy: BINDER_POLICY,
      snapshots: snapMetas,
      tracks: tracksExport,
    };
    pageMetas.push(pageMeta);

    const metaFile = binderDiagPageMetaFile(pageIndex);
    const tracksFile = binderDiagTracksFile(pageIndex);
    await FileSystem.writeAsStringAsync(`${root}${metaFile}`, JSON.stringify(pageMeta, null, 2));
    await FileSystem.writeAsStringAsync(
      `${root}${tracksFile}`,
      JSON.stringify({ pageIndex, tracks: tracksExport }, null, 2),
    );
    fileNames.push(metaFile, tracksFile);
  }

  const bundle: BinderSessionDiagBundle = {
    kind: 'binder',
    fixtureId: args.fixtureId,
    createdAt: args.createdAt,
    completedAt: new Date().toISOString(),
    pages: pageMetas,
    uploadStatus: 'PENDING',
  };
  await FileSystem.writeAsStringAsync(`${root}summary.json`, JSON.stringify(bundle, null, 2));
  fileNames.push('summary.json');

  return { dirUri, bundle, fileNames: [...new Set(fileNames)] };
};

const ACTIVE = 'active-run.json';

export const persistBinderDiagActiveMeta = async (fixtureId: string | null): Promise<void> => {
  const FileSystem = await fs();
  const uri = `${await rootDir()}${ACTIVE}`;
  if (!fixtureId) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }
  await FileSystem.writeAsStringAsync(uri, JSON.stringify({ fixtureId }, null, 2));
};

export const loadBinderDiagActiveMeta = async (): Promise<{ fixtureId: string } | null> => {
  try {
    const FileSystem = await fs();
    const uri = `${await rootDir()}${ACTIVE}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as { fixtureId: string };
  } catch {
    return null;
  }
};

export const listBinderDiagSessions = async (): Promise<
  {
    fixtureId: string;
    dirUri: string;
    uploadStatus?: BinderSessionDiagBundle['uploadStatus'];
    missingFiles?: string[];
  }[]
> => {
  const FileSystem = await fs();
  const root = await rootDir();
  const info = await FileSystem.getInfoAsync(root);
  if (!info.exists) return [];
  const names = await FileSystem.readDirectoryAsync(root);
  const out: {
    fixtureId: string;
    dirUri: string;
    uploadStatus?: BinderSessionDiagBundle['uploadStatus'];
    missingFiles?: string[];
  }[] = [];
  for (const name of names) {
    if (name === ACTIVE || name.startsWith('.')) continue;
    const dirUri = `${root}${name}/`;
    const dirInfo = await FileSystem.getInfoAsync(dirUri);
    if (!dirInfo.exists || !dirInfo.isDirectory) continue;
    try {
      const summaryUri = `${dirUri}summary.json`;
      const sInfo = await FileSystem.getInfoAsync(summaryUri);
      if (!sInfo.exists) continue;
      const bundle = JSON.parse(
        await FileSystem.readAsStringAsync(summaryUri),
      ) as BinderSessionDiagBundle;
      if (bundle.uploadStatus === 'COMPLETE') continue;
      out.push({
        fixtureId: bundle.fixtureId || name,
        dirUri,
        uploadStatus: bundle.uploadStatus,
        missingFiles: bundle.missingFiles ?? bundle.uploadManifest?.missingFiles,
      });
    } catch {
      /* skip */
    }
  }
  return out;
};
