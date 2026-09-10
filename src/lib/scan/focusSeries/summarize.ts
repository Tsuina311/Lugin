import { attachFocusSeriesDiagnostics, inferQuadMode } from './classify';
import { partitionFocusSeries } from './partition';
import type {
  FocusFailureClass,
  FocusSeriesBundle,
  FocusSeriesNominalMs,
  FocusSeriesSample,
} from './types';
import { FOCUS_SERIES_OFFSETS_MS } from './types';

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

const p50 = (values: number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
};

const identified = (s: FocusSeriesSample): boolean =>
  s.ocr.decision === 'exact-title' || s.ocr.decision === 'strong-fuzzy';

const sampleAt = (samples: readonly FocusSeriesSample[], nominal: FocusSeriesNominalMs) =>
  samples.find(s => s.nominalDelayMs === nominal) ?? null;

const fmt = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits);

const geometryConfounded = (s: FocusSeriesSample): boolean =>
  s.failureClass === 'WARP_BAD';

export const diagnoseFocusBundle = (
  bundle: FocusSeriesBundle,
): FocusSeriesBundle & { samples: FocusSeriesSample[] } => {
  const samples = attachFocusSeriesDiagnostics(bundle.samples);
  return {
    ...bundle,
    quadMode: bundle.quadMode ?? inferQuadMode(samples),
    samples,
  };
};

const sampleLine = (s: FocusSeriesSample): string => {
  const id = s.ocr.matchName ?? s.ocr.status;
  const ocr = (s.ocr.rawOcrFirst || '(empty)').replace(/\s+/g, ' ').slice(0, 22);
  return [
    `T${s.nominalDelayMs}`.padEnd(6),
    `age ${fmt(s.quadAgeAtCaptureMs, 0)}`.padEnd(10),
    `iou ${fmt(s.geometry?.iouVsT0, 2)}`.padEnd(9),
    `card ${fmt(s.metrics.cardSharpness, 0)}`.padEnd(9),
    `title ${fmt(s.metrics.titleSharpness, 0)}`.padEnd(10),
    (s.failureClass ?? '—').padEnd(18),
    ocr.padEnd(22),
    id,
  ].join(' ');
};

const byDelay = (
  bundles: readonly ReturnType<typeof diagnoseFocusBundle>[],
  pick: (s: FocusSeriesSample) => boolean,
  among: (s: FocusSeriesSample) => boolean = () => true,
) =>
  FOCUS_SERIES_OFFSETS_MS.map(n => {
    const samples = bundles
      .map(b => sampleAt(b.samples, n))
      .filter((s): s is FocusSeriesSample => s != null && among(s));
    return { n, rate: pct(samples.filter(pick).length, samples.length), count: samples.length };
  });

export const summarizeFocusSeries = (bundles: readonly FocusSeriesBundle[]): string => {
  const diagnosed = bundles.map(diagnoseFocusBundle);
  const header =
    'delay  quadAge   vsT0     card      title      class              OCR                    identity';
  const cards = diagnosed.flatMap(b => [
    '',
    `${b.label || b.fixtureId}  track ${b.currentTrackId ?? '—'}  quadMode ${b.quadMode}`,
    header,
    ...FOCUS_SERIES_OFFSETS_MS.map(n => {
      const s = sampleAt(b.samples, n);
      return s ? sampleLine(s) : `T${n}  (missing)`;
    }),
  ]);

  const allSamples = diagnosed.flatMap(b => b.samples);
  const clean = (s: FocusSeriesSample) => !geometryConfounded(s);

  const sourceByDelay = FOCUS_SERIES_OFFSETS_MS.map(n => {
    const samples = diagnosed
      .map(b => sampleAt(b.samples, n))
      .filter((s): s is FocusSeriesSample => Boolean(s));
    return {
      n,
      card: p50(samples.map(s => s.metrics.cardSharpness)),
      source: p50(samples.map(s => s.sourceSharpness).filter(v => v > 0)),
      sourceBad: pct(samples.filter(s => s.failureClass === 'SOURCE_BAD').length, samples.length),
    };
  });

  const geoByDelay = FOCUS_SERIES_OFFSETS_MS.map(n => {
    const samples = diagnosed
      .map(b => sampleAt(b.samples, n))
      .filter((s): s is FocusSeriesSample => Boolean(s));
    return {
      n,
      iou: p50(samples.map(s => s.geometry?.iouVsT0 ?? 1)),
      warpBad: pct(samples.filter(s => s.failureClass === 'WARP_BAD').length, samples.length),
      titleRegion: pct(samples.filter(s => s.failureClass === 'TITLE_REGION_BAD').length, samples.length),
    };
  });

  const ocrAll = byDelay(diagnosed, identified);
  const ocrClean = byDelay(diagnosed, identified, clean);
  const exactClean = byDelay(diagnosed, s => s.ocr.firstPassExact, clean);

  const classCounts = allSamples.reduce<Record<FocusFailureClass, number>>(
    (acc, s) => {
      const k = s.failureClass ?? 'SOURCE_BAD';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    { OK: 0, OCR_BAD: 0, SOURCE_BAD: 0, TITLE_REGION_BAD: 0, WARP_BAD: 0 },
  );

  return [
    ...cards,
    '',
    `series: ${diagnosed.length}  samples: ${allSamples.length}`,
    `classes: OK=${classCounts.OK}  SOURCE_BAD=${classCounts.SOURCE_BAD}  WARP_BAD=${classCounts.WARP_BAD}  TITLE_REGION_BAD=${classCounts.TITLE_REGION_BAD}  OCR_BAD=${classCounts.OCR_BAD}`,
    '',
    '1. capture/source quality vs delay (all samples)',
    ...sourceByDelay.map(
      d =>
        `T${d.n}  p50 card ${d.card == null ? 'n/a' : d.card.toFixed(1)}  p50 source ${d.source == null ? 'n/a' : d.source.toFixed(1)}  SOURCE_BAD ${d.sourceBad}`,
    ),
    '',
    '2. geometry/crop failures vs delay (all samples)',
    ...geoByDelay.map(
      d =>
        `T${d.n}  p50 IoU-vs-T0 ${d.iou == null ? 'n/a' : d.iou.toFixed(2)}  WARP_BAD ${d.warpBad}  TITLE_REGION_BAD ${d.titleRegion}`,
    ),
    '',
    '3. OCR success vs delay',
    ...FOCUS_SERIES_OFFSETS_MS.map((n, i) => {
      const all = ocrAll[i];
      const cleanRow = ocrClean[i];
      const exact = exactClean[i];
      return `T${n}  final ${all?.rate ?? 'n/a'} (all)  final ${cleanRow?.rate ?? 'n/a'} (excl. WARP_BAD)  first-pass exact ${exact?.rate ?? 'n/a'} (excl. WARP_BAD)`;
    }),
    '',
    'LEGACY-FROZEN mixed into the block above is evidence of stale geometry only.',
    `per-snapshot-only series: ${partitionFocusSeries(bundles).perSnapshot.length}  — use yarn scan:capture-policy-report for policy accuracy`,
    'Do not pick a fixed delay from geometry-confounded samples. F1–F4 only after excluding WARP_BAD.',
    'best-quality delay counts are not a production recommendation.',
    `best-quality delay counts: ${FOCUS_SERIES_OFFSETS_MS.map(n => {
      const wins = diagnosed.filter(b => {
        const best = [...b.samples].sort((a, c) => c.metrics.titleSharpness - a.metrics.titleSharpness)[0];
        return best?.nominalDelayMs === n;
      }).length;
      return `T${n}=${wins}`;
    }).join('  ')}`,
  ].join('\n');
};
