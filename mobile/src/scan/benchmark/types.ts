/** Expected card row for automatic oracle/printing/finish scoring. */
export interface ExpectedCard {
  name: string;
  setCode: string;
  collectorNumber: string;
  /** Optional finish hint: foil | nonfoil | etched */
  finish?: string | null;
}

export type BenchmarkFlag =
  | 'failure'
  | 'conflict'
  | 'title-art-conflict'
  | 'title-footer-conflict'
  | 'slow'
  | 'slow-1s'
  | 'slow-2s'
  | 'ambiguous'
  | 'ocr-miss'
  | 'false-confident'
  | 'detector-js'
  | 'ocr-base64';

export type UploadStatus = 'pending' | 'uploading' | 'ok' | 'failed' | 'skipped';

export interface BenchmarkScore {
  finishOk: boolean | null;
  nameOk: boolean;
  oracleOk: boolean;
  printingOk: boolean;
  expected: ExpectedCard | null;
}

export interface BenchmarkLatency {
  lockToFinalOracleMs: number | null;
  lockToFirstOracleMs: number | null;
  lockToPrintingMs: number | null;
}

/** Per-channel OCR stage timings captured at record time (ms / bytes). */
export interface BenchmarkOcrChannelTiming {
  bytes: number | null;
  cropH: number | null;
  cropW: number | null;
  encodeMs: number | null;
  jsBridgeMs: number | null;
  lookupMs: number | null;
  mlkitMs: number | null;
  nativeMs: number | null;
  totalMs: number | null;
  transport: string | null;
}

export interface BenchmarkScanRecord {
  earlyReason: string | null;
  flags: BenchmarkFlag[];
  latency: BenchmarkLatency;
  /** Session lock timestamp — dedupe key for one physical scan. */
  lockedAt: number | null;
  name: string | null;
  pngRelativePath: string;
  reportRelativePath: string;
  score: BenchmarkScore | null;
  seq: number;
  stamp: string;
  status: string | null;
  uploadAttempts: number;
  uploadError: string | null;
  uploadStatus: UploadStatus;
  winningChannel: 'title' | 'footer' | 'artwork' | 'type' | 'unknown' | null;
  ocrTitle?: BenchmarkOcrChannelTiming | null;
  ocrFooter?: BenchmarkOcrChannelTiming | null;
  ocrType?: BenchmarkOcrChannelTiming | null;
  detectorEngine?: string | null;
  actualDetectorEngine?: string | null;
  detectorFallbackReason?: string | null;
  artConflict?: boolean;
  titleFooterConflict?: boolean;
}

export type LatencyVerdict = 'pass' | 'stretch' | 'warn' | 'fail' | 'unknown';

export interface BenchmarkSessionSummary {
  accuracy: {
    finish: number | null;
    name: number | null;
    oracle: number | null;
    printing: number | null;
  };
  ambiguityRate: number;
  firstWinningChannel: Record<string, number>;
  generatedAt: string;
  latency: {
    lockToFirstOracleP50Ms: number | null;
    lockToFirstOracleP95Ms: number | null;
    lockToFirstOracleMaxMs: number | null;
    lockToFinalOracleP50Ms: number | null;
    lockToFinalOracleP95Ms: number | null;
    lockToOracleP50Ms: number | null;
    lockToOracleP95Ms: number | null;
    lockToPrintingP50Ms: number | null;
    lockToPrintingP95Ms: number | null;
    verdict: LatencyVerdict;
  };
  ocr: {
    title: ChannelRollup;
    footer: ChannelRollup;
    type: ChannelRollup;
    transport: string | null;
    coldFirstTitleMlkitMs: number | null;
    warmTitleMlkitP50Ms: number | null;
    warmTitleMlkitP95Ms: number | null;
    titleSuccessRate: number | null;
    footerSuccessRate: number | null;
    typeSuccessRate: number | null;
    invalidBase64Transport: boolean;
  };
  detector: {
    requested: string | null;
    actual: string | null;
    jsFallbackCount: number;
    nativeOk: boolean;
  };
  statusCounts: Record<string, number>;
  failureCorpus: Array<{
    seq: number;
    name: string | null;
    flags: BenchmarkFlag[];
    lockToOracleMs: number | null;
  }>;
  ocrSuccessRate: number | null;
  scanned: number;
  targetCount: number;
  gates: {
    detectorNative: boolean;
    ocrRgbaBytes: boolean;
    printingLoaded: boolean | null;
  };
}

export interface ChannelRollup {
  bytesP50: number | null;
  mlkitP50Ms: number | null;
  mlkitP95Ms: number | null;
  nativeP50Ms: number | null;
  totalP50Ms: number | null;
  transport: string | null;
  n: number;
}

export interface BenchmarkSession {
  createdAt: string;
  endedAt: string | null;
  expectedManifest: ExpectedCard[] | null;
  ingestionUrl: string | null;
  scans: BenchmarkScanRecord[];
  sessionId: string;
  summary: BenchmarkSessionSummary | null;
  targetCount: number;
  /** Snapshot of data/engine at session start (optional). */
  environment?: {
    printingEntries?: number | null;
    typeOracles?: number | null;
    artEntries?: number | null;
    names?: number | null;
  } | null;
}

export interface BenchmarkSettings {
  /** HTTPS endpoint for background ingestion. Empty = local-only. */
  ingestionUrl: string;
  targetCount: number;
}

export const DEFAULT_BENCHMARK_TARGET = 50;

/** lock→oracle above this (ms) is flagged slow (warning). */
export const SLOW_ORACLE_MS = 1500;
/** lock→oracle hard failure flag. */
export const SLOW_ORACLE_FAIL_MS = 3000;
/** lock→oracle >1s corpus flag. */
export const SLOW_ORACLE_1S_MS = 1000;
/** lock→oracle >2s corpus flag. */
export const SLOW_ORACLE_2S_MS = 2000;
/** lock→printing above this (ms) is flagged slow. */
export const SLOW_PRINTING_MS = 2500;

/** Warm lock→correct oracle targets (product goals). */
export const TARGET_ORACLE_P50_MS = 700;
export const TARGET_ORACLE_P95_MS = 1000;
export const WARN_ORACLE_P50_MS = 1500;
export const FAIL_ORACLE_P50_MS = 3000;

export const PRODUCTION_PRINTING_ENTRIES_EXPECT = 101_912;
