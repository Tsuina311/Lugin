import type { BenchmarkScanRecord, BenchmarkSessionSummary } from './types';

const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
};

const rate = (ok: number, n: number): number | null => (n > 0 ? ok / n : null);

export const buildSessionSummary = (
  scans: BenchmarkScanRecord[],
  targetCount: number,
): BenchmarkSessionSummary => {
  const scored = scans.filter(s => s.score);
  const nameOk = scored.filter(s => s.score!.nameOk).length;
  const oracleOk = scored.filter(s => s.score!.oracleOk).length;
  const printingOk = scored.filter(s => s.score!.printingOk).length;
  const finishScored = scored.filter(s => s.score!.finishOk != null);
  const finishOk = finishScored.filter(s => s.score!.finishOk).length;

  const ocrEligible = scans.filter(s => !s.flags.includes('ocr-miss') || s.name);
  const ocrOk = scans.filter(s => !s.flags.includes('ocr-miss')).length;

  const ambiguous = scans.filter(s => s.flags.includes('ambiguous')).length;

  const firstWinningChannel: Record<string, number> = {};
  for (const s of scans) {
    const ch = s.winningChannel ?? 'unknown';
    firstWinningChannel[ch] = (firstWinningChannel[ch] ?? 0) + 1;
  }

  const oracleMs = scans
    .map(s => s.latency.lockToFirstOracleMs ?? s.latency.lockToFinalOracleMs)
    .filter((x): x is number => x != null && Number.isFinite(x));
  const printingMs = scans
    .map(s => s.latency.lockToPrintingMs)
    .filter((x): x is number => x != null && Number.isFinite(x));

  return {
    accuracy: {
      finish: rate(finishOk, finishScored.length),
      name: rate(nameOk, scored.length),
      oracle: rate(oracleOk, scored.length),
      printing: rate(printingOk, scored.length),
    },
    ambiguityRate: scans.length ? ambiguous / scans.length : 0,
    firstWinningChannel,
    generatedAt: new Date().toISOString(),
    latency: {
      lockToOracleP50Ms: percentile(oracleMs, 50),
      lockToOracleP95Ms: percentile(oracleMs, 95),
      lockToPrintingP50Ms: percentile(printingMs, 50),
      lockToPrintingP95Ms: percentile(printingMs, 95),
    },
    ocrSuccessRate: rate(ocrOk, ocrEligible.length || scans.length),
    scanned: scans.length,
    targetCount,
  };
};

export const formatSummaryText = (summary: BenchmarkSessionSummary): string => {
  const pct = (x: number | null) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
  const ms = (x: number | null) => (x == null ? '—' : `${x.toFixed(0)} ms`);
  const channels = Object.entries(summary.firstWinningChannel)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return [
    `Benchmark summary · ${summary.scanned}/${summary.targetCount} scans`,
    `accuracy name ${pct(summary.accuracy.name)} · oracle ${pct(summary.accuracy.oracle)} · printing ${pct(summary.accuracy.printing)} · finish ${pct(summary.accuracy.finish)}`,
    `OCR success ${pct(summary.ocrSuccessRate)} · ambiguity ${pct(summary.ambiguityRate)}`,
    `first channel ${channels || '—'}`,
    `lock→oracle p50 ${ms(summary.latency.lockToOracleP50Ms)} · p95 ${ms(summary.latency.lockToOracleP95Ms)}`,
    `lock→printing p50 ${ms(summary.latency.lockToPrintingP50Ms)} · p95 ${ms(summary.latency.lockToPrintingP95Ms)}`,
  ].join('\n');
};
