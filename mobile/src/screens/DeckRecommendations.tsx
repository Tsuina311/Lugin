import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CardThumb } from '../ui/CardThumb';
import { DeckSuggestionPreview } from '../ui/DeckSuggestionPreview';

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey, frontFaceName } from '@/lib/cardName';
import type { CollectionCard } from '@/lib/collection';
import type { DeckPrinting } from '@/lib/deck';
import { applyDeckBrowse, type DeckBrowseState } from '@/lib/deckBrowse';
import { EdhrecNotFound, fetchEdhrec, type EdhrecCard, type EdhrecData } from '@/lib/edhrec';
import { goldfishDeckCount, goldfishSampleSize } from '@/lib/goldfishStats';
import { searchExactCards, type CardSearchResult } from '@/lib/search';

export type RecommendationSource = 'edhrec' | 'goldfish';

interface RecommendationCard {
  imageUrl?: string;
  inclusion?: number;
  name: string;
  synergy?: number;
}

interface RecommendationCategory {
  cards: RecommendationCard[];
  id: string;
  title: string;
}

interface RecommendationData {
  categories: RecommendationCategory[];
  sampleSize?: number;
  subtitle?: string;
}

const PAGE_SIZE = 15;
const DEFAULT_EDHREC_OPEN = new Set(['highsynergycards', 'highliftcards', 'topcards', 'newcards']);
const GOLDFISH_PROXY = 'https://lugin-goldfish.gwenaeloppitz.workers.dev';
const memoryCache = new Map<string, RecommendationData>();

const pct = (value?: number): string => (value == null ? '' : `${Math.round(value * 100)}%`);

const signedPct = (value?: number): string => {
  if (value == null) return '';
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
};

const messageOf = (error: unknown, source: RecommendationSource): string => {
  if (error instanceof EdhrecNotFound || error instanceof Error) return error.message;
  return `Could not load ${source === 'edhrec' ? 'EDHREC' : 'MTGGoldfish'} suggestions.`;
};

const edhrecData = (data: EdhrecData): RecommendationData => ({
  categories: data.lists.map(list => ({
    cards: list.cards,
    id: list.tag,
    title: list.header,
  })),
  subtitle: data.deckCount ? `${data.deckCount.toLocaleString()} decks` : undefined,
});

const decodeHtml = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\u0027')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));

const goldfishSlug = (commanderNames: readonly string[]): string =>
  commanderNames
    .map(name =>
      frontFaceName(name)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]s\b/g, '-s')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');

const parseGoldfish = (html: string): RecommendationData => {
  if (html.includes('Just a moment') && html.includes('challenge-platform')) {
    throw new Error('MTGGoldfish returned a bot check. Try again later.');
  }

  const categories: RecommendationCategory[] = [];
  const chunks = html.split(/<div class=['"]spoiler-card-container['"]>/i).slice(1);
  for (const [categoryIndex, chunk] of chunks.entries()) {
    const header = decodeHtml(chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.trim() ?? 'Cards');
    const cards: RecommendationCard[] = [];
    const cardChunks = chunk.split(/<div class=['"]spoiler-card['"]>/i).slice(1);
    for (const cardChunk of cardChunks) {
      const nameMatch = cardChunk.match(/data-card-tray-display-name=(['"])(.*?)\1/i);
      const statsMatch = cardChunk.match(/([\d.]+)\s+in\s+([\d.]+)\s*%\s+of decks/i);
      if (!nameMatch) continue;
      const sourceMatch = cardChunk.match(/<source[^>]+srcset=(['"])(.*?)\1/i);
      const imageUrl = sourceMatch?.[2]?.split(',')[0]?.trim().split(/\s+/)[0];
      cards.push({
        imageUrl,
        inclusion: statsMatch ? Number.parseFloat(statsMatch[2]) / 100 : undefined,
        name: decodeHtml(nameMatch[2]),
      });
    }
    if (cards.length > 0) {
      categories.push({
        cards,
        id: `${categoryIndex}:${header}`,
        title: header,
      });
    }
  }
  if (categories.length === 0) {
    throw new Error('MTGGoldfish has no card suggestions for this commander yet.');
  }
  const sampleSize = goldfishSampleSize(
    categories.flatMap(category =>
      category.cards.flatMap(card =>
        card.inclusion == null ? [] : [Math.round(card.inclusion * 100)],
      ),
    ),
  );
  return {
    categories,
    sampleSize,
    subtitle: sampleSize ? `${sampleSize} sample decks` : undefined,
  };
};

const loadGoldfish = async (commanderNames: readonly string[]): Promise<RecommendationData> => {
  const slug = goldfishSlug(commanderNames);
  if (!slug) throw new Error('Pick a commander to see MTGGoldfish suggestions.');
  // Goldfish is inconsistent: established commanders often use `/archetype/foo`,
  // while newer pages use `/archetype/commander-foo`. Resolve both forms.
  for (const archetype of [slug, `commander-${slug}`]) {
    const target = `https://www.mtggoldfish.com/archetype/${archetype}`;
    const response = await fetch(`${GOLDFISH_PROXY}?url=${encodeURIComponent(target)}`, {
      headers: { Accept: 'text/html' },
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`MTGGoldfish request failed (HTTP ${response.status}).`);
    return parseGoldfish(await response.text());
  }
  throw new Error('MTGGoldfish has no archetype page for this commander yet.');
};

const loadSource = async (
  source: RecommendationSource,
  commanderNames: readonly string[],
  force: boolean,
): Promise<RecommendationData> => {
  const key = `${source}:${commanderNames.map(cardKey).join('|')}`;
  if (!force) {
    const cached = memoryCache.get(key);
    if (cached) return cached;
  }
  const data =
    source === 'edhrec'
      ? edhrecData(await fetchEdhrec([...commanderNames], undefined, force))
      : await loadGoldfish(commanderNames);
  memoryCache.set(key, data);
  return data;
};

export function DeckRecommendations({
  browse,
  collectionCards,
  commanderNames,
  deckQuantity,
  onAdd,
  ownedQuantity,
  source,
}: {
  browse: DeckBrowseState;
  collectionCards: readonly CollectionCard[];
  commanderNames: readonly string[];
  deckQuantity: (name: string) => number;
  onAdd: (name: string, printing?: DeckPrinting) => void;
  ownedQuantity: (name: string) => number;
  source: RecommendationSource;
}) {
  const [data, setData] = useState<RecommendationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [hideInDeck, setHideInDeck] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<RecommendationCard | EdhrecCard | null>(null);
  const [metadata, setMetadata] = useState<Record<string, CardSearchResult>>({});
  const request = useRef(0);
  const commanderKey = commanderNames.map(cardKey).join('|');

  const load = (force = false): void => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    void loadSource(source, commanderNames, force).then(
      next => {
        if (current !== request.current) return;
        setData(next);
        setOpen(previous => {
          if (previous.size > 0 && !force) return previous;
          const defaults =
            source === 'edhrec'
              ? next.categories.filter(category => DEFAULT_EDHREC_OPEN.has(category.id))
              : next.categories.slice(0, 1);
          return new Set(
            (defaults.length > 0 ? defaults : next.categories.slice(0, 1)).map(c => c.id),
          );
        });
        setLoading(false);
      },
      reason => {
        if (current !== request.current) return;
        setError(messageOf(reason, source));
        setLoading(false);
      },
    );
  };

  useEffect(() => {
    setData(null);
    setOpen(new Set());
    setExpanded(new Set());
    load();
    return () => {
      request.current += 1;
    };
    // `load` intentionally follows these stable scalar keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commanderKey, source]);

  const recommendationNames = useMemo(
    () => [...new Set((data?.categories ?? []).flatMap(category => category.cards.map(card => card.name)))],
    [data],
  );
  const recommendationNamesKey = recommendationNames.map(cardKey).sort().join('|');

  useEffect(() => {
    if (recommendationNames.length === 0) {
      setMetadata({});
      return;
    }
    let cancelled = false;
    void searchExactCards(recommendationNames).then(cards => {
      if (!cancelled) {
        setMetadata(Object.fromEntries(cards.map(card => [cardKey(card.name), card])));
      }
    });
    return () => {
      cancelled = true;
    };
    // Names' content, not array identity, controls the metadata lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recommendationNamesKey]);

  const sections = useMemo(
    () =>
      (data?.categories ?? []).map(category => {
        const eligible = category.cards.filter(card => {
          if (ownedOnly && ownedQuantity(card.name) === 0) return false;
          if (hideInDeck && deckQuantity(card.name) > 0) return false;
          return true;
        });
        const filtered = applyDeckBrowse(
          eligible,
          card => {
            const meta = metadata[cardKey(card.name)];
            return {
              cmc: meta?.cmc,
              land: meta?.typeLine?.includes('Land'),
              name: card.name,
              owned: ownedQuantity(card.name),
              tags: [category.title],
              typeLine: meta?.typeLine,
            };
          },
          browse,
        );
        return {
          category,
          data: open.has(category.id)
            ? expanded.has(category.id)
              ? filtered
              : filtered.slice(0, PAGE_SIZE)
            : [],
          filteredCount: filtered.length,
          gridData: filtered,
          title: category.title,
        };
      }),
    [
      browse,
      data,
      deckQuantity,
      expanded,
      hideInDeck,
      metadata,
      open,
      ownedOnly,
      ownedQuantity,
    ],
  );

  const toggle = (current: Set<string>, id: string): Set<string> => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text style={styles.source}>
          {source === 'edhrec' ? 'EDHREC' : 'MTGGoldfish'}
          {data?.subtitle ? ` · ${data.subtitle}` : ''}
        </Text>
        <Pressable onPress={() => setOwnedOnly(value => !value)} style={styles.filter}>
          <Text style={[styles.filterText, ownedOnly && styles.filterOn]}>Owned only</Text>
        </Pressable>
        <Pressable onPress={() => setHideInDeck(value => !value)} style={styles.filter}>
          <Text style={[styles.filterText, hideInDeck && styles.filterOn]}>Hide in deck</Text>
        </Pressable>
        <Pressable onPress={() => load(true)} style={styles.refresh}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator color="#3D7EFF" />
          <Text style={styles.empty}>Loading suggestions…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => load(true)} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : browse.view === 'grid' ? (
        <FlatList
          key="grid"
          ListEmptyComponent={
            <Text style={styles.empty}>No suggestions match these filters.</Text>
          }
          columnWrapperStyle={styles.gridColumns}
          contentContainerStyle={styles.list}
          data={sections.flatMap(section =>
            section.gridData.map(card => ({ card, category: section.title })),
          )}
          keyExtractor={(item, index) => `${item.category}:${cardKey(item.card.name)}:${index}`}
          numColumns={2}
          renderItem={({ item }) => (
            <RecommendationGridCard
              card={item.card}
              category={item.category}
              deckQuantity={deckQuantity(item.card.name)}
              onAdd={() => onAdd(item.card.name)}
              onImagePress={() => setPreview(item.card)}
              ownedQuantity={ownedQuantity(item.card.name)}
            />
          )}
          style={styles.flex}
        />
      ) : (
        <SectionList
          ListEmptyComponent={<Text style={styles.empty}>No suggestions match these filters.</Text>}
          contentContainerStyle={styles.list}
          keyExtractor={(card, index) => `${cardKey(card.name)}:${index}`}
          renderItem={({ item }) => (
            <RecommendationRow
              card={item}
              deckQuantity={deckQuantity(item.name)}
              onAdd={() => onAdd(item.name)}
              onImagePress={() => setPreview(item)}
              ownedQuantity={ownedQuantity(item.name)}
              sampleSize={data?.sampleSize}
            />
          )}
          renderSectionFooter={({ section }) =>
            open.has(section.category.id) &&
            !expanded.has(section.category.id) &&
            section.filteredCount > PAGE_SIZE ? (
              <Pressable
                onPress={() => setExpanded(current => toggle(current, section.category.id))}
                style={styles.showAll}
              >
                <Text style={styles.showAllText}>Show all {section.filteredCount}</Text>
              </Pressable>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <Pressable
              onPress={() => setOpen(current => toggle(current, section.category.id))}
              style={styles.section}
            >
              <Text style={styles.chevron}>{open.has(section.category.id) ? '▾' : '▸'}</Text>
              <Text numberOfLines={1} style={styles.sectionTitle}>
                {section.title}
              </Text>
              <Text style={styles.sectionCount}>{section.filteredCount}</Text>
            </Pressable>
          )}
          sections={sections}
          stickySectionHeadersEnabled
          style={styles.flex}
        />
      )}
      {preview ? (
        <DeckSuggestionPreview
          candidates={cardImageCandidates({
            imageUrl: preview.imageUrl,
            name: preview.name,
            scryfallId: 'scryfallId' in preview ? preview.scryfallId : undefined,
          })}
          collectionCards={collectionCards}
          defaultPrinting={{
            imageUrl: preview.imageUrl,
            scryfallId: 'scryfallId' in preview ? preview.scryfallId : undefined,
          }}
          name={preview.name}
          onAdd={onAdd}
          onClose={() => setPreview(null)}
          placeholderCandidates={preview.imageUrl ? [preview.imageUrl] : undefined}
        />
      ) : null}
    </View>
  );
}

const RecommendationGridCard = ({
  card,
  category,
  deckQuantity,
  onAdd,
  onImagePress,
  ownedQuantity,
}: {
  card: RecommendationCard | EdhrecCard;
  category: string;
  deckQuantity: number;
  onAdd: () => void;
  onImagePress: () => void;
  ownedQuantity: number;
}) => (
  <View style={styles.gridCard}>
    <Pressable accessibilityLabel={`Preview ${card.name}`} onPress={onImagePress}>
      <CardThumb
        candidates={cardImageCandidates({
          imageUrl: card.imageUrl,
          name: card.name,
          scryfallId: 'scryfallId' in card ? card.scryfallId : undefined,
        })}
        style={styles.gridImage}
      />
    </Pressable>
    <Text numberOfLines={1} style={styles.gridName}>
      {card.name}
    </Text>
    <Text numberOfLines={1} style={styles.gridCategory}>
      {category}
    </Text>
    <View style={styles.gridFooter}>
      <Text style={styles.gridOwned}>
        {ownedQuantity > 0 ? `owned ×${ownedQuantity}` : 'not owned'}
      </Text>
      {deckQuantity > 0 ? (
        <Text style={styles.gridInDeck}>In deck</Text>
      ) : (
        <Pressable accessibilityLabel={`Add ${card.name}`} onPress={onAdd} style={styles.gridAdd}>
          <Text style={styles.addText}>+</Text>
        </Pressable>
      )}
    </View>
  </View>
);

const RecommendationRow = ({
  card,
  deckQuantity,
  onAdd,
  onImagePress,
  ownedQuantity,
  sampleSize,
}: {
  card: RecommendationCard | EdhrecCard;
  deckQuantity: number;
  onAdd: () => void;
  onImagePress: () => void;
  ownedQuantity: number;
  sampleSize?: number;
}) => {
  const sampleCount =
    card.inclusion != null && sampleSize
      ? goldfishDeckCount(card.inclusion * 100, sampleSize)
      : undefined;
  const details = [
    sampleCount != null && sampleSize
      ? `${sampleCount}/${sampleSize} sample decks`
      : card.inclusion != null
        ? `${pct(card.inclusion)} decks`
        : '',
    card.synergy != null ? `${signedPct(card.synergy)} synergy` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.cardRow}>
      <Pressable accessibilityLabel={`Preview ${card.name}`} onPress={onImagePress}>
        <CardThumb
          candidates={cardImageCandidates({
            imageUrl: card.imageUrl,
            name: card.name,
            scryfallId: 'scryfallId' in card ? card.scryfallId : undefined,
          })}
          style={styles.thumb}
        />
      </Pressable>
      <Pressable
        accessibilityLabel={`Preview ${card.name}`}
        onPress={onImagePress}
        style={styles.flex}
      >
        <Text numberOfLines={1} style={styles.cardName}>
          {card.name}
        </Text>
        <Text numberOfLines={1} style={styles.cardMeta}>
          {details || 'Suggested card'}
          {ownedQuantity > 0 ? ` · owned ×${ownedQuantity}` : ' · not owned'}
        </Text>
      </Pressable>
      {deckQuantity > 0 ? (
        <View style={styles.inDeck}>
          <Text style={styles.inDeckText}>In deck</Text>
        </View>
      ) : (
        <Pressable accessibilityLabel={`Add ${card.name}`} onPress={onAdd} style={styles.add}>
          <Text style={styles.addText}>+</Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  add: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 9,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  addText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', lineHeight: 24 },
  cardMeta: { color: '#8A97AD', fontSize: 11, marginTop: 2 },
  cardName: { color: '#F4F7FB', fontSize: 14, fontWeight: '600' },
  cardRow: {
    alignItems: 'center',
    borderBottomColor: '#1C2636',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 2,
    paddingVertical: 6,
  },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  chevron: { color: '#8A97AD', width: 14 },
  empty: { color: '#8A97AD', padding: 16, textAlign: 'center' },
  error: { color: '#E98A8A', lineHeight: 20, textAlign: 'center' },
  filter: {
    backgroundColor: '#1C2636',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  filterOn: { color: '#8CB4FF' },
  filterText: { color: '#8A97AD', fontSize: 11, fontWeight: '600' },
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
  gridCategory: { color: '#8290A6', fontSize: 9, paddingHorizontal: 7, paddingTop: 2 },
  gridColumns: { gap: 10, marginBottom: 10 },
  gridFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 7,
    paddingHorizontal: 7,
    paddingTop: 4,
  },
  gridImage: { aspectRatio: 488 / 680, backgroundColor: '#1C2636', width: '100%' },
  gridInDeck: { color: '#8CB4FF', fontSize: 9, fontWeight: '700' },
  gridName: {
    color: '#F4F7FB',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingTop: 6,
  },
  gridOwned: { color: '#8290A6', flex: 1, fontSize: 9 },
  inDeck: { backgroundColor: '#17345B', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 7 },
  inDeckText: { color: '#8CB4FF', fontSize: 11, fontWeight: '700' },
  list: { paddingBottom: 16 },
  refresh: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginLeft: 'auto',
    width: 28,
  },
  refreshText: { color: '#C5D3E8', fontSize: 20 },
  retry: {
    backgroundColor: '#1C2636',
    borderRadius: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: '#E8EEF7', fontWeight: '700' },
  root: { flex: 1 },
  section: {
    alignItems: 'center',
    backgroundColor: '#121A28',
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: 8,
  },
  sectionCount: { color: '#66758C', fontSize: 11 },
  sectionTitle: {
    color: '#B7C3D5',
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  showAll: { paddingHorizontal: 10, paddingVertical: 10 },
  showAllText: { color: '#8CB4FF', fontSize: 12, fontWeight: '700' },
  source: { color: '#C5D3E8', fontSize: 11, fontWeight: '700' },
  thumb: { backgroundColor: '#1C2636', borderRadius: 5, height: 48, width: 34 },
  toolbar: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 6 },
});
