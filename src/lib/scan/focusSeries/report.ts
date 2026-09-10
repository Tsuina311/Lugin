import { FOCUS_SERIES_OFFSETS_MS } from './types';
import { classifySampleOutcome, isStrongIdentity } from './outcome';
import { resolveExpectedIdentity } from './expected';
import { partitionFocusSeries, warpBadCount } from './partition';
import { diagnoseFocusBundle } from './summarize';
import {
  CAPTURE_POLICIES,
  aggregatePolicy,
  formatPolicyRow,
  sampleAtDelay,
  simulatePolicy,
} from './policy';
import { bestTitleSharpnessSeparator, labelQualitySample } from './qualityProbe';
import type { FocusFailureClass, FocusSeriesBundle, FocusSeriesSample } from './types';

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

const classCounts = (samples: readonly FocusSeriesSample[]) =>
  samples.reduce<Record<FocusFailureClass, number>>(
    (acc, s) => {
      const k = s.failureClass ?? 'SOURCE_BAD';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    { OK: 0, OCR_BAD: 0, SOURCE_BAD: 0, TITLE_REGION_BAD: 0, WARP_BAD: 0 },
  );

const auditTracks = (bundles: readonly FocusSeriesBundle[]): string[] => {
  const rows = [...bundles].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const sameTrack = prev.currentTrackId != null && prev.currentTrackId === cur.currentTrackId;
    const sameAttempt = prev.focusAttemptId != null && prev.focusAttemptId === cur.focusAttemptId;
    if (sameTrack || sameAttempt) {
      lines.push(
        `  ${prev.label} → ${cur.label}: track ${prev.currentTrackId}→${cur.currentTrackId}` +
          `  attempt ${prev.focusAttemptId}→${cur.focusAttemptId}` +
          (sameTrack ? '  SAME TRACK' : '') +
          (sameAttempt ? '  SAME ATTEMPT' : ''),
      );
    }
  }
  return lines;
};

export const formatCapturePolicyReport = (bundles: readonly FocusSeriesBundle[]): string => {
  const diagnosed = bundles.map(diagnoseFocusBundle);
  const { legacy, perSnapshot } = partitionFocusSeries(diagnosed);
  const expectedRows = perSnapshot.map(b => {
    const expected = resolveExpectedIdentity(b);
    const samples = FOCUS_SERIES_OFFSETS_MS.map(n => {
      const s = sampleAtDelay(b.samples, n);
      if (!s) return { n, outcome: 'unidentified' as const, sample: null };
      return { n, outcome: classifySampleOutcome(s, expected.expectedName), sample: s };
    });
    return { bundle: b, expected, samples };
  });

  const perSamples = perSnapshot.flatMap(b => b.samples);
  const counts = classCounts(perSamples);
  const delayLines = FOCUS_SERIES_OFFSETS_MS.map(n => {
    const cells = expectedRows.map(row => row.samples.find(s => s.n === n)!);
    const present = cells.filter(c => c.sample);
    const correct = present.filter(c => c.outcome === 'correct').length;
    const firstPass = present.filter(c => c.sample?.ocr.firstPassExact && c.outcome === 'correct').length;
    const strong = present.filter(c => c.sample && isStrongIdentity(c.sample)).length;
    return `T${n}  correct ${correct}/${present.length} (${pct(correct, present.length)})  first-pass exact ${firstPass}/${present.length} (${pct(firstPass, present.length)})  strong-identity published ${strong}/${present.length} (not the accuracy metric)`;
  });

  const identityBlock = expectedRows.flatMap(row => {
    const lines = [
      '',
      `${row.bundle.label || row.bundle.fixtureId}`,
      `  expected ${row.expected.expectedName}  oracleId ${row.expected.expectedOracleId || '—'}  via ${row.expected.source}`,
      `  track ${row.bundle.currentTrackId ?? '—'}  attempt ${row.bundle.focusAttemptId ?? '—'}  quadMode ${row.bundle.quadMode}`,
    ];
    for (const cell of row.samples) {
      const s = cell.sample;
      if (!s) {
        lines.push(`  T${cell.n}  missing`);
        continue;
      }
      const ocr = (s.ocr.ocrText || s.ocr.rawOcrFirst || '(empty)').replace(/\s+/g, ' ').slice(0, 28);
      lines.push(
        `  T${cell.n}  ${cell.outcome.padEnd(22)}  title ${s.metrics.titleSharpness.toFixed(0).padEnd(6)}  ${s.ocr.decision.padEnd(16)}  ${ocr.padEnd(28)}  ${s.ocr.matchName ?? '—'}`,
      );
    }
    return lines;
  });

  const policyAggs = CAPTURE_POLICIES.map(spec => {
    const picks = expectedRows
      .map(row => {
        const pick = simulatePolicy(row.bundle.samples, spec, row.expected.expectedName);
        const t0 = sampleAtDelay(row.bundle.samples, 0);
        if (!pick || !t0) return null;
        return { pick, t0DelayMs: t0.actualDelayFromFocusRequestMs };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    return aggregatePolicy(picks, spec);
  });

  const labeled = expectedRows.flatMap(row =>
    row.samples
      .map(cell => (cell.sample ? labelQualitySample(cell.sample, cell.outcome === 'correct') : null))
      .filter((x): x is NonNullable<typeof x> => Boolean(x)),
  );
  const sep = bestTitleSharpnessSeparator(labeled);

  const trackLines = auditTracks(perSnapshot);
  const legacyWarp = warpBadCount(legacy);
  const liveWarp = warpBadCount(perSnapshot);

  const bestByAccuracy = [...policyAggs].sort((a, b) => {
    if (b.correct !== a.correct) return b.correct - a.correct;
    const extraA = a.additionalLatencyMs.reduce((s, n) => s + n, 0) / Math.max(1, a.additionalLatencyMs.length);
    const extraB = b.additionalLatencyMs.reduce((s, n) => s + n, 0) / Math.max(1, b.additionalLatencyMs.length);
    return extraA - extraB;
  })[0];

  return [
    'CAPTURE POLICY REPORT — PER-SNAPSHOT ONLY',
    'Legacy-frozen series are excluded from accuracy and policy tables.',
    'Success = predicted == expected AND (exact-title | strong-fuzzy). Publishing any name is not success.',
    '',
    `legacy-frozen series: ${legacy.length}  (not used for policy)`,
    `per-snapshot series: ${perSnapshot.length}  samples: ${perSamples.length}`,
    `classes: OK=${counts.OK}  SOURCE_BAD=${counts.SOURCE_BAD}  WARP_BAD=${counts.WARP_BAD}  TITLE_REGION_BAD=${counts.TITLE_REGION_BAD}  OCR_BAD=${counts.OCR_BAD}`,
    '',
    'SUCCESS BY DELAY (predicted == expected)',
    ...delayLines,
    '',
    'EXPECTED IDENTITY',
    ...identityBlock,
    '',
    'POLICY SIMULATION (recorded OCR only; no ML Kit)',
    'Policy                          Accuracy          FP       amb      unid        fb       OCR/card        delay / extra vs T0',
    ...policyAggs.map(formatPolicyRow),
    '',
    'QUALITY THRESHOLD (offline; title sharpness → predict OCR-empty)',
    labeled.length
      ? `usable n=${sep.best?.trueUsable ?? 0}  empty n=${sep.best?.trueEmpty ?? 0}  usable min title ${sep.usableMin?.toFixed(1) ?? 'n/a'}  empty max title ${sep.emptyMax?.toFixed(1) ?? 'n/a'}`
      : 'no labeled samples',
    sep.overlap
      ? 'title sharpness alone does NOT separate usable vs unusable — ranges overlap.'
      : 'title sharpness ranges do not overlap on this tiny set; still not a production gate.',
    sep.best
      ? `best explored cut title < ${sep.best.threshold}: precision ${Math.round(100 * sep.best.precision)}%  recall ${Math.round(100 * sep.best.recall)}% (too few series to choose a gate)`
      : '',
    'Historical Teferi 6.2 vs 343.2 is a catastrophic pole, not a global threshold.',
    '',
    'TRACK / FOCUS IDS',
    trackLines.length ? trackLines.join('\n') : '  no consecutive series reused track/attempt ids',
    'Why physical swaps can keep the same trackId:',
    '  Continuity keeps a track when the next blob sits in a similar place (keep IoU 0.55;',
    '  a switch needs 3 agreeing frames). A same-spot card swap looks like the same object.',
    '  Focus Series holds controller.onFrame, so the session never sees gone→searching during the run.',
    '  focusAttemptId increments only on a new focus request after trackChanged.',
    '  The Lab button requests camera focus but records the live session attempt id — it does not mint one.',
    'Risk: focus reset and recognize retry budget may still belong to the previous card;',
    'found → next-card may not fire; continuous scanning can treat a swap as the same track.',
    'Debug-only idea (not implemented): Capture Focus Series always starts a fresh focus attempt',
    'even if continuity kept the track. Do not change production focus policy from this.',
    '',
    'GEOMETRY',
    `legacy-frozen WARP_BAD samples: ${legacyWarp}`,
    `per-snapshot WARP_BAD samples: ${liveWarp}`,
    liveWarp === 0 && legacyWarp > 0
      ? 'Proven: CAPTURE-TIME RECOGNITION QUAD REQUIRED FOR MULTI-FRAME CAPTURE. Do not revisit frozen-quad series.'
      : liveWarp === 0
        ? 'Per-snapshot WARP_BAD is zero. Frozen-quad series remain the stale-geometry proof.'
        : 'Per-snapshot still has WARP_BAD — do not treat geometry as solved.',
    '',
    'RECOMMENDATION',
    bestByAccuracy
      ? `On this ${perSnapshot.length}-series set, ${bestByAccuracy.spec.id} (${bestByAccuracy.spec.label}) has the best correct/total then lowest extra delay (${bestByAccuracy.correct}/${bestByAccuracy.total}).`
      : 'no policies',
    'This is not a production change. Do not implement a recapture policy yet.',
    'Do not implement titleSharpness < threshold → recapture. The feature overlaps too much.',
    '',
    'A fixed delay is still not justified for easy cards that already succeed at T0.',
  ].join('\n');
};
