/**
 * Explicit development capture of the last vNext decision.
 * Nothing is written unless the developer taps save, and only in dev builds.
 */

import { getVNextDebug } from '@/lib/scan/vnext/debug';

import { isBenchmarkToolsEnabled } from './benchmark/isBenchmarkEnabled';

export const saveVNextDebugCapture = async (): Promise<string | null> => {
  if (!isBenchmarkToolsEnabled()) return null;
  const snap = getVNextDebug();
  if (!snap) return null;
  const FileSystem = await import('expo-file-system/legacy');
  if (!FileSystem.cacheDirectory) return null;
  const dir = `${FileSystem.cacheDirectory}lugin-vnext-captures/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}vnext-${snap.at}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(snap));
  return uri;
};
