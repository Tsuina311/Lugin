import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { libraryStore } from '../data/libraryStore';
import { useLibrary } from '../data/useLibrary';
import { CardPreviewModal } from '../ui/CardPreviewModal';
import { CardThumb, deckImageCandidates } from '../ui/CardThumb';
import { DeckBrowseControls } from '../ui/DeckBrowseControls';
import { DeckPrintingPicker } from '../ui/DeckSuggestionPreview';

import { CommanderPickerScreen } from './CommanderPickerScreen';
import { DeckRecommendations, type RecommendationSource } from './DeckRecommendations';
import { DeckStats } from './DeckStats';
import { DeckCuts, DeckTags } from './DeckTools';

import { BRACKET_NAME } from '@/lib/bracket';
import { cardImageCandidates, candidatesByName } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import { buildCollection } from '@/lib/collection';
import {
  countCards,
  coverageView,
  copiesAcrossDecks,
  copiesUsed,
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  mergeDeckCards,
  paperAddSection,
  withDeckCardPrinting,
  withFormat,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckPrinting,
  type DeckTagAnalysis,
} from '@/lib/deck';
import {
  applyDeckBrowse,
  DEFAULT_DECK_BROWSE,
  type DeckBrowseState,
} from '@/lib/deckBrowse';
import { deckTagById } from '@/lib/deckTags';
import { estimateDeck, type DeckBracketEstimate } from '@/lib/decks/bracket/estimator';
import {
  basicsMatchPlan,
  isBasicLand,
  planBasicLands,
  withBasicLands,
} from '@/lib/lands';
import { isLandType, sortWubrg } from '@/lib/mtg';
import {
  searchCards,
  searchExactCard,
  searchExactCards,
  type CardSearchResult,
} from '@/lib/search';

type DeckView = 'deck' | 'tags' | 'cuts' | 'stats' | RecommendationSource;

/** Direct image files first for small covers; API image redirects are much slower. */
const fastCoverCandidates = (candidates: readonly string[]): string[] => [
  ...candidates.filter(url => !url.includes('api.scryfall.com')),
  ...candidates.filter(url => url.includes('api.scryfall.com')),
];

export function DeckScreens() {
  const library = useLibrary();
  const [openId, setOpenId] = useState<string | null>(null);
  const deck = library.data?.decks.value.find(item => item.id === openId) ?? null;
  if (deck) return <DeckEditor deck={deck} onClose={() => setOpenId(null)} />;
  return <DeckList onOpen={setOpenId} />;
}

const DeckList = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const decks = library.data?.decks.value ?? [];
  const [format, setFormat] = useState<DeckFormat>('commander');
  const [name, setName] = useState('');
  const [paste, setPaste] = useState('');
  const [pickingCommander, setPickingCommander] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bracketInfo, setBracketInfo] = useState<DeckBracketEstimate | null>(null);
  const collectionCards = library.data?.collection.value?.cards ?? [];
  const owned = useMemo(() => {
    return buildCollection(collectionCards, '', 'list').byKey;
  }, [collectionCards]);
  const images = useMemo(() => candidatesByName(collectionCards), [collectionCards]);
  const commanderNamesNeedingImages = useMemo(
    () =>
      [
        ...new Set(
          decks
            .map(deck => deck.cards.find(card => card.section === 'commander'))
            .filter(
              (card): card is DeckCard =>
                Boolean(card && !card.printing && !images.has(cardKey(card.name))),
            )
            .map(card => card.name),
        ),
      ],
    [decks, images],
  );
  const commanderNamesKey = commanderNamesNeedingImages.join('\0');
  const [commanderFallbacks, setCommanderFallbacks] = useState<
    Record<string, readonly string[]>
  >({});
  useEffect(() => {
    if (!commanderNamesKey) {
      setCommanderFallbacks({});
      return;
    }
    let cancelled = false;
    void searchExactCards(commanderNamesNeedingImages).then(
      cards => {
        if (cancelled) return;
        setCommanderFallbacks(
          Object.fromEntries(
            cards.map(card => [
              cardKey(card.name),
              [card.thumbUrl, card.imageUrl].filter((url): url is string => Boolean(url)),
            ]),
          ),
        );
      },
      () => {
        if (!cancelled) setCommanderFallbacks({});
      },
    );
    return () => {
      cancelled = true;
    };
  }, [commanderNamesKey, commanderNamesNeedingImages]);
  const deckRows = useMemo(
    () =>
      decks.map(deck => ({
        bracket: deck.format === 'commander' ? estimateDeck(deck.cards, null) : null,
        commander: deck.cards.find(card => card.section === 'commander'),
        deck,
        missingCount: deckShortfall(deck.cards, owned).length,
      })),
    [decks, owned],
  );

  const create = async (commanderName?: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await libraryStore.createDeck(format, name.trim() || commanderName, commanderName);
      setName('');
      setPickingCommander(false);
      onOpen(id);
    } finally {
      setCreating(false);
    }
  };

  if (pickingCommander) {
    return (
      <CommanderPickerScreen
        busy={creating}
        onCancel={() => setPickingCommander(false)}
        onPick={commander => void create(commander)}
        onSkip={() => void create()}
      />
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Decks</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.formats}>
        {DECK_FORMATS.map(item => (
          <Pressable key={item.id} onPress={() => setFormat(item.id)} style={styles.chip}>
            <Text style={[styles.chipLabel, format === item.id && styles.chipOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.meta}>
        {format === 'commander'
          ? 'Start with a legal commander, then build the 99.'
          : `Create an empty ${formatInfo(format).label} deck.`}
      </Text>
      <View style={styles.addRow}>
        <TextInput
          onChangeText={setName}
          placeholder="Deck name"
          placeholderTextColor="#6E7B91"
          style={[styles.input, styles.flex]}
          value={name}
        />
        <Pressable
          onPress={() => {
            if (format === 'commander') setPickingCommander(true);
            else void create();
          }}
          style={[styles.addButton, creating && styles.disabled]}
        >
          <Text style={styles.addLabel}>
            {format === 'commander' ? 'Search commander' : 'Create deck'}
          </Text>
        </Pressable>
      </View>
      <TextInput
        multiline
        onChangeText={setPaste}
        placeholder="Paste a deck list"
        placeholderTextColor="#6E7B91"
        style={[styles.input, styles.paste]}
        value={paste}
      />
      <Pressable
        onPress={() => {
          void libraryStore.importDeckList(paste).then(id => {
            if (id) {
              setPaste('');
              onOpen(id);
            }
          });
        }}
        style={styles.secondary}
      >
        <Text style={styles.secondaryLabel}>Import list</Text>
      </Pressable>
      <FlatList
        ListEmptyComponent={<Text style={styles.meta}>No decks yet.</Text>}
        data={deckRows}
        keyExtractor={item => item.deck.id}
        renderItem={({ item: row }) => {
          const { bracket, commander, deck: item, missingCount } = row;
          const rawCoverCandidates = commander
            ? [
                ...(commanderFallbacks[cardKey(commander.name)] ?? []),
                ...deckImageCandidates(commander, images),
              ]
            : [];
          const coverCandidates =
            commander?.printing ? rawCoverCandidates : fastCoverCandidates(rawCoverCandidates);
          return (
            <Pressable onPress={() => onOpen(item.id)} style={styles.deckRow}>
              {commander ? (
                <CardThumb
                  candidates={coverCandidates}
                  style={styles.deckCover}
                />
              ) : (
                <View style={styles.deckCover} />
              )}
              <View style={styles.flex}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {formatInfo(item.format).label} · {countCards(item.cards)} cards
                  {missingCount > 0 ? ` · ${missingCount} missing` : ''}
                  {item.frozen ? ' · paper' : ''}
                </Text>
              </View>
              {bracket ? (
                <BracketPill
                  bracket={bracket}
                  onPress={event => {
                    event.stopPropagation();
                    setBracketInfo(bracket);
                  }}
                />
              ) : null}
            </Pressable>
          );
        }}
        style={styles.flex}
      />
      {bracketInfo ? (
        <BracketInfo bracket={bracketInfo} onClose={() => setBracketInfo(null)} open />
      ) : null}
    </View>
  );
};

const DeckCardSearch = ({
  format,
  identity,
  identityError,
  onAdd,
  onRetryIdentity,
}: {
  format: DeckFormat;
  identity?: string[] | null;
  identityError?: string | null;
  onAdd: (name: string) => void;
  onRetryIdentity?: () => void;
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CardSearchResult | null>(null);
  const request = useRef(0);
  const needle = query.trim();

  useEffect(() => {
    const mine = ++request.current;
    if (needle.length < 2 || identity === null) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void searchCards({ format, identity: identity ?? undefined, text: needle }, 6).then(
        response => {
          if (request.current !== mine) return;
          setResults(response.cards);
          setLoading(false);
        },
        reason => {
          if (request.current !== mine) return;
          setResults([]);
          setLoading(false);
          setError(reason instanceof Error ? reason.message : 'Card search failed.');
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [format, identity, needle]);

  const add = (name: string) => {
    onAdd(name);
    setQuery('');
    setResults([]);
  };

  return (
    <View style={styles.cardSearch}>
      <TextInput
        autoCapitalize="words"
        autoCorrect={false}
        editable={identity !== null}
        onChangeText={setQuery}
        placeholder={identity === null ? 'Loading commander colors…' : 'Search real card names'}
        placeholderTextColor="#6E7B91"
        style={styles.input}
        value={query}
      />
      {identity === null && identityError ? (
        <Pressable onPress={onRetryIdentity} style={styles.identityRetry}>
          <Text style={styles.identityErrorText}>{identityError}</Text>
          <Text style={styles.identityRetryText}>Retry</Text>
        </Pressable>
      ) : null}
      {loading ? (
        <View style={styles.cardSearchLoading}>
          <ActivityIndicator color="#8FB4FF" size="small" />
          <Text style={styles.meta}>Searching Scryfall…</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.cardSearchError}>{error}</Text> : null}
      {needle.length >= 2 && !loading && !error && results.length === 0 ? (
        <Text style={styles.meta}>No legal cards match. Nothing will be added.</Text>
      ) : null}
      {results.length > 0 ? (
        <View style={styles.cardSearchResults}>
          {results.map(card => (
            <View key={card.id} style={styles.cardSearchResult}>
              <Pressable
                accessibilityLabel={`Preview ${card.name}`}
                onPress={() => setPreview(card)}
              >
                <CardThumb
                  candidates={cardImageCandidates({
                    collectorNumber: card.collectorNumber,
                    imageUrl: card.thumbUrl ?? card.imageUrl,
                    name: card.name,
                    scryfallId: card.id,
                    setCode: card.setCode,
                  })}
                  style={styles.cardSearchThumb}
                />
              </Pressable>
              <Pressable
                accessibilityLabel={`Preview ${card.name}`}
                onPress={() => setPreview(card)}
                style={styles.flex}
              >
                <Text numberOfLines={1} style={styles.name}>
                  {card.name}
                </Text>
                <Text numberOfLines={1} style={styles.cardSearchType}>
                  {card.typeLine ?? 'Magic card'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Add ${card.name} to the main deck`}
                onPress={() => add(card.name)}
                style={styles.cardSearchAddButton}
              >
                <Text style={styles.cardSearchAdd}>+ Add</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {preview ? (
        <CardPreviewModal
          candidates={cardImageCandidates({
            collectorNumber: preview.collectorNumber,
            imageUrl: preview.imageUrl,
            name: preview.name,
            scryfallId: preview.id,
            setCode: preview.setCode,
          })}
          faceImages={preview.faceImages}
          name={preview.name}
          onClose={() => setPreview(null)}
          placeholderCandidates={preview.thumbUrl ? [preview.thumbUrl] : undefined}
        />
      ) : null}
    </View>
  );
};

const DeckFormatPicker = ({
  format,
  onChange,
  onClose,
}: {
  format: DeckFormat;
  onChange: (format: DeckFormat) => void;
  onClose: () => void;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible>
    <Pressable onPress={onClose} style={styles.pickerBackdrop}>
      <Pressable
        onPress={(event: GestureResponderEvent) => event.stopPropagation()}
        style={styles.formatPicker}
      >
        <Text style={styles.formatPickerTitle}>Deck format</Text>
        {DECK_FORMATS.map(item => {
          const selected = item.id === format;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                onChange(item.id);
                onClose();
              }}
              style={[styles.formatChoice, selected && styles.formatChoiceOn]}
            >
              <Text style={[styles.formatChoiceText, selected && styles.formatChoiceTextOn]}>
                {item.label}
              </Text>
              {selected ? <Text style={styles.formatCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </Pressable>
    </Pressable>
  </Modal>
);

const LandManager = ({
  auto,
  basics,
  chosen,
  disabled,
  loading,
  onAutoChange,
  onClose,
  onRemoveBasics,
  onTargetChange,
  open,
  ready,
  target,
  total,
  unresolved,
}: {
  auto: boolean;
  basics: number;
  chosen: number;
  disabled: boolean;
  loading: boolean;
  onAutoChange: (enabled: boolean) => void;
  onClose: () => void;
  onRemoveBasics: () => void;
  onTargetChange: (target: number) => void;
  open: boolean;
  ready: boolean;
  target: number;
  total: number;
  unresolved: number;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
    <Pressable onPress={onClose} style={styles.modalBackdrop}>
      <Pressable
        onPress={(event: GestureResponderEvent) => event.stopPropagation()}
        style={styles.landPanel}
      >
        <View style={styles.landHeader}>
          <View style={styles.flex}>
            <Text style={styles.landTitle}>Lands</Text>
            <Text style={styles.rowMeta}>
              {total} now · {basics} basic
              {chosen > 0 ? ` · ${chosen} other` : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.modalDone}>
            <Text style={styles.modalDoneText}>Done</Text>
          </Pressable>
        </View>
        <View style={styles.landTargetRow}>
          <View style={styles.flex}>
            <Text style={styles.landOptionTitle}>Land target</Text>
            <Text style={styles.rowMeta}>Nonbasic lands count toward this total.</Text>
          </View>
          <Pressable
            disabled={disabled || target <= 0}
            onPress={() => onTargetChange(Math.max(0, target - 1))}
            style={[styles.step, disabled && styles.disabled]}
          >
            <Text style={styles.addLabel}>−</Text>
          </Pressable>
          <Text style={styles.landTarget}>{target}</Text>
          <Pressable
            disabled={disabled}
            onPress={() => onTargetChange(target + 1)}
            style={[styles.step, disabled && styles.disabled]}
          >
            <Text style={styles.addLabel}>+</Text>
          </Pressable>
        </View>
        <Pressable
          disabled={disabled || loading || unresolved > 0 || !ready}
          onPress={() => onAutoChange(!auto)}
          style={[
            styles.landToggle,
            auto && styles.landToggleOn,
            (disabled || loading || unresolved > 0 || !ready) && styles.disabled,
          ]}
        >
          <View style={[styles.landCheck, auto && styles.landCheckOn]}>
            <Text style={styles.landCheckText}>{auto ? '✓' : ''}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.landOptionTitle}>Top up with basics</Text>
            <Text style={styles.rowMeta}>
              Keeps the target filled and splits basics by your deck’s mana needs.
            </Text>
          </View>
        </Pressable>
        {loading ? <Text style={styles.landNotice}>Reading card colors and mana costs…</Text> : null}
        {!loading && !ready ? (
          <Text style={styles.landWarning}>Choose a commander before balancing its basics.</Text>
        ) : !loading && unresolved > 0 ? (
          <Text style={styles.landWarning}>
            {unresolved} unknown card {unresolved === 1 ? 'name prevents' : 'names prevent'} safe
            automatic land balancing.
          </Text>
        ) : null}
        {basics > 0 && !disabled ? (
          <Pressable onPress={onRemoveBasics} style={styles.landRemove}>
            <Text style={styles.landRemoveText}>Remove all basics</Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Pressable>
  </Modal>
);

const DeckEditor = ({ deck, onClose }: { deck: Deck; onClose: () => void }) => {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [view, setView] = useState<DeckView>('deck');
  const [bracketOpen, setBracketOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [landsOpen, setLandsOpen] = useState(false);
  const [browse, setBrowse] = useState<DeckBrowseState>(DEFAULT_DECK_BROWSE);
  const [nameDraft, setNameDraft] = useState(deck.name);
  const commanderZone = formatInfo(deck.format).commanderZone;
  const [browsingCommanders, setBrowsingCommanders] = useState(false);
  const [commanderSaving, setCommanderSaving] = useState(false);
  const [preview, setPreview] = useState<DeckCard | null>(null);
  const [printingCard, setPrintingCard] = useState<DeckCard | null>(null);
  const [commanderIdentity, setCommanderIdentity] = useState<string[] | null | undefined>(
    undefined,
  );
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityRetry, setIdentityRetry] = useState(0);
  const [landMetadata, setLandMetadata] = useState<Record<string, CardSearchResult>>({});
  const [landMetadataLoading, setLandMetadataLoading] = useState(false);
  const collectionCards = library.data?.collection.value?.cards ?? [];
  const owned = useMemo(
    () => buildCollection(collectionCards, '', 'list').byKey,
    [collectionCards],
  );
  const images = useMemo(() => candidatesByName(collectionCards), [collectionCards]);
  const bracket = useMemo(
    () => (deck.format === 'commander' ? estimateDeck(deck.cards, null) : null),
    [deck.cards, deck.format],
  );
  const commanders = deck.cards.filter(card => card.section === 'commander').map(card => card.name);
  const commanderKey = commanders.map(cardKey).sort().join('|');
  const browseDeckCards = (cards: DeckCard[]): DeckCard[] =>
    applyDeckBrowse(
      cards,
      card => {
        const key = cardKey(card.name);
        const metadata = landMetadata[key];
        const tagId = deck.tagOverrides?.[key];
        return {
          cmc: metadata?.cmc,
          land: isBasicLand(card.name) || isLandType(metadata),
          name: card.name,
          owned: owned[key]?.total ?? 0,
          tags: [card.section, tagId, tagId ? deckTagById(tagId)?.label : undefined].filter(
            (tag): tag is string => Boolean(tag),
          ),
          typeLine: metadata?.typeLine,
        };
      },
      browse,
    );
  const browseSections = (
    cards: DeckCard[],
    id: 'main' | 'sideboard',
    title: string,
  ): DeckCardSection[] => {
    const sorted = browseDeckCards(cards);
    if (browse.sort !== 'mana') return [{ data: sorted, id, title }];
    const groups = new Map<string, DeckCard[]>();
    for (const card of sorted) {
      const metadata = landMetadata[cardKey(card.name)];
      const key =
        isBasicLand(card.name) || isLandType(metadata)
          ? 'land'
          : metadata?.cmc == null
            ? 'unknown'
            : String(Math.min(7, Math.floor(metadata.cmc)));
      const group = groups.get(key) ?? [];
      group.push(card);
      groups.set(key, group);
    }
    const keys = ['0', '1', '2', '3', '4', '5', '6', '7', 'unknown', 'land'];
    const sections = keys.flatMap(key => {
      const data = groups.get(key);
      if (!data?.length) return [];
      const label =
        key === 'land' ? 'Lands' : key === 'unknown' ? 'Unknown mana value' : `MV ${key === '7' ? '7+' : key}`;
      return [{ data, id: `${id}:${key}`, title: `${title} · ${label}` }];
    });
    return sections.length > 0 ? sections : [{ data: [], id, title }];
  };
  const cardSections: DeckCardSection[] = [
    ...(commanderZone
      ? [
          {
            data: browseDeckCards(deck.cards.filter(card => card.section === 'commander')),
            id: 'commander' as const,
            title: 'Commander',
          },
        ]
      : []),
    ...browseSections(
      deck.cards.filter(card => card.section === 'main'),
      'main',
      commanderZone ? 'Main deck' : 'Cards',
    ),
    ...(deck.cards.some(card => card.section === 'sideboard')
      ? browseSections(
          deck.cards.filter(card => card.section === 'sideboard'),
          'sideboard',
          'Sideboard',
        )
      : []),
  ];
  const firstMainSectionId = cardSections.find(
    section => section.id === 'main' || section.id.startsWith('main:'),
  )?.id;
  const deckQuantities = useMemo(() => {
    const quantities: Record<string, number> = {};
    for (const card of deck.cards) {
      const key = cardKey(card.name);
      quantities[key] = (quantities[key] ?? 0) + card.quantity;
    }
    return quantities;
  }, [deck.cards]);
  const missing = deckShortfall(deck.cards, owned);
  const landTarget = deck.landTarget ?? formatInfo(deck.format).landCount;
  const landNames = useMemo(
    () =>
      [...new Set(
        deck.cards
          .filter(card => card.section !== 'sideboard' && !isBasicLand(card.name))
          .map(card => card.name),
      )],
    [deck.cards],
  );
  const landNamesKey = landNames.map(cardKey).sort().join('|');

  useEffect(() => {
    if (!commanderZone || commanders.length === 0) {
      setCommanderIdentity(undefined);
      setIdentityError(null);
      return;
    }
    let cancelled = false;
    setCommanderIdentity(null);
    setIdentityError(null);
    void Promise.all(commanders.map(searchExactCard)).then(
      cards => {
        if (cancelled) return;
        if (cards.some(card => !card)) {
          setIdentityError('Commander colors could not be verified.');
          return;
        }
        const colors = new Set(cards.flatMap(card => card?.colorIdentity ?? []));
        setCommanderIdentity(sortWubrg([...colors]));
      },
      reason => {
        if (cancelled) return;
        setIdentityError(
          reason instanceof Error ? reason.message : 'Commander colors could not be verified.',
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // Commander names, not the array identity, define this lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderKey, commanderZone, identityRetry]);

  useEffect(() => {
    if (landNames.length === 0) {
      setLandMetadata({});
      setLandMetadataLoading(false);
      return;
    }
    let cancelled = false;
    setLandMetadataLoading(true);
    void searchExactCards(landNames).then(
      cards => {
        if (cancelled) return;
        setLandMetadata(Object.fromEntries(cards.map(card => [cardKey(card.name), card])));
        setLandMetadataLoading(false);
      },
      () => {
        if (!cancelled) setLandMetadataLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // The names' content, not the rebuilt array, controls this lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landNamesKey]);

  const unresolvedLandNames = landNames.filter(name => !landMetadata[cardKey(name)]).length;
  const landColors = useMemo(() => {
    if (commanderZone) return commanders.length > 0 ? (commanderIdentity ?? null) : null;
    const colors = new Set<string>();
    for (const card of Object.values(landMetadata)) {
      for (const color of card.colorIdentity ?? []) colors.add(color);
    }
    return sortWubrg([...colors]);
  }, [commanderIdentity, commanderZone, commanders.length, landMetadata]);
  const landCounts = useMemo(() => {
    let basics = 0;
    let chosen = 0;
    for (const card of deck.cards) {
      if (card.section === 'sideboard') continue;
      if (isBasicLand(card.name)) basics += card.quantity;
      else if (isLandType(landMetadata[cardKey(card.name)])) chosen += card.quantity;
    }
    return { basics, chosen, total: basics + chosen };
  }, [deck.cards, landMetadata]);
  const landPlan = useMemo(() => {
    if (
      landTarget == null ||
      landColors == null ||
      landMetadataLoading ||
      unresolvedLandNames > 0
    ) {
      return null;
    }
    return planBasicLands({
      cards: deck.cards,
      colors: landColors,
      landTarget,
      metaByKey: landMetadata,
    });
  }, [
    deck.cards,
    landColors,
    landMetadata,
    landMetadataLoading,
    landTarget,
    unresolvedLandNames,
  ]);

  useEffect(() => {
    if (
      deck.frozen ||
      !deck.autoLands ||
      !landPlan ||
      basicsMatchPlan(deck.cards, landPlan)
    ) {
      return;
    }
    void libraryStore.updateDeck(deck.id, current => ({
      ...current,
      cards: withBasicLands(current.cards, landPlan),
    }));
  }, [deck.autoLands, deck.cards, deck.frozen, deck.id, landPlan]);

  useEffect(() => {
    if (nameDraft === deck.name) return;
    const timer = setTimeout(() => {
      void libraryStore.updateDeck(deck.id, current => ({ ...current, name: nameDraft }));
    }, 300);
    return () => clearTimeout(timer);
  }, [deck.id, deck.name, nameDraft]);

  const save = (update: (current: Deck) => Deck) => {
    void libraryStore.updateDeck(deck.id, update);
  };
  const saveTagAnalysis = useCallback(
    (analysis: DeckTagAnalysis) => {
      void libraryStore.updateDeckTagAnalysis(deck.id, analysis);
    },
    [deck.id],
  );

  const pickCommander = async (name: string) => {
    if (commanderSaving) return;
    setCommanderSaving(true);
    try {
      const write = libraryStore.updateDeck(deck.id, current => ({
        ...current,
        cards: current.cards.some(
          card => card.section === 'commander' && cardKey(card.name) === cardKey(name),
        )
          ? current.cards
          : mergeDeckCards(current.cards, [{ name, quantity: 1, section: 'commander' }]),
      }));
      let stored = libraryStore
        .getSnapshot()
        .data?.decks.value.find(candidate => candidate.id === deck.id)
        ?.cards.some(card => card.section === 'commander' && cardKey(card.name) === cardKey(name));
      if (!stored) {
        await write;
        stored = libraryStore
          .getSnapshot()
          .data?.decks.value.find(candidate => candidate.id === deck.id)
          ?.cards.some(
            card => card.section === 'commander' && cardKey(card.name) === cardKey(name),
          );
        if (!stored) throw new Error('The commander was not saved.');
        setBrowsingCommanders(false);
        return;
      }
      setBrowsingCommanders(false);
      await write;
    } catch (reason) {
      Alert.alert(
        'Commander not added',
        reason instanceof Error ? reason.message : 'Please try again.',
      );
    } finally {
      setCommanderSaving(false);
    }
  };

  const addSearchedCard = (name: string) => {
    save(current => ({
      ...current,
      cards: mergeDeckCards(current.cards, [{ name, quantity: 1, section: 'main' }]),
    }));
  };

  const addRecommendation = (name: string, printing?: DeckPrinting) => {
    save(current => {
      const section = paperAddSection(current, 'main');
      const cards = mergeDeckCards(current.cards, [{ name, printing, quantity: 1, section }]);
      return {
        ...current,
        cards: printing
          ? cards.map(card =>
              card.section === section && cardKey(card.name) === cardKey(name)
                ? { ...card, printing }
                : card,
            )
          : cards,
      };
    });
  };

  const setCardQuantity = (item: DeckCard, quantity: number): void => {
    save(current => ({
      ...current,
      cards:
        quantity <= 0
          ? current.cards.filter(
              candidate =>
                !(
                  candidate.section === item.section &&
                  cardKey(candidate.name) === cardKey(item.name)
                ),
            )
          : current.cards.map(candidate =>
              candidate.section === item.section &&
              cardKey(candidate.name) === cardKey(item.name)
                ? { ...candidate, quantity }
                : candidate,
            ),
    }));
  };

  const cutCard = (name: string) => {
    if (deck.frozen) return;
    save(current => ({
      ...current,
      cards: current.cards.filter(
        card => !(card.section === 'main' && cardKey(card.name) === cardKey(name)),
      ),
    }));
  };

  const confirmDelete = (): void => {
    Alert.alert('Delete deck', `Delete ${deck.name}? This cannot be undone.`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void libraryStore.removeDeck(deck.id);
          onClose();
        },
        style: 'destructive',
        text: 'Delete',
      },
    ]);
  };

  const deckTabs: readonly { id: DeckView; label: string }[] =
    commanders.length > 0
      ? [
          { id: 'deck', label: 'Deck' },
          { id: 'tags', label: 'Tags' },
          { id: 'edhrec', label: 'EDHREC' },
          { id: 'goldfish', label: 'Goldfish' },
          { id: 'cuts', label: 'Cuts' },
          { id: 'stats', label: 'Stats' },
        ]
      : [
          { id: 'deck', label: 'Deck' },
          { id: 'tags', label: 'Tags' },
          { id: 'stats', label: 'Stats' },
        ];

  if (browsingCommanders) {
    return (
      <CommanderPickerScreen
        busy={commanderSaving}
        cancelLabel="Deck"
        onCancel={() => setBrowsingCommanders(false)}
        onPick={name => void pickCommander(name)}
        title="Search commander"
      />
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.editorTitleRow}>
        <Pressable accessibilityLabel="Back to decks" onPress={onClose} style={styles.iconButton}>
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Deck name"
          onChangeText={setNameDraft}
          selectTextOnFocus
          style={styles.deckNameInput}
          value={nameDraft}
        />
      </View>
      <View style={styles.summaryRow}>
        <Pressable
          accessibilityLabel={`Change deck format. Current format ${formatInfo(deck.format).label}`}
          onPress={() => setFormatOpen(true)}
          style={styles.summaryFormat}
        >
          <Text style={styles.summaryFormatText}>{formatInfo(deck.format).label} ▾</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.summaryText}>
          {countCards(deck.cards)} cards
          {missing.length > 0 ? ` · ${missing.length} short` : ' · collection covers it'}
        </Text>
        {landTarget != null ? (
          <Pressable
            accessibilityLabel={`${landCounts.total} of ${landTarget} lands. Open land controls`}
            onPress={() => setLandsOpen(true)}
            style={[styles.landPill, deck.autoLands && styles.landPillOn]}
          >
            <Text style={styles.landPillIcon}>▲</Text>
            <Text style={styles.landPillText}>
              {landCounts.total}/{landTarget}
            </Text>
          </Pressable>
        ) : null}
        {bracket ? <BracketPill bracket={bracket} onPress={() => setBracketOpen(true)} /> : null}
        <Pressable
          accessibilityLabel={deck.frozen ? 'Unlock paper deck' : 'Mark as paper deck'}
          onPress={() => save(current => ({ ...current, frozen: !current.frozen }))}
          style={[styles.iconButton, deck.frozen && styles.iconButtonOn]}
        >
          <Text style={styles.iconButtonText}>{deck.frozen ? '▣' : '▤'}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Share deck"
          onPress={() => void libraryStore.shareDeck(deck)}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>↗</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Delete deck"
          onPress={confirmDelete}
          style={styles.iconButton}
        >
          <View style={styles.trashIcon}>
            <View style={styles.trashHandle} />
            <View style={styles.trashLid} />
            <View style={styles.trashCan} />
          </View>
        </Pressable>
      </View>
      {deckTabs.length > 1 ? (
        <View style={styles.tabs}>
          {deckTabs.map(tab => (
            <Pressable
              key={tab.id}
              onPress={() => setView(tab.id)}
              style={[styles.tab, view === tab.id && styles.tabOn]}
            >
              <Text style={[styles.tabLabel, view === tab.id && styles.tabLabelOn]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {view !== 'deck' && view !== 'stats' ? (
        <DeckBrowseControls onChange={setBrowse} state={browse} />
      ) : null}
      {view === 'deck' ? (
        browse.view === 'grid' ? (
          <View style={styles.flex}>
            <DeckCardSearch
              format={deck.format}
              identity={commanderIdentity}
              identityError={identityError}
              onAdd={addSearchedCard}
              onRetryIdentity={() => setIdentityRetry(value => value + 1)}
            />
            <DeckGrid
              browse={browse}
              deck={deck}
              images={images}
              onBrowseChange={setBrowse}
              onChange={setCardQuantity}
              onCommanderSearch={() => setBrowsingCommanders(true)}
              onOpen={setPreview}
              sections={cardSections}
            />
          </View>
        ) : (
          <SectionList
          ListHeaderComponent={
            <DeckCardSearch
              format={deck.format}
              identity={commanderIdentity}
              identityError={identityError}
              onAdd={addSearchedCard}
              onRetryIdentity={() => setIdentityRetry(value => value + 1)}
            />
          }
          contentContainerStyle={styles.deckListContent}
          keyExtractor={(card, index) => `${card.section}:${cardKey(card.name)}:${index}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <DeckRow
              card={item}
              deck={deck}
              decks={library.data?.decks.value ?? []}
              images={images}
              onChange={quantity => setCardQuantity(item, quantity)}
              onOpen={() => setPreview(item)}
              owned={owned[cardKey(item.name)]?.total ?? 0}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.deckSectionHeader}>
              <Text style={styles.deckSectionTitle}>
                {section.title} · {section.data.reduce((sum, card) => sum + card.quantity, 0)}
              </Text>
              {section.id === 'commander' ? (
                <Pressable
                  accessibilityLabel="Search commander"
                  onPress={() => setBrowsingCommanders(true)}
                  style={styles.sectionSearch}
                >
                  <Text style={styles.sectionSearchIcon}>⌕</Text>
                </Pressable>
              ) : null}
              {section.id === firstMainSectionId ? (
                <DeckBrowseControls inline onChange={setBrowse} state={browse} />
              ) : null}
            </View>
          )}
          sections={cardSections}
          stickySectionHeadersEnabled
          style={styles.flex}
          />
        )
      ) : view === 'tags' ? (
        <DeckTags
          browse={browse}
          collectionCards={collectionCards}
          deckFormat={deck.format}
          deckQuantity={name => deckQuantities[cardKey(name)] ?? 0}
          identity={commanderIdentity}
          identityError={identityError}
          onAdd={addRecommendation}
          onRetryIdentity={() => setIdentityRetry(value => value + 1)}
          ownedQuantity={name => owned[cardKey(name)]?.total ?? 0}
        />
      ) : view === 'cuts' ? (
        deck.frozen ? (
          <Text style={styles.emptyPanel}>
            This deck is locked as a paper deck. Unlock it before cutting cards.
          </Text>
        ) : (
          <DeckCuts
            browse={browse}
            cards={deck.cards}
            commanderNames={commanders}
            metadata={landMetadata}
            onCut={cutCard}
            ownedQuantity={name => owned[cardKey(name)]?.total ?? 0}
          />
        )
      ) : view === 'stats' ? (
        <DeckStats deck={deck} metadata={landMetadata} onAnalysis={saveTagAnalysis} />
      ) : commanders.length > 0 ? (
        <DeckRecommendations
          browse={browse}
          collectionCards={collectionCards}
          commanderNames={commanders}
          deckQuantity={name => deckQuantities[cardKey(name)] ?? 0}
          onAdd={addRecommendation}
          ownedQuantity={name => owned[cardKey(name)]?.total ?? 0}
          source={view}
        />
      ) : null}
      {preview ? (
        <CardPreviewModal
          candidates={deckImageCandidates(preview, images)}
          name={preview.name}
          onClose={() => setPreview(null)}
          onOtherEdition={() => {
            setPrintingCard(preview);
            setPreview(null);
          }}
        />
      ) : null}
      {printingCard ? (
        <DeckPrintingPicker
          actionLabel="Use selected edition"
          collectionCards={collectionCards}
          defaultPrinting={printingCard.printing}
          name={printingCard.name}
          onChoose={printing => {
            save(current => ({
              ...current,
              cards: withDeckCardPrinting(
                current.cards,
                printingCard.section,
                printingCard.name,
                printing,
              ),
            }));
            setPrintingCard(null);
          }}
          onClose={() => setPrintingCard(null)}
        />
      ) : null}
      {bracket ? (
        <BracketInfo bracket={bracket} onClose={() => setBracketOpen(false)} open={bracketOpen} />
      ) : null}
      {formatOpen ? (
        <DeckFormatPicker
          format={deck.format}
          onChange={format => save(current => withFormat(current, format))}
          onClose={() => setFormatOpen(false)}
        />
      ) : null}
      {landTarget != null ? (
        <LandManager
          auto={deck.autoLands === true}
          basics={landCounts.basics}
          chosen={landCounts.chosen}
          disabled={deck.frozen === true}
          loading={landMetadataLoading}
          onAutoChange={enabled =>
            save(current => ({
              ...current,
              autoLands: enabled,
            }))
          }
          onClose={() => setLandsOpen(false)}
          onRemoveBasics={() =>
            save(current => ({
              ...current,
              autoLands: false,
              cards: withBasicLands(current.cards, {}),
            }))
          }
          onTargetChange={target =>
            save(current => ({
              ...current,
              landTarget: target,
            }))
          }
          open={landsOpen}
          ready={landColors != null}
          target={landTarget}
          total={landCounts.total}
          unresolved={unresolvedLandNames}
        />
      ) : null}
    </View>
  );
};

interface DeckCardSection {
  data: DeckCard[];
  id: string;
  title: string;
}

type DeckGridItem =
  | { id: string; kind: 'header'; section: DeckCardSection }
  | { cards: DeckCard[]; id: string; kind: 'row' };

const DeckGrid = ({
  browse,
  deck,
  images,
  onBrowseChange,
  onChange,
  onCommanderSearch,
  onOpen,
  sections,
}: {
  browse: DeckBrowseState;
  deck: Deck;
  images: Map<string, readonly string[]>;
  onBrowseChange: (state: DeckBrowseState) => void;
  onChange: (card: DeckCard, quantity: number) => void;
  onCommanderSearch: () => void;
  onOpen: (card: DeckCard) => void;
  sections: DeckCardSection[];
}) => {
  const items: DeckGridItem[] = [];
  const firstMainSectionId = sections.find(
    section => section.id === 'main' || section.id.startsWith('main:'),
  )?.id;
  for (const section of sections) {
    items.push({ id: `header:${section.id}`, kind: 'header', section });
    for (let index = 0; index < section.data.length; index += 2) {
      items.push({
        cards: section.data.slice(index, index + 2),
        id: `row:${section.id}:${index}`,
        kind: 'row',
      });
    }
    if (section.data.length === 0) {
      items.push({ cards: [], id: `row:${section.id}:empty`, kind: 'row' });
    }
  }
  return (
    <FlatList
      contentContainerStyle={styles.deckGridContent}
      data={items}
      initialNumToRender={7}
      keyExtractor={item => item.id}
      maxToRenderPerBatch={6}
      removeClippedSubviews
      renderItem={({ item }) => {
        if (item.kind === 'header') {
          const section = item.section;
          return (
            <View style={styles.deckSectionHeader}>
              <Text style={styles.deckSectionTitle}>
                {section.title} · {section.data.reduce((sum, card) => sum + card.quantity, 0)}
              </Text>
              {section.id === 'commander' ? (
                <Pressable
                  accessibilityLabel="Search commander"
                  onPress={onCommanderSearch}
                  style={styles.sectionSearch}
                >
                  <Text style={styles.sectionSearchIcon}>⌕</Text>
                </Pressable>
              ) : null}
              {section.id === firstMainSectionId ? (
                <DeckBrowseControls inline onChange={onBrowseChange} state={browse} />
              ) : null}
            </View>
          );
        }
        if (item.cards.length === 0) {
          return <Text style={styles.gridEmpty}>No cards match these filters.</Text>;
        }
        return (
          <View style={styles.deckGrid}>
            {item.cards.map(card => (
              <View key={`${card.section}:${cardKey(card.name)}`} style={styles.deckGridCard}>
                <Pressable
                  accessibilityLabel={`Open image for ${card.name}`}
                  onPress={() => onOpen(card)}
                >
                  <CardThumb
                    candidates={deckImageCandidates(card, images)}
                    style={styles.deckGridImage}
                  />
                </Pressable>
                <Text numberOfLines={1} style={styles.deckGridName}>
                  {card.name}
                </Text>
                <View style={styles.deckGridFooter}>
                  <Pressable
                    disabled={deck.frozen}
                    onPress={() => onChange(card, card.quantity - 1)}
                    style={[styles.deckGridStep, deck.frozen && styles.disabled]}
                  >
                    <Text style={styles.deckGridStepText}>−</Text>
                  </Pressable>
                  <Text style={styles.deckGridQuantity}>{card.quantity}</Text>
                  <Pressable
                    disabled={deck.frozen}
                    onPress={() => onChange(card, card.quantity + 1)}
                    style={[styles.deckGridStep, deck.frozen && styles.disabled]}
                  >
                    <Text style={styles.deckGridStepText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        );
      }}
      style={styles.flex}
      windowSize={5}
    />
  );
};

const DeckRow = ({
  card,
  deck,
  decks,
  images,
  onChange,
  onOpen,
  owned,
}: {
  card: DeckCard;
  deck: Deck;
  decks: readonly Deck[];
  images: Map<string, readonly string[]>;
  onChange: (quantity: number) => void;
  onOpen: () => void;
  owned: number;
}) => {
  const uses = copiesAcrossDecks(card.name, decks);
  const mark = coverageView(owned, uses, deck.frozen === true);
  const used = copiesUsed(uses);
  return (
    <View style={styles.deckRow}>
      <Pressable
        accessibilityLabel={`Open image for ${card.name}`}
        onPress={onOpen}
        style={styles.deckIdentity}
      >
        <CardThumb candidates={deckImageCandidates(card, images)} style={styles.thumb} />
        <View style={styles.flex}>
          <Text style={styles.name}>{card.name}</Text>
          <Text numberOfLines={1} style={styles.rowMeta}>
            {used > 0
              ? `${owned} owned · ${used} used in ${uses.length} deck${uses.length === 1 ? '' : 's'}`
              : `${owned} owned · ${card.quantity} here`}
            {card.printing?.setCode ? ` · ${card.printing.setCode.toUpperCase()}` : ''}
          </Text>
        </View>
      </Pressable>
      {mark ? (
        <View
          accessibilityLabel={`${owned} owned, ${used} used across decks`}
          style={[
            styles.coverage,
            mark.tone === 'pos' && styles.coverageGood,
            mark.tone === 'warn' && styles.coverageWarn,
            mark.tone === 'neg' && styles.coverageBad,
            mark.tone === 'accent' && styles.coveragePaper,
          ]}
        >
          <Text style={styles.coverageText}>
            {mark.check ? '✓ ' : ''}
            {owned}/{used}
          </Text>
        </View>
      ) : null}
      <Pressable onPress={() => onChange(card.quantity - 1)} style={styles.step}>
        <Text style={styles.addLabel}>−</Text>
      </Pressable>
      <Text style={styles.qty}>{card.quantity}</Text>
      <Pressable onPress={() => onChange(card.quantity + 1)} style={styles.step}>
        <Text style={styles.addLabel}>+</Text>
      </Pressable>
    </View>
  );
};

const BracketPill = ({
  bracket,
  onPress,
}: {
  bracket: DeckBracketEstimate;
  onPress?: (event: GestureResponderEvent) => void;
}) => (
  <Pressable
    accessibilityLabel={`Estimated bracket ${bracket.estimatedBracket}, ${BRACKET_NAME[bracket.estimatedBracket]}`}
    disabled={!onPress}
    onPress={onPress}
    style={[
      styles.bracket,
      bracket.estimatedBracket === 2
        ? styles.bracketTwo
        : bracket.estimatedBracket === 3
          ? styles.bracketThree
          : styles.bracketFour,
    ]}
  >
    <Text style={styles.bracketNumber}>{bracket.estimatedBracket}</Text>
  </Pressable>
);

const BracketInfo = ({
  bracket,
  onClose,
  open,
}: {
  bracket: DeckBracketEstimate;
  onClose: () => void;
  open: boolean;
}) => (
  <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
    <Pressable onPress={onClose} style={styles.modalBackdrop}>
      <Pressable onPress={event => event.stopPropagation()} style={styles.bracketPanel}>
        <View style={styles.bracketPanelHeader}>
          <View style={styles.flex}>
            <Text style={styles.bracketPanelTitle}>
              Bracket {bracket.estimatedBracket} · {BRACKET_NAME[bracket.estimatedBracket]}
            </Text>
            <Text style={styles.rowMeta}>
              Estimated from this deck’s cards
              {bracket.likelyRange[0] !== bracket.likelyRange[1]
                ? ` · likely ${bracket.likelyRange[0]}–${bracket.likelyRange[1]}`
                : ''}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.modalDone}>
            <Text style={styles.modalDoneText}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.bracketWhy}>WHY</Text>
        {bracket.evidence.length > 0 ? (
          <ScrollView style={styles.bracketEvidence}>
            {bracket.evidence.map(item => (
              <Text key={`${item.kind}:${item.summary}`} style={styles.bracketEvidenceLine}>
                • {item.summary}
              </Text>
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.bracketEvidenceLine}>
            No Game Changers or mass land denial detected.
          </Text>
        )}
        <Text style={styles.bracketNote}>
          This is a deck-list estimate, not an official power-level rating.
        </Text>
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  addButton: {
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  addLabel: { color: '#fff', fontWeight: '700' },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  backIcon: { color: '#E8EEF7', fontSize: 26, lineHeight: 28 },
  bracket: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  bracketEvidence: { maxHeight: 260 },
  bracketEvidenceLine: { color: '#DCE5F2', fontSize: 13, lineHeight: 19, marginBottom: 7 },
  bracketFour: { backgroundColor: '#3C2516', borderColor: '#A86429' },
  bracketNote: { color: '#7D8BA2', fontSize: 11, lineHeight: 16, marginTop: 8 },
  bracketNumber: { color: '#F4F7FB', fontSize: 13, fontWeight: '800' },
  bracketPanel: {
    backgroundColor: '#121A28',
    borderColor: '#2B3850',
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '70%',
    padding: 16,
    width: '90%',
  },
  bracketPanelHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  bracketPanelTitle: { color: '#F4F7FB', fontSize: 18, fontWeight: '800' },
  bracketThree: { backgroundColor: '#152E51', borderColor: '#3D7EFF' },
  bracketTwo: { backgroundColor: '#202B3B', borderColor: '#53647C' },
  bracketWhy: {
    color: '#7D8BA2',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 7,
    marginTop: 14,
  },
  cardSearch: { marginBottom: 4 },
  cardSearchAdd: { color: '#8CB4FF', fontSize: 12, fontWeight: '800' },
  cardSearchAddButton: { alignItems: 'center', height: 38, justifyContent: 'center', minWidth: 48 },
  cardSearchError: {
    backgroundColor: '#431F27',
    borderRadius: 8,
    color: '#FFB4B4',
    fontSize: 12,
    marginBottom: 8,
    padding: 8,
  },
  cardSearchLoading: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  cardSearchResult: {
    alignItems: 'center',
    borderBottomColor: '#26354B',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    minHeight: 54,
    paddingVertical: 5,
  },
  cardSearchResults: {
    backgroundColor: '#101827',
    borderColor: '#26354B',
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  cardSearchThumb: { backgroundColor: '#1C2636', borderRadius: 3, height: 43, width: 30 },
  cardSearchType: { color: '#8A97AD', fontSize: 10, marginTop: 2 },
  chip: { marginRight: 12, paddingVertical: 6 },
  chipLabel: { color: '#8A97AD', fontSize: 13 },
  chipOn: { color: '#F4F7FB', fontWeight: '700' },
  coverage: {
    alignItems: 'center',
    borderRadius: 8,
    minWidth: 43,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  coverageBad: { backgroundColor: '#431F27' },
  coverageGood: { backgroundColor: '#173B30' },
  coveragePaper: { backgroundColor: '#17345B' },
  coverageText: { color: '#F4F7FB', fontSize: 11, fontWeight: '800' },
  coverageWarn: { backgroundColor: '#493819' },
  deckCover: {
    backgroundColor: '#1C2636',
    borderRadius: 6,
    height: 67,
    width: 48,
  },
  deckGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 9 },
  deckGridCard: {
    backgroundColor: '#121A28',
    borderColor: '#26354B',
    borderRadius: 9,
    borderWidth: 1,
    overflow: 'hidden',
    width: '48%',
  },
  deckGridContent: { paddingBottom: 12 },
  deckGridFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 7,
    paddingHorizontal: 6,
  },
  deckGridImage: { aspectRatio: 488 / 680, backgroundColor: '#1C2636', width: '100%' },
  deckGridName: {
    color: '#F4F7FB',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingTop: 6,
  },
  deckGridQuantity: {
    color: '#F4F7FB',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    textAlign: 'center',
    width: 30,
  },
  deckGridStep: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 32,
  },
  deckGridStepText: { color: '#DCE5F2', fontSize: 17, fontWeight: '800' },
  deckIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  deckListContent: { paddingBottom: 8 },
  deckNameInput: {
    color: '#F4F7FB',
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    minHeight: 36,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  deckRow: {
    alignItems: 'center',
    borderBottomColor: '#1C2636',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
  },
  deckSectionHeader: {
    alignItems: 'center',
    backgroundColor: '#0B1220',
    borderBottomColor: '#26354B',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 34,
    paddingVertical: 4,
  },
  deckSectionTitle: {
    color: '#8A97AD',
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  disabled: { opacity: 0.45 },
  editorTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  emptyPanel: {
    color: '#8A97AD',
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingVertical: 28,
    textAlign: 'center',
  },
  flex: { flex: 1 },
  formatCheck: { color: '#8CB4FF', fontSize: 18, fontWeight: '800' },
  formatChoice: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  formatChoiceOn: { backgroundColor: '#17345B' },
  formatChoiceText: { color: '#C5D3E8', flex: 1, fontSize: 14, fontWeight: '700' },
  formatChoiceTextOn: { color: '#FFFFFF' },
  formatPicker: {
    backgroundColor: '#111A28',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 14,
    paddingBottom: 24,
  },
  formatPickerTitle: {
    color: '#F4F7FB',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  formats: { flexGrow: 0, marginBottom: 8, maxHeight: 36 },
  gridEmpty: { color: '#7D8BA2', fontSize: 11, paddingVertical: 12, textAlign: 'center' },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  iconButtonOn: { backgroundColor: '#17345B' },
  iconButtonText: { color: '#E8EEF7', fontSize: 17, fontWeight: '700' },
  identityErrorText: { color: '#FFB4B4', flex: 1, fontSize: 11 },
  identityRetry: {
    alignItems: 'center',
    backgroundColor: '#431F27',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    padding: 8,
  },
  identityRetryText: { color: '#FFD1D1', fontSize: 11, fontWeight: '800' },
  input: {
    backgroundColor: '#121A28',
    borderRadius: 8,
    color: '#F4F7FB',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  landCheck: {
    alignItems: 'center',
    borderColor: '#53647C',
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  landCheckOn: { backgroundColor: '#3D7EFF', borderColor: '#3D7EFF' },
  landCheckText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  landHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  landNotice: { color: '#8CB4FF', fontSize: 11, marginTop: 10 },
  landOptionTitle: { color: '#E8EEF7', fontSize: 14, fontWeight: '700' },
  landPanel: {
    backgroundColor: '#121A28',
    borderColor: '#2B3850',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    width: '90%',
  },
  landPill: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 3,
    height: 32,
    paddingHorizontal: 7,
  },
  landPillIcon: { color: '#B9865A', fontSize: 8 },
  landPillOn: { backgroundColor: '#17345B' },
  landPillText: { color: '#E8EEF7', fontSize: 11, fontWeight: '800' },
  landRemove: { alignSelf: 'flex-start', marginTop: 14, paddingVertical: 5 },
  landRemoveText: { color: '#FFAAAA', fontSize: 12, fontWeight: '700' },
  landTarget: {
    color: '#F4F7FB',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    textAlign: 'center',
    width: 30,
  },
  landTargetRow: {
    alignItems: 'center',
    borderBottomColor: '#26354B',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
    paddingBottom: 13,
  },
  landTitle: { color: '#F4F7FB', fontSize: 18, fontWeight: '800' },
  landToggle: {
    alignItems: 'flex-start',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    padding: 10,
  },
  landToggleOn: { backgroundColor: '#17345B' },
  landWarning: { color: '#FFCB7D', fontSize: 11, lineHeight: 16, marginTop: 10 },
  meta: { color: '#8A97AD', fontSize: 12, marginBottom: 8 },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    flex: 1,
    justifyContent: 'center',
  },
  modalDone: {
    backgroundColor: '#1C2636',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  modalDoneText: { color: '#DCE5F2', fontSize: 12, fontWeight: '700' },
  name: { color: '#F4F7FB', fontSize: 16, fontWeight: '600' },
  paste: { minHeight: 64 },
  pickerBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  qty: { color: '#F4F7FB', fontVariant: ['tabular-nums'], textAlign: 'center', width: 24 },
  root: { backgroundColor: '#0B1220', flex: 1, paddingHorizontal: 16 },
  rowMeta: { color: '#8A97AD', fontSize: 11, marginTop: 3 },
  secondary: {
    backgroundColor: '#1C2636',
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryLabel: { color: '#E8EEF7', fontWeight: '700' },
  sectionSearch: {
    alignItems: 'center',
    backgroundColor: '#1D3E73',
    borderRadius: 7,
    height: 27,
    justifyContent: 'center',
    width: 30,
  },
  sectionSearchIcon: { color: '#DCE9FF', fontSize: 21, fontWeight: '800', lineHeight: 22 },
  step: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  summaryFormat: {
    backgroundColor: '#17243A',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  summaryFormatText: { color: '#BFD1ED', fontSize: 11, fontWeight: '800' },
  summaryRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 5 },
  summaryText: { color: '#8A97AD', flex: 1, fontSize: 11 },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 8,
  },
  tabLabel: { color: '#8A97AD', fontSize: 13, fontWeight: '700' },
  tabLabelOn: { color: '#F4F7FB' },
  tabOn: { backgroundColor: '#1C2636' },
  tabs: {
    backgroundColor: '#101827',
    borderRadius: 10,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 3,
  },
  thumb: { backgroundColor: '#1C2636', borderRadius: 4, height: 46, width: 32 },
  title: { color: '#F4F7FB', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  trashCan: {
    borderColor: '#E8EEF7',
    borderRadius: 2,
    borderTopWidth: 0,
    borderWidth: 1.5,
    height: 11,
    width: 10,
  },
  trashHandle: {
    backgroundColor: '#E8EEF7',
    borderRadius: 1,
    height: 2,
    marginBottom: 1,
    width: 5,
  },
  trashIcon: { alignItems: 'center', height: 18, justifyContent: 'center', width: 18 },
  trashLid: { backgroundColor: '#E8EEF7', height: 1.5, marginBottom: 1, width: 13 },
});
