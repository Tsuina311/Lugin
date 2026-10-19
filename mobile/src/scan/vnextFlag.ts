/**
 * Developer toggle for Scanner vNext. Default OFF, including after a reload,
 * unless a previous development session wrote the cache flag.
 * Production builds never read or write it.
 */

import { isScannerVNextEnabled, setScannerVNextEnabled } from '@/lib/scan/vnext/flag';

import { isBenchmarkToolsEnabled } from './benchmark/isBenchmarkEnabled';

const FILE = 'lugin-scanner-vnext.txt';

const fileUri = async (): Promise<string | null> => {
  if (!isBenchmarkToolsEnabled()) return null;
  const FileSystem = await import('expo-file-system/legacy');
  if (!FileSystem.cacheDirectory) return null;
  return `${FileSystem.cacheDirectory}${FILE}`;
};

let hydrated: Promise<void> | null = null;
/** Bumped by the Settings toggle so an in-flight file read cannot turn vNext back off. */
let revision = 0;

export const hydrateScannerVNextFlag = (): Promise<boolean> => {
  if (!hydrated) hydrated = readScannerVNextFlag();
  return hydrated.then(() => isScannerVNextEnabled());
};

const readScannerVNextFlag = async (): Promise<void> => {
  const seen = revision;
  if (!isBenchmarkToolsEnabled()) {
    if (seen === revision) setScannerVNextEnabled(false);
    return;
  }
  try {
    const uri = await fileUri();
    if (!uri || seen !== revision) return;
    const FileSystem = await import('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(uri);
    if (seen !== revision) return;
    if (!info.exists) {
      setScannerVNextEnabled(false);
      return;
    }
    const text = await FileSystem.readAsStringAsync(uri);
    if (seen !== revision) return;
    setScannerVNextEnabled(text.trim() === '1');
  } catch {
    if (seen === revision) setScannerVNextEnabled(false);
  }
};

export const setScannerVNextFromDeveloper = async (on: boolean): Promise<void> => {
  revision += 1;
  if (!isBenchmarkToolsEnabled()) {
    setScannerVNextEnabled(false);
    return;
  }
  setScannerVNextEnabled(on);
  const uri = await fileUri();
  if (!uri) return;
  const FileSystem = await import('expo-file-system/legacy');
  await FileSystem.writeAsStringAsync(uri, on ? '1' : '0');
};

export { isScannerVNextEnabled };
