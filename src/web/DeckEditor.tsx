// Building a deck on a phone.
//
// Not a port of the desktop editor, which is a workbench: Scryfall search, mana
// curve, land balancing, EDHREC suggestions. Those want a big screen and a
// sitting-down kind of attention. This is the subset that has to exist wherever
// you are — start a deck, put cards in it, take cards out — so that "new deck"
// isn't a door into a room you can't furnish.
//
// Cards go in as text, which sounds primitive and isn't: the same box takes a
// typed name, a "2 Lightning Bolt" line, and a whole list pasted from Moxfield,
// because it hands the string to `parseDeckList` — the parser the desktop uses
// for the same job. Suggestions merge Scryfall, your collection, and — when a
// commander is set — EDHREC and MTGGoldfish staples, sorted A→Z; cards you
// own are tinted green. Suggested cuts use the same EDHREC play-rate logic as
// the extension when a commander is set.
//
// Pictures in list and box view use the same small thumbnails as Tags — tap to
// enlarge. A deck card is only ever a name, so the picture is looked up in your
// collection first — that way it's the copy you own, right printing and all —
// and only falls back to Scryfall's default printing for cards you don't have.

import { useEffect, useMemo, useState } from 'react';

import { ExportBar } from './ExportBar';
import { syncStore } from './syncStore';

import { candidatesByName, deckCardCandidates } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import type { Collection } from '@/lib/collection';
import {
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  mergeDeckCards,
  parseDeckList,
  withFormat,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckSection,
} from '@/lib/deck';
import { bucketMainByTagSections, type TagSectionBucket } from '@/lib/deckTagSections';
import { deckTagById, deckTagsByCategory, filterDeckTags } from '@/lib/deckTags';
import { fetchEdhrec } from '@/lib/edhrec';
import { deckFile } from '@/lib/export';
import { fetchRemote } from '@/lib/fetchRemote';
import { fetchGoldfishArchetype } from '@/lib/mtggoldfish';
import { sortWubrg } from '@/lib/mtg';
import { searchCards } from '@/lib/search';
import { CollectionThumb } from '@/ui/components/CollectionThumb';
import { CutsPanel } from '@/ui/components/CutsPanel';
import { TagsPanel } from '@/ui/components/TagsPanel';
import { EdhrecPanel } from '@/ui/components/EdhrecPanel';
import { GoldfishPanel } from '@/ui/components/GoldfishPanel';
import { ViewToggle, type ViewShape } from '@/ui/components/ViewToggle';

const SECTIONS: readonly { id: DeckSection; label: string }[] = [
  { id: 'commander', label: 'Commander' },
  { id: 'main', label: 'Main deck' },
  { id: 'sideboard', label: 'Sideboard' },
];

const copies = (deck: Deck, section: DeckSection): number =>
  deck.cards.filter(card => card.section === section).reduce((sum, card) => sum + card.quantity, 0);

const same = (a: DeckCard, b: DeckCard): boolean =>
  a.section === b.section && cardKey(a.name) === cardKey(b.name);

/** How many names to show. A phone dropdown past this is a wall. */
const SUGGESTIONS = 10;

/** Pause before asking Scryfall — collection matches show immediately. */
const SEARCH_DEBOUNCE_MS = 300;

const VIEW_KEY = 'lugin:webDeckView';

const DECK_VIEWS = [
  { id: 'deck', label: 'Overview', title: 'The cards in this deck' },
  { id: 'tags', label: 'Tags', title: 'Find cards by mechanic or theme' },
  { id: 'edhrec', label: 'EDHREC', title: 'Recommended cards for this commander' },
  { id: 'goldfish', label: 'Goldfish', title: 'Most-played cards for this commander' },
  { id: 'cuts', label: 'Cuts', title: 'Cards few other decks play' },
] as const;

type DeckPanel = (typeof DECK_VIEWS)[number]['id'];

const COMMANDER_PANELS = new Set<DeckPanel>(['edhrec', 'goldfish', 'cuts']);

/** Identifies a row across sections, since the same card can sit in two. */
const rowKey = (card: DeckCard): string => `${card.section}:${cardKey(card.name)}`;

const Stepper = ({
  onChange,
  quantity,
}: {
  onChange: (quantity: number) => void;
  quantity: number;
}) => (
  <span className="flex shrink-0 items-center gap-0.5">
    <button
      aria-label="One fewer"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-ink-faint active:bg-raised"
      onClick={() => onChange(quantity - 1)}
      type="button"
    >
      −
    </button>
    <span className="w-6 text-center text-sm font-semibold tabular-nums text-ink">{quantity}</span>
    <button
      aria-label="One more"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-ink-faint active:bg-raised"
      onClick={() => onChange(quantity + 1)}
      type="button"
    >
      +
    </button>
  </span>
);

export const DeckEditor = ({
  collection,
  deck,
  onBack,
}: {
  collection: Collection | null;
  deck: Deck;
  onBack: () => void;
}) => {
  const [name, setName] = useState(deck.name);
  const [adding, setAdding] = useState('');
  const [into, setInto] = useState<DeckSection>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [panel, setPanel] = useState<DeckPanel>('deck');

  useEffect(() => setPanel('deck'), [deck.id]);

  const [view, setView] = useState<ViewShape>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'box' ? 'box' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // a browser refusing storage still gets a working screen, just a forgetful one
    }
  }, [view]);

  const ownedCandidates = useMemo(
    () => (collection ? candidatesByName(collection.cards) : new Map<string, readonly string[]>()),
    [collection],
  );
  const candidatesOf = (cardName: string): readonly string[] =>
    deckCardCandidates(cardName, ownedCandidates);

  const missing = useMemo(
    () => (collection ? deckShortfall(deck.cards, collection.byKey) : []),
    [collection, deck],
  );

  const commanders = useMemo(
    () => deck.cards.filter(card => card.section === 'commander').map(card => card.name),
    [deck.cards],
  );
  const commandersKey = commanders.map(name => cardKey(name)).join('|');
  const commanderRecs = formatInfo(deck.format).commanderZone && commanders.length > 0;
  const [commanderIdentity, setCommanderIdentity] = useState<string[] | undefined>();

  useEffect(() => {
    if (commanders.length === 0) {
      setCommanderIdentity(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      const colors = new Set<string>();
      for (const name of commanders) {
        try {
          const res = await fetchRemote(
            `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
          );
          if (!res.ok) continue;
          const card = JSON.parse(res.body) as { color_identity?: string[] };
          for (const color of card.color_identity ?? []) colors.add(color);
        } catch {
          // One unknown commander shouldn't block the rest.
        }
      }
      if (!cancelled) setCommanderIdentity(colors.size ? sortWubrg([...colors]) : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [commandersKey, commanders]);

  const deckTabs = useMemo(
    () => DECK_VIEWS.filter(tab => tab.id === 'deck' || tab.id === 'tags' || commanderRecs),
    [commanderRecs],
  );
  const collectionByKey = collection?.byKey ?? {};

  useEffect(() => {
    if (!commanderRecs && COMMANDER_PANELS.has(panel)) setPanel('deck');
  }, [commanderRecs, panel]);

  const inDeck = useMemo(() => {
    const map: Record<string, number> = {};
    for (const card of deck.cards) {
      map[cardKey(card.name)] = (map[cardKey(card.name)] ?? 0) + card.quantity;
    }
    return map;
  }, [deck.cards]);

  const tagSectionIds = deck.tagSections ?? [];
  const [tagBuckets, setTagBuckets] = useState<TagSectionBucket[]>([]);
  const [mainRest, setMainRest] = useState<DeckCard[]>([]);
  const [tagBucketsLoading, setTagBucketsLoading] = useState(false);
  const [addingTagSection, setAddingTagSection] = useState(false);
  const [tagPickerQuery, setTagPickerQuery] = useState('');

  useEffect(() => {
    const main = deck.cards.filter(c => c.section === 'main');
    if (tagSectionIds.length === 0) {
      setTagBuckets([]);
      setMainRest(main);
      setTagBucketsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setTagBucketsLoading(true);
    void bucketMainByTagSections(main, tagSectionIds, controller.signal).then(result => {
      if (cancelled) return;
      setTagBuckets(result.buckets);
      setMainRest(result.rest);
      setTagBucketsLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [deck.cards, tagSectionIds.join('|')]);

  const setTagSections = (next: string[]) => {
    void syncStore.updateDeck(deck.id, d => ({ ...d, tagSections: next }));
  };

  const addTagSection = (tagId: string) => {
    if (tagSectionIds.includes(tagId)) return;
    setTagSections([...tagSectionIds, tagId]);
    setAddingTagSection(false);
    setTagPickerQuery('');
  };

  const removeTagSection = (tagId: string) => {
    setTagSections(tagSectionIds.filter(id => id !== tagId));
  };

  const pickerTags = useMemo(() => {
    const filtered = filterDeckTags(tagPickerQuery).filter(t => !tagSectionIds.includes(t.id));
    return deckTagsByCategory(filtered);
  }, [tagPickerQuery, tagSectionIds]);

  const zones = useMemo(
    () => SECTIONS.filter(s => s.id !== 'commander' || formatInfo(deck.format).commanderZone),
    [deck.format],
  );

  const [remote, setRemote] = useState<string[]>([]);
  const [recNames, setRecNames] = useState<string[]>([]);

  useEffect(() => {
    if (!commanderRecs) {
      setRecNames([]);
      return;
    }
    let cancelled = false;
    void Promise.allSettled([fetchEdhrec(commanders), fetchGoldfishArchetype(commanders)]).then(
      ([edhrec, goldfish]) => {
        if (cancelled) return;
        const names: string[] = [];
        if (edhrec.status === 'fulfilled') {
          for (const list of edhrec.value.lists) {
            for (const card of list.cards) names.push(card.name);
          }
        }
        if (goldfish.status === 'fulfilled') {
          for (const category of goldfish.value.categories) {
            for (const card of category.cards) names.push(card.name);
          }
        }
        setRecNames(names);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [commanderRecs, commandersKey, commanders]);

  const needle = adding.trim();
  const canSuggest = needle.length >= 2 && !adding.includes('\n');

  useEffect(() => {
    if (!canSuggest) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchCards({ format: deck.format, text: needle }, SUGGESTIONS)
        .then(resp => {
          if (!cancelled) setRemote(resp.cards.map(c => c.name));
        })
        .catch(() => {
          if (!cancelled) setRemote([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canSuggest, deck.format, needle]);

  // Scryfall, collection, EDHREC and Goldfish — deduped, then sorted A→Z.
  // Owned cards get a green tint in the UI but don't jump to the front.
  const suggestions = useMemo((): { name: string; owned: boolean }[] => {
    if (!canSuggest) return [];
    const key = cardKey(needle);
    const ownedOf = (name: string): boolean => (collection?.byKey[cardKey(name)]?.total ?? 0) > 0;
    const local = collection
      ? Object.values(collection.byKey)
          .filter(row => cardKey(row.name).includes(key))
          .map(row => row.name)
      : [];
    const staple = recNames.filter(name => cardKey(name).includes(key));
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...local, ...remote, ...staple]) {
      const id = cardKey(name);
      if (seen.has(id)) continue;
      seen.add(id);
      names.push(name);
    }
    return names
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, SUGGESTIONS)
      .map(name => ({ name, owned: ownedOf(name) }));
  }, [canSuggest, collection, needle, recNames, remote]);

  const add = (text: string) => {
    const { cards } = parseDeckList(text);
    if (cards.length === 0) return;
    // A pasted list can name its own sections; a typed line can't, so anything
    // the parser defaulted to "main" goes wherever the button says instead.
    const placed = cards.map(card => (card.section === 'main' ? { ...card, section: into } : card));
    void syncStore.updateDeck(deck.id, d => ({ ...d, cards: mergeDeckCards(d.cards, placed) }));
    setAdding('');
  };

  const setQuantity = (card: DeckCard, quantity: number) =>
    void syncStore.updateDeck(deck.id, d => ({
      ...d,
      cards:
        quantity <= 0
          ? d.cards.filter(c => !same(c, card))
          : d.cards.map(c => (same(c, card) ? { ...c, quantity } : c)),
    }));

  const addToMain = (names: string[]) => {
    const placed = names.map(name => ({ name, quantity: 1, section: 'main' as const }));
    void syncStore.updateDeck(deck.id, d => ({ ...d, cards: mergeDeckCards(d.cards, placed) }));
  };

  const cutFromMain = (names: string[]) => {
    const doomed = new Set(names.map(cardKey));
    void syncStore.updateDeck(deck.id, d => ({
      ...d,
      cards: d.cards.filter(
        card => !(card.section === 'main' && doomed.has(cardKey(card.name))),
      ),
    }));
  };

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-2 py-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <button
            className="shrink-0 rounded-md px-2 py-2 text-sm font-medium text-accent"
            onClick={onBack}
            type="button"
          >
            ‹ Decks
          </button>
          <input
            aria-label="Deck name"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-2 text-sm font-semibold text-ink focus:border-line-strong"
            onBlur={() => void syncStore.updateDeck(deck.id, d => ({ ...d, name: name.trim() || d.name }))}
            onChange={event => setName(event.target.value)}
            value={name}
          />
        </div>
        <div className="mt-1 flex items-center gap-2 px-2">
          <select
            aria-label="Deck format"
            className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-xs text-ink"
            onChange={event =>
              void syncStore.updateDeck(deck.id, d =>
                withFormat(d, event.target.value as DeckFormat),
              )
            }
            value={deck.format}
          >
            {DECK_FORMATS.map(format => (
              <option key={format.id} value={format.id}>
                {format.label}
              </option>
            ))}
          </select>
          <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-ink-faint">
            {copies(deck, 'main') + copies(deck, 'commander')}
            {formatInfo(deck.format).targetSize ? `/${formatInfo(deck.format).targetSize}` : ''}{' '}
            cards
          </span>
          {deck.cards.length > 0 ? <ViewToggle onChange={setView} size="md" value={view} /> : null}
          {/* Two taps, like the desktop's Clear: a deck is somebody's evening,
              and there is no undo for it on this device. */}
          <button
            className={`rounded-md px-2 py-1.5 text-xs font-medium ${
              confirmDelete ? 'bg-neg-soft text-neg' : 'text-ink-faint'
            }`}
            onBlur={() => setConfirmDelete(false)}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void syncStore.removeDeck(deck.id);
              onBack();
            }}
            type="button"
          >
            {confirmDelete ? 'Delete for good?' : 'Delete'}
          </button>
        </div>
        {formatInfo(deck.format).commanderZone && commanders.length === 0 ? (
          <p className="mt-1 px-2 text-[11px] text-ink-faint">
            Add a commander to unlock EDHREC, Goldfish and cut suggestions.
          </p>
        ) : null}
        {deckTabs.length > 1 ? (
          <div
            className="mt-2 flex gap-1 overflow-x-auto px-2 pb-1"
            role="tablist"
          >
            {deckTabs.map(tab => (
              <button
                key={tab.id}
                aria-selected={panel === tab.id}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                  panel === tab.id ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-faint'
                }`}
                onClick={() => setPanel(tab.id)}
                role="tab"
                title={tab.title}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {panel === 'tags' ? (
        <TagsPanel
          collectionByKey={collectionByKey}
          commanderIdentity={commanderIdentity}
          deckFormat={deck.format}
          inDeck={inDeck}
          onAdd={addToMain}
        />
      ) : panel === 'edhrec' ? (
        <EdhrecPanel
          collectionByKey={collectionByKey}
          commanderNames={commanders}
          inDeck={inDeck}
          onAdd={addToMain}
        />
      ) : panel === 'goldfish' ? (
        <GoldfishPanel
          collectionByKey={collectionByKey}
          commanderNames={commanders}
          inDeck={inDeck}
          onAdd={addToMain}
        />
      ) : panel === 'cuts' ? (
        <CutsPanel
          cards={deck.cards}
          commanderNames={commanders}
          metaByKey={{}}
          onCut={cutFromMain}
        />
      ) : (
        <>
      {/* Adding sits above the cards: it's what this screen is for, and hunting
          for it under a hundred rows would be absurd on a phone. */}
      <section className="border-b border-line px-4 py-3">
        {zones.length > 1 ? (
          <div className="mb-2 flex gap-1">
            {zones.map(zone => (
              <button
                key={zone.id}
                aria-pressed={into === zone.id}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  into === zone.id ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-faint'
                }`}
                onClick={() => setInto(zone.id)}
                type="button"
              >
                {zone.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            aria-label="Card to add"
            autoCapitalize="words"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
            onChange={event => setAdding(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') add(adding);
            }}
            placeholder="Add a card, or paste a list"
            value={adding}
          />
          <button
            className="shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
            disabled={!adding.trim()}
            onClick={() => add(adding)}
            type="button"
          >
            Add
          </button>
        </div>
        {suggestions.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map(suggestion => (
              <li key={suggestion.name}>
                <button
                  className={`rounded-full border px-2.5 py-1 text-xs active:bg-raised ${
                    suggestion.owned
                      ? 'border-pos/40 bg-pos-soft text-pos'
                      : 'border-line-strong text-ink-muted'
                  }`}
                  onClick={() => add(suggestion.name)}
                  type="button"
                >
                  {suggestion.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex items-center gap-3 border-b border-line px-4 py-3">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-faint">
          Copy the list to paste into ManaBox, Moxfield or Archidekt — all three import a deck as
          text.
        </p>
        <ExportBar actions={['copy', 'save', 'share']} file={() => deckFile(deck)} />
      </section>

      {deck.cards.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          Nothing in this deck yet. Add cards above, or paste a list you already have.
        </p>
      ) : null}

      {deck.cards.length > 0 ? (
        <section className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-faint">
              Tag sections auto-sort main-deck cards (first match wins).
            </p>
            <button
              className="shrink-0 rounded-lg bg-raised px-2.5 py-1.5 text-xs font-medium text-ink active:bg-tint"
              onClick={() => setAddingTagSection(v => !v)}
              type="button"
            >
              {addingTagSection ? 'Done' : '+ Tag section'}
            </button>
          </div>
          {tagSectionIds.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {tagSectionIds.map(id => (
                <li key={id}>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel px-2 py-0.5 text-[11px] text-ink">
                    {deckTagById(id)?.label ?? id}
                    <button
                      aria-label={`Remove ${deckTagById(id)?.label ?? id} section`}
                      className="text-ink-faint"
                      onClick={() => removeTagSection(id)}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {addingTagSection ? (
            <div className="mt-2 rounded-lg border border-line bg-raised p-2">
              <input
                aria-label="Search tags"
                className="mb-2 w-full rounded-md border border-line-strong bg-panel px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                onChange={e => setTagPickerQuery(e.target.value)}
                placeholder="Search tags…"
                value={tagPickerQuery}
              />
              <div className="max-h-48 overflow-auto">
                {pickerTags.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-ink-faint">No matching tags left to add.</p>
                ) : (
                  pickerTags.map(group => (
                    <div key={group.category} className="mb-2">
                      <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                        {group.category}
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {group.tags.map(tag => (
                          <li key={tag.id}>
                            <button
                              className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-ink-muted active:bg-panel"
                              onClick={() => addTagSection(tag.id)}
                              type="button"
                            >
                              {tag.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
          {tagBucketsLoading ? (
            <p className="mt-2 text-[11px] text-ink-faint">Sorting cards into tag sections…</p>
          ) : null}
        </section>
      ) : null}

      {(() => {
        const renderCardList = (cards: DeckCard[]) =>
          view === 'box' ? (
            <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
              {cards.map(card => (
                <div key={rowKey(card)} className="flex flex-col gap-1">
                  <CollectionThumb
                    candidates={candidatesOf(card.name)}
                    className="aspect-[488/680] w-full overflow-hidden rounded-lg bg-raised"
                    imgStyle={{ objectPosition: '50% 17%' }}
                    name={card.name}
                    previewKey={`deck|box|${deck.id}|${rowKey(card)}`}
                  />
                  <span className="truncate text-xs text-ink" title={card.name}>
                    {card.name}
                  </span>
                  <Stepper
                    onChange={quantity => setQuantity(card, quantity)}
                    quantity={card.quantity}
                  />
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {cards.map(card => {
                const key = rowKey(card);
                return (
                  <li key={key} className="flex items-center gap-2 px-2 py-1">
                    <CollectionThumb
                      candidates={candidatesOf(card.name)}
                      name={card.name}
                      previewKey={`deck|list|${deck.id}|${key}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{card.name}</span>
                    <Stepper
                      onChange={quantity => setQuantity(card, quantity)}
                      quantity={card.quantity}
                    />
                    <button
                      aria-label={`Remove ${card.name}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-faint active:bg-raised"
                      onClick={() => setQuantity(card, 0)}
                      type="button"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          );

        const qty = (cards: DeckCard[]) => cards.reduce((sum, c) => sum + c.quantity, 0);

        const overviewBlocks: { key: string; label: string; cards: DeckCard[]; removable?: string }[] =
          [];
        const commanders = deck.cards.filter(c => c.section === 'commander');
        if (commanders.length > 0) {
          overviewBlocks.push({ key: 'commander', label: 'Commander', cards: commanders });
        }
        for (const bucket of tagBuckets) {
          if (bucket.cards.length === 0 && !tagBucketsLoading) continue;
          overviewBlocks.push({
            key: `tag:${bucket.tagId}`,
            label: bucket.label,
            cards: bucket.cards,
            removable: bucket.tagId,
          });
        }
        if (mainRest.length > 0 || (tagSectionIds.length === 0 && deck.cards.some(c => c.section === 'main'))) {
          const main =
            tagSectionIds.length === 0
              ? deck.cards.filter(c => c.section === 'main')
              : mainRest;
          if (main.length > 0) {
            overviewBlocks.push({ key: 'main', label: 'Main deck', cards: main });
          }
        }
        const side = deck.cards.filter(c => c.section === 'sideboard');
        if (side.length > 0) {
          overviewBlocks.push({ key: 'sideboard', label: 'Sideboard', cards: side });
        }

        return overviewBlocks.map(block => (
          <section key={block.key}>
            <h2 className="flex items-center gap-2 bg-panel px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <span className="min-w-0 flex-1 truncate">
                {block.label}
                <span className="ml-2 tabular-nums opacity-70">{qty(block.cards)}</span>
              </span>
              {block.removable ? (
                <button
                  aria-label={`Remove ${block.label} section`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-ink-faint active:bg-raised"
                  onClick={() => removeTagSection(block.removable!)}
                  type="button"
                >
                  Remove section
                </button>
              ) : null}
            </h2>
            {block.cards.length > 0 ? renderCardList(block.cards) : null}
          </section>
        ));
      })()}

      {collection && deck.cards.length > 0 ? (
        <section className="border-t border-line px-4 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {missing.length === 0 ? 'Nothing missing' : `Missing ${missing.length}`}
          </h2>
          {missing.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">You own every non-basic card in this deck.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {missing.map(card => (
                <li key={card.name} className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{card.name}</span>
                  {card.owned > 0 ? (
                    <span className="shrink-0 text-[11px] text-ink-faint">have {card.owned}</span>
                  ) : null}
                  <span className="shrink-0 font-semibold tabular-nums text-neg">×{card.need}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
        </>
      )}
    </div>
  );
};
