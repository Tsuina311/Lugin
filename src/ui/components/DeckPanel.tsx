import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Badge } from './Badge';
import { Button } from './Button';
import { CutsPanel } from './CutsPanel';
import { DeckFromWants } from './DeckFromWants';
import { DeckWantList } from './DeckWantList';
import { EdhrecPanel } from './EdhrecPanel';
import { EmptyState } from './EmptyState';
import { NumberStepper, SearchInput, Select, TextInput } from './Field';
import { GoldfishPanel } from './GoldfishPanel';
import { IconButton } from './IconButton';
import { ManaCurve } from './ManaCurve';
import { SelectionBar } from './Selection';
import { TagsPanel } from './TagsPanel';
import { useCardPreview } from './cardPreview';
import { COLOR_PIPS } from './colorPips';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Filter,
  Layers,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Upload,
  Wand2,
  X,
} from './icons';

import { collectionStore } from '@/content/collectionStore';
import { countCards, deckStore, type DeckCardRef } from '@/content/deckStore';
import { cardKey } from '@/lib/cardName';
import {
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  groupDeckCards,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckSection,
} from '@/lib/deck';
import { basicsMatchPlan, isBasicLand, planBasicLands } from '@/lib/lands';
import { requestScryfall } from '@/lib/messaging';
import {
  allowsSecondCommander,
  canPairCommanders,
  isLandType,
  sortWubrg,
  type CardMetadata,
} from '@/lib/mtg';
import {
  buildScryfallQuery,
  hasSearchCriteria,
  looksLikeSyntax,
  searchCards,
  type CardQuery,
  type CardSearchResponse,
  type CardSearchResult,
} from '@/lib/search';
import { cardmarketSearchUrl } from '@/sites/cardmarket/searchArgs';
import { currentLang } from '@/sites/cardmarket/wants';
import { useCardMetadata } from '@/ui/useCardMetadata';
import { useRowSelection, type RowSelection } from '@/ui/useRowSelection';

// Cardmarket product search for a card the user still needs to buy.
const buyUrl = (name: string): string =>
  `${location.origin}${cardmarketSearchUrl(name, currentLang())}`;

// How the deck list is broken up — remembered across sessions. localStorage can
// throw in locked-down contexts, so every access is guarded.
const SPLIT_TYPE_KEY = 'lugin:deckSplitType';
const SPLIT_COST_KEY = 'lugin:deckSplitCost';

/**
 * Cards we don't hold against your collection. Nobody bothers listing their
 * basics, and they're free to come by anyway, so counting them as missing would
 * make every deck look like a shopping list.
 */
const skipOwnership = (name: string): boolean => isBasicLand(name);

const CURVE_KEY = 'lugin:deckCurve';

const readFlag = (key: string, fallback = false): boolean => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
};

const writeFlag = (key: string, on: boolean): void => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // ignore storage failures
  }
};

export const DeckPanel = () => {
  const { decks, error, loading } = useSyncExternalStore(
    deckStore.subscribe,
    deckStore.getSnapshot,
  );
  const { collection } = useSyncExternalStore(
    collectionStore.subscribe,
    collectionStore.getSnapshot,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(() => decks.find(d => d.id === editingId) ?? null, [decks, editingId]);

  const fileInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);

  const handleUpload = (ev: React.ChangeEvent<HTMLInputElement>, into: 'new' | 'current'): void => {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // allow re-uploading the same file
    if (!file) return;
    void file.text().then(async text => {
      if (into === 'current' && editingId) {
        await deckStore.mergeText(editingId, text);
      } else {
        const id = await deckStore.importText(text, file.name);
        if (id) setEditingId(id);
      }
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-slate-200">
      {editing ? (
        <DeckEditor
          collectionByKey={collection?.byKey ?? {}}
          deck={editing}
          onBack={() => setEditingId(null)}
          onMergeUpload={() => mergeInput.current?.click()}
        />
      ) : (
        <DeckList
          collectionByKey={collection?.byKey ?? {}}
          decks={decks}
          error={error}
          loading={loading}
          onCreate={async format => setEditingId(await deckStore.create('New deck', format))}
          onOpen={setEditingId}
          onUpload={() => fileInput.current?.click()}
        />
      )}

      <input
        ref={fileInput}
        accept=".txt,.dec,.csv,text/plain"
        className="hidden"
        onChange={e => handleUpload(e, 'new')}
        type="file"
      />
      <input
        ref={mergeInput}
        accept=".txt,.dec,.csv,text/plain"
        className="hidden"
        onChange={e => handleUpload(e, 'current')}
        type="file"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Deck list
// ---------------------------------------------------------------------------

interface OwnedIndex {
  [key: string]: { total: number };
}

const DeckList = ({
  collectionByKey,
  decks,
  error,
  loading,
  onCreate,
  onOpen,
  onUpload,
}: {
  collectionByKey: OwnedIndex;
  decks: Deck[];
  error: string | null;
  loading: boolean;
  onCreate: (format: DeckFormat) => void;
  onOpen: (id: string) => void;
  onUpload: () => void;
}) => {
  const [newFormat, setNewFormat] = useState<DeckFormat>('commander');
  const preview = useCardPreview();
  const selection = useRowSelection(decks.map(d => d.id));

  // Every deck's commander(s), so each row can show what it's built around.
  const commandersOf = (deck: Deck): DeckCard[] =>
    deck.cards.filter(c => c.section === 'commander');
  const { metaByKey } = useCardMetadata(decks.flatMap(d => commandersOf(d).map(c => c.name)));

  const needToBuy = (deck: Deck): number =>
    deckShortfall(deck.cards, collectionByKey).reduce((n, m) => n + m.need, 0);

  return (
    <>
      <div className="flex flex-none items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5">
        <Layers aria-hidden className="text-ink-faint" size={14} />
        <span className="text-sm font-semibold text-ink">Decks</span>
        {decks.length > 0 && <Badge>{decks.length}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <Select
            onChange={e => setNewFormat(e.target.value as DeckFormat)}
            title="Format for the new deck"
            value={newFormat}
          >
            {DECK_FORMATS.map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
          <IconButton icon={Upload} label="Upload a decklist file" onClick={onUpload} />
          <Button icon={Plus} onClick={() => onCreate(newFormat)} variant="primary">
            New deck
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 border-b border-line bg-neg-soft px-2 py-1 text-xs text-neg">
          <CircleAlert aria-hidden size={13} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-1.5 text-xs text-ink-faint">
          <Loader2 aria-hidden className="animate-spin" size={13} />
          Loading decks…
        </div>
      ) : decks.length === 0 ? (
        <EmptyState
          action={
            <div className="flex items-center gap-1">
              <Button icon={Plus} onClick={() => onCreate(newFormat)} variant="primary">
                New {formatInfo(newFormat).label} deck
              </Button>
              <Button icon={Upload} onClick={onUpload} variant="neutral">
                Upload
              </Button>
            </div>
          }
          hint="Import an Arena, MTGO or plain-text decklist, or start from a commander and build it card by card."
          icon={Layers}
          title="No decks yet"
        />
      ) : (
        <>
          <SelectionBar selection={selection}>
            <Button
              onClick={() => {
                void deckStore.removeDecks(selection.ids);
                selection.clear();
              }}
              size="xs"
              title="Delete the selected decks"
              variant="danger"
            >
              Delete {selection.count}
            </Button>
          </SelectionBar>
          <ul
            className="list-none divide-y divide-line overflow-auto outline-none"
            {...selection.listProps}
          >
            {decks.map(d => {
              const buy = needToBuy(d);
              const commanders = commandersOf(d);
              return (
                <li
                  key={d.id}
                  onClick={() => onOpen(d.id)}
                  {...selection.rowProps(
                    d.id,
                    'group flex cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-tint',
                  )}
                >
                  <div className="flex flex-none items-center gap-0.5">
                    {commanders.length === 0 ? (
                      <div className="h-9 w-9 rounded bg-slate-800/60" />
                    ) : (
                      commanders.map(c => {
                        const meta = metaByKey[cardKey(c.name)];
                        const faces = meta?.faceImages;
                        const urls =
                          faces && faces.length >= 2
                            ? faces
                            : meta?.imageUrl
                              ? [meta.imageUrl]
                              : [];
                        const { flippable, handlers } = preview(
                          `decklist|${d.id}|${cardKey(c.name)}`,
                          c.name,
                          urls,
                        );
                        return (
                          <div
                            key={c.name}
                            className="h-9 w-9 overflow-hidden rounded bg-slate-800"
                            {...handlers}
                          >
                            {urls[0] && (
                              <img
                                alt={c.name}
                                className={`h-full w-full object-cover ${flippable ? 'cursor-pointer' : ''}`}
                                decoding="async"
                                loading="lazy"
                                src={urls[0]}
                                style={{ objectPosition: '50% 18%' }}
                                title={flippable ? 'Click to flip to the other side' : c.name}
                              />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{d.name}</div>
                    <div className="truncate text-2xs text-ink-faint">
                      {formatInfo(d.format).label} · {countCards(d.cards)} cards
                      {countCards(d.cards, 'sideboard') > 0 &&
                        ` · ${countCards(d.cards, 'sideboard')} SB`}
                      {d.source !== 'manual' && ` · ${d.source}`}
                    </div>
                  </div>
                  {buy > 0 ? (
                    <Badge title={`${buy} cards still to buy`} tone="warn">
                      buy {buy}
                    </Badge>
                  ) : (
                    <Badge title="Every card is in your collection" tone="pos">
                      <Check aria-hidden size={10} strokeWidth={3} />
                    </Badge>
                  )}
                  {/* Destructive, so it stays out of sight until the row is under
                      the pointer (or reached by keyboard). */}
                  <IconButton
                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    icon={Trash2}
                    label={`Delete ${d.name}`}
                    onClick={e => {
                      e.stopPropagation();
                      void deckStore.remove(d.id);
                    }}
                    tone="danger"
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Deck editor
// ---------------------------------------------------------------------------

const SECTION_LABEL: Record<DeckSection, string> = {
  commander: 'Command zone',
  main: 'Main deck',
  sideboard: 'Sideboard',
};

// The editor's panes: the deck itself plus one per recommendation source.
const DECK_VIEWS = [
  { id: 'deck', label: 'Deck', title: 'The cards in this deck' },
  { id: 'tags', label: 'Tags', title: 'Find cards by mechanic or theme' },
  { id: 'edhrec', label: 'EDHREC', title: 'Recommended cards for this commander (EDHREC)' },
  {
    id: 'goldfish',
    label: 'Goldfish',
    title: 'Most-played cards and recent decks for this commander (MTGGoldfish)',
  },
  { id: 'cuts', label: 'Cuts', title: 'Cards in this deck that few other decks play' },
] as const;

type DeckView = (typeof DECK_VIEWS)[number]['id'];

const COMMANDER_VIEWS = new Set<DeckView>(['edhrec', 'goldfish', 'cuts']);

const DeckEditor = ({
  collectionByKey,
  deck,
  onBack,
  onMergeUpload,
}: {
  collectionByKey: OwnedIndex;
  deck: Deck;
  onBack: () => void;
  onMergeUpload: () => void;
}) => {
  const [nameDraft, setNameDraft] = useState(deck.name);
  const [splitType, setSplitType] = useState(() => readFlag(SPLIT_TYPE_KEY));
  const [splitCost, setSplitCost] = useState(() => readFlag(SPLIT_COST_KEY));
  const [showCurve, setShowCurve] = useState(() => readFlag(CURVE_KEY, true));

  useEffect(() => writeFlag(SPLIT_TYPE_KEY, splitType), [splitType]);
  useEffect(() => writeFlag(SPLIT_COST_KEY, splitCost), [splitCost]);
  useEffect(() => writeFlag(CURVE_KEY, showCurve), [showCurve]);

  useEffect(() => setNameDraft(deck.name), [deck.id, deck.name]);

  // Metadata for the deck's cards: images and face info for the hover preview,
  // types and mana values for the grouping, curve and land balancing.
  const names = useMemo(() => deck.cards.map(c => c.name), [deck.cards]);
  const { merge: mergeMeta, metaByKey: metaByName } = useCardMetadata(names);

  const ownedOf = (name: string): number => collectionByKey[cardKey(name)]?.total ?? 0;

  const previewUrls = (name: string): string[] => {
    const meta = metaByName[cardKey(name)];
    if (meta?.faceImages && meta.faceImages.length >= 2) return meta.faceImages;
    return meta?.imageUrl ? [meta.imageUrl] : [];
  };

  const fmt = formatInfo(deck.format);
  const commanders = useMemo(() => deck.cards.filter(c => c.section === 'commander'), [deck.cards]);

  // Whether a second commander can be added. Only offered when the commander's
  // own card says it can take one: the metadata arrives a moment after the card
  // does, and treating "not looked up yet" as a yes offered a partner to every
  // commander. The one exception is a card Scryfall doesn't know, where we can't
  // judge and so don't stand in the way (see `commanderNote`).
  const firstMeta = commanders[0] ? metaByName[cardKey(commanders[0].name)] : undefined;
  const firstCmdInfo = firstMeta?.commander;
  /** The lookup has come back, whatever it said. */
  const firstKnown = firstMeta != null;
  const firstUnrecognized = firstKnown && !firstMeta.found;
  const canAddSecondCommander =
    commanders.length === 1 && (firstUnrecognized || allowsSecondCommander(firstCmdInfo));
  const showCommanderSearch = commanders.length === 0 || canAddSecondCommander;

  // Add a commander. We never block the add (the user knows their cards) — if the
  // pair isn't a legal partner combination we surface a note instead (see
  // `commanderNote`). We still fetch metadata so the note + image can update.
  const addCommander = async (name: string): Promise<void> => {
    let cand: CardMetadata | undefined;
    try {
      [cand] = await requestScryfall([name]);
    } catch {
      // ignore lookup failures — still add what the user typed/picked
    }
    if (cand) mergeMeta([cand]);
    await deckStore.addCard(deck.id, cand?.name ?? name, 'commander', 1);
  };

  // Non-blocking legality feedback for the command zone.
  const commanderNote = useMemo<string | null>(() => {
    if (!fmt.commanderZone) return null;
    if (commanders.length >= 2) {
      const a = metaByName[cardKey(commanders[0].name)]?.commander;
      const b = metaByName[cardKey(commanders[1].name)]?.commander;
      if (a && b && !canPairCommanders(a, commanders[0].name, b, commanders[1].name)) {
        return `${commanders[0].name} and ${commanders[1].name} don’t share a partner ability — not a legal pairing.`;
      }
    }
    if (commanders.length === 1 && firstCmdInfo && !firstCmdInfo.canBeCommander) {
      return firstCmdInfo.pairings.includes('background')
        ? 'A Background can’t be your only commander — pair it with a “Choose a Background” creature.'
        : `${commanders[0].name} isn’t normally a legal commander on its own.`;
    }
    if (commanders.length === 1 && firstMeta && !firstMeta.found) {
      return `Scryfall doesn’t recognize “${commanders[0].name}”, so its partner rules are anyone’s guess — check the spelling.`;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanders, metaByName, fmt.commanderZone]);

  // Everything the deck is short of, for the want-list builder below.
  const missing = useMemo(
    () => deckShortfall(deck.cards, collectionByKey),
    [deck.cards, collectionByKey],
  );
  const [wantListOpen, setWantListOpen] = useState(false);
  useEffect(() => setWantListOpen(false), [deck.id]);

  // Totals for the header summary. Basics count as covered rather than dropping
  // out of the maths, so owned + to buy still adds up to the deck size.
  const summary = useMemo(() => {
    const total = countCards(deck.cards);
    const toBuy = missing.reduce((n, m) => n + m.need, 0);
    return { owned: total - toBuy, toBuy, total };
  }, [deck.cards, missing]);

  // The deck itself vs. suggestions for the current commander(s).
  const [view, setView] = useState<DeckView>('deck');
  useEffect(() => setView('deck'), [deck.id]);
  const showSuggestions = fmt.commanderZone && commanders.length > 0;
  const visibleViews = useMemo(
    () => DECK_VIEWS.filter(v => v.id === 'deck' || v.id === 'tags' || showSuggestions),
    [showSuggestions],
  );
  useEffect(() => {
    if (!showSuggestions && COMMANDER_VIEWS.has(view)) setView('deck');
  }, [showSuggestions, view]);

  // The commander's colour identity, which bounds what's legal in the deck —
  // used to preselect the card search's identity filter. Undefined until every
  // commander's metadata has loaded, so the filter isn't seeded with a
  // half-known identity.
  const commanderIdentity = useMemo(() => {
    if (!fmt.commanderZone || commanders.length === 0) return undefined;
    const colors = new Set<string>();
    for (const c of commanders) {
      const meta = metaByName[cardKey(c.name)];
      if (!meta?.found) return undefined;
      for (const color of meta.colorIdentity) colors.add(color);
    }
    return sortWubrg([...colors]);
  }, [commanders, metaByName, fmt.commanderZone]);

  // Colors the auto-balancer draws basics from: the commander's identity in
  // Commander, otherwise whatever the deck's own cards need.
  const landColors = useMemo(() => {
    if (commanderIdentity) return commanderIdentity;
    const colors = new Set<string>();
    for (const c of deck.cards) {
      if (c.section === 'sideboard') continue;
      for (const color of metaByName[cardKey(c.name)]?.colorIdentity ?? []) colors.add(color);
    }
    return sortWubrg([...colors]);
  }, [commanderIdentity, deck.cards, metaByName]);

  // Lands this deck should run: its own setting, else the format's convention.
  const landTarget = deck.landTarget ?? fmt.landCount;

  // Lands in the main deck right now, split into the basics we manage and the
  // ones the user chose (which count towards the same target).
  const landCounts = useMemo(() => {
    let basics = 0;
    let chosen = 0;
    for (const c of deck.cards) {
      if (c.section === 'sideboard') continue;
      if (isBasicLand(c.name)) basics += c.quantity;
      else if (isLandType(metaByName[cardKey(c.name)])) chosen += c.quantity;
    }
    return { basics, chosen, total: basics + chosen };
  }, [deck.cards, metaByName]);

  // How the basics should be split right now. Null while it can't be trusted:
  // auto-balancing off, no land target, or metadata still loading (an unresolved
  // card might turn out to be a land, which would change the count).
  const landPlan = useMemo(() => {
    // A target of 0 is meaningful (strip the basics); only "no target" bails.
    if (!deck.autoLands || landTarget == null) return null;
    const pending = deck.cards.some(
      c => c.section !== 'sideboard' && !isBasicLand(c.name) && !metaByName[cardKey(c.name)],
    );
    if (pending) return null;
    return planBasicLands({
      cards: deck.cards,
      colors: landColors,
      landTarget,
      metaByKey: metaByName,
    });
  }, [deck.autoLands, deck.cards, landTarget, landColors, metaByName]);

  // Apply the plan after any change to the deck. Writing converges (the next
  // pass finds the basics already matching), so this doesn't loop.
  useEffect(() => {
    if (!landPlan || basicsMatchPlan(deck.cards, landPlan)) return;
    void deckStore.setBasicLands(deck.id, landPlan);
  }, [landPlan, deck.cards, deck.id]);

  // cardKey -> copies already in the deck, so suggestions can mark what's in.
  const inDeck = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of deck.cards) map[cardKey(c.name)] = (map[cardKey(c.name)] ?? 0) + c.quantity;
    return map;
  }, [deck.cards]);

  const sections: DeckSection[] = ['main', 'sideboard'];

  // The main and sideboard rows exactly as they'll be laid out: sorted, then
  // grouped if the split checkboxes are on. Doing it here rather than inline in
  // the JSX gives the selection the rows in the order they appear on screen,
  // which is the order its ranges and arrow keys follow.
  const layout = useMemo(
    () =>
      sections
        .map(section => {
          const cards = deck.cards
            .filter(c => c.section === section)
            .sort((a, b) => a.name.localeCompare(b.name));
          return {
            cards,
            groups: groupDeckCards(cards, metaByName, { cost: splitCost, type: splitType }),
            section,
          };
        })
        .filter(s => s.cards.length > 0),
    // `sections` is a constant literal, so it isn't a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deck.cards, metaByName, splitCost, splitType],
  );

  const rows = useMemo(() => {
    const ids: string[] = [];
    const byId = new Map<string, DeckCardRef>();
    for (const { groups, section } of layout) {
      for (const group of groups) {
        for (const part of group.sub ?? [group]) {
          for (const c of part.cards) {
            const id = `${section}|${cardKey(c.name)}`;
            ids.push(id);
            byId.set(id, { name: c.name, section });
          }
        }
      }
    }
    return { byId, ids };
  }, [layout]);

  const selection = useRowSelection(rows.ids);
  const selectedCards = selection.ids
    .map(id => rows.byId.get(id))
    .filter((r): r is DeckCardRef => !!r);
  const movable = (to: DeckSection): DeckCardRef[] => selectedCards.filter(c => c.section !== to);

  return (
    <>
      <div className="flex flex-none items-center gap-1 border-b border-line bg-panel px-2 py-1.5">
        <IconButton icon={ArrowLeft} label="Back to all decks" onClick={onBack} />
        <TextInput
          className="min-w-0 flex-1 border-transparent bg-transparent text-base font-semibold hover:border-line-strong"
          onBlur={() => void deckStore.rename(deck.id, nameDraft)}
          onChange={e => setNameDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          title="Deck name"
          value={nameDraft}
        />
        <Select
          onChange={e => void deckStore.setFormat(deck.id, e.target.value as DeckFormat)}
          title="Deck format"
          value={deck.format}
        >
          {DECK_FORMATS.map(f => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
        <IconButton icon={Upload} label="Import a list into this deck" onClick={onMergeUpload} />
      </div>

      {/* Where the deck stands: size against the format, and what it costs you. */}
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line px-2 py-1 text-xs">
        <span className="tabular-nums text-ink-muted">
          <span className="font-semibold text-ink">{summary.total}</span>
          {fmt.targetSize ? `/${fmt.targetSize}` : ''} cards
        </span>
        <Badge title="Cards you already own" tone="pos">
          {summary.owned} owned
        </Badge>
        {summary.toBuy > 0 ? (
          <>
            <Badge title="Cards missing from your collection" tone="warn">
              {summary.toBuy} to buy
            </Badge>
            <Button
              active={wantListOpen}
              icon={ShoppingCart}
              onClick={() => setWantListOpen(o => !o)}
              size="xs"
              title="Put the cards you're missing on a Cardmarket want list"
            >
              Want list
            </Button>
          </>
        ) : (
          summary.total > 0 && <Badge tone="pos">complete</Badge>
        )}
      </div>
      {visibleViews.length > 1 && (
        <div
          className="flex flex-none overflow-x-auto border-b border-line"
          role="group"
        >
          {visibleViews.map(v => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              className={`flex-none px-2.5 py-1 text-2xs font-medium transition-colors ${
                view === v.id
                  ? 'border-b-2 border-accent bg-accent-soft text-accent'
                  : 'text-ink-faint hover:bg-tint hover:text-ink'
              }`}
              onClick={() => setView(v.id)}
              title={v.title}
              type="button"
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {wantListOpen && (
        <DeckWantList deck={deck} missing={missing} onClose={() => setWantListOpen(false)} />
      )}

      {fmt.commanderZone && (
        <div className="flex-none border-b border-line bg-warn-soft">
          <div className="flex items-center gap-1.5 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-warn">
            <span aria-hidden>♛</span>
            {SECTION_LABEL.commander}
            <span className="font-normal tabular-nums opacity-70">
              {commanders.length}/{canAddSecondCommander || commanders.length === 2 ? 2 : 1}
            </span>
          </div>
          {commanders.length > 0 ? (
            <ul className="list-none divide-y divide-line">
              {commanders.map(c => (
                <DeckRow
                  key={`commander|${cardKey(c.name)}`}
                  card={c}
                  commander
                  deckId={deck.id}
                  owned={ownedOf(c.name)}
                  urls={previewUrls(c.name)}
                />
              ))}
            </ul>
          ) : (
            <div className="px-2 py-1 text-2xs text-ink-faint">
              Pick your commander — a legendary creature (or a card that says “can be your
              commander”).
            </div>
          )}
          {showCommanderSearch && (
            <AddCardBox
              deckFormat={deck.format}
              inDeck={inDeck}
              onPick={name => void addCommander(name)}
              placeholder={
                commanders.length === 0 ? 'Search for your commander…' : 'Add a second commander…'
              }
            />
          )}
          {commanderNote && (
            <div className="flex items-start gap-1 px-2 pb-1 text-2xs text-warn">
              <CircleAlert aria-hidden className="mt-px flex-none" size={11} />
              {commanderNote}
            </div>
          )}
          {commanders.length === 1 && firstKnown && !canAddSecondCommander && (
            <div className="px-2 pb-1 text-2xs text-ink-faint">
              This commander can’t take a partner.
            </div>
          )}
        </div>
      )}

      {view !== 'deck' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {view === 'tags' ? (
            <TagsPanel
              collectionByKey={collectionByKey}
              commanderIdentity={commanderIdentity}
              deckFormat={deck.format}
              inDeck={inDeck}
              onAdd={names => void deckStore.addCards(deck.id, names, 'main')}
            />
          ) : view === 'edhrec' ? (
            <EdhrecPanel
              collectionByKey={collectionByKey}
              commanderNames={commanders.map(c => c.name)}
              inDeck={inDeck}
              onAdd={names => void deckStore.addCards(deck.id, names, 'main')}
            />
          ) : view === 'goldfish' ? (
            <GoldfishPanel
              collectionByKey={collectionByKey}
              commanderNames={commanders.map(c => c.name)}
              inDeck={inDeck}
              onAdd={names => void deckStore.addCards(deck.id, names, 'main')}
            />
          ) : (
            <CutsPanel
              cards={deck.cards}
              commanderNames={commanders.map(c => c.name)}
              metaByKey={metaByName}
              onCut={names =>
                void deckStore.removeCards(
                  deck.id,
                  names.map(name => ({ name, section: 'main' as const })),
                )
              }
            />
          )}
        </div>
      ) : (
        <>
          <AddCardBox
            commanderIdentity={commanderIdentity}
            deckFormat={deck.format}
            filters
            inDeck={inDeck}
            onPick={name => void deckStore.addCard(deck.id, name, 'main', 1)}
            onPickMany={names => void deckStore.addCards(deck.id, names, 'main')}
            placeholder="Add a card — name, or t:wolf, mv<3…"
          />

          <DeckFromWants
            inDeck={inDeck}
            onAdd={names => void deckStore.addCards(deck.id, names, 'main')}
          />

          {landTarget != null && (
            <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line px-2 py-1 text-2xs">
              <Button
                active={!!deck.autoLands}
                icon={Wand2}
                onClick={() => void deckStore.setAutoLands(deck.id, !deck.autoLands)}
                size="xs"
                title="Keep the deck at its land count with basics, split by the colored mana its spells need. Basics are recalculated while this is on — turn it off to tweak them by hand."
              >
                auto lands
              </Button>
              <span className="flex items-center gap-1 text-ink-muted">
                <NumberStepper
                  label="Lands this deck should run"
                  max={200}
                  onChange={n => void deckStore.setLandTarget(deck.id, n)}
                  size="xs"
                  title={`Lands this deck should run — ${fmt.label} usually plays ${fmt.landCount}. Lands you picked yourself count towards it.`}
                  value={landTarget}
                />
                lands
              </span>
              <span className="tabular-nums text-ink-faint">
                {landCounts.total} now
                {landCounts.chosen > 0 && ` (${landCounts.basics} basic + ${landCounts.chosen})`}
                {deck.autoLands && landColors.length === 0 && ' · no colors yet'}
              </span>
              {landCounts.basics > 0 && (
                <IconButton
                  className="ml-auto"
                  icon={Trash2}
                  label="Remove all basic lands (also turns off auto-balancing)"
                  onClick={() => void deckStore.clearBasicLands(deck.id)}
                  size="xs"
                  tone="danger"
                />
              )}
            </div>
          )}

          {deck.cards.length > 0 && (
            <div className="flex flex-none flex-wrap items-center gap-1 border-b border-line px-2 py-1">
              <span className="mr-0.5 text-2xs uppercase tracking-wide text-ink-faint">group</span>
              <Button
                active={splitType}
                onClick={() => setSplitType(v => !v)}
                size="xs"
                title="Group each section by card type"
              >
                type
              </Button>
              <Button
                active={splitCost}
                onClick={() => setSplitCost(v => !v)}
                size="xs"
                title="Group by mana value. Lands get their own group — they're not part of the curve."
              >
                cost
              </Button>
              <Button
                active={showCurve}
                className="ml-auto"
                icon={BarChart3}
                onClick={() => setShowCurve(v => !v)}
                size="xs"
                title="Show the deck's mana curve as a column chart"
              >
                curve
              </Button>
            </div>
          )}

          {showCurve && deck.cards.length > 0 && (
            <ManaCurve cards={deck.cards} metaByKey={metaByName} />
          )}

          {rows.ids.length > 0 && (
            <SelectionBar selection={selection}>
              <Button
                onClick={() => {
                  void deckStore.removeCards(deck.id, selectedCards);
                  selection.clear();
                }}
                size="xs"
                title="Remove the selected cards from the deck"
                variant="danger"
              >
                Remove {selection.count}
              </Button>
              {movable('sideboard').length > 0 && (
                <Button
                  icon={ChevronDown}
                  onClick={() => void deckStore.moveCards(deck.id, selectedCards, 'sideboard')}
                  size="xs"
                  title="Move the selected cards to the sideboard"
                >
                  to sideboard
                </Button>
              )}
              {movable('main').length > 0 && (
                <Button
                  icon={ChevronUp}
                  onClick={() => void deckStore.moveCards(deck.id, selectedCards, 'main')}
                  size="xs"
                  title="Move the selected cards into the deck"
                >
                  to deck
                </Button>
              )}
            </SelectionBar>
          )}

          <div className="min-h-0 flex-1 overflow-auto outline-none" {...selection.listProps}>
            {layout.map(({ cards, groups, section }) => {
              return (
                <div key={section}>
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                    {SECTION_LABEL[section]}
                    <span className="font-normal tabular-nums text-ink-faint">
                      {countCards(cards)}
                    </span>
                  </div>
                  {groups.map(group => (
                    <div key={group.key}>
                      {group.label && (
                        <div className="flex items-center gap-1.5 bg-tint px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                          {group.label}
                          <span className="font-normal tabular-nums text-ink-faint">
                            {countCards(group.cards)}
                          </span>
                        </div>
                      )}
                      {(group.sub ?? [group]).map(part => (
                        <div key={part.key}>
                          {group.sub && (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 pl-4 text-2xs text-ink-faint">
                              {part.label}
                              <span className="tabular-nums">{countCards(part.cards)}</span>
                            </div>
                          )}
                          <ul className="list-none divide-y divide-line">
                            {part.cards.map(c => (
                              <DeckRow
                                key={`${section}|${cardKey(c.name)}`}
                                auto={!!deck.autoLands && section === 'main' && isBasicLand(c.name)}
                                card={c}
                                deckId={deck.id}
                                owned={ownedOf(c.name)}
                                rowId={`${section}|${cardKey(c.name)}`}
                                selection={selection}
                                urls={previewUrls(c.name)}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
            {deck.cards.length === 0 && (
              <EmptyState
                hint={
                  fmt.commanderZone
                    ? 'Pick a commander for EDHREC and Goldfish — or use Tags to find cards by mechanic, or search by name, type or mana value.'
                    : 'Search above by name, type or mana value to add cards, or import a list.'
                }
                icon={Search}
                title="This deck is empty"
              />
            )}
          </div>
        </>
      )}
    </>
  );
};

const DeckRow = ({
  auto = false,
  card,
  commander = false,
  deckId,
  owned,
  rowId,
  selection,
  urls,
}: {
  /** Managed by auto-balance — quantity edits here get recalculated away. */
  auto?: boolean;
  card: DeckCard;
  commander?: boolean;
  deckId: string;
  owned: number;
  /** Selection id; omitted (with `selection`) for rows that can't be picked. */
  rowId?: string;
  selection?: RowSelection;
  urls: string[];
}) => {
  const need = Math.max(0, card.quantity - owned);
  const basic = skipOwnership(card.name);
  const status = owned >= card.quantity ? 'owned' : owned > 0 ? 'partial' : 'buy';
  const preview = useCardPreview();
  const { flippable, handlers } = preview(`deck|${cardKey(card.name)}`, card.name, urls);
  // `group` so the row's remove button can hide until the pointer arrives.
  const base = 'group flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-tint';
  return (
    <li {...(selection && rowId ? selection.rowProps(rowId, base) : { className: base })}>
      <div className="h-7 w-7 flex-none overflow-hidden rounded-sm bg-raised" {...handlers}>
        {urls[0] ? (
          <img
            alt={card.name}
            className={`h-full w-full object-cover ${flippable ? 'cursor-pointer' : 'cursor-zoom-in'}`}
            src={urls[0]}
            style={{ objectPosition: '50% 18%' }}
            title={flippable ? 'Click to flip to the other side' : undefined}
          />
        ) : null}
      </div>

      {commander ? (
        <span aria-hidden className="text-sm text-warn" title="Commander">
          ♛
        </span>
      ) : (
        // A stepper, quiet until hovered so a long list doesn't read as buttons.
        <div className="flex flex-none items-center">
          <IconButton
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            icon={Minus}
            label={`One less ${card.name}`}
            onClick={() =>
              void deckStore.setQuantity(deckId, card.name, card.section, card.quantity - 1)
            }
            size="xs"
          />
          <span className="min-w-4 text-center text-xs font-medium tabular-nums text-ink">
            {card.quantity}
          </span>
          <IconButton
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            icon={Plus}
            label={`One more ${card.name}`}
            onClick={() =>
              void deckStore.setQuantity(deckId, card.name, card.section, card.quantity + 1)
            }
            size="xs"
          />
        </div>
      )}

      <span className="min-w-0 flex-1 truncate text-ink" title={card.name}>
        {card.name}
        {auto && (
          <span
            className="ml-1 text-2xs uppercase text-accent"
            title="Count is managed by auto balance lands"
          >
            auto
          </span>
        )}
      </span>

      {basic ? (
        <Badge title="Basic lands aren’t tracked in your collection">basic</Badge>
      ) : status === 'owned' ? (
        <Badge title={`You own ${owned}`} tone="pos">
          <Check aria-hidden size={10} strokeWidth={3} />
        </Badge>
      ) : (
        <a
          className="flex-none"
          href={buyUrl(card.name)}
          rel="noreferrer"
          target="_blank"
          title={
            status === 'partial'
              ? `You own ${owned} of ${card.quantity} — buy ${need} more on Cardmarket`
              : `Not in your collection — buy ${need} on Cardmarket`
          }
        >
          <Badge tone={status === 'partial' ? 'warn' : 'neg'}>buy {need}</Badge>
        </a>
      )}

      <IconButton
        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        icon={X}
        label={`Remove ${card.name} from the deck`}
        onClick={() => void deckStore.removeCard(deckId, card.name, card.section)}
        size="xs"
        tone="danger"
      />
    </li>
  );
};

// ---------------------------------------------------------------------------
// Add-a-card search box
// ---------------------------------------------------------------------------

// Show card images only once the result set has narrowed to this many or fewer.
const IMAGE_THRESHOLD = 5;

// Card types offered as one-click filters.
const CARD_TYPES = [
  'Creature',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Land',
  'Battle',
];

// The identity picker deals in real colors; "none selected" means colorless.
const IDENTITY_PIPS = COLOR_PIPS.filter(p => p.code !== 'C');

/**
 * Faces to hand the hover preview for a search hit. Scryfall's search response
 * already carries both sides of a double-faced card, so it flips with no extra
 * lookup.
 */
const previewUrls = (c: CardSearchResult): string[] =>
  c.faceImages ?? (c.imageUrl ? [c.imageUrl] : []);

const AddCardBox = ({
  commanderIdentity,
  deckFormat,
  filters = false,
  inDeck,
  onPick,
  onPickMany,
  placeholder = 'Add a card — type a name…',
}: {
  /**
   * The deck commander's color identity, once known. Preselects the identity
   * filter so searches only turn up cards that are legal in the deck.
   */
  commanderIdentity?: string[];
  /** Deck format — restricts results to format-legal cards. */
  deckFormat?: DeckFormat;
  /** Show the type/color/mana-value filters (the main add box, not commander search). */
  filters?: boolean;
  /**
   * cardKey -> copies already in the deck. Those are dropped from the results:
   * a card that's in already isn't a suggestion, and another copy of it is a
   * click on its own row.
   */
  inDeck?: Record<string, number>;
  onPick: (name: string) => void;
  /** Add several results at once. Without it, results can't be multi-selected. */
  onPickMany?: (names: string[]) => void;
  placeholder?: string;
}) => {
  const [text, setText] = useState('');
  const [resp, setResp] = useState<CardSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const preview = useCardPreview();

  const [showFilters, setShowFilters] = useState(false);
  const [useIdentity, setUseIdentity] = useState(false);
  const [identity, setIdentity] = useState<Set<string>>(() => new Set());
  const [types, setTypes] = useState<Set<string>>(() => new Set());
  const [subtype, setSubtype] = useState('');
  const [cmcMin, setCmcMin] = useState('');
  const [cmcMax, setCmcMax] = useState('');

  // Adopt the commander's identity whenever it changes (it arrives a moment
  // after the commander itself, once Scryfall metadata lands).
  const identityKey = commanderIdentity?.join('') ?? '';
  useEffect(() => {
    if (!filters || !commanderIdentity) return;
    setIdentity(new Set(commanderIdentity));
    setUseIdentity(true);
    // `commanderIdentity` is covered by its stable key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, filters]);

  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
  };

  const query: CardQuery = useMemo(
    () => ({
      cmcMax: filters ? num(cmcMax) : undefined,
      cmcMin: filters ? num(cmcMin) : undefined,
      format: deckFormat,
      identity: filters && useIdentity ? sortWubrg([...identity]) : undefined,
      subtype: filters ? subtype : undefined,
      text,
      types: filters ? [...types] : undefined,
    }),
    [deckFormat, filters, text, useIdentity, identity, types, subtype, cmcMin, cmcMax],
  );

  const runnable = hasSearchCriteria(query);
  // Stable dependency for the search effect — the query object is rebuilt on
  // every keystroke, but only its resulting Scryfall syntax matters.
  const queryText = buildScryfallQuery(query);

  useEffect(() => {
    if (!runnable) {
      setResp(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchCards(query)
        .then(r => {
          if (!cancelled) {
            setResp(r);
            setErr(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setResp(null);
            setErr(e instanceof Error ? e.message : 'Search failed');
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `query` is captured; `queryText` is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText, runnable]);

  const add = (name: string): void => {
    onPick(name);
    setText('');
    setResp(null);
  };

  // What's left to suggest once the deck's own cards are taken out, with the
  // match count discounted to match. Only the page Scryfall sent back can be
  // filtered, which for any search narrow enough to act on is all of it.
  const results = useMemo(() => {
    const cards = resp?.cards ?? [];
    const kept = inDeck ? cards.filter(c => !inDeck[cardKey(c.name)]) : cards;
    const hidden = cards.length - kept.length;
    return { cards: kept, hidden, total: Math.max(0, (resp?.total ?? 0) - hidden) };
  }, [resp, inDeck]);

  // Multi-select over the text results, so a broad search ("t:wolf") can be
  // harvested in one go. The image grid is at most five tiles that add on click,
  // which is already a single gesture, so it stays as it is.
  const hits = !searching && onPickMany ? results.cards : [];
  const selection = useRowSelection(hits.map(c => c.id));
  const addSelected = (): void => {
    const byId = new Map(hits.map(c => [c.id, c.name] as const));
    onPickMany?.(selection.ids.map(id => byId.get(id) ?? '').filter(Boolean));
    setText('');
    setResp(null);
  };

  // Enter adds the typed name as-is — but if the text is Scryfall syntax
  // ("t:wolf") there's no name to add, so take the top result instead.
  const submit = (): void => {
    const typed = text.trim();
    if (typed && !looksLikeSyntax(typed)) {
      add(typed);
      return;
    }
    const first = results.cards[0];
    if (first) add(first.name);
  };

  const toggleIn = (set: Set<string>, value: string, apply: (s: Set<string>) => void): void => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const activeFilters =
    (useIdentity ? 1 : 0) +
    types.size +
    (subtype.trim() ? 1 : 0) +
    (cmcMin ? 1 : 0) +
    (cmcMax ? 1 : 0);

  const showImages = results.cards.length > 0 && results.total <= IMAGE_THRESHOLD;

  return (
    <div className="flex-none border-b border-line p-1.5">
      <div className="flex gap-1">
        <SearchInput
          onChange={e => setText(e.target.value)}
          onClear={() => setText('')}
          onKeyDown={e => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={placeholder}
          title={
            filters
              ? 'Type a name, or use Scryfall syntax — t:wolf, o:"draw a card", mv<3, -t:land'
              : undefined
          }
          value={text}
        />
        {filters && (
          <Button
            active={showFilters}
            icon={Filter}
            onClick={() => setShowFilters(v => !v)}
            title="Filter by color, type and mana value"
          >
            {activeFilters > 0 ? activeFilters : ''}
          </Button>
        )}
      </div>

      {filters && showFilters && (
        <div className="mt-1.5 space-y-1.5 rounded border border-line bg-panel p-1.5 text-2xs">
          <div className="flex flex-wrap items-center gap-1">
            <label
              className="flex items-center gap-1 text-ink-muted"
              title="Only cards that fit inside these colors (Commander colour-identity rule)"
            >
              <input
                checked={useIdentity}
                className="h-3 w-3 accent-[color:var(--lugin-accent)]"
                onChange={e => setUseIdentity(e.target.checked)}
                type="checkbox"
              />
              identity
            </label>
            {IDENTITY_PIPS.map(p => (
              <button
                key={p.code}
                className={`h-5 w-5 rounded-full text-[10px] font-bold ${p.cls} ${
                  useIdentity && identity.has(p.code) ? 'ring-2 ring-sky-400' : 'opacity-50'
                }`}
                onClick={() => {
                  setUseIdentity(true);
                  toggleIn(identity, p.code, setIdentity);
                }}
                title={`Include ${p.code} in the identity`}
                type="button"
              >
                {p.label}
              </button>
            ))}
            {useIdentity && identity.size === 0 && (
              <span className="text-ink-faint">colorless only</span>
            )}
            {commanderIdentity && (
              <span className="text-ink-faint" title="Preselected from your commander">
                from commander
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {CARD_TYPES.map(t => (
              <Button
                key={t}
                active={types.has(t)}
                onClick={() => toggleIn(types, t, setTypes)}
                size="xs"
                variant="subtle"
              >
                {t}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <TextInput
              className="h-5 flex-1 px-1.5 text-2xs"
              onChange={e => setSubtype(e.target.value)}
              placeholder="creature type — e.g. Wolf"
              value={subtype}
            />
            <span className="text-ink-faint">MV</span>
            <TextInput
              className="h-5 w-10 px-1 text-center text-2xs tabular-nums"
              onChange={e => setCmcMin(e.target.value)}
              placeholder="min"
              type="number"
              value={cmcMin}
            />
            <TextInput
              className="h-5 w-10 px-1 text-center text-2xs tabular-nums"
              onChange={e => setCmcMax(e.target.value)}
              placeholder="max"
              type="number"
              value={cmcMax}
            />
            {activeFilters > 0 && (
              <Button
                onClick={() => {
                  setUseIdentity(false);
                  setTypes(new Set());
                  setSubtype('');
                  setCmcMin('');
                  setCmcMax('');
                }}
                size="xs"
                variant="subtle"
              >
                Reset
              </Button>
            )}
          </div>

          {queryText && (
            <div className="truncate font-mono text-2xs text-ink-faint" title={queryText}>
              {queryText}
            </div>
          )}
        </div>
      )}

      {searching && (
        <div className="mt-1 flex items-center gap-1 text-2xs text-ink-faint">
          <Loader2 aria-hidden className="animate-spin" size={11} />
          Searching…
        </div>
      )}
      {err && (
        <div className="mt-1 flex items-center gap-1 text-2xs text-neg">
          <CircleAlert aria-hidden size={11} />
          {err}
        </div>
      )}

      {resp && !searching && (
        <>
          {results.cards.length === 0 ? (
            <div className="mt-1 text-2xs text-ink-faint">
              {results.hidden > 0
                ? 'Every match is already in the deck.'
                : text.trim()
                  ? `No cards match “${text.trim()}”.`
                  : 'No cards match these filters.'}
            </div>
          ) : showImages ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {results.cards.map(c => {
                // The preview lives on the image so clicking it can flip a
                // double-faced card; clicks anywhere else on the tile add.
                const { flippable, handlers } = preview(`search|${c.id}`, c.name, previewUrls(c));
                return (
                  <button
                    key={c.id}
                    className="group w-20 overflow-hidden rounded border border-line-strong bg-raised text-left transition-colors hover:border-accent"
                    onClick={() => add(c.name)}
                    title={`Add ${c.name}`}
                    type="button"
                  >
                    {c.imageUrl ? (
                      <span className="block" {...handlers}>
                        <img
                          alt={c.name}
                          className={`h-28 w-full object-cover ${flippable ? 'cursor-pointer' : ''}`}
                          src={c.imageUrl}
                          title={flippable ? 'Click to flip to the other side' : undefined}
                        />
                      </span>
                    ) : (
                      <div className="flex h-28 w-full items-center justify-center text-2xs text-ink-faint">
                        no image
                      </div>
                    )}
                    <div className="flex items-center gap-0.5 px-1 py-0.5 text-2xs text-ink-muted group-hover:text-accent">
                      <Plus aria-hidden className="flex-none" size={9} />
                      <span className="truncate">{c.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mt-1 text-2xs text-ink-faint">
                <span className="tabular-nums">{results.total}</span> matches
                {results.hidden > 0 && ` (${results.hidden} already in the deck)`} — narrow the
                search to see images.
              </div>
              <div className="mt-1 overflow-hidden rounded border border-line">
                {onPickMany && (
                  <SelectionBar selection={selection}>
                    <Button icon={Plus} onClick={addSelected} size="xs" variant="primary">
                      Add {selection.count}
                    </Button>
                  </SelectionBar>
                )}
                <ul
                  className="max-h-44 list-none divide-y divide-line overflow-auto outline-none"
                  {...selection.listProps}
                >
                  {results.cards.map(c => {
                    const { flippable, handlers } = preview(
                      `search|${c.id}`,
                      c.name,
                      previewUrls(c),
                    );
                    // Hovering the row previews; the thumbnail is the flip target
                    // so the rest of the row still adds the card.
                    const { onClick: flip, ...hover } = handlers;
                    return (
                      <li
                        key={c.id}
                        {...selection.rowProps(c.id, 'group flex items-center gap-1.5 pl-2')}
                      >
                        <button
                          className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-ink transition-colors hover:bg-tint"
                          data-lugin-row-click
                          onClick={() => add(c.name)}
                          title={`Add ${c.name}`}
                          type="button"
                          {...hover}
                        >
                          {c.imageUrl && (
                            <span
                              className="h-6 w-[18px] flex-none overflow-hidden rounded-sm bg-raised"
                              onClick={flip}
                            >
                              <img
                                alt=""
                                className={`h-full w-full object-cover ${flippable ? 'cursor-pointer' : ''}`}
                                loading="lazy"
                                src={c.imageUrl}
                                style={{ objectPosition: '50% 18%' }}
                                title={flippable ? 'Click to flip to the other side' : undefined}
                              />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {c.name}
                            {c.typeLine && (
                              <span className="ml-1 text-2xs text-ink-faint">{c.typeLine}</span>
                            )}
                          </span>
                          {c.setCode && (
                            <span className="flex-none text-2xs uppercase text-ink-faint">
                              {c.setCode}
                            </span>
                          )}
                          <Plus
                            aria-hidden
                            className="flex-none text-ink-faint group-hover:text-accent"
                            size={12}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
