/** Expected card row for automatic oracle/printing/finish scoring. */
export interface ExpectedCard {
  name: string;
  setCode: string;
  collectorNumber: string;
  /** Optional finish hint: foil | nonfoil | etched */
  finish?: string | null;
}

export type BenchmarkFlag = 'failure' | 'conflict' | 'slow' | 'ambiguous' | 'ocr-miss';

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

export interface BenchmarkScanRecord {
  earlyReason: string | null;
  flags: BenchmarkFlag[];
  latency: BenchmarkLatency;
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
  winningChannel: 'title' | 'footer' | 'artwork' | 'unknown' | null;
}

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
    lockToOracleP50Ms: number | null;
    lockToOracleP95Ms: number | null;
    lockToPrintingP50Ms: number | null;
    lockToPrintingP95Ms: number | null;
  };
  ocrSuccessRate: number | null;
  scanned: number;
  targetCount: number;
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
}

export interface BenchmarkSettings {
  /** HTTPS endpoint for background ingestion. Empty = local-only. */
  ingestionUrl: string;
  targetCount: number;
}

export const DEFAULT_BENCHMARK_TARGET = 50;

/** lock→oracle above this (ms) is flagged slow. */
export const SLOW_ORACLE_MS = 1500;
/** lock→printing above this (ms) is flagged slow. */
export const SLOW_PRINTING_MS = 2500;
