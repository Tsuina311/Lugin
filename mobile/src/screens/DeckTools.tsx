import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CardPreviewModal } from '../ui/CardPreviewModal';
import { CardThumb } from '../ui/CardThumb';
import { DeckSuggestionPreview } from '../ui/DeckSuggestionPreview';

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import type { CollectionCard } from '@/lib/collection';
import type { DeckCard, DeckFormat, DeckPrinting } from '@/lib/deck';
import { applyDeckBrowse, type DeckBrowseState } from '@/lib/deckBrowse';
import {
  DEFAULT_CUT_THRESHOLD,
  edhrecPlayRates,
  suggestCuts,
  type CutCandidate,
} from '@/lib/deckCuts';
import { buildTagsQuery, customOracleQuery, filterDeckTags } from '@/lib/deckTags';
import { fetchEdhrec, type EdhrecData } from '@/lib/edhrec';
import { searchScryfallQuery, type CardSearchResult } from '@/lib/search';

export function DeckTags({
  browse,
  collectionCards,
  deckFormat,
  deckQuantity,
  identity,
  identityError,
  onAdd,
  onRetryIdentity,
  ownedQuantity,
}: {
  browse: DeckBrowseState;
  collectionCards: readonly CollectionCard[];
  deckFormat: DeckFormat;
  deckQuantity: (name: string) => number;
  identity?: string[] | null;
  identityError?: string | null;
  onAdd: (name: string, printing?: DeckPrinting) => void;
  onRetryIdentity?: () => void;
  ownedQuantity: (name: string) => number;
}) {
  const [tagSearch, setTagSearch] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideInDeck, setHideInDeck] = useState(true);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [preview, setPreview] = useState<CardSearchResult | null>(null);
  const request = useRef(0);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedKey = selectedIds.slice().sort().join('|');
  const customQuery = useMemo(() => customOracleQuery(customDraft), [customDraft]);
  const tags = useMemo(() => {
    const found = filterDeckTags(tagSearch).slice(0, tagSearch.trim() ? 36 : 24);
    const picked = selectedIds
      .map(id => filterDeckTags(id).find(tag => tag.id === id))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    const byId = new Map([...picked, ...found].map(tag => [tag.id, tag]));
    return [...byId.values()];
  }, [selectedIds, tagSearch]);

  useEffect(() => {
    if ((!selectedKey && !customQuery) || identity === null) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const query = buildTagsQuery(
        [...selected].sort(),
        identity,
        customQuery ? [customQuery] : [],
      );
      void searchScryfallQuery(query, 80, deckFormat).then(
        response => {
          if (id !== request.current) return;
          setResults(response.cards);
          setLoading(false);
        },
        reason => {
          if (id !== request.current) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : 'Tag search failed.');
          setLoading(false);
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [customQuery, deckFormat, identity, selected, selectedKey]);

  const visible = useMemo(() => {
    const filtered = results.filter(card => {
        if (hideInDeck && deckQuantity(card.name) > 0) return false;
        if (ownedOnly && ownedQuantity(card.name) === 0) return false;
        return true;
      });
    return applyDeckBrowse(
      filtered,
      card => ({
        cmc: card.cmc,
        land: card.typeLine?.includes('Land'),
        name: card.name,
        owned: ownedQuantity(card.name),
        tags: selectedIds,
        typeLine: card.typeLine,
      }),
      browse,
    );
  }, [
    browse,
    deckQuantity,
    hideInDeck,
    ownedOnly,
    ownedQuantity,
    results,
    selectedIds,
  ]);

  const toggle = (id: string): void => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <View style={styles.root}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setTagSearch}
        placeholder="Find tags — draw, wolves, tokens…"
        placeholderTextColor="#6E7B91"
        style={styles.input}
        value={tagSearch}
      />
      <View style={styles.customRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setCustomDraft}
          placeholder="Custom Scryfall — kobold, goad, o:goad…"
          placeholderTextColor="#6E7B91"
          style={styles.customInput}
          value={customDraft}
        />
        {customDraft ? (
          <Pressable
            accessibilityLabel="Clear custom Scryfall query"
            onPress={() => setCustomDraft('')}
            style={styles.customClear}
          >
            <Text style={styles.customClearText}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.tags}
        keyboardShouldPersistTaps="handled"
        style={styles.tagPicker}
      >
        {tags.map(tag => {
          const active = selected.has(tag.id);
          return (
            <Pressable
              key={tag.id}
              onPress={() => toggle(tag.id)}
              style={[styles.tag, active && styles.tagOn]}
            >
              <Text style={[styles.tagText, active && styles.tagTextOn]}>
                {tag.label}
                {active ? ' ×' : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.filters}>
        <Pressable onPress={() => setHideInDeck(value => !value)} style={styles.filter}>
          <Text style={[styles.filterText, hideInDeck && styles.filterTextOn]}>Hide in deck</Text>
        </Pressable>
        <Pressable onPress={() => setOwnedOnly(value => !value)} style={styles.filter}>
          <Text style={[styles.filterText, ownedOnly && styles.filterTextOn]}>Owned only</Text>
        </Pressable>
        <Text style={styles.resultCount}>{loading ? 'Searching…' : `${visible.length} cards`}</Text>
      </View>
      {identity === null ? (
        <View style={styles.center}>
          {identityError ? (
            <>
              <Text style={styles.error}>{identityError}</Text>
              <Pressable onPress={onRetryIdentity} style={styles.action}>
                <Text style={styles.actionText}>Retry color check</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color="#3D7EFF" />
              <Text style={styles.toolMeta}>Checking commander colors…</Text>
            </>
          )}
        </View>
      ) : loading && results.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3D7EFF" />
          <Text style={styles.toolMeta}>Searching Scryfall…</Text>
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : selected.size === 0 && !customQuery ? (
        <Text style={styles.empty}>
          {customDraft.trim()
            ? 'Type at least two characters for a custom search.'
            : 'Pick a tag or type a custom Scryfall search.'}
        </Text>
      ) : (
        <FlatList
          key={browse.view}
          ListEmptyComponent={<Text style={styles.empty}>No cards match these filters.</Text>}
          ListHeaderComponent={
            loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#3D7EFF" size="small" />
                <Text style={styles.toolMeta}>Updating results…</Text>
              </View>
            ) : null
          }
          columnWrapperStyle={browse.view === 'grid' ? styles.gridColumns : undefined}
          data={visible}
          keyExtractor={card => card.id}
          numColumns={browse.view === 'grid' ? 2 : 1}
          renderItem={({ item }) => (
            browse.view === 'grid' ? (
              <ToolCardGrid
                action="+"
                imageUrl={item.thumbUrl ?? item.imageUrl}
                name={item.name}
                onAction={() => onAdd(item.name)}
                onImagePress={() => setPreview(item)}
                owned={ownedQuantity(item.name)}
              />
            ) : (
              <ToolCardRow
                action="+"
                imageUrl={item.thumbUrl ?? item.imageUrl}
                meta={[
                  item.typeLine,
                  ownedQuantity(item.name) > 0
                    ? `owned ×${ownedQuantity(item.name)}`
                    : 'not owned',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                name={item.name}
                onAction={() => onAdd(item.name)}
                onImagePress={() => setPreview(item)}
              />
            )
          )}
          style={styles.flex}
        />
      )}
      {preview ? (
        <DeckSuggestionPreview
          candidates={cardImageCandidates({
            imageUrl: preview.imageUrl,
            name: preview.name,
            scryfallId: preview.id,
          })}
          collectionCards={collectionCards}
          defaultPrinting={{
            collectorNumber: preview.collectorNumber,
            imageUrl: preview.imageUrl,
            scryfallId: preview.id,
            setCode: preview.setCode,
          }}
          faceImages={preview.faceImages}
          name={preview.name}
          onAdd={onAdd}
          onClose={() => setPreview(null)}
          placeholderCandidates={preview.thumbUrl ? [preview.thumbUrl] : undefined}
        />
      ) : null}
    </View>
  );
}

export function DeckCuts({
  browse,
  cards,
  commanderNames,
  metadata,
  onCut,
  ownedQuantity,
}: {
  browse: DeckBrowseState;
  cards: readonly DeckCard[];
  commanderNames: readonly string[];
  metadata: Record<string, CardSearchResult>;
  onCut: (name: string) => void;
  ownedQuantity: (name: string) => number;
}) {
  const [data, setData] = useState<EdhrecData | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_CUT_THRESHOLD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const request = useRef(0);
  const commanderKey = commanderNames.map(cardKey).join('|');

  const load = (force = false): void => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    void fetchEdhrec([...commanderNames], undefined, force).then(
      response => {
        if (id !== request.current) return;
        setData(response);
        setLoading(false);
      },
      reason => {
        if (id !== request.current) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : 'EDHREC failed.');
        setLoading(false);
      },
    );
  };

  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
    // Load follows this commander key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderKey]);

  const played = useMemo(() => edhrecPlayRates(data), [data]);
  const cuts = useMemo(() => suggestCuts(cards, played, threshold), [cards, played, threshold]);
  const visibleCuts = useMemo(
    () =>
      applyDeckBrowse(
        cuts.cuts,
        cut => {
          const meta = metadata[cardKey(cut.card.name)];
          return {
            cmc: meta?.cmc,
            land: meta?.typeLine?.includes('Land'),
            name: cut.card.name,
            owned: ownedQuantity(cut.card.name),
            tags: ['cut', cut.inclusion == null ? 'not listed' : 'low inclusion'],
            typeLine: meta?.typeLine,
          };
        },
        browse,
      ),
    [browse, cuts.cuts, metadata, ownedQuantity],
  );

  return (
    <View style={styles.root}>
      <View style={styles.cutToolbar}>
        <View style={styles.flex}>
          <Text style={styles.toolTitle}>Suggested cuts</Text>
          <Text style={styles.toolMeta}>
            {data
              ? `${visibleCuts.length} of ${cuts.candidates} cards below ${threshold}%`
              : 'Compared with EDHREC decks'}
          </Text>
        </View>
        <Pressable
          onPress={() => setThreshold(value => Math.max(1, value - 5))}
          style={styles.thresholdButton}
        >
          <Text style={styles.thresholdButtonText}>−</Text>
        </Pressable>
        <Text style={styles.threshold}>{threshold}%</Text>
        <Pressable
          onPress={() => setThreshold(value => Math.min(100, value + 5))}
          style={styles.thresholdButton}
        >
          <Text style={styles.thresholdButtonText}>+</Text>
        </Pressable>
        <Pressable onPress={() => load(true)} style={styles.refresh}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>
      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3D7EFF" />
          <Text style={styles.empty}>Checking EDHREC play rates…</Text>
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : cuts.cuts.length === 0 ? (
        <Text style={styles.empty}>
          Every card is played in at least {threshold}% of decks. Raise the threshold to be harsher.
        </Text>
      ) : visibleCuts.length === 0 ? (
        <Text style={styles.empty}>No suggested cuts match these filters.</Text>
      ) : (
        <FlatList
          key={browse.view}
          columnWrapperStyle={browse.view === 'grid' ? styles.gridColumns : undefined}
          data={visibleCuts}
          keyExtractor={cut => cardKey(cut.card.name)}
          numColumns={browse.view === 'grid' ? 2 : 1}
          renderItem={({ item }) => (
            browse.view === 'grid' ? (
              <ToolCardGrid
                action="Cut"
                name={item.card.name}
                onAction={() => onCut(item.card.name)}
                onImagePress={() => setPreview(item.card.name)}
                owned={ownedQuantity(item.card.name)}
              />
            ) : (
              <CutRow
                cut={item}
                floor={played.floor}
                onCut={() => onCut(item.card.name)}
                onPreview={() => setPreview(item.card.name)}
              />
            )
          )}
          style={styles.flex}
        />
      )}
      {preview ? (
        <CardPreviewModal
          candidates={cardImageCandidates({ name: preview })}
          name={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </View>
  );
}

const CutRow = ({
  cut,
  floor,
  onCut,
  onPreview,
}: {
  cut: CutCandidate;
  floor: number;
  onCut: () => void;
  onPreview: () => void;
}) => (
  <ToolCardRow
    action="Cut"
    meta={`${cut.card.quantity > 1 ? `${cut.card.quantity} copies · ` : ''}${
      cut.inclusion == null
        ? `not listed · under ${Math.round(floor * 100)}%`
        : `played in ${Math.round(cut.inclusion * 100)}% of decks`
    }`}
    name={cut.card.name}
    onAction={onCut}
    onImagePress={onPreview}
  />
);

const ToolCardGrid = ({
  action,
  imageUrl,
  name,
  onAction,
  onImagePress,
  owned,
}: {
  action: string;
  imageUrl?: string;
  name: string;
  onAction: () => void;
  onImagePress: () => void;
  owned: number;
}) => (
  <View style={styles.gridCard}>
    <Pressable accessibilityLabel={`Preview ${name}`} onPress={onImagePress}>
      <CardThumb candidates={cardImageCandidates({ imageUrl, name })} style={styles.gridImage} />
    </Pressable>
    <Text numberOfLines={1} style={styles.gridName}>
      {name}
    </Text>
    <View style={styles.gridFooter}>
      <Text style={styles.gridOwned}>{owned > 0 ? `owned ×${owned}` : 'not owned'}</Text>
      <Pressable accessibilityLabel={`${action} ${name}`} onPress={onAction} style={styles.gridAdd}>
        <Text style={styles.actionText}>{action}</Text>
      </Pressable>
    </View>
  </View>
);

const ToolCardRow = ({
  action,
  imageUrl,
  meta,
  name,
  onAction,
  onImagePress,
}: {
  action: string;
  imageUrl?: string;
  meta: string;
  name: string;
  onAction: () => void;
  onImagePress?: () => void;
}) => (
  <View style={styles.cardRow}>
    <Pressable
      accessibilityLabel={onImagePress ? `Open image for ${name}` : undefined}
      disabled={!onImagePress}
      onPress={onImagePress}
    >
      <CardThumb candidates={cardImageCandidates({ imageUrl, name })} style={styles.thumb} />
    </Pressable>
    <Pressable
      accessibilityLabel={onImagePress ? `Open image for ${name}` : undefined}
      disabled={!onImagePress}
      onPress={onImagePress}
      style={styles.flex}
    >
      <Text numberOfLines={1} style={styles.cardName}>
        {name}
      </Text>
      <Text numberOfLines={1} style={styles.cardMeta}>
        {meta}
      </Text>
    </Pressable>
    <Pressable
      accessibilityLabel={`${action} ${name}`}
      onPress={onAction}
      style={[styles.action, action === 'Cut' && styles.cutAction]}
    >
      <Text style={styles.actionText}>{action}</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 36,
    paddingHorizontal: 9,
  },
  actionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  cardMeta: { color: '#8A97AD', fontSize: 11, marginTop: 2 },
  cardName: { color: '#F4F7FB', fontSize: 14, fontWeight: '600' },
  cardRow: {
    alignItems: 'center',
    borderBottomColor: '#1C2636',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    minHeight: 58,
    paddingVertical: 6,
  },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 20 },
  customClear: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  customClearText: { color: '#AAB6C9', fontSize: 22, lineHeight: 24 },
  customInput: {
    color: '#F4F7FB',
    flex: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  customRow: {
    alignItems: 'center',
    backgroundColor: '#121A28',
    borderColor: '#26354B',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 7,
  },
  cutAction: { backgroundColor: '#8C3340' },
  cutToolbar: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 8 },
  empty: { color: '#8A97AD', lineHeight: 19, padding: 18, textAlign: 'center' },
  error: { color: '#E98A8A', lineHeight: 19, padding: 18, textAlign: 'center' },
  filter: {
    backgroundColor: '#1C2636',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  filterText: { color: '#8A97AD', fontSize: 11, fontWeight: '600' },
  filterTextOn: { color: '#8CB4FF' },
  filters: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 5 },
  flex: { flex: 1 },
  gridAdd: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 7,
    height: 28,
    justifyContent: 'center',
    width: 32,
  },
  gridCard: {
    backgroundColor: '#121A28',
    borderColor: '#26354B',
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    maxWidth: '48.5%',
    overflow: 'hidden',
  },
  gridColumns: { gap: 10, marginBottom: 10 },
  gridFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 7,
    paddingHorizontal: 7,
  },
  gridImage: { aspectRatio: 488 / 680, backgroundColor: '#1C2636', width: '100%' },
  gridName: {
    color: '#F4F7FB',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingTop: 6,
  },
  gridOwned: { color: '#8290A6', flex: 1, fontSize: 9 },
  input: {
    backgroundColor: '#121A28',
    borderRadius: 8,
    color: '#F4F7FB',
    marginBottom: 7,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  refresh: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
  refreshText: { color: '#C5D3E8', fontSize: 20 },
  resultCount: { color: '#697991', fontSize: 11, marginLeft: 'auto' },
  root: { flex: 1 },
  tag: {
    borderColor: '#334158',
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  tagOn: { backgroundColor: '#17345B', borderColor: '#3D7EFF' },
  tagPicker: { flexGrow: 0, marginBottom: 7, maxHeight: 82 },
  tagText: { color: '#AAB6C9', fontSize: 11 },
  tagTextOn: { color: '#9BBEFF', fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  threshold: {
    color: '#F4F7FB',
    fontSize: 12,
    fontWeight: '800',
    minWidth: 30,
    textAlign: 'center',
  },
  thresholdButton: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 7,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  thresholdButtonText: { color: '#F4F7FB', fontSize: 17, fontWeight: '700' },
  thumb: { backgroundColor: '#1C2636', borderRadius: 5, height: 48, width: 34 },
  toolMeta: { color: '#8A97AD', fontSize: 11, marginTop: 2 },
  toolTitle: { color: '#DCE5F2', fontSize: 13, fontWeight: '800' },
});
