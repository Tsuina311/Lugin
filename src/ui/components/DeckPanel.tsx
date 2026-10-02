import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { Badge } from './Badge';
import { BracketMark } from './BracketMark';
import { Button } from './Button';
import { CollectionThumb } from './CollectionThumb';
import { CutsPanel } from './CutsPanel';
import { DeckCardTagMove } from './DeckCardTagMove';
import { DeckFromWants } from './DeckFromWants';
import { DeckWantList } from './DeckWantList';
import { EdhrecPanel } from './EdhrecPanel';
import { EditionPicker } from './EditionPicker';
import { EmptyState } from './EmptyState';
import { NumberStepper, SearchInput, Select, TextInput } from './Field';
import { GoldfishPanel } from './GoldfishPanel';
import { IconButton } from './IconButton';
import { ManaCurve, MiniCurve } from './ManaCurve';
import { Popover } from './Popover';
import { SelectionBar, SelectionHint } from './Selection';
import { SetSymbol } from './SetSymbol';
import { TagsPanel } from './TagsPanel';
import { ViewToggle, type ViewShape } from './ViewToggle';
import { useCardPreview } from './cardPreview';
import { COLOR_PIPS } from './colorPips';
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleAlert,
  Filter,
  Layers,
  Loader2,
  Minus,
  Mountain,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Upload,
  X,
} from './icons';

import { cardImageOverrideStore } from '@/content/cardImageOverrideStore';
import { cardmarketArtStore } from '@/content/cardmarketArtStore';
import { collectionStore } from '@/content/collectionStore';
import { countCards, deckStore, type DeckCardRef } from '@/content/deckStore';
import {
  candidatesByName,
  cardmarketProductId,
  cdnImageFromId,
  leadWithScryfall,
} from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import type { Collection } from '@/lib/collection';
import {
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  groupDeckCards,
  manaCurve,
  type Deck,
  type DeckCard,
  type DeckCardGroup,
  type DeckFormat,
  type DeckPrinting,
  type DeckSection,
} from '@/lib/deck';
import { bucketMainByTagSections, type TagSectionBucket } from '@/lib/deckTagSections';
import { deckTagById, deckTagsByCategory, filterDeckTags } from '@/lib/deckTags';
import { basicsMatchPlan, isBasicLand, planBasicLands } from '@/lib/lands';
import { requestScryfall } from '@/lib/messaging';
import {
  allowsSecondCommander,
  canPairCommanders,
  isLandType,
  sortWubrg,
  type CardMetadata,
} from '@/lib/mtg';
import type { CardPrint } from '@/lib/prints';
import { isScryfallUrl } from '@/lib/scryfallFetch';
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

// Cardmarket product search for a card the user still needs to buy. A chosen
// printing goes straight to that product; otherwise the search is any edition.
const buyUrl = (name: string, productId?: number): string =>
  productId
    ? `${location.origin}/${currentLang()}/Magic/Products?idProduct=${productId}`
    : `${location.origin}${cardmarketSearchUrl(name, currentLang())}`;

// How the deck list is broken up — remembered across sessions. localStorage can
// throw in locked-down contexts, so every access is guarded.
const SPLIT_TYPE_KEY = 'lugin:deckSplitType';
const SPLIT_COST_KEY = 'lugin:deckSplitCost';
const OVERVIEW_SHAPE_KEY = 'lugin:deckOverviewShape';

const readFlag = (key: string, fallback = false): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
};

const writeFlag = (key: string, on: boolean): void => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore */
  }
};

const readShape = (): ViewShape => {
  try {
    return localStorage.getItem(OVERVIEW_SHAPE_KEY) === 'box' ? 'box' : 'list';
  } catch {
    return 'list';
  }
};

/**
 * Cards we don't hold against your collection. Nobody bothers listing their
 * basics, and they're free to come by anyway, so counting them as missing would
 * make every deck look like a shopping list.
 */
const skipOwnership = (name: string): boolean => isBasicLand(name);

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
          collection={collection}
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
                        const { handlers } = preview(
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
                                className="h-full w-full cursor-zoom-in object-cover"
                                decoding="async"
                                loading="lazy"
                                src={urls[0]}
                                style={{ objectPosition: '50% 18%' }}
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
                  <BracketMark deck={d} />
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

const SECTION_HEAD =
  'flex items-center gap-1.5 border-b border-line bg-panel px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted';
/** Sticks a header to the top of the list. Above z-10, where a tile's loading spinner sits. */
const PINNED = 'sticky top-0 z-20';
/**
 * A mana value's or card type's header. Pinned, so the list always shows which
 * group it's in and the next group's header visibly pushes this one off. Fixed
 * height, because a subgroup's header pins right under it.
 */
const GROUP_HEAD = `${PINNED} flex h-7 items-center gap-2 border-b border-line bg-raised px-2 text-xs font-semibold text-ink`;
const SUBGROUP_HEAD =
  'sticky top-7 z-[15] flex h-6 items-center gap-2 border-b border-line bg-panel pl-4 pr-2 text-2xs font-medium text-ink';
const SECTION_ACTION =
  'shrink-0 text-2xs font-medium normal-case tracking-normal text-ink-faint hover:text-ink';

/** Every section's tiles, the commander's included, so they all come out one size. */
const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 p-2';

const POPOVER_HEADING = 'text-2xs font-semibold uppercase tracking-wide text-ink-faint';
const CHECKBOX = 'h-3 w-3 flex-none accent-[color:var(--lugin-accent)]';

// The editor's panes: the deck itself plus one per recommendation source.
const DECK_VIEWS = [
  { id: 'deck', label: 'Overview', title: 'The cards in this deck' },
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
  collection,
  collectionByKey,
  deck,
  onBack,
  onMergeUpload,
}: {
  collection: Collection | null;
  collectionByKey: OwnedIndex;
  deck: Deck;
  onBack: () => void;
  onMergeUpload: () => void;
}) => {
  const [nameDraft, setNameDraft] = useState(deck.name);
  const [splitType, setSplitType] = useState(() => readFlag(SPLIT_TYPE_KEY));
  const [splitCost, setSplitCost] = useState(() => readFlag(SPLIT_COST_KEY));
  const [overviewShape, setOverviewShape] = useState<ViewShape>(readShape);

  useEffect(() => writeFlag(SPLIT_TYPE_KEY, splitType), [splitType]);
  useEffect(() => writeFlag(SPLIT_COST_KEY, splitCost), [splitCost]);
  useEffect(() => {
    try {
      localStorage.setItem(OVERVIEW_SHAPE_KEY, overviewShape);
    } catch {
      /* ignore */
    }
  }, [overviewShape]);

  useEffect(() => setNameDraft(deck.name), [deck.id, deck.name]);

  // Metadata for the deck's cards: images and face info for the hover preview,
  // types and mana values for the grouping, curve and land balancing.
  const names = useMemo(() => deck.cards.map(c => c.name), [deck.cards]);
  const { merge: mergeMeta, metaByKey: metaByName } = useCardMetadata(names);
  const bracketImages = useMemo(() => {
    const images: Record<string, string> = {};
    for (const card of deck.cards) {
      const url = metaByName[cardKey(card.name)]?.imageUrl ?? card.printing?.imageUrl;
      if (url) images[cardKey(card.name)] = url;
    }
    return images;
  }, [deck.cards, metaByName]);
  const bracketOracle = useMemo(() => {
    const out: Record<string, { found: boolean; oracleId?: string }> = {};
    for (const card of deck.cards) {
      const meta = metaByName[cardKey(card.name)];
      if (!meta) continue;
      out[cardKey(card.name)] = { found: meta.found, oracleId: meta.oracleId };
    }
    return out;
  }, [deck.cards, metaByName]);

  const ownedOf = (name: string): number => collectionByKey[cardKey(name)]?.total ?? 0;

  const ownedCandidates = useMemo(() => candidatesByName(collection?.cards ?? []), [collection]);
  const imageOverrides = useSyncExternalStore(
    cardImageOverrideStore.subscribe,
    cardImageOverrideStore.getSnapshot,
  );
  const printingArt = useSyncExternalStore(
    cardmarketArtStore.subscribe,
    cardmarketArtStore.getSnapshot,
  );
  // The printing already on a collection row, so a deck of cards you own can
  // show that edition before Scryfall's default arrives.
  const ownedEdition = useMemo(() => {
    const map = new Map<string, { scryfallId?: string; setCode?: string; setName?: string }>();
    for (const card of collection?.cards ?? []) {
      const key = cardKey(card.name);
      if (!key || (!card.setCode && !card.setName)) continue;
      const prev = map.get(key);
      if (prev?.setCode || prev?.setName) continue;
      map.set(key, { scryfallId: card.scryfallId, setCode: card.setCode, setName: card.setName });
    }
    return map;
  }, [collection]);

  // The line being given a different printing. The picker covers the list.
  const [picking, setPicking] = useState<DeckCard | null>(null);

  /**
   * The edition a line shows: the one someone picked, else Scryfall's default.
   */
  const editionOf = (
    card: DeckCard,
  ): { cardmarketId?: number; scryfallId?: string; setCode?: string; setName?: string } => {
    const key = cardKey(card.name);
    const meta = metaByName[key];
    const override = imageOverrides[key];
    const owned = ownedEdition.get(key);
    const picked = card.printing;
    return {
      cardmarketId: picked?.cardmarketId ?? meta?.cardmarketId,
      scryfallId:
        picked?.scryfallId ?? override?.scryfallId ?? owned?.scryfallId ?? meta?.scryfallId,
      setCode: picked?.setCode ?? override?.setCode ?? owned?.setCode ?? meta?.setCode,
      setName: picked?.setName ?? override?.setName ?? owned?.setName ?? meta?.setName,
    };
  };

  const chooseEdition = (card: DeckCard, print: CardPrint): void => {
    const printing: DeckPrinting = {
      cardmarketId: print.cardmarketId,
      collectorNumber: print.collectorNumber,
      imageUrl: print.imageUrl,
      scryfallId: print.id,
      setCode: print.setCode,
      setName: print.setName,
    };
    void deckStore.setPrinting(deck.id, card.name, card.section, printing);
    // The collection's picture of this card follows, when you already own one.
    if (ownedOf(card.name) > 0) {
      void cardImageOverrideStore.set(cardKey(card.name), {
        collectorNumber: printing.collectorNumber,
        imageUrl: printing.imageUrl,
        scryfallId: printing.scryfallId,
        setCode: printing.setCode,
        setName: printing.setName,
      });
    }
    setPicking(null);
  };

  // The Cardmarket product ids behind this deck's owned cards, so each one can
  // be swapped for Scryfall's file of that same printing.
  useEffect(() => {
    const names = new Set(deck.cards.map(c => cardKey(c.name)));
    const ids: string[] = [];
    for (const card of collection?.cards ?? []) {
      if (!names.has(cardKey(card.name))) continue;
      if (card.productId) ids.push(card.productId);
      const fromImage = cardmarketProductId(card.imageUrl);
      if (fromImage) ids.push(fromImage);
    }
    cardmarketArtStore.ensure(ids);
  }, [collection, deck.cards]);

  /**
   * Scryfall's image of the printing, then the Cardmarket photo if that's all
   * we have. The photo is a small scan; zooming it is what looks soft.
   */
  const thumbOf = (card: DeckCard): { candidates: readonly string[]; faceImages?: string[] } => {
    const key = cardKey(card.name);
    const meta = metaByName[key];
    const owned = ownedEdition.get(key);
    const override = imageOverrides[key];
    const raw = ownedCandidates.get(key) ?? [];
    let fromProduct: string | undefined;
    for (const url of raw) {
      const id = cardmarketProductId(url);
      const art = id ? printingArt[id] : undefined;
      if (art) {
        fromProduct = art;
        break;
      }
    }
    const scryfall =
      cdnImageFromId(card.printing?.scryfallId) ??
      cdnImageFromId(override?.scryfallId) ??
      cdnImageFromId(owned?.scryfallId) ??
      fromProduct ??
      cdnImageFromId(meta?.scryfallId) ??
      (meta?.imageUrl && !isScryfallUrl(meta.imageUrl) ? meta.imageUrl : undefined);
    return {
      candidates: leadWithScryfall(raw, scryfall),
      faceImages: meta?.faceImages,
    };
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
  const [pickingPartner, setPickingPartner] = useState(false);
  useEffect(() => setPickingPartner(false), [deck.id]);
  const commanderSearch = commanders.length === 0 || (pickingPartner && canAddSecondCommander);

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

  const curve = useMemo(() => manaCurve(deck.cards, metaByName), [deck.cards, metaByName]);

  // The deck itself vs. suggestions for the current commander(s).
  const [view, setView] = useState<DeckView>('deck');
  useEffect(() => setView('deck'), [deck.id]);
  const edhrecDeckCards = useMemo(
    () =>
      deck.cards
        .filter(c => c.section === 'main')
        .map(c => {
          const meta = metaByName[cardKey(c.name)];
          return {
            keywords: meta?.keywords,
            name: c.name,
            subtypes: meta?.subtypes,
            typeLine: meta?.typeLine,
          };
        }),
    [deck.cards, metaByName],
  );

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

  const tagSectionIds = deck.tagSections ?? [];
  const [tagBuckets, setTagBuckets] = useState<TagSectionBucket[]>([]);
  const [mainRest, setMainRest] = useState<DeckCard[]>([]);
  const [tagPickerQuery, setTagPickerQuery] = useState('');

  useEffect(() => {
    const main = deck.cards.filter(c => c.section === 'main');
    if (tagSectionIds.length === 0) {
      setTagBuckets([]);
      setMainRest(main);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void bucketMainByTagSections(main, tagSectionIds, controller.signal, deck.tagOverrides).then(
      result => {
        if (cancelled) return;
        setTagBuckets(result.buckets);
        setMainRest(result.rest);
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [deck.cards, deck.tagOverrides, tagSectionIds.join('|')]);

  const pickerTags = useMemo(() => {
    const filtered = filterDeckTags(tagPickerQuery).filter(t => !tagSectionIds.includes(t.id));
    return deckTagsByCategory(filtered);
  }, [tagPickerQuery, tagSectionIds]);

  // Main (optionally split by tag sections) and sideboard, then type/cost groups.
  const layout = useMemo(() => {
    type Block = {
      cards: DeckCard[];
      groups: ReturnType<typeof groupDeckCards>;
      key: string;
      label: string;
      section: DeckSection;
      tagId?: string;
    };
    const blocks: Block[] = [];
    if (tagSectionIds.length > 0) {
      for (const bucket of tagBuckets) {
        const cards = [...bucket.cards].sort((a, b) => a.name.localeCompare(b.name));
        if (cards.length === 0) continue;
        blocks.push({
          cards,
          groups: groupDeckCards(cards, metaByName, { cost: splitCost, type: splitType }),
          key: `tag:${bucket.tagId}`,
          label: bucket.label,
          section: 'main',
          tagId: bucket.tagId,
        });
      }
      const rest = [...mainRest].sort((a, b) => a.name.localeCompare(b.name));
      if (rest.length > 0) {
        blocks.push({
          cards: rest,
          groups: groupDeckCards(rest, metaByName, { cost: splitCost, type: splitType }),
          key: 'main',
          label: SECTION_LABEL.main,
          section: 'main',
        });
      }
    } else {
      const cards = deck.cards
        .filter(c => c.section === 'main')
        .sort((a, b) => a.name.localeCompare(b.name));
      if (cards.length > 0) {
        blocks.push({
          cards,
          groups: groupDeckCards(cards, metaByName, { cost: splitCost, type: splitType }),
          key: 'main',
          label: SECTION_LABEL.main,
          section: 'main',
        });
      }
    }
    const side = deck.cards
      .filter(c => c.section === 'sideboard')
      .sort((a, b) => a.name.localeCompare(b.name));
    if (side.length > 0) {
      blocks.push({
        cards: side,
        groups: groupDeckCards(side, metaByName, { cost: splitCost, type: splitType }),
        key: 'sideboard',
        label: SECTION_LABEL.sideboard,
        section: 'sideboard',
      });
    }
    return blocks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.cards, metaByName, splitCost, splitType, tagBuckets, mainRest, tagSectionIds.join('|')]);

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

  const target = fmt.targetSize;
  const sizeTone =
    !target || summary.total < target
      ? 'text-ink'
      : summary.total > target
        ? 'text-warn'
        : 'text-pos';
  const grouped = splitType || splitCost || tagSectionIds.length > 0;
  const landsOff = landTarget != null && landCounts.total !== landTarget;
  const manaTitle = `${
    curve.average != null ? `Average mana value ${curve.average.toFixed(2)} · ` : ''
  }${landCounts.total} lands${
    landTarget != null ? `, aiming for ${landTarget}` : ''
  } — click for the full curve and land settings`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-none items-center gap-1 border-b border-line bg-panel px-1.5 py-1.5">
        <Button
          className="flex-none pl-1"
          icon={ChevronLeft}
          onClick={onBack}
          title="Back to all your decks"
          variant="subtle"
        >
          Decks
        </Button>
        <span aria-hidden className="h-4 w-px flex-none bg-line-strong" />
        <input
          aria-label="Deck name"
          className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-base font-semibold text-ink outline-none transition-colors hover:border-line-strong focus:border-accent focus:bg-raised"
          onBlur={() => void deckStore.rename(deck.id, nameDraft)}
          onChange={e => setNameDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          title="Rename the deck"
          value={nameDraft}
        />
        <Select
          aria-label="Deck format"
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
        <BracketMark
          deck={deck}
          knownImages={bracketImages}
          onRemove={card => void deckStore.removeCards(deck.id, [card])}
          oracleByKey={bracketOracle}
        />
        <Popover
          className="w-72"
          label="Import cards into this deck"
          trigger={({ open, toggle }) => (
            <Button
              active={open}
              icon={Upload}
              onClick={toggle}
              title="Add cards from a decklist file or one of your want lists"
              variant="subtle"
            >
              Import
            </Button>
          )}
        >
          {close => (
            <div className="space-y-2">
              <button
                className="flex w-full items-start gap-2 rounded p-1.5 text-left transition-colors hover:bg-tint"
                onClick={() => {
                  close();
                  onMergeUpload();
                }}
                type="button"
              >
                <Upload aria-hidden className="mt-0.5 flex-none text-ink-muted" size={13} />
                <span className="min-w-0">
                  <span className="block font-medium">From a file…</span>
                  <span className="block text-2xs text-ink-faint">
                    A decklist (.txt, .dec or .csv). Its cards are added to this deck.
                  </span>
                </span>
              </button>
              <DeckFromWants
                inDeck={inDeck}
                onAdd={names => {
                  void deckStore.addCards(deck.id, names, 'main');
                  close();
                }}
              />
            </div>
          )}
        </Popover>
      </div>

      <div className="flex flex-none items-center gap-1.5 border-b border-line bg-panel pr-2">
        <div
          className="flex min-w-0 flex-1 overflow-x-auto px-1 [scrollbar-width:none]"
          role="tablist"
        >
          {visibleViews.map(v => {
            const on = view === v.id;
            return (
              <button
                key={v.id}
                aria-selected={on}
                className={`relative flex-none px-2 py-1.5 text-xs font-medium transition-colors ${
                  on ? 'text-ink' : 'text-ink-faint hover:text-ink-muted'
                }`}
                onClick={() => setView(v.id)}
                role="tab"
                title={v.title}
                type="button"
              >
                {v.label}
                {on && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>
        <span
          className="flex-none text-2xs tabular-nums text-ink-faint"
          title={target ? `${fmt.label} decks play ${target} cards` : undefined}
        >
          <span className={`text-xs font-semibold ${sizeTone}`}>{summary.total}</span>
          {target ? `/${target}` : ''} cards
        </span>
        {summary.toBuy > 0 ? (
          <button
            aria-pressed={wantListOpen}
            className={`flex h-5 flex-none items-center gap-1 rounded-full px-2 text-2xs font-medium transition-colors ${
              wantListOpen
                ? 'bg-accent-soft text-accent'
                : 'bg-warn-soft text-warn hover:ring-1 hover:ring-inset hover:ring-warn'
            }`}
            onClick={() => setWantListOpen(o => !o)}
            title={`You own ${summary.owned} of these. Put the ${summary.toBuy} you're missing on a Cardmarket want list.`}
            type="button"
          >
            <ShoppingCart aria-hidden size={11} />
            {summary.toBuy} to buy
          </button>
        ) : (
          summary.total > 0 && (
            <Badge title="Every card is in your collection" tone="pos">
              all owned
            </Badge>
          )
        )}
      </div>

      {wantListOpen && (
        <DeckWantList deck={deck} missing={missing} onClose={() => setWantListOpen(false)} />
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
              deckCards={edhrecDeckCards}
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
        <div className="flex min-h-0 flex-1 flex-col">
          <AddCardBox
            commanderIdentity={commanderIdentity}
            deckFormat={deck.format}
            filters
            inDeck={inDeck}
            onPick={name => void deckStore.addCard(deck.id, name, 'main', 1)}
            onPickMany={names => void deckStore.addCards(deck.id, names, 'main')}
            placeholder="Add a card — name, or t:wolf, mv<3…"
            trailing={
              deck.cards.length > 0 && (
                <>
                  <ViewToggle onChange={setOverviewShape} value={overviewShape} />
                  <Popover
                    className="w-72"
                    label="Group the list"
                    trigger={({ open, toggle }) => (
                      <Button
                        active={open || grouped}
                        icon={Layers}
                        onClick={toggle}
                        title="Group the list by card type, mana value or mechanic"
                      >
                        Group
                      </Button>
                    )}
                  >
                    <p className={POPOVER_HEADING}>Group by</p>
                    <label className="mt-1.5 flex items-center gap-1.5">
                      <input
                        checked={splitType}
                        className={CHECKBOX}
                        onChange={e => setSplitType(e.target.checked)}
                        type="checkbox"
                      />
                      Card type
                    </label>
                    <label className="mt-1 flex items-center gap-1.5">
                      <input
                        checked={splitCost}
                        className={CHECKBOX}
                        onChange={e => setSplitCost(e.target.checked)}
                        type="checkbox"
                      />
                      Mana value
                      <span className="text-2xs text-ink-faint">— lands get their own group</span>
                    </label>

                    <div className="mt-3 border-t border-line pt-2">
                      <p className={POPOVER_HEADING}>Tag sections</p>
                      <p className="mt-0.5 text-2xs text-ink-faint">
                        Sort the main deck into sections by mechanic: ramp, draw, removal…
                      </p>
                      {tagSectionIds.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-1">
                          {tagSectionIds.map(id => (
                            <li key={id}>
                              <span className="inline-flex items-center gap-0.5 rounded-full border border-line-strong py-0.5 pl-1.5 pr-1 text-2xs text-ink">
                                {deckTagById(id)?.label ?? id}
                                <button
                                  aria-label={`Remove the ${deckTagById(id)?.label ?? id} section`}
                                  className="rounded-full text-ink-faint hover:text-ink"
                                  onClick={() =>
                                    void deckStore.setTagSections(
                                      deck.id,
                                      tagSectionIds.filter(t => t !== id),
                                    )
                                  }
                                  type="button"
                                >
                                  <X aria-hidden size={10} />
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <SearchInput
                        className="mt-1.5"
                        onChange={e => setTagPickerQuery(e.target.value)}
                        onClear={() => setTagPickerQuery('')}
                        placeholder="Find a tag to add as a section…"
                        value={tagPickerQuery}
                      />
                      <div className="mt-1 max-h-48 overflow-auto">
                        {pickerTags.map(group => (
                          <div key={group.category} className="mb-1.5">
                            <div className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                              {group.category}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {group.tags.map(tag => (
                                <Button
                                  key={tag.id}
                                  icon={Plus}
                                  onClick={() => {
                                    void deckStore.setTagSections(deck.id, [
                                      ...tagSectionIds,
                                      tag.id,
                                    ]);
                                    setTagPickerQuery('');
                                  }}
                                  size="xs"
                                  title={`Add a ${tag.label} section`}
                                >
                                  {tag.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {pickerTags.length === 0 && (
                          <p className="py-1 text-2xs text-ink-faint">No tags left to add.</p>
                        )}
                      </div>
                    </div>
                  </Popover>
                  <Popover
                    className="w-72"
                    label="Mana curve and lands"
                    trigger={({ open, toggle }) => (
                      <Button active={open} onClick={toggle} title={manaTitle}>
                        {curve.total > 0 ? (
                          <MiniCurve curve={curve} />
                        ) : (
                          <BarChart3 aria-hidden size={13} />
                        )}
                        <Mountain aria-hidden className="ml-1 text-ink-faint" size={12} />
                        <span className={`tabular-nums ${landsOff ? 'text-warn' : ''}`}>
                          {landCounts.total}
                          {landTarget != null && (
                            <span className="text-ink-faint">/{landTarget}</span>
                          )}
                        </span>
                      </Button>
                    )}
                  >
                    <p className={POPOVER_HEADING}>Mana curve</p>
                    <div className="mt-1.5">
                      <ManaCurve curve={curve} />
                    </div>
                    {landTarget != null && (
                      <div className="mt-3 space-y-2 border-t border-line pt-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={POPOVER_HEADING}>Lands</p>
                          <span className="text-2xs tabular-nums text-ink-faint">
                            {landCounts.total} now
                            {landCounts.chosen > 0 &&
                              ` — ${landCounts.basics} basic, ${landCounts.chosen} other`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-ink-muted">Aim for</span>
                          <NumberStepper
                            label="Lands this deck should run"
                            max={200}
                            onChange={n => void deckStore.setLandTarget(deck.id, n)}
                            title={`${fmt.label} usually plays ${fmt.landCount}. Lands you picked yourself count towards it.`}
                            value={landTarget}
                          />
                        </div>
                        <label className="flex items-start gap-1.5">
                          <input
                            checked={!!deck.autoLands}
                            className={`${CHECKBOX} mt-0.5`}
                            onChange={e => void deckStore.setAutoLands(deck.id, e.target.checked)}
                            type="checkbox"
                          />
                          <span>
                            <span className="block">Top up with basics</span>
                            <span className="block text-2xs text-ink-faint">
                              Basics fill the gap to the target, split by the colors your spells
                              need. Turn off to set them by hand.
                            </span>
                          </span>
                        </label>
                        {deck.autoLands && landColors.length === 0 && (
                          <p className="text-2xs text-warn">No colors to pick basics from yet.</p>
                        )}
                        {landCounts.basics > 0 && (
                          <Button
                            icon={Trash2}
                            onClick={() => void deckStore.clearBasicLands(deck.id)}
                            size="xs"
                            title="Also stops topping up with basics"
                            variant="subtle"
                          >
                            Remove all basics
                          </Button>
                        )}
                      </div>
                    )}
                  </Popover>
                </>
              )
            }
          />

          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              className={`min-h-0 flex-1 overflow-auto outline-none ${selection.active ? 'pb-12' : ''} ${
                // Clears the pinned headers when the arrow keys scroll a row into view.
                splitType && splitCost
                  ? 'scroll-pt-[3.25rem]'
                  : splitType || splitCost
                    ? 'scroll-pt-7'
                    : 'scroll-pt-6'
              }`}
              {...selection.listProps}
            >
              {fmt.commanderZone && (
                <section>
                  <div className={`${SECTION_HEAD} ${PINNED}`}>
                    <span className="min-w-0 truncate">
                      {SECTION_LABEL.commander}
                      {commanders.length > 1 && (
                        <span className="ml-1.5 font-normal tabular-nums text-ink-faint">
                          {commanders.length}
                        </span>
                      )}
                    </span>
                    {canAddSecondCommander && !pickingPartner && (
                      <button
                        className={`${SECTION_ACTION} ml-auto`}
                        onClick={() => setPickingPartner(true)}
                        title="Add a second commander — this one can have a partner"
                        type="button"
                      >
                        + Partner
                      </button>
                    )}
                  </div>
                  {commanderNote && (
                    <p className="flex items-start gap-1 px-2 pt-1.5 text-2xs text-warn">
                      <CircleAlert aria-hidden className="mt-px flex-none" size={11} />
                      {commanderNote}
                    </p>
                  )}
                  {commanders.length > 0 &&
                    (overviewShape === 'box' ? (
                      <div className={TILE_GRID}>
                        {commanders.map(c => {
                          const thumb = thumbOf(c);
                          const edition = editionOf(c);
                          return (
                            <DeckTile
                              key={cardKey(c.name)}
                              candidates={thumb.candidates}
                              card={c}
                              faceImages={thumb.faceImages}
                              onEdition={() => setPicking(c)}
                              remove={() => void deckStore.removeCard(deck.id, c.name, 'commander')}
                              setCode={edition.setCode}
                              setName={edition.setName}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <ul className="list-none divide-y divide-line">
                        {commanders.map(c => {
                          const thumb = thumbOf(c);
                          const edition = editionOf(c);
                          return (
                            <DeckRow
                              key={cardKey(c.name)}
                              candidates={thumb.candidates}
                              card={c}
                              commander
                              deckId={deck.id}
                              faceImages={thumb.faceImages}
                              onEdition={() => setPicking(c)}
                              owned={ownedOf(c.name)}
                              setCode={edition.setCode}
                              setName={edition.setName}
                            />
                          );
                        })}
                      </ul>
                    ))}
                  {commanderSearch && (
                    <div className="flex items-start gap-1 p-1.5">
                      <div className="min-w-0 flex-1">
                        <AddCardBox
                          deckFormat={deck.format}
                          embedded
                          inDeck={inDeck}
                          onPick={name => {
                            setPickingPartner(false);
                            void addCommander(name);
                          }}
                          placeholder={
                            commanders.length === 0
                              ? 'Search for your commander…'
                              : 'Search for a partner…'
                          }
                        />
                      </div>
                      {commanders.length > 0 && (
                        <IconButton
                          icon={X}
                          label="No partner after all"
                          onClick={() => setPickingPartner(false)}
                        />
                      )}
                    </div>
                  )}
                  {commanders.length === 0 && (
                    <p className="px-2 pb-2 text-2xs text-ink-faint">
                      Picking one unlocks EDHREC, Goldfish and Cuts, and keeps searches to its
                      colors.
                    </p>
                  )}
                </section>
              )}
              {layout.map(({ cards, groups, key, label, section, tagId }, index) => {
                // Its group headers take over the top while its cards scroll by.
                const pinnedGroups = groups.some(g => g.label);
                return (
                  <section key={key}>
                    <div className={`${SECTION_HEAD} ${pinnedGroups ? '' : PINNED}`}>
                      <span className="max-w-full flex-none truncate">
                        {label}
                        <span className="ml-1.5 font-normal tabular-nums text-ink-faint">
                          {countCards(cards)}
                        </span>
                      </span>
                      {index === 0 && overviewShape === 'list' && !selection.active && (
                        <SelectionHint className="min-w-0 flex-1 truncate text-right font-normal normal-case tracking-normal" />
                      )}
                      {tagId ? (
                        <button
                          className={`${SECTION_ACTION} ml-auto`}
                          onClick={() =>
                            void deckStore.setTagSections(
                              deck.id,
                              tagSectionIds.filter(t => t !== tagId),
                            )
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    {groups.map((group, g) => (
                      <div key={group.key}>
                        {group.label && (
                          <div className={`${GROUP_HEAD} ${g > 0 ? 'border-t' : ''}`}>
                            <GroupHeading
                              group={group}
                              section={layout.length > 1 ? label : undefined}
                            />
                          </div>
                        )}
                        {(group.sub ?? [group]).map((part, p) => (
                          <div key={part.key}>
                            {group.sub && (
                              <div className={`${SUBGROUP_HEAD} ${p > 0 ? 'border-t' : ''}`}>
                                <GroupHeading group={part} />
                              </div>
                            )}
                            {overviewShape === 'box' ? (
                              <div className={TILE_GRID}>
                                {part.cards.map(c => {
                                  const thumb = thumbOf(c);
                                  const edition = editionOf(c);
                                  const key = cardKey(c.name);
                                  const ov = deck.tagOverrides;
                                  const hasOv =
                                    ov != null && Object.prototype.hasOwnProperty.call(ov, key);
                                  return (
                                    <DeckTile
                                      key={`${section}|${key}`}
                                      candidates={thumb.candidates}
                                      card={c}
                                      faceImages={thumb.faceImages}
                                      onEdition={() => setPicking(c)}
                                      remove={() =>
                                        void deckStore.removeCard(deck.id, c.name, c.section)
                                      }
                                      setCode={edition.setCode}
                                      setName={edition.setName}
                                      setQuantity={n =>
                                        void deckStore.setQuantity(deck.id, c.name, c.section, n)
                                      }
                                    >
                                      {section === 'main' && tagSectionIds.length > 0 && (
                                        <DeckCardTagMove
                                          onChange={tagId =>
                                            void deckStore.setCardTagOverride(
                                              deck.id,
                                              c.name,
                                              tagId,
                                            )
                                          }
                                          override={hasOv ? ov![key] : undefined}
                                          tagSectionIds={tagSectionIds}
                                        />
                                      )}
                                    </DeckTile>
                                  );
                                })}
                              </div>
                            ) : (
                              <ul className="list-none divide-y divide-line">
                                {part.cards.map(c => {
                                  const thumb = thumbOf(c);
                                  const edition = editionOf(c);
                                  const key = cardKey(c.name);
                                  const ov = deck.tagOverrides;
                                  const hasOv =
                                    ov != null && Object.prototype.hasOwnProperty.call(ov, key);
                                  return (
                                    <DeckRow
                                      key={`${section}|${key}`}
                                      auto={
                                        !!deck.autoLands &&
                                        section === 'main' &&
                                        isBasicLand(c.name)
                                      }
                                      candidates={thumb.candidates}
                                      card={c}
                                      deckId={deck.id}
                                      faceImages={thumb.faceImages}
                                      onEdition={() => setPicking(c)}
                                      onTagOverride={
                                        section === 'main' && tagSectionIds.length > 0
                                          ? tagId =>
                                              void deckStore.setCardTagOverride(
                                                deck.id,
                                                c.name,
                                                tagId,
                                              )
                                          : undefined
                                      }
                                      owned={ownedOf(c.name)}
                                      rowId={`${section}|${key}`}
                                      selection={selection}
                                      setCode={edition.setCode}
                                      setName={edition.setName}
                                      tagOverride={hasOv ? ov![key] : undefined}
                                      tagSectionIds={tagSectionIds}
                                    />
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </section>
                );
              })}
              {deck.cards.length === 0 && (
                <EmptyState
                  hint={
                    fmt.commanderZone
                      ? 'Search above by name, type or mana value, find cards by mechanic under Tags, or bring in a list with Import.'
                      : 'Search above by name, type or mana value, or bring in a list with Import.'
                  }
                  icon={Search}
                  title="This deck is empty"
                />
              )}
            </div>

            {picking && (
              <EditionPicker
                currentId={editionOf(picking).scryfallId}
                name={picking.name}
                onClose={() => setPicking(null)}
                onPick={print => chooseEdition(picking, print)}
              />
            )}

            {/* Floats over the list instead of joining the rows above it: a bar
              that appeared on the first pick would push the list down under
              the pointer, and the next click would land on the wrong card. */}
            {selection.active && (
              <div className="absolute inset-x-2 bottom-2 z-20 mx-auto max-w-xl overflow-hidden rounded-md border border-line-strong bg-panel shadow-pop [&>div]:border-b-0">
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const DeckRow = ({
  auto = false,
  card,
  candidates,
  commander = false,
  deckId,
  faceImages,
  onEdition,
  onTagOverride,
  owned,
  rowId,
  selection,
  setCode,
  setName,
  tagOverride,
  tagSectionIds = [],
}: {
  /** Managed by auto-balance — quantity edits here get recalculated away. */
  auto?: boolean;
  candidates: readonly string[];
  card: DeckCard;
  commander?: boolean;
  deckId: string;
  faceImages?: string[];
  onEdition?: () => void;
  onTagOverride?: (tagId: string | null) => void;
  owned: number;
  /** Selection id; omitted (with `selection`) for rows that can't be picked. */
  rowId?: string;
  selection?: RowSelection;
  setCode?: string;
  setName?: string;
  tagOverride?: string;
  tagSectionIds?: readonly string[];
}) => {
  const [adding, setAdding] = useState(false);
  const need = Math.max(0, card.quantity - owned);
  const basic = skipOwnership(card.name);
  const status = owned >= card.quantity ? 'owned' : owned > 0 ? 'partial' : 'buy';
  // `group` so the row's remove button can hide until the pointer arrives.
  const base = 'group flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-tint';
  return (
    <li {...(selection && rowId ? selection.rowProps(rowId, base) : { className: base })}>
      <CollectionThumb
        candidates={candidates}
        faceImages={faceImages}
        name={card.name}
        previewKey={`deck|${card.section}|${cardKey(card.name)}`}
      />

      {commander ? (
        <span aria-hidden className="text-sm text-warn" title="Commander">
          ♛
        </span>
      ) : null}

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

      {onTagOverride && (
        <DeckCardTagMove
          onChange={onTagOverride}
          override={tagOverride}
          tagSectionIds={tagSectionIds}
        />
      )}

      {!commander ? (
        // A stepper, quiet until hovered so a long list doesn't read as buttons.
        // Sits after the name, just before ownership badges / remove.
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
      ) : null}

      {basic ? (
        <Badge title="Basic lands aren’t tracked in your collection">basic</Badge>
      ) : status === 'owned' ? (
        <Badge title={`You own ${owned}`} tone="pos">
          <Check aria-hidden size={10} strokeWidth={3} />
        </Badge>
      ) : (
        <>
          <button
            className="inline-flex h-4 flex-none items-center rounded-full bg-pos-soft px-1.5 text-2xs font-medium text-pos hover:ring-1 hover:ring-inset hover:ring-pos disabled:opacity-60"
            disabled={adding}
            onClick={() => {
              setAdding(true);
              const printing = card.printing;
              void collectionStore
                .addCopies(card.name, need)
                .then(() => {
                  if (!printing) return;
                  return cardImageOverrideStore.set(cardKey(card.name), {
                    collectorNumber: printing.collectorNumber,
                    imageUrl: printing.imageUrl,
                    scryfallId: printing.scryfallId,
                    setCode: printing.setCode,
                    setName: printing.setName,
                  });
                })
                .finally(() => setAdding(false));
            }}
            title={
              need === 1
                ? `Add ${card.name} to your collection`
                : `Add ${need} copies of ${card.name} to your collection`
            }
            type="button"
          >
            add{need > 1 ? ` ${need}` : ''}
          </button>
          <a
            className="flex-none"
            href={buyUrl(card.name, card.printing?.cardmarketId)}
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
        </>
      )}

      {onEdition && <SetSymbol onClick={onEdition} setCode={setCode} setName={setName} />}

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

/** A mana value the way the cards print it: the generic mana symbol. */
const ManaPip = ({ value }: { value: string }) => (
  <span
    aria-label={`Mana value ${value}`}
    className="inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[#cac5c0] px-1 text-2xs font-bold leading-none tabular-nums text-black shadow-[-1px_1px_0_rgb(0_0_0/0.6)]"
    role="img"
    title={`Mana value ${value}`}
  >
    {value}
  </span>
);

/**
 * A group header's contents. `section` names the section the group belongs to,
 * for lists with more than one: the section's own header scrolls away while
 * this one stays pinned.
 */
const GroupHeading = ({ group, section }: { group: DeckCardGroup; section?: string }) => {
  const count = countCards(group.cards);
  return (
    <>
      {group.manaValue ? (
        <ManaPip value={group.manaValue} />
      ) : (
        <span className="min-w-0 truncate">{group.label}</span>
      )}
      <span className="flex-none font-normal tabular-nums text-ink-muted">
        {count} {count === 1 ? 'card' : 'cards'}
      </span>
      {section && (
        <span className="ml-auto min-w-0 truncate pl-2 text-2xs font-medium uppercase tracking-wide text-ink-faint">
          {section}
        </span>
      )}
    </>
  );
};

/**
 * A card in the image view. Clicking the picture zooms it; the edit controls
 * wait for the pointer, like a row's, so a grid of a hundred cards reads as
 * cards rather than as three hundred buttons.
 */
const DeckTile = ({
  candidates,
  card,
  children,
  faceImages,
  onEdition,
  remove,
  setCode,
  setName,
  setQuantity,
}: {
  candidates: readonly string[];
  card: DeckCard;
  /** Goes under the name (the tag-section picker). */
  children?: ReactNode;
  faceImages?: string[];
  onEdition?: () => void;
  remove: () => void;
  setCode?: string;
  setName?: string;
  /** Left out where the count is fixed at one: a commander. */
  setQuantity?: (quantity: number) => void;
}) => (
  <div className="group flex min-w-0 flex-col gap-1">
    <div className="relative">
      <CollectionThumb
        candidates={candidates}
        className="card-frame aspect-[488/680] w-full cursor-zoom-in overflow-hidden bg-raised"
        faceImages={faceImages}
        hover={false}
        name={card.name}
        previewKey={`deck|box|${card.section}|${cardKey(card.name)}`}
      />
      {card.quantity > 1 && (
        <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/75 px-1 text-2xs font-semibold tabular-nums text-white">
          {card.quantity}×
        </span>
      )}
      <div className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-0.5 rounded border border-line-strong bg-panel p-0.5 opacity-0 shadow-pop transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {setQuantity && (
          <>
            <IconButton
              icon={Minus}
              label={`One less ${card.name}`}
              onClick={() => setQuantity(card.quantity - 1)}
              size="xs"
            />
            <span className="min-w-4 text-center text-2xs font-medium tabular-nums text-ink">
              {card.quantity}
            </span>
            <IconButton
              icon={Plus}
              label={`One more ${card.name}`}
              onClick={() => setQuantity(card.quantity + 1)}
              size="xs"
            />
          </>
        )}
        {onEdition && <SetSymbol onClick={onEdition} setCode={setCode} setName={setName} />}
        <IconButton
          icon={X}
          label={`Remove ${card.name}${card.section === 'commander' ? ' from the command zone' : ''}`}
          onClick={remove}
          size="xs"
          tone="danger"
        />
      </div>
    </div>
    <span className="truncate px-0.5 text-2xs text-ink" title={card.name}>
      {card.name}
    </span>
    {children}
  </div>
);

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
  embedded = false,
  filters = false,
  inDeck,
  onPick,
  onPickMany,
  placeholder = 'Add a card — type a name…',
  trailing,
}: {
  /**
   * The deck commander's color identity, once known. Preselects the identity
   * filter so searches only turn up cards that are legal in the deck.
   */
  commanderIdentity?: string[];
  /** Deck format — restricts results to format-legal cards. */
  deckFormat?: DeckFormat;
  /** Drop the outer border when the box sits inside another section. */
  embedded?: boolean;
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
  /**
   * More controls on the search's line. They wrap under it when the panel is
   * narrow; the results still open below at full width either way.
   */
  trailing?: ReactNode;
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
    // Keep filter / Scryfall-syntax searches open so you can click through many
    // hits (t:god, type chips, …). Plain name lookups still clear for the next card.
    if (keepSearchOpen(text)) return;
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
    selection.clear();
    if (keepSearchOpen(text)) return;
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

  /** True when the box is a filter/syntax harvest, not a one-off name add. */
  function keepSearchOpen(q: string): boolean {
    if (!filters) return false;
    if (looksLikeSyntax(q.trim())) return true;
    return types.size > 0 || !!subtype.trim() || !!cmcMin || !!cmcMax;
  }

  const showImages = results.cards.length > 0 && results.total <= IMAGE_THRESHOLD;

  return (
    <div className={embedded ? 'min-w-0' : 'flex-none border-b border-line p-1.5'}>
      <div className="flex flex-wrap gap-1">
        <SearchInput
          className="min-w-[8rem]"
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
        {trailing && <div className="flex flex-none items-center gap-1">{trailing}</div>}
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
                // The preview lives on the image so clicking it enlarges the card;
                // clicks anywhere else on the tile add.
                const { handlers } = preview(`search|${c.id}`, c.name, previewUrls(c));
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
                          className="h-28 w-full cursor-zoom-in object-cover"
                          src={c.imageUrl}
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
                    const { handlers } = preview(`search|${c.id}`, c.name, previewUrls(c));
                    // Hovering the row previews; the thumbnail enlarges the card
                    // so the rest of the row still adds it.
                    const { onClick: zoom, ...hover } = handlers;
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
                              onClick={zoom}
                            >
                              <img
                                alt=""
                                className="h-full w-full cursor-zoom-in object-cover"
                                loading="lazy"
                                src={c.imageUrl}
                                style={{ objectPosition: '50% 18%' }}
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
