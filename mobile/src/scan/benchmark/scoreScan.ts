import { collectorNumbersEqual } from './expectedManifest';
import type {
  BenchmarkFlag,
  BenchmarkLatency,
  BenchmarkOcrChannelTiming,
  BenchmarkScore,
  ExpectedCard,
} from './types';
import {
  SLOW_ORACLE_1S_MS,
  SLOW_ORACLE_2S_MS,
  SLOW_ORACLE_FAIL_MS,
  SLOW_ORACLE_MS,
  SLOW_PRINTING_MS,
} from './types';

export interface ScoreableResult {
  artConflict?: boolean;
  earlyReason?: string | null;
  finish?: string | null;
  name?: string | null;
  printing?: {
    collectorNumber?: string | null;
    setCode?: string | null;
  } | null;
  status?: string | null;
  titleFooterConflict?: boolean;
  userLatency?: {
    lockToFinalOracleMs?: number | null;
    lockToFirstOracleMs?: number | null;
    lockToPrintingMs?: number | null;
  } | null;
  /** OCR produced any title/footer reading. */
  ocrPresent?: boolean;
  detectorEngine?: string | null;
  actualDetectorEngine?: string | null;
  ocrTransport?: string | null;
}

export const mapWinningChannel = (
  earlyReason: string | null | undefined,
): 'title' | 'footer' | 'artwork' | 'type' | 'unknown' | null => {
  if (!earlyReason) return null;
  if (earlyReason.includes('type')) return 'type';
  if (earlyReason === 'title-only' || earlyReason === 'title-footer') return 'title';
  if (earlyReason === 'footer-printing') return 'footer';
  if (earlyReason === 'art-only' || earlyReason === 'title-art' || earlyReason === 'dual') {
    return earlyReason === 'art-only' ? 'artwork' : 'title';
  }
  if (earlyReason.includes('footer')) return 'footer';
  if (earlyReason.includes('title')) return 'title';
  if (earlyReason.includes('art')) return 'artwork';
  return 'unknown';
};

export const scoreAgainstExpected = (
  result: ScoreableResult,
  expected: ExpectedCard | null,
): BenchmarkScore | null => {
  if (!expected) return null;
  const gotName = (result.name ?? '').trim().toLowerCase();
  const expName = expected.name.trim().toLowerCase();
  const nameOk =
    gotName === expName ||
    gotName === expName.split(' // ')[0] ||
    expName === gotName.split(' // ')[0];

  const gotSet = (result.printing?.setCode ?? '').trim().toLowerCase();
  const gotNum = (result.printing?.collectorNumber ?? '').trim();
  const printingOk =
    gotSet === expected.setCode.trim().toLowerCase() &&
    collectorNumbersEqual(gotNum, expected.collectorNumber);

  let finishOk: boolean | null = null;
  if (expected.finish) {
    const got = (result.finish ?? '').trim().toLowerCase();
    finishOk = got === expected.finish.toLowerCase();
  }

  return {
    expected,
    finishOk,
    nameOk,
    oracleOk: nameOk,
    printingOk,
  };
};

export const collectFlags = (
  result: ScoreableResult,
  score: BenchmarkScore | null,
  latency: BenchmarkLatency,
): BenchmarkFlag[] => {
  const flags: BenchmarkFlag[] = [];
  if (result.titleFooterConflict) {
    flags.push('conflict');
    flags.push('title-footer-conflict');
  }
  if (result.artConflict) flags.push('title-art-conflict');
  if (
    result.status === 'card-ambiguous' ||
    result.status === 'printing-ambiguous' ||
    result.status === 'insufficient-confidence'
  ) {
    flags.push('ambiguous');
  }
  if (score && (!score.oracleOk || !score.printingOk)) flags.push('failure');
  if (
    score?.oracleOk === false &&
    (result.status === 'identified' || result.status === 'printing-ambiguous')
  ) {
    flags.push('false-confident');
  }
  if (!result.ocrPresent) flags.push('ocr-miss');
  const oracleMs = latency.lockToFirstOracleMs ?? latency.lockToFinalOracleMs;
  if (oracleMs != null) {
    if (oracleMs > SLOW_ORACLE_FAIL_MS || oracleMs > SLOW_ORACLE_MS) flags.push('slow');
    if (oracleMs > SLOW_ORACLE_1S_MS) flags.push('slow-1s');
    if (oracleMs > SLOW_ORACLE_2S_MS) flags.push('slow-2s');
  }
  if (latency.lockToPrintingMs != null && latency.lockToPrintingMs > SLOW_PRINTING_MS) {
    if (!flags.includes('slow')) flags.push('slow');
  }
  if (
    result.actualDetectorEngine != null &&
    result.actualDetectorEngine !== 'native'
  ) {
    flags.push('detector-js');
  }
  if (
    result.ocrTransport === 'rgba-base64' ||
    result.ocrTransport === 'base64'
  ) {
    flags.push('ocr-base64');
  }
  return flags;
};

export const latencyFromSnapshot = (result: ScoreableResult): BenchmarkLatency => ({
  lockToFinalOracleMs: result.userLatency?.lockToFinalOracleMs ?? null,
  lockToFirstOracleMs: result.userLatency?.lockToFirstOracleMs ?? null,
  lockToPrintingMs: result.userLatency?.lockToPrintingMs ?? null,
});

export const ocrTimingFromReport = (
  channel: Record<string, unknown> | null | undefined,
): BenchmarkOcrChannelTiming | null => {
  if (!channel || typeof channel !== 'object') return null;
  const num = (k: string): number | null => {
    const v = channel[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const str = (k: string): string | null => {
    const v = channel[k];
    return typeof v === 'string' ? v : null;
  };
  return {
    bytes: num('bytes'),
    cropH: num('cropH'),
    cropW: num('cropW'),
    encodeMs: num('encodeMs'),
    jsBridgeMs: num('jsBridgeMs'),
    lookupMs: num('footerLookupMs') ?? num('lookupMs'),
    mlkitMs: num('mlkitMs'),
    nativeMs: num('nativeMs'),
    totalMs: num('titleMs') ?? num('footerMs') ?? num('typeLineMs') ?? num('totalMs'),
    transport: str('transport'),
  };
};
