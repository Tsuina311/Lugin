// Binder Benchmark local persistence.

import type { BinderBenchmarkBundle, BinderPageRecord } from '@/lib/scan/binderBenchmark';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';

type LegacyFS = typeof import('expo-file-system/legacy');

const ROOT = 'lugin-binder-benchmark/';
const ACTIVE = 'active-run.json';

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export const binderBenchmarkRoot = async (): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('documentDirectory unavailable');
  const dir = `${root}${ROOT}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

export const binderRunDir = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const dir = `${await binderBenchmarkRoot()}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const writeJson = async (uri: string, value: unknown) => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(value, null, 2));
};

export const persistBinderActiveMeta = async (fixtureId: string | null) => {
  if (!isBenchmarkToolsEnabled()) return;
  const FileSystem = await fs();
  const uri = `${await binderBenchmarkRoot()}${ACTIVE}`;
  if (!fixtureId) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }
  await writeJson(uri, { fixtureId });
};

export const loadBinderActiveMeta = async (): Promise<{ fixtureId: string } | null> => {
  if (!isBenchmarkToolsEnabled()) return null;
  try {
    const FileSystem = await fs();
    const uri = `${await binderBenchmarkRoot()}${ACTIVE}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as { fixtureId: string };
  } catch {
    return null;
  }
};

export const saveBinderBundle = async (bundle: BinderBenchmarkBundle): Promise<string> => {
  const dir = await binderRunDir(bundle.fixtureId);
  await writeJson(`${dir}summary.json`, bundle);
  return dir;
};

export const loadBinderBundle = async (fixtureId: string): Promise<BinderBenchmarkBundle | null> => {
  try {
    const FileSystem = await fs();
    const uri = `${await binderRunDir(fixtureId)}summary.json`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as BinderBenchmarkBundle;
  } catch {
    return null;
  }
};

export const saveBinderPage = async (
  fixtureId: string,
  page: BinderPageRecord,
): Promise<void> => {
  const dir = await binderRunDir(fixtureId);
  const { binderPageMetaFile } = await import('@/lib/scan/binderBenchmark');
  await writeJson(`${dir}${binderPageMetaFile(page.pageIndex)}`, page);
};

/** Write a ScanImage PNG into the run directory as an allowlisted name. */
export const writeBinderFramePng = async (
  fixtureId: string,
  destName: string,
  image: import('@/lib/scan/types').ScanImage,
): Promise<string> => {
  const FileSystem = await fs();
  const { bytesToBase64, scanImageToPngBytes } = await import('../debug/scanImagePng');
  const dir = await binderRunDir(fixtureId);
  const png = scanImageToPngBytes(image, image.width);
  await FileSystem.writeAsStringAsync(`${dir}${destName}`, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return destName;
};

/** @deprecated snapshot is a nitro Image — use writeBinderFramePng */
export const copyBinderFrameJpeg = async (
  fixtureId: string,
  destName: string,
  sourcePath: string,
): Promise<string> => {
  const FileSystem = await fs();
  const dir = await binderRunDir(fixtureId);
  const from = sourcePath.startsWith('file://') ? sourcePath : `file://${sourcePath}`;
  await FileSystem.copyAsync({ from, to: `${dir}${destName}` });
  return destName;
};

export const deleteBinderRunLocal = async (fixtureId: string): Promise<void> => {
  const FileSystem = await fs();
  await FileSystem.deleteAsync(await binderRunDir(fixtureId), { idempotent: true });
  const meta = await loadBinderActiveMeta();
  if (meta?.fixtureId === fixtureId) await persistBinderActiveMeta(null);
};

export const listBinderRuns = async (): Promise<
  Array<{ fixtureId: string; pages: number; target: number; phase: string }>
> => {
  if (!isBenchmarkToolsEnabled()) return [];
  const FileSystem = await fs();
  const root = await binderBenchmarkRoot();
  const entries = await FileSystem.readDirectoryAsync(root);
  const out: Array<{ fixtureId: string; pages: number; target: number; phase: string }> = [];
  for (const name of entries) {
    if (name === ACTIVE) continue;
    const bundle = await loadBinderBundle(name);
    if (!bundle) continue;
    out.push({
      fixtureId: bundle.fixtureId,
      pages: bundle.pages.length,
      target: bundle.targetPages,
      phase: bundle.phase,
    });
  }
  return out.sort((a, b) => b.fixtureId.localeCompare(a.fixtureId));
};
