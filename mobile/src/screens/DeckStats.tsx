import { useEffect, useMemo, useState } from 'react';

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cardKey } from '@/lib/cardName';
import { manaCurve, type Deck, type DeckTagAnalysis, type ManaCurve } from '@/lib/deck';
import {
  analyzeDeckTags,
  deckTagAnalysisComplete,
} from '@/lib/deckTagSections';
import { DECK_TAGS, deckTagById } from '@/lib/deckTags';
import { isBasicLand } from '@/lib/lands';
import type { CardSearchResult } from '@/lib/search';

interface TagStat {
  cards: string[];
  id: string;
  label: string;
}

const TYPE_SPECS = [
  { color: '#F2A65A', label: 'Creatures', type: 'Creature' },
  { color: '#B28DFF', label: 'Planeswalkers', type: 'Planeswalker' },
  { color: '#F06C9B', label: 'Battles', type: 'Battle' },
  { color: '#55C2FF', label: 'Instants', type: 'Instant' },
  { color: '#5DD39E', label: 'Sorceries', type: 'Sorcery' },
  { color: '#D0A96B', label: 'Artifacts', type: 'Artifact' },
  { color: '#E58DCE', label: 'Enchantments', type: 'Enchantment' },
  { color: '#8F9E72', label: 'Lands', type: 'Land' },
  { color: '#9AA8BC', label: 'Other', type: 'Other' },
] as const;

const CHART_TYPE_SPECS = TYPE_SPECS.filter(spec => spec.label !== 'Lands');

const typeOf = (name: string, typeLine?: string): string => {
  const frontTypeLine = typeLine?.split(/\s*\/\/\s*/, 1)[0];
  if (isBasicLand(name) || frontTypeLine?.includes('Land')) return 'Lands';
  for (const spec of TYPE_SPECS) {
    if (spec.type !== 'Land' && spec.type !== 'Other' && frontTypeLine?.includes(spec.type)) {
      return spec.label;
    }
  }
  return 'Other';
};

const subtypesOf = (typeLine?: string): string[] => {
  if (!typeLine) return [];
  const out = new Set<string>();
  const frontTypeLine = typeLine.split(/\s*\/\/\s*/, 1)[0];
  const [, subtypes = ''] = frontTypeLine.split(/\s+[—–]\s+/, 2);
  for (const subtype of subtypes.trim().split(/\s+/)) {
    if (subtype) out.add(subtype);
  }
  return [...out];
};

const CurveChart = ({
  curve,
  onToggleType,
  overlays,
  typeOptions,
}: {
  curve: ManaCurve;
  onToggleType: (label: string) => void;
  overlays: Array<{ color: string; curve: ManaCurve; label: string }>;
  typeOptions: Array<{ color: string; count: number; label: string; selected: boolean }>;
}) => (
  <>
    <View style={styles.curveLegend}>
      <View style={styles.legendItem}>
        <View style={styles.legendAll} />
        <Text numberOfLines={1} style={styles.legendText}>Total</Text>
        <Text style={styles.legendCount}>{curve.total + curve.pending}</Text>
      </View>
      {typeOptions.map(option => (
        <Pressable
          key={option.label}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: option.selected }}
          onPress={() => onToggleType(option.label)}
          style={[styles.legendToggle, option.selected && styles.legendToggleSelected]}
        >
          <View
            style={[
              styles.legendCheck,
              option.selected && {
                backgroundColor: option.color,
                borderColor: option.color,
              },
            ]}
          >
            {option.selected ? <Text style={styles.legendCheckMark}>✓</Text> : null}
          </View>
          <Text numberOfLines={1} style={styles.legendText}>{option.label}</Text>
          <Text style={styles.legendCount}>{option.count}</Text>
        </Pressable>
      ))}
    </View>
    <View style={styles.curve}>
      {curve.bars.map((bar, index) => {
        let stacked = 0;
        const barHeight = curve.peak > 0 ? Math.max(3, (bar.count / curve.peak) * 70) : 3;
        const fillHeight = Math.max(1, barHeight - 4);
        const segments = overlays.map(overlay => {
          const count = overlay.curve.bars[index]?.count ?? 0;
          const bottom = stacked;
          stacked += count;
          return { ...overlay, bottom, count };
        });
        return (
          <View key={bar.bucket} style={styles.curveColumn}>
            <Text style={styles.curveCount}>
              {overlays.length > 0 ? (
                <>
                  <Text style={styles.curveSelectedCount}>{stacked}</Text>
                  <Text>/{bar.count}</Text>
                </>
              ) : (
                bar.count
              )}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  { height: barHeight },
                ]}
              />
              {segments.map(segment =>
                segment.count > 0 ? (
                <View
                  key={segment.label}
                  style={[
                    styles.overlayBar,
                    {
                      backgroundColor: segment.color,
                      bottom: bar.count > 0 ? 2 + (segment.bottom / bar.count) * fillHeight : 2,
                      height: bar.count > 0 ? (segment.count / bar.count) * fillHeight : 0,
                    },
                  ]}
                />
                ) : null,
              )}
            </View>
            <Text style={styles.curveLabel}>{bar.label}</Text>
          </View>
        );
      })}
    </View>
    <Text style={styles.summary}>
      {curve.average == null ? 'No mana values yet' : `Average mana value ${curve.average.toFixed(2)}`}
      {' · '}
      {curve.lands} lands
      {curve.pending > 0 ? ` · ${curve.pending} loading` : ''}
    </Text>
    {overlays.length > 0 ? (
      <Text style={styles.overlaySummary}>
        Selected: {overlays.reduce(
          (sum, overlay) =>
            sum + overlay.curve.total + overlay.curve.lands + overlay.curve.pending,
          0,
        )}{' '}
        cards
      </Text>
    ) : null}
  </>
);

export const DeckStats = ({
  deck,
  metadata,
  onAnalysis,
}: {
  deck: Deck;
  metadata: Record<string, CardSearchResult>;
  onAnalysis: (analysis: DeckTagAnalysis) => void;
}) => {
  const cards = useMemo(
    () => deck.cards.filter(card => card.section !== 'sideboard'),
    [deck.cards],
  );
  const curve = useMemo(() => manaCurve(cards, metadata), [cards, metadata]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      const label = typeOf(card.name, metadata[cardKey(card.name)]?.typeLine);
      counts.set(label, (counts.get(label) ?? 0) + card.quantity);
    }
    return CHART_TYPE_SPECS.map(spec => [spec.label, counts.get(spec.label) ?? 0] as const).filter(
      ([, count]) => count > 0,
    );
  }, [cards, metadata]);
  const selectedDetails = useMemo(
    () =>
      CHART_TYPE_SPECS.filter(spec => selectedTypes.includes(spec.label)).map(spec => {
        const typeCards = cards.filter(
          card => typeOf(card.name, metadata[cardKey(card.name)]?.typeLine) === spec.label,
        );
        const subtypeCounts = new Map<string, number>();
        for (const card of typeCards) {
          for (const subtype of subtypesOf(metadata[cardKey(card.name)]?.typeLine)) {
            subtypeCounts.set(subtype, (subtypeCounts.get(subtype) ?? 0) + card.quantity);
          }
        }
        return {
          ...spec,
          curve: manaCurve(typeCards, metadata),
          subtypes: [...subtypeCounts.entries()].sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
          ),
        };
      }),
    [cards, metadata, selectedTypes],
  );
  const curveOverlays = useMemo(
    () =>
      selectedDetails.map(detail => ({
        color: detail.color,
        curve: detail.curve,
        label: detail.label,
      })),
    [selectedDetails],
  );
  const typeOptions = useMemo(
    () =>
      types.map(([label, count]) => ({
        color: TYPE_SPECS.find(spec => spec.label === label)?.color ?? '#9AA8BC',
        count,
        label,
        selected: selectedTypes.includes(label),
      })),
    [selectedTypes, types],
  );
  const toggleType = (label: string) => {
    setSelectedTypes(current => {
      const selected = new Set(current);
      if (selected.has(label)) selected.delete(label);
      else selected.add(label);
      return CHART_TYPE_SPECS.map(spec => spec.label).filter(type => selected.has(type));
    });
  };
  const criteria = useMemo(() => DECK_TAGS.map(tag => tag.id), []);
  const criteriaKey = criteria.join('|');
  const names = useMemo(() => cards.map(card => card.name), [cards]);
  const [analysis, setAnalysis] = useState<DeckTagAnalysis | undefined>(deck.tagAnalysis);
  const [tagsLoading, setTagsLoading] = useState(
    !deckTagAnalysisComplete(names, criteria, deck.tagAnalysis),
  );
  const tags = useMemo(
    () =>
      criteria
        .map(id => {
          const tag = deckTagById(id);
          if (!tag) return null;
          const valid =
            analysis?.queries[id] === tag.query
              ? new Set(analysis.results[id] ?? [])
              : undefined;
          const matching = cards
            .filter(card => {
              const key = cardKey(card.name);
              const override = deck.tagOverrides?.[key];
              if (override != null) return override === id;
              return valid?.has(key) === true;
            })
            .map(card => card.name);
          return { cards: matching, id, label: tag.label };
        })
        .filter((item): item is TagStat => Boolean(item && item.cards.length > 0))
        .sort((a, b) => b.cards.length - a.cards.length || a.label.localeCompare(b.label)),
    [analysis, cards, criteria, deck.tagOverrides],
  );

  useEffect(() => {
    if (deckTagAnalysisComplete(names, criteria, deck.tagAnalysis)) {
      setAnalysis(deck.tagAnalysis);
      setTagsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAnalysis(deck.tagAnalysis);
    setTagsLoading(true);
    void analyzeDeckTags(names, criteria, deck.tagAnalysis, controller.signal).then(next => {
      if (cancelled) return;
      setAnalysis(next);
      setTagsLoading(false);
      onAnalysis(next);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [criteria, criteriaKey, deck.tagAnalysis, names, onAnalysis]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.root}>
      <Text style={styles.heading}>Mana curve</Text>
      <CurveChart
        curve={curve}
        onToggleType={toggleType}
        overlays={curveOverlays}
        typeOptions={typeOptions}
      />

      {selectedDetails.length > 0 ? (
        <View style={styles.subtypePanel}>
          {selectedDetails.map(detail => (
            <View key={detail.label} style={styles.subtypeGroup}>
              <View style={styles.subtypeTitleRow}>
                <View style={[styles.legendSelected, { backgroundColor: detail.color }]} />
                <Text style={styles.subtypeHeading}>{detail.label} subtypes</Text>
              </View>
              {detail.subtypes.length > 0 ? (
                <View style={styles.subtypeList}>
                  {detail.subtypes.map(([label, count]) => (
                    <View key={label} style={styles.subtypePill}>
                      <Text style={styles.subtypeLabel}>{label}</Text>
                      <Text style={styles.subtypeCount}>{count}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.muted}>No subtypes in this group.</Text>
              )}
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.heading}>By tag</Text>
      {tagsLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#3D7EFF" size="small" />
          <Text style={styles.muted}>
            {tags.length > 0 ? 'Updating tags for new cards…' : 'Checking tags once for this deck…'}
          </Text>
        </View>
      ) : null}
      {!tagsLoading && tags.length === 0 ? (
        <Text style={styles.muted}>No cards match the tracked deck-building criteria yet.</Text>
      ) : (
        tags.map(tag => (
          <View key={tag.id} style={styles.tagPanel}>
            <View style={styles.tagHeader}>
              <Text style={styles.tagTitle}>{tag.label}</Text>
              <Text style={styles.tagCount}>{tag.cards.length}</Text>
            </View>
            <Text style={styles.tagCards}>{tag.cards.join(' · ')}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'transparent',
    borderColor: '#4C8DFF',
    borderRadius: 3,
    borderWidth: 1,
    width: '70%',
  },
  barTrack: {
    alignItems: 'center',
    height: 72,
    justifyContent: 'flex-end',
    position: 'relative',
    width: '100%',
  },
  content: { paddingBottom: 18 },
  curve: {
    alignItems: 'flex-end',
    backgroundColor: '#121A28',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    padding: 10,
  },
  curveColumn: { alignItems: 'center', flex: 1 },
  curveCount: { color: '#BFD1ED', fontSize: 9, fontVariant: ['tabular-nums'] },
  curveLabel: { color: '#8290A6', fontSize: 10, marginTop: 4 },
  curveLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  curveSelectedCount: { color: '#F2A65A', fontWeight: '800' },
  heading: {
    color: '#DCE5F2',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 7,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  legendAll: {
    backgroundColor: 'transparent',
    borderColor: '#4C8DFF',
    borderRadius: 2,
    borderWidth: 1,
    height: 8,
    width: 8,
  },
  legendCheck: {
    alignItems: 'center',
    borderColor: '#526177',
    borderRadius: 3,
    borderWidth: 1,
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  legendCheckMark: { color: '#101722', fontSize: 9, fontWeight: '900' },
  legendCount: {
    color: '#D4DDEA',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  legendItem: {
    alignItems: 'center',
    borderColor: '#26354B',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 5,
    paddingVertical: 4,
    width: '31.5%',
  },
  legendSelected: { backgroundColor: '#F2A65A', borderRadius: 2, height: 8, width: 8 },
  legendText: { color: '#AAB6C9', flex: 1, fontSize: 9 },
  legendToggle: {
    alignItems: 'center',
    borderColor: '#26354B',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 5,
    paddingVertical: 4,
    width: '31.5%',
  },
  legendToggleSelected: { backgroundColor: '#172641' },
  loading: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 12 },
  muted: { color: '#8290A6', fontSize: 11, lineHeight: 16, paddingVertical: 8 },
  overlayBar: {
    borderRadius: 1,
    position: 'absolute',
    width: '60%',
  },
  overlaySummary: { color: '#D7A36B', fontSize: 11, marginTop: 2 },
  root: { flex: 1 },
  subtypeCount: { color: '#8CB4FF', fontSize: 10, fontWeight: '800' },
  subtypeGroup: { marginBottom: 10 },
  subtypeHeading: {
    color: '#AAB6C9',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  subtypeLabel: { color: '#D5DEEB', fontSize: 11 },
  subtypeList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  subtypePanel: { backgroundColor: '#121A28', borderRadius: 10, marginTop: 8, padding: 9 },
  subtypePill: {
    alignItems: 'center',
    backgroundColor: '#1A2638',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  subtypeTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 7,
  },
  summary: { color: '#8290A6', fontSize: 11, marginTop: 6 },
  tagCards: { color: '#AAB6C9', fontSize: 11, lineHeight: 17, marginTop: 5 },
  tagCount: { color: '#8CB4FF', fontSize: 11, fontWeight: '800' },
  tagHeader: { alignItems: 'center', flexDirection: 'row' },
  tagPanel: {
    backgroundColor: '#121A28',
    borderColor: '#26354B',
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 7,
    padding: 9,
  },
  tagTitle: { color: '#E8EEF7', flex: 1, fontSize: 12, fontWeight: '700' },
});
