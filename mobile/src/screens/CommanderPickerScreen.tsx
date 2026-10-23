import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardPreviewModal } from '../ui/CardPreviewModal';
import { CardThumb } from '../ui/CardThumb';

import { cardImageCandidates } from '@/lib/cardImage';
import { commanderQuery, COMMANDER_RARITIES, type CommanderRarity } from '@/lib/commanders';
import { customOracleQuery, deckTagById, deckTagsByCategory, filterDeckTags } from '@/lib/deckTags';
import { searchScryfallPage, type CardSearchResult } from '@/lib/search';

const COLORS = [
  { background: '#F3E7C7', code: 'W', foreground: '#302A20', label: 'White' },
  { background: '#A9D8F2', code: 'U', foreground: '#172D42', label: 'Blue' },
  { background: '#57545B', code: 'B', foreground: '#FFFFFF', label: 'Black' },
  { background: '#D86657', code: 'R', foreground: '#FFFFFF', label: 'Red' },
  { background: '#79B989', code: 'G', foreground: '#102A1A', label: 'Green' },
] as const;

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

const imageCandidates = (card: CardSearchResult): string[] =>
  cardImageCandidates({
    collectorNumber: card.collectorNumber,
    imageUrl: card.imageUrl ?? card.thumbUrl,
    name: card.name,
    scryfallId: card.id,
    setCode: card.setCode,
  });

export const CommanderPickerScreen = ({
  busy,
  cancelLabel = 'Decks',
  onCancel,
  onPick,
  onSkip,
  title = 'New Commander deck',
}: {
  busy: boolean;
  cancelLabel?: string;
  onCancel: () => void;
  onPick: (name: string) => void;
  onSkip?: () => void;
  title?: string;
}) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [colors, setColors] = useState<Set<string>>(() => new Set());
  const [colorless, setColorless] = useState(false);
  const [exactIdentity, setExactIdentity] = useState(false);
  const [rarities, setRarities] = useState<Set<string>>(() => new Set());
  const [tags, setTags] = useState<Set<string>>(() => new Set());
  const [tagSearch, setTagSearch] = useState('');
  const [customDraft, setCustomDraft] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cards, setCards] = useState<CardSearchResult[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CardSearchResult | null>(null);
  const generation = useRef(0);

  const selectedTagIds = useMemo(() => [...tags].sort(), [tags]);
  const customQuery = customOracleQuery(customDraft);
  const query = useMemo(
    () =>
      commanderQuery({
        colorless,
        exactIdentity,
        extraQueries: customQuery ? [customQuery] : [],
        identity: [...colors],
        name,
        rarities: [...rarities],
        tagIds: selectedTagIds,
      }),
    [colorless, colors, customQuery, exactIdentity, name, rarities, selectedTagIds],
  );
  const groupedTags = useMemo(() => deckTagsByCategory(filterDeckTags(tagSearch)), [tagSearch]);
  const activeFilters =
    colors.size +
    rarities.size +
    tags.size +
    (colorless ? 1 : 0) +
    (exactIdentity ? 1 : 0) +
    (customQuery ? 1 : 0);

  useEffect(() => {
    const mine = generation.current + 1;
    generation.current = mine;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void searchScryfallPage(query, { order: 'edhrec' }).then(
        page => {
          if (generation.current !== mine) return;
          setCards(page.cards);
          setNext(page.next);
          setTotal(page.total);
          setLoading(false);
        },
        reason => {
          if (generation.current !== mine) return;
          setCards([]);
          setNext(null);
          setTotal(0);
          setLoading(false);
          setError(reason instanceof Error ? reason.message : 'Commander search failed.');
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const loadMore = () => {
    if (!next || loading) return;
    const mine = generation.current;
    setLoading(true);
    void searchScryfallPage(query, { next }).then(
      page => {
        if (generation.current !== mine) return;
        setCards(current => [...current, ...page.cards]);
        setNext(page.next);
        setTotal(page.total);
        setLoading(false);
      },
      reason => {
        if (generation.current !== mine) return;
        setLoading(false);
        setError(reason instanceof Error ? reason.message : 'More commanders could not be loaded.');
      },
    );
  };

  const clearFilters = () => {
    setColors(new Set());
    setColorless(false);
    setExactIdentity(false);
    setRarities(new Set());
    setTags(new Set());
    setTagSearch('');
    setCustomDraft('');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable disabled={busy} onPress={onCancel} style={styles.headerSide}>
          <Text style={styles.headerAction}>‹ {cancelLabel}</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerSubtitle}>Choosing the commander slot</Text>
        </View>
        {onSkip ? (
          <Pressable disabled={busy} onPress={onSkip} style={styles.headerSide}>
            <Text style={[styles.headerAction, styles.headerActionRight]}>Skip</Text>
          </Pressable>
        ) : (
          <View style={styles.headerSide} />
        )}
      </View>

      <FlatList
        ListEmptyComponent={
          loading ? null : (
            <Text style={styles.empty}>
              {error ? 'Check your connection or remove a filter.' : 'No commanders match.'}
            </Text>
          )
        }
        ListFooterComponent={
          loading ? <ActivityIndicator color="#8FB4FF" style={styles.loading} /> : null
        }
        ListHeaderComponent={
          <View>
            <View style={styles.intent}>
              <Text style={styles.intentEyebrow}>COMMANDER</Text>
              <Text style={styles.intentTitle}>Pick the card that leads this deck</Text>
              <Text style={styles.intentText}>
                Only legal commanders are shown. Your choice goes directly into the command zone.
              </Text>
            </View>

            <TextInput
              autoCapitalize="words"
              autoCorrect={false}
              onChangeText={setName}
              placeholder="Search by commander name"
              placeholderTextColor="#6E7B91"
              style={styles.search}
              value={name}
            />

            <View style={styles.filterBar}>
              <Pressable
                onPress={() => setFiltersOpen(open => !open)}
                style={[styles.filterToggle, activeFilters > 0 && styles.filterToggleOn]}
              >
                <Text style={styles.filterToggleText}>
                  Filters{activeFilters > 0 ? ` · ${activeFilters}` : ''}
                </Text>
                <Text style={styles.filterChevron}>{filtersOpen ? '−' : '+'}</Text>
              </Pressable>
              {activeFilters > 0 ? (
                <Pressable onPress={clearFilters} style={styles.clearButton}>
                  <Text style={styles.clearText}>Clear all</Text>
                </Pressable>
              ) : null}
            </View>

            {filtersOpen ? (
              <View style={styles.filters}>
                <Text style={styles.filterLabel}>COLOR IDENTITY</Text>
                <Text style={styles.filterHelp}>
                  Select allowed colors. Turn on Exact to require only that identity.
                </Text>
                <View style={styles.colorRow}>
                  {COLORS.map(color => {
                    const selected = !colorless && colors.has(color.code);
                    return (
                      <Pressable
                        key={color.code}
                        accessibilityLabel={`${color.label}${selected ? ', selected' : ''}`}
                        onPress={() => {
                          setColorless(false);
                          setColors(current => {
                            const next = toggle(current, color.code);
                            if (next.size === 0) setExactIdentity(false);
                            return next;
                          });
                        }}
                        style={[
                          styles.color,
                          { backgroundColor: color.background },
                          !selected && styles.filterDimmed,
                          selected && styles.colorSelected,
                        ]}
                      >
                        <Text style={[styles.colorText, { color: color.foreground }]}>
                          {color.code}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    accessibilityLabel={`Colorless${colorless ? ', selected' : ''}`}
                    onPress={() => {
                      setColors(new Set());
                      setExactIdentity(false);
                      setColorless(value => !value);
                    }}
                    style={[
                      styles.color,
                      styles.colorless,
                      !colorless && styles.filterDimmed,
                      colorless && styles.colorSelected,
                    ]}
                  >
                    <Text style={styles.colorlessText}>C</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Exact color identity${exactIdentity ? ', selected' : ''}`}
                    disabled={colors.size === 0}
                    onPress={() => setExactIdentity(value => !value)}
                    style={[
                      styles.exactIdentity,
                      colors.size === 0 && styles.filterDimmed,
                      exactIdentity && styles.exactIdentityOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.exactIdentityText,
                        exactIdentity && styles.exactIdentityTextOn,
                      ]}
                    >
                      = Exact
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.filterLabel}>RARITY</Text>
                <View style={styles.wrap}>
                  {COMMANDER_RARITIES.map(rarity => {
                    const selected = rarities.has(rarity);
                    return (
                      <Pressable
                        key={rarity}
                        onPress={() => setRarities(current => toggle(current, rarity))}
                        style={[styles.pill, selected && styles.pillOn]}
                      >
                        <Text style={[styles.pillText, selected && styles.pillTextOn]}>
                          {RARITY_LABEL[rarity]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.filterLabel}>THEMES & MECHANICS</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setTagSearch}
                  placeholder="Find draw, tokens, elves, graveyard…"
                  placeholderTextColor="#6E7B91"
                  style={styles.filterInput}
                  value={tagSearch}
                />
                {selectedTagIds.length > 0 ? (
                  <>
                    <Text style={styles.selectedLabel}>SELECTED</Text>
                    <View style={styles.wrap}>
                      {selectedTagIds.map(id => {
                        const tag = deckTagById(id);
                        if (!tag) return null;
                        return (
                          <Pressable
                            key={tag.id}
                            onPress={() => setTags(current => toggle(current, tag.id))}
                            style={[styles.pill, styles.pillOn]}
                          >
                            <Text style={[styles.pillText, styles.pillTextOn]}>{tag.label} ×</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {groupedTags.map(group => (
                  <View key={group.category} style={styles.tagGroup}>
                    <Text style={styles.tagCategory}>{group.category}</Text>
                    <View style={styles.wrap}>
                      {group.tags.map(tag => {
                        const selected = tags.has(tag.id);
                        return (
                          <Pressable
                            key={tag.id}
                            onPress={() => setTags(current => toggle(current, tag.id))}
                            style={[styles.pill, selected && styles.pillOn]}
                          >
                            <Text style={[styles.pillText, selected && styles.pillTextOn]}>
                              {tag.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
                {groupedTags.length === 0 ? (
                  <Text style={styles.noTags}>No tags match that search.</Text>
                ) : null}

                <Text style={styles.filterLabel}>CUSTOM THEME</Text>
                <Text style={styles.filterHelp}>
                  Search a creature type or phrase in rules text, such as Kobold or cast from exile.
                </Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setCustomDraft}
                  placeholder="Custom type or rules phrase"
                  placeholderTextColor="#6E7B91"
                  style={styles.filterInput}
                  value={customDraft}
                />
              </View>
            ) : null}

            <Text style={styles.results}>
              {loading && cards.length === 0
                ? 'Finding commanders…'
                : `${total.toLocaleString()} legal commanders · most played first`}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.content}
        data={cards}
        initialNumToRender={8}
        keyExtractor={card => card.id}
        keyboardShouldPersistTaps="handled"
        numColumns={2}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => (
          <View style={styles.choice}>
            <Pressable accessibilityLabel={`Preview ${item.name}`} onPress={() => setPreview(item)}>
              <CardThumb candidates={imageCandidates(item)} style={styles.image} />
            </Pressable>
            <Pressable accessibilityLabel={`Preview ${item.name}`} onPress={() => setPreview(item)}>
              <Text numberOfLines={2} style={styles.name}>
                {item.name}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Choose ${item.name} as commander`}
              disabled={busy}
              onPress={() => onPick(item.name)}
              style={[styles.choose, busy && styles.disabled]}
            >
              <Text style={styles.chooseText}>Choose commander</Text>
            </Pressable>
          </View>
        )}
        style={styles.list}
      />

      {preview ? (
        <CardPreviewModal
          candidates={imageCandidates(preview)}
          faceImages={preview.faceImages}
          name={preview.name}
          onClose={() => setPreview(null)}
          placeholderCandidates={preview.thumbUrl ? [preview.thumbUrl] : undefined}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  choice: { marginBottom: 16, width: '48%' },
  choose: {
    alignItems: 'center',
    backgroundColor: '#1D3E73',
    borderColor: '#3D7EFF',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 7,
    minHeight: 36,
    paddingHorizontal: 6,
  },
  chooseText: { color: '#DCE9FF', fontSize: 11, fontWeight: '800' },
  clearButton: { paddingHorizontal: 8, paddingVertical: 7 },
  clearText: { color: '#8CB4FF', fontSize: 12, fontWeight: '700' },
  color: {
    alignItems: 'center',
    borderColor: '#8FB4FF',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  colorRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  colorSelected: { borderWidth: 3 },
  colorText: { fontSize: 13, fontWeight: '900' },
  colorless: { backgroundColor: '#AAB2BF' },
  colorlessText: { color: '#1C2636', fontSize: 13, fontWeight: '900' },
  columns: { justifyContent: 'space-between' },
  content: { paddingBottom: 28 },
  disabled: { opacity: 0.45 },
  empty: { color: '#8A97AD', lineHeight: 20, padding: 28, textAlign: 'center' },
  error: {
    backgroundColor: '#431F27',
    borderRadius: 8,
    color: '#FFB4B4',
    fontSize: 12,
    marginBottom: 10,
    padding: 9,
  },
  exactIdentity: {
    alignItems: 'center',
    borderColor: '#40516B',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    marginLeft: 2,
    paddingHorizontal: 10,
  },
  exactIdentityOn: { backgroundColor: '#17345B', borderColor: '#4A88E8' },
  exactIdentityText: { color: '#AAB6C9', fontSize: 11, fontWeight: '700' },
  exactIdentityTextOn: { color: '#DCE9FF' },
  filterBar: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 8 },
  filterChevron: { color: '#8CB4FF', fontSize: 18, fontWeight: '500' },
  filterDimmed: { opacity: 0.42 },
  filterHelp: { color: '#77869D', fontSize: 11, lineHeight: 16, marginBottom: 7 },
  filterInput: {
    backgroundColor: '#0E1624',
    borderColor: '#2B3850',
    borderRadius: 8,
    borderWidth: 1,
    color: '#F4F7FB',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterLabel: {
    color: '#8A97AD',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 5,
    marginTop: 10,
  },
  filterToggle: {
    alignItems: 'center',
    backgroundColor: '#182233',
    borderColor: '#2B3850',
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  filterToggleOn: { backgroundColor: '#17345B', borderColor: '#3D7EFF' },
  filterToggleText: { color: '#DCE5F2', fontSize: 13, fontWeight: '700' },
  filters: {
    backgroundColor: '#121A28',
    borderColor: '#26344A',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 11,
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: 5, marginBottom: 8 },
  headerAction: { color: '#AFC8EF', fontSize: 12, fontWeight: '700' },
  headerActionRight: { textAlign: 'right' },
  headerSide: { minWidth: 58, paddingVertical: 9 },
  headerSubtitle: { color: '#7D8BA2', fontSize: 10, marginTop: 1, textAlign: 'center' },
  headerTitle: { color: '#F4F7FB', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  headerTitleWrap: { flex: 1 },
  image: {
    aspectRatio: 488 / 680,
    backgroundColor: '#1C2636',
    borderRadius: 11,
    width: '100%',
  },
  intent: {
    backgroundColor: '#152E51',
    borderColor: '#315D99',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 11,
  },
  intentEyebrow: { color: '#8CB4FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  intentText: { color: '#AAB6C9', fontSize: 11, lineHeight: 16, marginTop: 3 },
  intentTitle: { color: '#F4F7FB', fontSize: 14, fontWeight: '800', marginTop: 3 },
  list: { flex: 1 },
  loading: { paddingVertical: 20 },
  name: { color: '#F4F7FB', fontSize: 13, fontWeight: '600', lineHeight: 17, marginTop: 6 },
  noTags: { color: '#77869D', fontSize: 11, paddingVertical: 8, textAlign: 'center' },
  pill: {
    borderColor: '#334158',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pillOn: { backgroundColor: '#17345B', borderColor: '#3D7EFF' },
  pillText: { color: '#AAB6C9', fontSize: 11 },
  pillTextOn: { color: '#AFCBFF', fontWeight: '700' },
  results: { color: '#7D8BA2', fontSize: 11, marginBottom: 9 },
  root: { backgroundColor: '#0B1220', flex: 1, paddingHorizontal: 14 },
  search: {
    backgroundColor: '#121A28',
    borderColor: '#2B3850',
    borderRadius: 10,
    borderWidth: 1,
    color: '#F4F7FB',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  selectedLabel: {
    color: '#8CB4FF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 5,
  },
  tagCategory: {
    color: '#7D8BA2',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 5,
  },
  tagGroup: { marginTop: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
