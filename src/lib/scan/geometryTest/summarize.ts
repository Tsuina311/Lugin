import type { GeometryTestBundle, GeometryTestItemRecord } from './types';

const percentile = (vals: number[], p: number): number | null => {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
};

const collect = (
  items: GeometryTestItemRecord[],
  pick: (i: GeometryTestItemRecord) => number | null,
): number[] =>
  items.map(pick).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

export type GeometryTestSummary = {
  fixtureId: string;
  itemCount: number;
  manualCaptureRate: number;
  failureRate: number;
  firstRawP50: number | null;
  firstRawP95: number | null;
  firstPlausibleP50: number | null;
  firstPlausibleP95: number | null;
  lockP50: number | null;
  lockP95: number | null;
  captureDoneP50: number | null;
  captureDoneP95: number | null;
  displayP50: number | null;
  displayP95: number | null;
};

export const summarizeGeometryTest = (bundle: GeometryTestBundle): GeometryTestSummary => {
  const items = bundle.items;
  const captured = items.filter(i => i.timing.captureCompletedAt != null);
  const manual = items.filter(i => i.manualCapture).length;
  const failed = items.length - captured.length;
  return {
    fixtureId: bundle.fixtureId,
    itemCount: items.length,
    manualCaptureRate: items.length ? manual / items.length : 0,
    failureRate: items.length ? failed / items.length : 0,
    firstRawP50: percentile(collect(items, i => i.derivedMs.buttonToFirstRawMs), 50),
    firstRawP95: percentile(collect(items, i => i.derivedMs.buttonToFirstRawMs), 95),
    firstPlausibleP50: percentile(collect(items, i => i.derivedMs.buttonToFirstPlausibleMs), 50),
    firstPlausibleP95: percentile(collect(items, i => i.derivedMs.buttonToFirstPlausibleMs), 95),
    lockP50: percentile(
      collect(items, i =>
        i.timing.buttonPressedAt != null && i.timing.captureQuadLockedAt != null
          ? i.timing.captureQuadLockedAt - i.timing.buttonPressedAt
          : null,
      ),
      50,
    ),
    lockP95: percentile(
      collect(items, i =>
        i.timing.buttonPressedAt != null && i.timing.captureQuadLockedAt != null
          ? i.timing.captureQuadLockedAt - i.timing.buttonPressedAt
          : null,
      ),
      95,
    ),
    captureDoneP50: percentile(collect(items, i => i.derivedMs.buttonToCaptureDoneMs), 50),
    captureDoneP95: percentile(collect(items, i => i.derivedMs.buttonToCaptureDoneMs), 95),
    displayP50: percentile(collect(items, i => i.derivedMs.buttonToDisplayMs), 50),
    displayP95: percentile(collect(items, i => i.derivedMs.buttonToDisplayMs), 95),
  };
};

export const formatGeometryTestReport = (bundle: GeometryTestBundle): string => {
  const s = summarizeGeometryTest(bundle);
  const fmt = (v: number | null) => (v == null ? 'n/a' : `${Math.round(v)}ms`);
  const lines = [
    `Geometry Test ${s.fixtureId}`,
    `items ${s.itemCount} · manual ${(s.manualCaptureRate * 100).toFixed(0)}% · fail ${(s.failureRate * 100).toFixed(0)}%`,
    `first raw      p50 ${fmt(s.firstRawP50)}  p95 ${fmt(s.firstRawP95)}`,
    `first plausible p50 ${fmt(s.firstPlausibleP50)}  p95 ${fmt(s.firstPlausibleP95)}`,
    `lock           p50 ${fmt(s.lockP50)}  p95 ${fmt(s.lockP95)}`,
    `capture done   p50 ${fmt(s.captureDoneP50)}  p95 ${fmt(s.captureDoneP95)}`,
    `image display  p50 ${fmt(s.displayP50)}  p95 ${fmt(s.displayP95)}`,
    '',
    'Per item:',
  ];
  for (const it of bundle.items) {
    const d = it.derivedMs;
    const firstQuad =
      d.buttonToFirstQuadMs ?? d.buttonToFirstPlausibleMs ?? d.buttonToFirstRawMs;
    const reasonBits = Object.entries(it.captureUnsafeReasonMs ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}:${Math.round(v)}ms`)
      .join(' ');
    lines.push(
      `#${it.itemIndex}` +
        ` quad=${fmt(firstQuad)}` +
        ` q→s=${fmt(d.firstQuadToFirstCaptureSafeMs)}` +
        ` safe=${fmt(d.buttonToFirstCaptureSafeMs)}` +
        ` s→L=${fmt(d.captureSafeToLockMs)}` +
        ` lock=${fmt(
          it.timing.buttonPressedAt != null && it.timing.captureQuadLockedAt != null
            ? it.timing.captureQuadLockedAt - it.timing.buttonPressedAt
            : null,
        )}` +
        ` cap=${fmt(d.buttonToCaptureDoneMs)}` +
        ` disp=${fmt(d.buttonToDisplayMs)}` +
        `${it.manualCapture ? ' MANUAL' : ''}` +
        (it.dominantUnsafeReason ? ` · dom=${it.dominantUnsafeReason}` : '') +
        (reasonBits ? ` · ${reasonBits}` : '') +
        ` · ${it.sourceWidth ?? '?'}x${it.sourceHeight ?? '?'} → ${it.warpWidth ?? '?'}x${it.warpHeight ?? '?'}`,
    );
  }
  return lines.join('\n');
};
