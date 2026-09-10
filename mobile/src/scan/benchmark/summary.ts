import type {
  BenchmarkOcrChannelTiming,
  BenchmarkScanRecord,
  BenchmarkSessionSummary,
  ChannelRollup,
  LatencyVerdict,
} from './types';
import {
  FAIL_ORACLE_P50_MS,
  TARGET_ORACLE_P50_MS,
  TARGET_ORACLE_P95_MS,
  WARN_ORACLE_P50_MS,
} from './types';

const percentile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
};

const rate = (ok: number, n: number): number | null => (n > 0 ? ok / n : null);

const maxOf = (xs: number[]): number | null => (xs.length ? Math.max(...xs) : null);

const nums = (xs: Array<number | null | undefined>): number[] =>
  xs.filter((x): x is number => x != null && Number.isFinite(x));

const rollupChannel = (
  scans: BenchmarkScanRecord[],
  pick: (s: BenchmarkScanRecord) => BenchmarkOcrChannelTiming | null | undefined,
): ChannelRollup => {
  const rows = scans.map(pick).filter((x): x is BenchmarkOcrChannelTiming => Boolean(x));
  const transports = rows.map(r => r.transport).filter((t): t is string => Boolean(t));
  const transport =
    transports.length === 0
      ? null
      : transports.every(t => t === transports[0])
        ? transports[0]
        : 'mixed';
  return {
    bytesP50: percentile(nums(rows.map(r => r.bytes)), 50),
    mlkitP50Ms: percentile(nums(rows.map(r => r.mlkitMs)), 50),
    mlkitP95Ms: percentile(nums(rows.map(r => r.mlkitMs)), 95),
    nativeP50Ms: percentile(nums(rows.map(r => r.nativeMs)), 50),
    totalP50Ms: percentile(nums(rows.map(r => r.totalMs)), 50),
    transport,
    n: rows.length,
  };
};

export const classifyLatencyVerdict = (p50: number | null, p95: number | null): LatencyVerdict => {
  if (p50 == null) return 'unknown';
  if (p50 > FAIL_ORACLE_P50_MS) return 'fail';
  if (p50 > WARN_ORACLE_P50_MS) return 'warn';
  if (p50 <= TARGET_ORACLE_P50_MS && (p95 == null || p95 <= TARGET_ORACLE_P95_MS)) {
    return 'pass';
  }
  if (p50 <= TARGET_ORACLE_P50_MS) return 'stretch';
  return 'warn';
};

export const buildSessionSummary = (
  scans: BenchmarkScanRecord[],
  targetCount: number,
  opts?: { printingEntries?: number | null },
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

  const statusCounts: Record<string, number> = {};
  for (const s of scans) {
    const st = s.status ?? 'unknown';
    statusCounts[st] = (statusCounts[st] ?? 0) + 1;
  }

  const firstOracleMs = nums(scans.map(s => s.latency.lockToFirstOracleMs));
  const finalOracleMs = nums(scans.map(s => s.latency.lockToFinalOracleMs));
  const oracleMs = nums(
    scans.map(s => s.latency.lockToFirstOracleMs ?? s.latency.lockToFinalOracleMs),
  );
  const printingMs = nums(scans.map(s => s.latency.lockToPrintingMs));

  const titleRollup = rollupChannel(scans, s => s.ocrTitle);
  const footerRollup = rollupChannel(scans, s => s.ocrFooter);
  const typeRollup = rollupChannel(scans, s => s.ocrType);

  const titleMlkit = nums(scans.map(s => s.ocrTitle?.mlkitMs));
  const coldFirstTitleMlkitMs = titleMlkit[0] ?? null;
  const warmTitle = titleMlkit.slice(1);

  const transports = scans
    .map(s => s.ocrTitle?.transport ?? s.ocrFooter?.transport)
    .filter((t): t is string => Boolean(t));
  const transport =
    transports.length === 0
      ? null
      : transports.every(t => t === transports[0])
        ? transports[0]
        : 'mixed';
  const invalidBase64Transport =
    transports.some(t => t === 'rgba-base64' || t === 'base64') &&
    !scans.every(s => s.flags.includes('ocr-base64'));

  const jsFallbackCount = scans.filter(
    s =>
      s.flags.includes('detector-js') ||
      (s.actualDetectorEngine != null && s.actualDetectorEngine !== 'native'),
  ).length;
  const actualDetector =
    scans.map(s => s.actualDetectorEngine).find(Boolean) ??
    scans.map(s => s.detectorEngine).find(Boolean) ??
    null;
  const requestedDetector = scans.map(s => s.detectorEngine).find(Boolean) ?? actualDetector;

  const failureCorpus = scans
    .filter(
      s =>
        s.flags.includes('failure') ||
        s.flags.includes('ambiguous') ||
        s.flags.includes('conflict') ||
        s.flags.includes('title-art-conflict') ||
        s.flags.includes('title-footer-conflict') ||
        s.flags.includes('ocr-miss') ||
        s.flags.includes('slow-1s') ||
        s.flags.includes('slow-2s') ||
        s.flags.includes('false-confident'),
    )
    .map(s => ({
      seq: s.seq,
      name: s.name,
      flags: s.flags,
      lockToOracleMs: s.latency.lockToFirstOracleMs ?? s.latency.lockToFinalOracleMs,
    }));

  const p50 = percentile(oracleMs, 50);
  const p95 = percentile(oracleMs, 95);

  const printingEntries = opts?.printingEntries ?? null;

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
      lockToFirstOracleP50Ms: percentile(firstOracleMs, 50),
      lockToFirstOracleP95Ms: percentile(firstOracleMs, 95),
      lockToFirstOracleMaxMs: maxOf(firstOracleMs),
      lockToFinalOracleP50Ms: percentile(finalOracleMs, 50),
      lockToFinalOracleP95Ms: percentile(finalOracleMs, 95),
      lockToOracleP50Ms: p50,
      lockToOracleP95Ms: p95,
      lockToPrintingP50Ms: percentile(printingMs, 50),
      lockToPrintingP95Ms: percentile(printingMs, 95),
      verdict: classifyLatencyVerdict(p50, p95),
    },
    ocr: {
      title: titleRollup,
      footer: footerRollup,
      type: typeRollup,
      transport,
      coldFirstTitleMlkitMs,
      warmTitleMlkitP50Ms: percentile(warmTitle, 50),
      warmTitleMlkitP95Ms: percentile(warmTitle, 95),
      titleSuccessRate: rate(
        scans.filter(s => (s.ocrTitle?.totalMs ?? 0) > 0 || s.winningChannel === 'title').length,
        scans.length,
      ),
      footerSuccessRate: rate(
        scans.filter(s => (s.ocrFooter?.bytes ?? 0) > 0).length,
        scans.length,
      ),
      typeSuccessRate: typeRollup.n ? rate(typeRollup.n, scans.length) : null,
      invalidBase64Transport,
    },
    detector: {
      requested: requestedDetector,
      actual: actualDetector,
      jsFallbackCount,
      nativeOk: actualDetector === 'native' && jsFallbackCount === 0,
    },
    statusCounts,
    failureCorpus,
    ocrSuccessRate: rate(ocrOk, ocrEligible.length || scans.length),
    scanned: scans.length,
    targetCount,
    gates: {
      detectorNative: actualDetector === 'native',
      ocrRgbaBytes: transport === 'rgba-bytes',
      printingLoaded:
        printingEntries == null ? null : printingEntries >= 100_000,
    },
  };
};

export const formatSummaryText = (summary: BenchmarkSessionSummary): string => {
  const pct = (x: number | null) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);
  const ms = (x: number | null) => (x == null ? '—' : `${x.toFixed(0)} ms`);
  const channels = Object.entries(summary.firstWinningChannel)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  const statuses = Object.entries(summary.statusCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return [
    `Benchmark summary · ${summary.scanned}/${summary.targetCount} scans · verdict ${summary.latency.verdict}`,
    `accuracy name ${pct(summary.accuracy.name)} · oracle ${pct(summary.accuracy.oracle)} · printing ${pct(summary.accuracy.printing)} · finish ${pct(summary.accuracy.finish)}`,
    `OCR success ${pct(summary.ocrSuccessRate)} · ambiguity ${pct(summary.ambiguityRate)} · statuses ${statuses || '—'}`,
    `first channel ${channels || '—'}`,
    `lock→first oracle p50 ${ms(summary.latency.lockToFirstOracleP50Ms)} · p95 ${ms(summary.latency.lockToFirstOracleP95Ms)} · max ${ms(summary.latency.lockToFirstOracleMaxMs)}`,
    `lock→final oracle p50 ${ms(summary.latency.lockToFinalOracleP50Ms)} · p95 ${ms(summary.latency.lockToFinalOracleP95Ms)}`,
    `lock→printing p50 ${ms(summary.latency.lockToPrintingP50Ms)} · p95 ${ms(summary.latency.lockToPrintingP95Ms)}`,
    `OCR transport ${summary.ocr.transport ?? '—'} · title mlkit warm p50 ${ms(summary.ocr.warmTitleMlkitP50Ms)} · cold ${ms(summary.ocr.coldFirstTitleMlkitMs)}`,
    `title bytes p50 ${summary.ocr.title.bytesP50 != null ? `${(summary.ocr.title.bytesP50 / 1024).toFixed(1)} KB` : '—'} · footer ${summary.ocr.footer.bytesP50 != null ? `${(summary.ocr.footer.bytesP50 / 1024).toFixed(1)} KB` : '—'}`,
    `detector ${summary.detector.actual ?? '—'} (requested ${summary.detector.requested ?? '—'}) · jsFallback ${summary.detector.jsFallbackCount}`,
    `gates detectorNative=${summary.gates.detectorNative} ocrRgbaBytes=${summary.gates.ocrRgbaBytes} printingLoaded=${summary.gates.printingLoaded}`,
    `failure corpus ${summary.failureCorpus.length} scans`,
  ].join('\n');
};
