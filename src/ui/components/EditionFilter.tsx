import { Button } from './Button';
import { Check, CircleAlert } from './icons';

import type { EditionYear } from '@/lib/sets';
import type { SetIndexStatus } from '@/ui/useSetIndex';

/**
 * Pick expansions to filter by, laid out as a timeline.
 *
 * Cardmarket orders its expansion lists alphabetically, which files "Alliances"
 * beside "Alchemy Horizons" and tells you nothing about either. Here the newest
 * year comes first and each year lists its expansions newest-first too, so the
 * control doubles as a view of what appeared when.
 *
 * The options are always derived from the rows on screen, never from the whole
 * catalogue — a collection of thirty sets should offer thirty choices, not the
 * nine hundred Magic has printed.
 */
export const EditionFilter = ({
  onClear,
  onToggle,
  selected,
  status = 'ready',
  years,
}: {
  onClear: () => void;
  onToggle: (key: string) => void;
  selected: ReadonlySet<string>;
  /** Whether the release-date catalogue arrived; see `useSetIndex`. */
  status?: SetIndexStatus;
  years: readonly EditionYear[];
}) => {
  if (years.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-ink-faint">Edition</span>
        {selected.size > 0 && (
          <Button className="ml-auto" onClick={onClear} size="xs" variant="subtle">
            Clear {selected.size}
          </Button>
        )}
      </div>

      {/* Filtering still works without the catalogue — you just get one
          alphabetical pile instead of a timeline. Saying so is the difference
          between a degraded filter and one that looks broken for no reason. */}
      {status === 'failed' && (
        <div className="flex items-center gap-1 text-2xs text-warn">
          <CircleAlert aria-hidden size={11} />
          <span>Release dates unavailable — reload the extension to sort by year.</span>
        </div>
      )}

      <div className="max-h-56 overflow-auto rounded border border-line">
        {years.map(({ count, editions, year }) => (
          <div key={year ?? 'undated'}>
            <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-raised px-1.5 py-0.5 text-2xs font-semibold text-ink-muted">
              {/* Cardmarket sells things Scryfall has never heard of, and a set
                  released this week may predate our weekly copy of the catalogue.
                  Both end up here rather than being dropped from the list. */}
              <span>{year ?? 'Year unknown'}</span>
              <span className="ml-auto font-normal tabular-nums text-ink-faint">{count}</span>
            </div>
            {editions.map(edition => {
              const on = selected.has(edition.key);
              return (
                <button
                  key={edition.key}
                  className={`flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left text-2xs transition-colors ${
                    on ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-tint'
                  }`}
                  onClick={() => onToggle(edition.key)}
                  type="button"
                >
                  <span
                    className={`flex h-3 w-3 flex-none items-center justify-center rounded-sm border ${
                      on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
                    }`}
                  >
                    {on && <Check aria-hidden size={9} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{edition.label}</span>
                  <span className="flex-none tabular-nums text-ink-faint">{edition.count}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
