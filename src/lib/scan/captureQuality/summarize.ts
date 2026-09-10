import type { CaptureQualityBundle } from './types';

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

const p50 = (values: number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
};

export const summarizeCapturePairs = (bundles: readonly CaptureQualityBundle[]): string => {
  const rows = bundles.map(b => {
    const sharpDelta =
      b.snapshot.metrics.titleSharpness > 0
        ? ((b.photo.metrics.titleSharpness - b.snapshot.metrics.titleSharpness) /
            b.snapshot.metrics.titleSharpness) *
          100
        : null;
    return {
      card: b.label || b.fixtureId,
      fastExact: b.snapshot.ocr.firstPassExact,
        fastIdentified:
          b.snapshot.ocr.decision === 'exact-title' || b.snapshot.ocr.decision === 'strong-fuzzy',
        fastMs: b.snapshot.timings.totalCaptureToIdentityMs,
        photoExact: b.photo.ocr.firstPassExact,
        photoIdentified:
          b.photo.ocr.decision === 'exact-title' || b.photo.ocr.decision === 'strong-fuzzy',
      photoMs: b.photo.timings.totalCaptureToIdentityMs,
      sharpDelta,
    };
  });
  const lines = [
    'Card'.padEnd(28) +
      'Fast exact  Photo exact  Fast ms  Photo ms  Sharpness Δ',
    ...rows.map(r =>
      `${r.card.slice(0, 26).padEnd(28)}${r.fastExact ? 'yes' : 'no '}         ${
        r.photoExact ? 'yes' : 'no '
      }         ${String(Math.round(r.fastMs)).padStart(6)}  ${String(Math.round(r.photoMs)).padStart(7)}  ${
        r.sharpDelta == null ? 'n/a' : `${r.sharpDelta >= 0 ? '+' : ''}${r.sharpDelta.toFixed(0)}%`
      }`,
    ),
    '',
    `pairs: ${bundles.length}`,
    `fast final identified: ${pct(rows.filter(r => r.fastIdentified).length, rows.length)}`,
    `photo final identified: ${pct(rows.filter(r => r.photoIdentified).length, rows.length)}`,
    `fast first-pass exact: ${pct(rows.filter(r => r.fastExact).length, rows.length)}`,
    `photo first-pass exact: ${pct(rows.filter(r => r.photoExact).length, rows.length)}`,
    `fast p50 capture→identity: ${p50(rows.map(r => r.fastMs)) ?? 'n/a'} ms`,
    `photo p50 capture→identity: ${p50(rows.map(r => r.photoMs)) ?? 'n/a'} ms`,
    `fast p50 capture only: ${p50(bundles.map(b => b.snapshot.timings.captureRequestToSourceReadyMs)) ?? 'n/a'} ms`,
    `photo p50 capture only: ${p50(bundles.map(b => b.photo.timings.captureRequestToSourceReadyMs)) ?? 'n/a'} ms`,
  ];
  return lines.join('\n');
};
