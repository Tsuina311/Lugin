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

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import type { DeckCard, DeckFormat } from '@/lib/deck';
import {
  DEFAULT_CUT_THRESHOLD,
  edhrecPlayRates,
  suggestCuts,
  type CutCandidate,
} from '@/lib/deckCuts';
import { buildTagsQuery, filterDeckTags } from '@/lib/deckTags';
import { fetchEdhrec, type EdhrecData } from '@/lib/edhrec';
import { searchScryfallQuery, type CardSearchResult } from '@/lib/search';

export function DeckTags({
  deckFormat,
  deckQuantity,
  onAdd,
  ownedQuantity,
}: {
  deckFormat: DeckFormat;
  deckQuantity: (name: string) => number;
  onAdd: (name: string) => void;
  ownedQuantity: (name: string) => number;
}) {
  const [tagSearch, setTagSearch] = useState('');
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
  const tags = useMemo(() => {
    const found = filterDeckTags(tagSearch).slice(0, tagSearch.trim() ? 36 : 24);
    const picked = selectedIds
      .map(id => filterDeckTags(id).find(tag => tag.id === id))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    const byId = new Map([...picked, ...found].map(tag => [tag.id, tag]));
    return [...byId.values()];
  }, [selectedIds, tagSearch]);

  useEffect(() => {
    if (!selectedKey) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      const query = buildTagsQuery([...selected].sort());
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
  }, [deckFormat, selected, selectedKey]);

  const visible = useMemo(
    () =>
      results.filter(card => {
        if (hideInDeck && deckQuantity(card.name) > 0) return false;
        if (ownedOnly && ownedQuantity(card.name) === 0) return false;
        return true;
      }),
    [deckQuantity, hideInDeck, ownedOnly, ownedQuantity, results],
  );

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
        <Text style={styles.resultCount}>{visible.length} cards</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3D7EFF" />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : selected.size === 0 ? (
        <Text style={styles.empty}>Pick one or more tags to find matching cards.</Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={card => card.id}
          renderItem={({ item }) => (
            <ToolCardRow
              action="+"
              imageUrl={item.thumbUrl ?? item.imageUrl}
              meta={[
                item.typeLine,
                ownedQuantity(item.name) > 0 ? `owned ×${ownedQuantity(item.name)}` : 'not owned',
              ]
                .filter(Boolean)
                .join(' · ')}
              name={item.name}
              onAction={() => onAdd(item.name)}
              onImagePress={() => setPreview(item)}
            />
          )}
          style={styles.flex}
        />
      )}
      {preview ? (
        <CardPreviewModal
          candidates={cardImageCandidates({
            imageUrl: preview.imageUrl,
            name: preview.name,
            scryfallId: preview.id,
          })}
          name={preview.name}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </View>
  );
}

export function DeckCuts({
  cards,
  commanderNames,
  onCut,
}: {
  cards: readonly DeckCard[];
  commanderNames: readonly string[];
  onCut: (name: string) => void;
}) {
  const [data, setData] = useState<EdhrecData | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_CUT_THRESHOLD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <View style={styles.root}>
      <View style={styles.cutToolbar}>
        <View style={styles.flex}>
          <Text style={styles.toolTitle}>Suggested cuts</Text>
          <Text style={styles.toolMeta}>
            {data
              ? `${cuts.cuts.length} of ${cuts.candidates} cards below ${threshold}%`
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
      ) : (
        <FlatList
          data={cuts.cuts}
          keyExtractor={cut => cardKey(cut.card.name)}
          renderItem={({ item }) => (
            <CutRow cut={item} floor={played.floor} onCut={() => onCut(item.card.name)} />
          )}
          style={styles.flex}
        />
      )}
    </View>
  );
}

const CutRow = ({ cut, floor, onCut }: { cut: CutCandidate; floor: number; onCut: () => void }) => (
  <ToolCardRow
    action="Cut"
    meta={`${cut.card.quantity > 1 ? `${cut.card.quantity} copies · ` : ''}${
      cut.inclusion == null
        ? `not listed · under ${Math.round(floor * 100)}%`
        : `played in ${Math.round(cut.inclusion * 100)}% of decks`
    }`}
    name={cut.card.name}
    onAction={onCut}
  />
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
    <View style={styles.flex}>
      <Text numberOfLines={1} style={styles.cardName}>
        {name}
      </Text>
      <Text numberOfLines={1} style={styles.cardMeta}>
        {meta}
      </Text>
    </View>
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
  input: {
    backgroundColor: '#121A28',
    borderRadius: 8,
    color: '#F4F7FB',
    marginBottom: 7,
    paddingHorizontal: 11,
    paddingVertical: 9,
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
  tagPicker: { flexGrow: 0, marginBottom: 7, maxHeight: 135 },
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
