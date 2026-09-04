// Dev-only gate for Scanner Benchmark Session tools.
// Never enable silent uploads or benchmark UI on production/preview channels.

import Constants from 'expo-constants';

/**
 * Benchmark tools: Metro (__DEV__) or EAS Updates channel "development" only.
 * Production / preview binaries must never expose this UI or upload queue.
 */
export const isBenchmarkToolsEnabled = (): boolean => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Updates = require('expo-updates') as { channel?: string | null };
    const ch = Updates.channel;
    if (ch === 'development') return true;
    if (ch === 'production' || ch === 'preview') return false;
  } catch {
    /* expo-updates may be unavailable in some test hosts */
  }

  // Do not trust hardcoded extra.lugin.channel (app.config currently stamps
  // "development" even for other profiles). Opt-in only via explicit flag.
  const extra = Constants.expoConfig?.extra as
    | { lugin?: { benchmarkTools?: boolean } }
    | undefined;
  return extra?.lugin?.benchmarkTools === true;
};
