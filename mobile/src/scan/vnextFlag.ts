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

let hydrated: Promise<boolean> | null = null;

export const hydrateScannerVNextFlag = (): Promise<boolean> => {
  if (!hydrated) hydrated = readScannerVNextFlag();
  return hydrated;
};

const readScannerVNextFlag = async (): Promise<boolean> => {
  if (!isBenchmarkToolsEnabled()) {
    setScannerVNextEnabled(false);
    return false;
  }
  try {
    const uri = await fileUri();
    if (!uri) return isScannerVNextEnabled();
    const FileSystem = await import('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      setScannerVNextEnabled(false);
      return false;
    }
    const text = await FileSystem.readAsStringAsync(uri);
    const on = text.trim() === '1';
    setScannerVNextEnabled(on);
    return on;
  } catch {
    setScannerVNextEnabled(false);
    return false;
  }
};

export const setScannerVNextFromDeveloper = async (on: boolean): Promise<void> => {
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
