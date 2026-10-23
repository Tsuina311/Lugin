import { getInboxSettings, isInboxConfigured, loadInboxSettings } from './debugInbox/settings';
import { manifestHasFrozenVNextIdentity } from '@/lib/scan/vnext/frozenIdentity';

const DIR = 'lugin-visual-vnext';

export type GalleryProgress = {
  doneBytes: number;
  totalBytes: number;
  label: string;
};

const fs = async () => import('expo-file-system/legacy');

const dirUri = async (): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('The phone has no place to store the card list.');
  const dir = `${root}${DIR}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

export const vnextGalleryInstalled = async (): Promise<boolean> => {
  try {
    const FileSystem = await fs();
    const dir = await dirUri();
    const info = await FileSystem.getInfoAsync(`${dir}manifest.json`);
    if (!info.exists) return false;
    const manifest = JSON.parse(
      await FileSystem.readAsStringAsync(`${dir}manifest.json`),
    ) as Record<string, unknown>;
    if (!manifestHasFrozenVNextIdentity(manifest)) return false;
    for (const key of ['clean', 'prototype', 'refs', 'adapterW', 'adapterB']) {
      const name = manifest[key];
      if (typeof name !== 'string') return false;
      const file = await FileSystem.getInfoAsync(`${dir}${name}`);
      if (!file.exists || !file.size) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const mb = (bytes: number): string => `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;

/** Download the frozen card list from the paired computer. One picture-list, not a new model. */
export const downloadVNextGallery = async (
  onProgress: (progress: GalleryProgress) => void,
): Promise<string> => {
  await loadInboxSettings();
  if (!isInboxConfigured()) {
    return 'Pair this phone to the computer in Settings, then try the download again.';
  }
  const { token, url } = getInboxSettings();
  const base = url.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const listed = await fetch(`${base}/vnext-gallery`, { headers });
  if (!listed.ok) {
    return listed.status === 401
      ? 'The computer refused the download. Pair this phone again in Settings.'
      : `The computer did not offer the card list (${listed.status}).`;
  }
  const body = (await listed.json()) as { files?: { name: string; bytes: number }[] };
  const files = body.files ?? [];
  if (files.length === 0) return 'The computer has no card list to send.';
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const FileSystem = await fs();
  const dir = await dirUri();
  let doneBytes = 0;
  for (const file of files) {
    const dest = `${dir}${file.name}`;
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists && existing.size === file.bytes) {
      doneBytes += file.bytes;
      onProgress({ doneBytes, totalBytes, label: `${mb(doneBytes)} of ${mb(totalBytes)}` });
      continue;
    }
    const task = FileSystem.createDownloadResumable(
      `${base}/vnext-gallery/${encodeURIComponent(file.name)}`,
      dest,
      { headers },
      progress => {
        const written = progress.totalBytesWritten;
        onProgress({
          doneBytes: doneBytes + written,
          totalBytes,
          label: `${mb(doneBytes + written)} of ${mb(totalBytes)}`,
        });
      },
    );
    const result = await task.downloadAsync();
    if (!result || result.status !== 200) {
      return `The download of ${file.name} stopped. Tap again to continue.`;
    }
    const saved = await FileSystem.getInfoAsync(dest);
    if (!saved.exists || saved.size !== file.bytes) {
      return `The download of ${file.name} is incomplete. Tap again to continue.`;
    }
    doneBytes += file.bytes;
    onProgress({ doneBytes, totalBytes, label: `${mb(doneBytes)} of ${mb(totalBytes)}` });
  }
  return 'Card list is on the phone. Capture one card that fills the frame.';
};
