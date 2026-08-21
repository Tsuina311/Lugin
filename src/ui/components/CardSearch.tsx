import { useEffect, useRef, useState } from 'react';

import { SearchInput } from './Field';
import { Loader2 } from './icons';

import { MIN_SEARCH_LENGTH } from '@/sites/cardmarket/searchArgs';

/**
 * Long enough that a normal typist finishes a word first, short enough that
 * pausing to think already shows results.
 */
const DEBOUNCE_MS = 400;

/**
 * Search Cardmarket's catalogue from Lugin.
 *
 * Enter (or a short pause while typing) asks the parent to load Search 2.0
 * results into the panel — the same page Cardmarket shows when you press Enter
 * in its header box — instead of navigating the tab away.
 */
export const CardSearch = ({
  busy = false,
  onSearch,
  seed = null,
}: {
  /** True while catalogue results or a product's offers are loading. */
  busy?: boolean;
  onSearch: (term: string) => void;
  /** When set (e.g. from a want-list click), fill the box with this term. */
  seed?: { id: number; term: string } | null;
}) => {
  const [query, setQuery] = useState('');
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seedSeen = useRef(0);

  useEffect(() => {
    if (!seed || seed.id === seedSeen.current) return;
    seedSeen.current = seed.id;
    if (timer.current) clearTimeout(timer.current);
    latest.current++;
    setQuery(seed.term);
  }, [seed]);

  const submit = (raw: string) => {
    const term = raw.trim();
    if (term.length < MIN_SEARCH_LENGTH) return;
    latest.current++;
    onSearch(term);
  };

  const onChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      latest.current++;
      return;
    }
    const seq = ++latest.current;
    timer.current = setTimeout(() => {
      if (seq !== latest.current) return;
      onSearch(term);
    }, DEBOUNCE_MS);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (timer.current) clearTimeout(timer.current);
      submit(query);
    }
  };

  return (
    <div className="relative border-b border-line bg-panel px-2 py-1.5">
      <SearchInput
        aria-label="Search Cardmarket for a card"
        onChange={e => onChange(e.target.value)}
        onClear={() => {
          if (timer.current) clearTimeout(timer.current);
          latest.current++;
          setQuery('');
        }}
        onKeyDown={onKeyDown}
        placeholder="Search Cardmarket for a card…"
        trailing={
          busy ? <Loader2 aria-hidden className="mr-1 animate-spin text-ink-faint" size={12} /> : null
        }
        value={query}
      />
    </div>
  );
};
