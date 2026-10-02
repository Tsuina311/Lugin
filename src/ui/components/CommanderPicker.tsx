// Pick a commander before the deck exists. Scryfall's legal commanders, minus
// the ones with no rules text, as a grid. Most-played first, then whatever
// colors, tags, and rarity the new deck is aiming at.

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from './Button';
import { CollectionThumb } from './CollectionThumb';
import { Popover } from './Popover';
import { COLOR_PIPS } from './colorPips';
import { ChevronLeft, Loader2 } from './icons';

import { commanderQuery, COMMANDER_RARITIES, type CommanderRarity } from '@/lib/commanders';
import { deckTagById, deckTagsByCategory, filterDeckTags } from '@/lib/deckTags';
import { searchScryfallPage, type CardSearchResult } from '@/lib/search';

const IDENTITY_PIPS = COLOR_PIPS.filter(pip => pip.code !== 'C');
const RARITY_LABEL: Record<CommanderRarity, string> = {
  common: 'Common',
  mythic: 'Mythic',
  rare: 'Rare',
  uncommon: 'Uncommon',
};

const toggle = (current: Set<string>, value: string): Set<string> => {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
};

export const CommanderPicker = ({
  cancelLabel = 'Decks',
  onCancel,
  onPick,
  onSkip,
  title = 'Choose a commander',
}: {
  /** What the back button says. A new deck returns to the deck list. */
  cancelLabel?: string;
  onCancel: () => void;
  /** The chosen card's name. The caller puts it in the command zone. */
  onPick: (name: string) => void;
  /** An empty Commander deck, with no commander yet. Left off once a deck exists. */
  onSkip?: () => void;
  title?: string;
}) => {
  const [name, setName] = useState('');
  const [colors, setColors] = useState<Set<string>>(() => new Set());
  const [colorless, setColorless] = useState(false);
  const [rarities, setRarities] = useState<Set<string>>(() => new Set());
  const [tags, setTags] = useState<Set<string>>(() => new Set());
  const [tagSearch, setTagSearch] = useState('');

  const [cards, setCards] = useState<CardSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);

  const query = useMemo(
    () =>
      commanderQuery({
        colorless,
        identity: [...colors],
        name,
        rarities: [...rarities],
        tagIds: [...tags],
      }),
    [colorless, colors, name, rarities, tags],
  );

  useEffect(() => {
    const mine = generation.current + 1;
    generation.current = mine;
    setStatus('loading');
    setError(null);
    const timer = window.setTimeout(() => {
      void searchScryfallPage(query, { order: 'edhrec' })
        .then(page => {
          if (generation.current !== mine) return;
          setCards(page.cards);
          setNext(page.next);
          setTotal(page.total);
          setStatus('idle');
        })
        .catch((reason: unknown) => {
          if (generation.current !== mine) return;
          setCards([]);
          setNext(null);
          setTotal(0);
          setStatus('error');
          setError(reason instanceof Error ? reason.message : 'Scryfall search failed.');
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const more = (): void => {
    if (!next || status === 'loading') return;
    const mine = generation.current;
    const pageUrl = next;
    setStatus('loading');
    void searchScryfallPage(query, { next: pageUrl })
      .then(page => {
        if (generation.current !== mine) return;
        setCards(current => [...current, ...page.cards]);
        setNext(page.next);
        setTotal(page.total);
        setStatus('idle');
      })
      .catch((reason: unknown) => {
        if (generation.current !== mine) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'Scryfall search failed.');
      });
  };

  const pick = (cardName: string): void => {
    if (saving) return;
    setSaving(true);
    onPick(cardName);
  };

  const groupedTags = useMemo(() => deckTagsByCategory(filterDeckTags(tagSearch)), [tagSearch]);
  const selectedTags = useMemo(() => [...tags].sort(), [tags]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-line bg-panel px-1.5 py-1.5">
        <Button className="flex-none pl-1" icon={ChevronLeft} onClick={onCancel} variant="subtle">
          {cancelLabel}
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{title}</span>
        {onSkip && (
          <Button disabled={saving} onClick={onSkip} variant="subtle">
            Empty deck
          </Button>
        )}
      </div>

      <div className="flex-none space-y-1.5 border-b border-line px-2 py-1.5">
        <input
          aria-label="Search commanders"
          className="w-full rounded border border-line-strong bg-raised px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
          onChange={event => setName(event.target.value)}
          placeholder="Search commanders"
          type="search"
          value={name}
        />
        <div className="flex flex-wrap items-center gap-1">
          {IDENTITY_PIPS.map(pip => (
            <button
              key={pip.code}
              className={`h-5 w-5 rounded-full text-[10px] font-bold ${pip.cls} ${
                !colorless && colors.has(pip.code) ? 'ring-2 ring-sky-400' : 'opacity-50'
              }`}
              onClick={() => {
                setColorless(false);
                setColors(current => toggle(current, pip.code));
              }}
              title={`Commanders whose colors fit in ${pip.label}`}
              type="button"
            >
              {pip.label}
            </button>
          ))}
          <button
            className={`h-5 rounded-full bg-slate-400 px-1.5 text-[10px] font-bold text-slate-900 ${
              colorless ? 'ring-2 ring-sky-400' : 'opacity-50'
            }`}
            onClick={() => {
              setColors(new Set());
              setColorless(value => !value);
            }}
            title="Colorless commanders"
            type="button"
          >
            C
          </button>
          <span className="ml-1 text-2xs text-ink-faint">
            {colorless ? 'Colorless' : colors.size > 0 ? 'Fits in these colors' : 'Any colors'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {COMMANDER_RARITIES.map(rarity => (
            <button
              key={rarity}
              className={`rounded-full border px-2 py-0.5 text-2xs font-medium ${
                rarities.has(rarity)
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-line text-ink-muted'
              }`}
              onClick={() => setRarities(current => toggle(current, rarity))}
              title={rarity === 'uncommon' ? 'Pauper commander uses an uncommon commander' : RARITY_LABEL[rarity]}
              type="button"
            >
              {RARITY_LABEL[rarity]}
            </button>
          ))}
          <Popover
            align="left"
            className="w-72"
            label="Commander tags"
            trigger={({ open, toggle: togglePopover }) => (
              <button
                className={`rounded-full border px-2 py-0.5 text-2xs font-medium ${
                  open || tags.size > 0
                    ? 'border-accent/40 bg-accent-soft text-accent'
                    : 'border-line text-ink-muted'
                }`}
                onClick={togglePopover}
                type="button"
              >
                Tags{tags.size > 0 ? ` ${tags.size}` : ''}
              </button>
            )}
          >
            <div className="space-y-1.5 p-1.5">
              <input
                aria-label="Search tags"
                className="w-full rounded border border-line-strong bg-raised px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
                onChange={event => setTagSearch(event.target.value)}
                placeholder="Draw, tokens, elf…"
                type="search"
                value={tagSearch}
              />
              <div className="max-h-64 space-y-2 overflow-auto">
                {groupedTags.map(group => (
                  <div key={group.category}>
                    <div className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                      {group.category}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {group.tags.map(tag => (
                        <button
                          key={tag.id}
                          className={`rounded-full border px-2 py-0.5 text-2xs ${
                            tags.has(tag.id)
                              ? 'border-accent/40 bg-accent-soft text-accent'
                              : 'border-line text-ink-muted'
                          }`}
                          onClick={() => setTags(current => toggle(current, tag.id))}
                          type="button"
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Popover>
        </div>
        {selectedTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selectedTags.map(id => (
              <button
                key={id}
                className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent"
                onClick={() => setTags(current => toggle(current, id))}
                type="button"
              >
                {deckTagById(id)?.label ?? id} ×
              </button>
            ))}
          </div>
        )}
        <p className="text-2xs text-ink-faint">
          {status === 'loading' && cards.length === 0
            ? 'Looking up commanders…'
            : `${total.toLocaleString()} legal commanders with rules text`}
          {status === 'idle' ? ' · most played first' : ''}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {error && <p className="mb-2 text-xs text-neg">{error}</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {cards.map(card => {
            const src = card.imageUrl ?? card.thumbUrl;
            return (
              <div key={card.id} className="flex min-w-0 flex-col gap-1">
                <CollectionThumb
                  candidates={src ? [src] : []}
                  className="card-frame aspect-[488/680] w-full cursor-zoom-in overflow-hidden bg-raised"
                  faceImages={card.faceImages}
                  hover={false}
                  name={card.name}
                  previewKey={`commander|${card.id}`}
                />
                <span className="truncate px-0.5 text-2xs text-ink" title={card.name}>
                  {card.name}
                </span>
                <Button
                  className="w-full"
                  disabled={saving}
                  onClick={() => pick(card.name)}
                  size="xs"
                  variant="neutral"
                >
                  Select
                </Button>
              </div>
            );
          })}
        </div>
        {status === 'loading' && cards.length > 0 && (
          <div className="mt-2 flex items-center justify-center gap-1 text-2xs text-ink-faint">
            <Loader2 aria-hidden className="animate-spin" size={12} />
            Loading…
          </div>
        )}
        {next && status !== 'loading' && (
          <div className="mt-2 flex justify-center">
            <Button onClick={more} variant="neutral">
              Show more
            </Button>
          </div>
        )}
        {status === 'idle' && cards.length === 0 && !error && (
          <p className="py-6 text-center text-xs text-ink-muted">No commanders match.</p>
        )}
      </div>
    </div>
  );
};
