// Does the daily price table agree with Cardmarket's own trend? (dev only)
//
// This exists to answer one question before acting on it: the snapshot values a
// whole collection for free, and if its numbers track Cardmarket's Price Trend
// then the per-card page fetch behind "Load prices" is buying with minutes
// something we already have. But Scryfall documents `eur` only as "daily price
// information" — not whether that is Cardmarket's trend, its low, or an average.
// Guessing wrong in the optimistic direction would be worse than being slow: a
// reference price that sits below trend makes every bad offer look green.
//
// So this samples cards you actually own, fetches Cardmarket's trend for that
// exact printing, and reports the spread. Sequential and paced, like every other
// scrape here — it is a measurement, run once, not something the UI depends on.
//
// Deliberately narrow to keep the comparison honest:
//   - non-foil only, because a product page quotes foils separately;
//   - at least 50c, since a 1c rounding difference on a 2c card is noise that
//     would swamp the median;
//   - exact printings only, never a name match, whose price is the cheapest
//     printing by construction and would fake a low bias.
//
// Resolution is by Scryfall's `cardmarket_id` for that set+number, not by
// matching expansion names. Cardmarket's set labels and Scryfall's rarely agree
// word-for-word, and a first pass that tried that got zero resolved of 19.

import { useRef, useState } from 'react';

import { Button } from './Button';

import type { CollectionCard } from '@/lib/collection';
import { requestApi } from '@/lib/messaging';
import { money, priceOf, type PriceSnapshot } from '@/lib/prices';
import {
  currentLang,
  fetchDoc,
  pace,
  parsePriceGuide,
} from '@/sites/cardmarket/wants';

const SAMPLE = 25;
const MIN_CENTS = 50;

/**
 * A Cardmarket price string as a number. Their prices are "1.234,56 €", so
 * dropping everything but digits and the comma gets the decimal right and the
 * thousands separator out of the way at once.
 */
const euros = (text?: string): number | null => {
  if (!text) return null;
  const value = Number.parseFloat(text.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

interface Compared {
  name: string;
  ratio: number;
  set: string;
  snapshot: number;
  trend: number;
}

type MissReason = 'no-cm-id' | 'no-page' | 'no-trend' | 'scryfall';

interface Report {
  compared: Compared[];
  misses: Record<MissReason, number>;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** What the numbers mean for the decision that prompted the measurement. */
const verdict = (rows: Compared[]): string => {
  if (rows.length < 5) return 'Too few resolved to conclude anything — try a larger sample.';
  const mid = median(rows.map(r => r.ratio));
  const close = rows.filter(r => Math.abs(r.ratio - 1) <= 0.1).length / rows.length;
  if (mid >= 0.95 && mid <= 1.05 && close >= 0.7) {
    return 'Tracks trend closely: the snapshot can be the reference price, and the per-card fetch kept for live offers only.';
  }
  if (mid < 0.9) {
    return `Sits ${Math.round((1 - mid) * 100)}% below trend: usable as a floor, but colouring offers against it would flatter bad prices.`;
  }
  if (mid > 1.1) return `Sits ${Math.round((mid - 1) * 100)}% above trend, so it would judge fair offers harshly.`;
  return 'Centred but scattered: fine for a collection total, not for judging a single offer.';
};

const cardmarketIdOf = async (
  card: CollectionCard,
  signal: AbortSignal,
): Promise<number | null> => {
  if (!card.setCode || !card.collectorNumber) return null;
  const url =
    `https://api.scryfall.com/cards/${encodeURIComponent(card.setCode.toLowerCase())}/` +
    `${encodeURIComponent(card.collectorNumber)}`;
  const res = await requestApi({ url });
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) return null;
  const body = JSON.parse(res.body) as { cardmarket_id?: number };
  return typeof body.cardmarket_id === 'number' ? body.cardmarket_id : null;
};

export const PriceCheck = ({
  cards,
  snapshot,
}: {
  cards: readonly CollectionCard[];
  snapshot: PriceSnapshot | null;
}) => {
  const [report, setReport] = useState<Report | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async (): Promise<void> => {
    if (!snapshot) return;
    const controller = new AbortController();
    abort.current = controller;
    setReport(null);

    // Eligible rows, then a shuffle: taking the first 25 would measure whichever
    // binder happens to sort first, and sets differ in how well Cardmarket's
    // naming lines up with Scryfall's.
    const eligible = cards.filter(card => {
      if (card.foil || !card.setName || !card.setCode || !card.collectorNumber) return false;
      const price = priceOf(card, snapshot);
      return price?.exact === true && price.cents >= MIN_CENTS;
    });
    const sample = eligible
      .map(card => ({ card, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, SAMPLE)
      .map(entry => entry.card);

    const compared: Compared[] = [];
    const misses: Record<MissReason, number> = {
      'no-cm-id': 0,
      'no-page': 0,
      'no-trend': 0,
      scryfall: 0,
    };

    try {
      for (const [index, card] of sample.entries()) {
        setProgress(`${index + 1} of ${sample.length}: ${card.name}`);

        let id: number | null = null;
        try {
          id = await cardmarketIdOf(card, controller.signal);
        } catch {
          misses.scryfall += 1;
          continue;
        }
        if (!id) {
          misses['no-cm-id'] += 1;
          await pace(controller.signal);
          continue;
        }

        // Scryfall's id is Cardmarket's idProduct — land on that printing's page
        // and read the trend Cardmarket itself shows, no set-name guesswork.
        try {
          const { doc } = await fetchDoc(
            `/${currentLang()}/Magic/Products?idProduct=${id}`,
            controller.signal,
          );
          const trend = euros(parsePriceGuide(doc).trend);
          const ours = priceOf(card, snapshot)?.cents;
          if (trend && ours) {
            compared.push({
              name: card.name,
              ratio: ours / 100 / trend,
              set: card.setCode ?? '',
              snapshot: ours,
              trend: Math.round(trend * 100),
            });
          } else {
            misses['no-trend'] += 1;
          }
        } catch {
          misses['no-page'] += 1;
        }
        await pace(controller.signal);
      }
      setReport({ compared, misses });
    } catch {
      // Aborted, or the site stopped answering. Whatever was gathered still says
      // something, and half a measurement beats none.
      setReport({ compared, misses });
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const unresolved = (out: Report): number =>
    out.misses['no-cm-id'] + out.misses['no-page'] + out.misses['no-trend'] + out.misses.scryfall;

  const summary = (out: Report): string => {
    const rows = out.compared;
    const missed = unresolved(out);
    const missLine = Object.entries(out.misses)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${reason}=${n}`)
      .join(', ');
    if (rows.length === 0) {
      return `Nothing resolved out of ${missed} sampled${missLine ? ` (${missLine})` : ''}.`;
    }
    const mid = median(rows.map(r => r.ratio));
    const close = rows.filter(r => Math.abs(r.ratio - 1) <= 0.1).length;
    const worst = [...rows].sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1)).slice(0, 5);
    return [
      `Snapshot vs Cardmarket trend — ${rows.length} compared, ${missed} unresolved` +
        (missLine ? ` (${missLine})` : ''),
      `median ratio ${mid.toFixed(2)} · within 10%: ${close} of ${rows.length}`,
      verdict(rows),
      ...worst.map(
        r =>
          `  ${r.name} (${r.set.toUpperCase()}): ours ${money(r.snapshot)} vs trend ${money(
            r.trend,
          )} — ${r.ratio.toFixed(2)}`,
      ),
    ].join('\n');
  };

  return (
    <div className="mt-1 border-t border-slate-800 pt-1 text-[10px] text-slate-400">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">Price agreement (dev)</span>
        {progress ? (
          <>
            <span className="min-w-0 flex-1 truncate text-slate-500">{progress}</span>
            <Button onClick={() => abort.current?.abort()} variant="subtle">
              Stop
            </Button>
          </>
        ) : (
          <Button disabled={!snapshot} onClick={() => void run()} variant="subtle">
            {snapshot ? `Check ${SAMPLE} cards` : 'No price table yet'}
          </Button>
        )}
        {report && !progress ? (
          <Button onClick={() => void navigator.clipboard?.writeText(summary(report))} variant="subtle">
            Copy
          </Button>
        ) : null}
      </div>
      {report && !progress ? (
        <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-400">{summary(report)}</pre>
      ) : null}
    </div>
  );
};
