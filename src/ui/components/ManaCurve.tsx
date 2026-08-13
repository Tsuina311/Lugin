import { useMemo } from 'react';

import { manaCurve, type DeckCard } from '@/lib/deck';
import type { CardMetadata } from '@/lib/mtg';

// Tall enough to read at a glance without pushing the card list off screen.
const CHART_HEIGHT = 56;

/**
 * The deck's mana curve as a column chart: one column per mana value, sized
 * against the tallest. Lands are excluded (see `manaCurve`), so the shape shows
 * what the deck actually spends mana on.
 */
export const ManaCurve = ({
  cards,
  metaByKey,
}: {
  cards: DeckCard[];
  metaByKey: Record<string, CardMetadata>;
}) => {
  const curve = useMemo(() => manaCurve(cards, metaByKey), [cards, metaByKey]);

  if (curve.total === 0) {
    return (
      <div className="flex-none border-b border-line px-2 py-1.5 text-2xs text-ink-faint">
        {curve.pending > 0 ? 'Working out the curve…' : 'No spells yet — the curve needs cards.'}
      </div>
    );
  }

  return (
    <div className="flex-none border-b border-line px-2 py-1.5">
      <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {curve.bars.map(bar => {
          const share = Math.round((bar.count / curve.total) * 100);
          return (
            <div
              key={bar.bucket}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-0.5"
              title={`${bar.count} card${bar.count === 1 ? '' : 's'} at mana value ${bar.label} — ${share}% of the deck's spells`}
            >
              <span className="text-2xs leading-none tabular-nums text-ink-muted">
                {bar.count || ''}
              </span>
              {/* The bars grow inside what the labels leave over, so their
                  heights are a share of this row rather than the whole chart. */}
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded-t transition-all ${
                    bar.count > 0 ? 'bg-accent' : 'bg-tint-strong'
                  } ${bar.count === curve.peak ? '' : 'opacity-70'}`}
                  style={{ height: bar.count > 0 ? `${(bar.count / curve.peak) * 100}%` : 2 }}
                />
              </div>
              <span className="text-2xs leading-none tabular-nums text-ink-faint">{bar.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
        <span>
          avg MV{' '}
          <span className="font-medium tabular-nums text-ink-muted">
            {curve.average?.toFixed(2)}
          </span>
        </span>
        <span>· {curve.total} spells</span>
        <span>· {curve.lands} lands</span>
        {curve.pending > 0 && <span>· {curve.pending} still loading</span>}
      </div>
    </div>
  );
};
