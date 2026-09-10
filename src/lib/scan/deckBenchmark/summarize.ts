/** Deck Benchmark host summarization + multiset reconciliation. */

import type { DeckBenchmarkBundle, DeckBenchmarkCardRecord } from './types';

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

export const summarizeDeckBenchmark = (bundle: DeckBenchmarkBundle) => {
  const cards = bundle.cards;
  const identified = cards.filter(c => c.terminal === 'identified');
  const ambiguous = cards.filter(c => c.terminal === 'ambiguous');
  const unidentified = cards.filter(
    c => c.terminal === 'ocr-empty' || c.terminal === 'budget-exhausted' || c.terminal === 'timeout',
  );
  const exact = cards.filter(c => c.matchMethod === 'exact-title');
  const fuzzy = cards.filter(c => c.matchMethod === 'strong-fuzzy');
  const manual = cards.filter(c => c.swapKind === 'manual');
  const auto = cards.filter(c => c.swapKind === 'automatic');
  const totals = cards
    .map(c => c.timings.totalMs)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const lockId = cards
    .map(c => c.timings.lockToIdentityMs)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));

  return {
    fixtureId: bundle.fixtureId,
    total: cards.length,
    target: bundle.targetCount,
    identified: identified.length,
    ambiguous: ambiguous.length,
    unidentified: unidentified.length,
    firstPass: {
      exact: exact.length,
      strongFuzzy: fuzzy.length,
      empty: cards.filter(c => c.matchMethod === 'empty').length,
    },
    session: {
      automaticSwaps: auto.length,
      manualSwaps: manual.length,
      automaticRate: cards.length ? auto.length / cards.length : null,
    },
    latency: {
      totalP50: percentile(totals, 50),
      totalP90: percentile(totals, 90),
      totalP95: percentile(totals, 95),
      lockToIdentityP50: percentile(lockId, 50),
      lockToIdentityP95: percentile(lockId, 95),
    },
  };
};

/** Safe multiset pairing — does not treat "in deck" as correctness alone. */
export const reconcileDeckMultiset = (
  cards: DeckBenchmarkCardRecord[],
  expected: { name: string; quantity: number }[] | null,
) => {
  if (!expected?.length) {
    return {
      mode: 'none' as const,
      paired: [] as Array<{ index: number; predicted: string; expected: string }>,
      unresolved: cards.map(c => ({
        index: c.benchmarkIndex,
        predicted: c.matchName,
        terminal: c.terminal,
        reason: 'no-expected-deck',
      })),
    };
  }
  const pool = new Map<string, number>();
  for (const e of expected) {
    const k = e.name.trim().toLowerCase();
    pool.set(k, (pool.get(k) ?? 0) + Math.max(1, e.quantity));
  }
  const paired: Array<{ index: number; predicted: string; expected: string }> = [];
  const unresolved: Array<{
    index: number;
    predicted: string | null;
    terminal: string;
    reason: string;
  }> = [];

  for (const c of cards) {
    const name = c.matchName?.trim();
    if (!name || c.terminal !== 'identified') {
      unresolved.push({
        index: c.benchmarkIndex,
        predicted: c.matchName,
        terminal: c.terminal,
        reason: c.terminal === 'identified' ? 'missing-name' : c.terminal,
      });
      continue;
    }
    const k = name.toLowerCase();
    const left = pool.get(k) ?? 0;
    if (left > 0) {
      pool.set(k, left - 1);
      paired.push({ index: c.benchmarkIndex, predicted: name, expected: name });
    } else {
      unresolved.push({
        index: c.benchmarkIndex,
        predicted: name,
        terminal: c.terminal,
        reason: 'not-in-expected-remaining',
      });
    }
  }

  const leftover: string[] = [];
  for (const [name, qty] of pool) {
    for (let i = 0; i < qty; i++) leftover.push(name);
  }

  return { mode: 'multiset' as const, paired, unresolved, leftoverExpected: leftover };
};
