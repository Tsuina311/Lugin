import { useEffect, useRef, useState } from 'react';

import { SearchInput } from './Field';
import { CircleAlert, ExternalLink, Loader2 } from './icons';

import { askForLogin, ajaxToken } from '@/content/session';
import { searchProducts, type ProductSuggestion } from '@/sites/cardmarket/search';
import { MIN_SEARCH_LENGTH } from '@/sites/cardmarket/searchArgs';
import { currentLang } from '@/sites/cardmarket/wants';

/**
 * Long enough that a normal typist finishes a word first, short enough that
 * pausing to think already shows results. Cardmarket's own box uses about this.
 */
const DEBOUNCE_MS = 250;

/** Search Cardmarket's catalogue and pick one printing out of the results. */
export const CardSearch = ({
  busy = false,
  onPick,
}: {
  /** True while the picked printing's offers are loading. */
  busy?: boolean;
  onPick: (suggestion: ProductSuggestion) => void;
}) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle');
  /** Null while the failure is the one we can name precisely: no session. */
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  // Answers can overtake each other — the user types on while a request is out.
  // Only the newest one is allowed to land, or a slow "abr" would overwrite the
  // results for "abrupt" a moment after they appeared.
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      latest.current++;
      setSuggestions([]);
      setStatus('idle');
      setError(null);
      return;
    }
    setStatus('searching');
    const timer = setTimeout(() => {
      const seq = ++latest.current;
      const fail = (message: string | null) => {
        setSuggestions([]);
        setError(message);
        setStatus('error');
        setOpen(true);
      };
      void (async () => {
        // Asked for here rather than left to `searchProducts`, so the search can
        // borrow one from another page: most of Cardmarket carries no token, and
        // reading only the page in front of us broke the box nearly everywhere.
        const token = await ajaxToken();
        if (seq !== latest.current) return;
        if (!token) {
          fail(null);
          return;
        }
        const reply = await searchProducts(term, { token });
        if (seq !== latest.current) return;
        setSuggestions(reply.suggestions);
        setHighlighted(0);
        setStatus('idle');
        setError(null);
        setOpen(true);
      })().catch((err: unknown) => {
        if (seq !== latest.current) return;
        fail(err instanceof Error ? err.message : String(err));
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const pick = (suggestion: ProductSuggestion) => {
    setOpen(false);
    onPick(suggestion);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHighlighted(i => (i + step + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = suggestions[highlighted];
      if (chosen) pick(chosen);
    }
  };

  const showAll = `/${currentLang()}/Magic/Products/Search?searchString=${encodeURIComponent(query.trim())}`;

  return (
    <div className="relative border-b border-line bg-panel px-2 py-1.5">
      <SearchInput
        aria-label="Search Cardmarket for a card"
        onBlur={() => setOpen(false)}
        onChange={e => setQuery(e.target.value)}
        onClear={() => setQuery('')}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search Cardmarket for a card…"
        trailing={
          status === 'searching' || busy ? (
            <Loader2 aria-hidden className="mr-1 animate-spin text-ink-faint" size={12} />
          ) : null
        }
        value={query}
      />

      {open && (status === 'error' || suggestions.length > 0) && (
        // Floats over the results rather than pushing them down, so the list you
        // are searching from stays where it was when the dropdown closes.
        <div className="absolute inset-x-2 top-full z-20 max-h-80 overflow-auto rounded border border-line-strong bg-raised shadow-pop">
          {status === 'error' ? (
            <div className="flex flex-col gap-1 px-2 py-1.5 text-2xs text-ink-muted">
              {error === null ? (
                <>
                  <span className="text-ink">
                    Could not reach Cardmarket&apos;s search — reload the page and try again.
                  </span>
                  <button
                    className="self-start text-accent hover:underline"
                    onClick={askForLogin}
                    type="button"
                  >
                    Open Cardmarket sign-in
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-1 text-neg">
                  <CircleAlert aria-hidden size={11} />
                  {error}
                </span>
              )}
              <a
                className="flex items-center gap-1 text-accent hover:underline"
                href={showAll}
                rel="noreferrer"
                target="_blank"
              >
                Search on Cardmarket instead
                <ExternalLink aria-hidden size={10} />
              </a>
            </div>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={`${s.href}-${s.productId ?? i}`}
                className={`flex w-full items-baseline gap-2 px-2 py-1 text-left transition-colors ${
                  i === highlighted ? 'bg-tint-strong' : 'hover:bg-tint'
                }`}
                // Pick before the input's blur can close the dropdown underneath
                // the pointer.
                onMouseDown={e => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{s.name}</span>
                <span className="min-w-0 flex-none truncate text-2xs text-ink-faint">
                  {s.expansion}
                </span>
                {s.available != null && (
                  <span
                    className="flex-none text-2xs tabular-nums text-ink-muted"
                    title={`${s.available} offers`}
                  >
                    {s.available}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
