import type { SwapTestBundle, SwapTestTransition } from './types';

const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');

const geometrySame = (t: SwapTestTransition): boolean =>
  t.previousGeometryTrackId != null &&
  t.newGeometryTrackId != null &&
  t.previousGeometryTrackId === t.newGeometryTrackId;

const sessionChanged = (t: SwapTestTransition): boolean =>
  t.previousCardSessionId != null &&
  t.newCardSessionId != null &&
  t.previousCardSessionId !== t.newCardSessionId;

const focusFresh = (t: SwapTestTransition): boolean =>
  t.focusAttemptAfter != null &&
  t.focusAttemptBefore != null &&
  t.focusAttemptAfter > t.focusAttemptBefore;

const retryFresh = (t: SwapTestTransition): boolean =>
  (t.retryBudgetAfter ?? 0) === 0 && (t.retryBudgetBefore ?? 0) >= 0
    ? (t.retryBudgetBefore ?? 0) > 0 || sessionChanged(t)
    : sessionChanged(t);

export const summarizeSwapTest = (bundle: SwapTestBundle): string => {
  const lines: string[] = [
    `SWAP TEST  ${bundle.fixtureId}`,
    `swaps ${bundle.swaps.length}/${bundle.targetCount}  transitions ${bundle.transitions.length}`,
    '',
  ];
  for (const t of bundle.transitions) {
    const from = bundle.swaps[t.fromIndex];
    const to = bundle.swaps[t.toIndex];
    lines.push(
      `${t.fromSwapId} → ${t.toSwapId}` +
        (from?.expectedLabel || to?.expectedLabel
          ? `  (${from?.expectedLabel ?? '?'} → ${to?.expectedLabel ?? '?'})`
          : ''),
    );
    lines.push(
      `  geometry ${geometrySame(t) ? 'SAME' : 'changed'}` +
        `  ${t.previousGeometryTrackId ?? '—'} → ${t.newGeometryTrackId ?? '—'}`,
    );
    lines.push(
      `  cardSession ${sessionChanged(t) ? 'CHANGED' : 'same'}` +
        `  ${t.previousCardSessionId ?? '—'} → ${t.newCardSessionId ?? '—'}`,
    );
    lines.push(
      `  delta ${t.visualFingerprintDelta == null ? '—' : t.visualFingerprintDelta.toFixed(3)}` +
        `  confirms ${t.visualConfirmCount}` +
        `  band ${t.changeWatchBand ?? '—'}` +
        `  watch ${t.changeWatchState ?? '—'}` +
        `  reset ${t.sessionResetReason ?? '—'}` +
        `  detect ${t.detection}` +
        `  latency ${t.timeToDetectSwapMs == null ? '—' : `${Math.round(t.timeToDetectSwapMs)}ms`}`,
    );
    lines.push(
      `  focus fresh ${focusFresh(t) ? 'yes' : 'no'}` +
        `  (${t.focusAttemptBefore ?? '—'} → ${t.focusAttemptAfter ?? '—'})` +
        `  retry reset ${retryFresh(t) ? 'yes' : 'no'}` +
        `  (${t.retryBudgetBefore ?? '—'} → ${t.retryBudgetAfter ?? '—'})`,
    );
    lines.push(
      `  identity ${t.previousIdentity ?? '—'} → ${t.newIdentity ?? '—'}`,
    );
    lines.push('');
  }

  const sameGeom = bundle.transitions.filter(geometrySame).length;
  const newSession = bundle.transitions.filter(sessionChanged).length;
  const goodSticky = bundle.transitions.filter(t => geometrySame(t) && sessionChanged(t)).length;
  const missed = Math.max(0, bundle.swaps.length - 1 - bundle.transitions.length);
  const falseReset = 0; // host cannot know without same-card control; reported separately if labeled

  lines.push('SUMMARY');
  lines.push(`  transitions: ${bundle.transitions.length}`);
  lines.push(`  geometryTrack stayed same: ${sameGeom}/${bundle.transitions.length} (${pct(sameGeom, bundle.transitions.length)})`);
  lines.push(`  cardSession changed: ${newSession}/${bundle.transitions.length} (${pct(newSession, bundle.transitions.length)})`);
  lines.push(
    `  GOOD sticky-geometry + new-session: ${goodSticky}/${bundle.transitions.length} (${pct(goodSticky, bundle.transitions.length)})`,
  );
  lines.push(`  missed swaps (swaps-1 − transitions): ${missed}`);
  lines.push(`  false session resets: ${falseReset} (use same-card control run to measure)`);
  const latencies = bundle.transitions
    .map(t => t.timeToDetectSwapMs)
    .filter((n): n is number => n != null && Number.isFinite(n));
  if (latencies.length) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    lines.push(`  detect latency mean ${mean.toFixed(0)}ms  p50 ${p50?.toFixed(0) ?? 'n/a'}ms`);
  }
  return lines.join('\n');
};

export const summarizeSwapCorpus = (bundles: readonly SwapTestBundle[]): string => {
  if (!bundles.length) return 'No swap-test bundles in .scan-inbox.';
  return bundles.map(summarizeSwapTest).join('\n\n────────────────\n\n');
};
