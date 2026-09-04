import { collectorNumbersEqual } from './expectedManifest';
import type { BenchmarkFlag, BenchmarkLatency, BenchmarkScore, ExpectedCard } from './types';
import { SLOW_ORACLE_MS, SLOW_PRINTING_MS } from './types';

export interface ScoreableResult {
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
}

export const mapWinningChannel = (
  earlyReason: string | null | undefined,
): 'title' | 'footer' | 'artwork' | 'unknown' | null => {
  if (!earlyReason) return null;
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
  if (result.titleFooterConflict) flags.push('conflict');
  if (
    result.status === 'card-ambiguous' ||
    result.status === 'printing-ambiguous' ||
    result.status === 'insufficient-confidence'
  ) {
    flags.push('ambiguous');
  }
  if (score && (!score.oracleOk || !score.printingOk)) flags.push('failure');
  if (!result.ocrPresent) flags.push('ocr-miss');
  const oracleMs = latency.lockToFirstOracleMs ?? latency.lockToFinalOracleMs;
  if (oracleMs != null && oracleMs > SLOW_ORACLE_MS) flags.push('slow');
  if (latency.lockToPrintingMs != null && latency.lockToPrintingMs > SLOW_PRINTING_MS) {
    if (!flags.includes('slow')) flags.push('slow');
  }
  return flags;
};

export const latencyFromSnapshot = (result: ScoreableResult): BenchmarkLatency => ({
  lockToFinalOracleMs: result.userLatency?.lockToFinalOracleMs ?? null,
  lockToFirstOracleMs: result.userLatency?.lockToFirstOracleMs ?? null,
  lockToPrintingMs: result.userLatency?.lockToPrintingMs ?? null,
});
