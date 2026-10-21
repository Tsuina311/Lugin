import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CardThumb } from '../ui/CardThumb';

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey, frontFaceName } from '@/lib/cardName';
import {
  EdhrecNotFound,
  fetchEdhrec,
  type EdhrecCard,
  type EdhrecData,
} from '@/lib/edhrec';

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
  subtitle?: string;
}

const PAGE_SIZE = 15;
const DEFAULT_EDHREC_OPEN = new Set([
  'highsynergycards',
  'highliftcards',
  'topcards',
  'newcards',
]);
const GOLDFISH_PROXY = 'https://lugin-goldfish.gwenaeloppitz.workers.dev';
const memoryCache = new Map<string, RecommendationData>();

const pct = (value?: number): string =>
  value == null ? '' : `${Math.round(value * 100)}%`;

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
    .replace(/&#39;|&apos;/g, "'")
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
  return { categories };
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
  commanderNames,
  deckQuantity,
  onAdd,
  ownedQuantity,
  source,
}: {
  commanderNames: readonly string[];
  deckQuantity: (name: string) => number;
  onAdd: (name: string) => void;
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
          const defaults = source === 'edhrec'
            ? next.categories.filter(category => DEFAULT_EDHREC_OPEN.has(category.id))
            : next.categories.slice(0, 1);
          return new Set((defaults.length > 0 ? defaults : next.categories.slice(0, 1)).map(c => c.id));
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

  const sections = useMemo(
    () =>
      (data?.categories ?? []).map(category => {
        const filtered = category.cards.filter(card => {
          if (ownedOnly && ownedQuantity(card.name) === 0) return false;
          if (hideInDeck && deckQuantity(card.name) > 0) return false;
          return true;
        });
        return {
          category,
          data: open.has(category.id)
            ? (expanded.has(category.id) ? filtered : filtered.slice(0, PAGE_SIZE))
            : [],
          filteredCount: filtered.length,
          title: category.title,
        };
      }),
    [data, deckQuantity, expanded, hideInDeck, open, ownedOnly, ownedQuantity],
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
      ) : (
        <SectionList
          contentContainerStyle={styles.list}
          keyExtractor={(card, index) => `${cardKey(card.name)}:${index}`}
          ListEmptyComponent={<Text style={styles.empty}>No suggestions match these filters.</Text>}
          renderItem={({ item }) => (
            <RecommendationRow
              card={item}
              deckQuantity={deckQuantity(item.name)}
              onAdd={() => onAdd(item.name)}
              ownedQuantity={ownedQuantity(item.name)}
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
              <Text numberOfLines={1} style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.filteredCount}</Text>
            </Pressable>
          )}
          sections={sections}
          stickySectionHeadersEnabled
          style={styles.flex}
        />
      )}
    </View>
  );
}

const RecommendationRow = ({
  card,
  deckQuantity,
  onAdd,
  ownedQuantity,
}: {
  card: RecommendationCard | EdhrecCard;
  deckQuantity: number;
  onAdd: () => void;
  ownedQuantity: number;
}) => {
  const details = [
    card.inclusion != null ? `${pct(card.inclusion)} decks` : '',
    card.synergy != null ? `${signedPct(card.synergy)} synergy` : '',
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.cardRow}>
      <CardThumb
        candidates={cardImageCandidates({
          imageUrl: card.imageUrl,
          name: card.name,
          scryfallId: 'scryfallId' in card ? card.scryfallId : undefined,
        })}
        style={styles.thumb}
      />
      <View style={styles.flex}>
        <Text numberOfLines={1} style={styles.cardName}>{card.name}</Text>
        <Text numberOfLines={1} style={styles.cardMeta}>
          {details || 'Suggested card'}
          {ownedQuantity > 0 ? ` · owned ×${ownedQuantity}` : ' · not owned'}
        </Text>
      </View>
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
  filter: { backgroundColor: '#1C2636', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  filterOn: { color: '#8CB4FF' },
  filterText: { color: '#8A97AD', fontSize: 11, fontWeight: '600' },
  flex: { flex: 1 },
  inDeck: { backgroundColor: '#17345B', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 7 },
  inDeckText: { color: '#8CB4FF', fontSize: 11, fontWeight: '700' },
  list: { paddingBottom: 16 },
  refresh: { alignItems: 'center', height: 28, justifyContent: 'center', marginLeft: 'auto', width: 28 },
  refreshText: { color: '#C5D3E8', fontSize: 20 },
  retry: { backgroundColor: '#1C2636', borderRadius: 8, marginTop: 12, paddingHorizontal: 14, paddingVertical: 8 },
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
  sectionTitle: { color: '#B7C3D5', flex: 1, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  showAll: { paddingHorizontal: 10, paddingVertical: 10 },
  showAllText: { color: '#8CB4FF', fontSize: 12, fontWeight: '700' },
  source: { color: '#C5D3E8', fontSize: 11, fontWeight: '700' },
  thumb: { backgroundColor: '#1C2636', borderRadius: 5, height: 48, width: 34 },
  toolbar: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 6 },
});
