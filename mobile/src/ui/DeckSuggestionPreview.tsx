import { useEffect, useMemo, useState } from 'react';

import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardPreviewModal } from './CardPreviewModal';
import { CardThumb } from './CardThumb';

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import type { CollectionCard } from '@/lib/collection';
import { cardPrintArtKey, ownedCardPrintScore } from '@/lib/collectionPrintPicker';
import type { DeckPrinting } from '@/lib/deck';
import { fetchCardPrints, type CardPrint } from '@/lib/prints';

const deckPrintingFromPrint = (print: CardPrint): DeckPrinting => ({
  cardmarketId: print.cardmarketId,
  collectorNumber: print.collectorNumber,
  imageUrl: print.imageUrl,
  scryfallId: print.id,
  setCode: print.setCode,
  setName: print.setName,
});

const printCandidates = (print: CardPrint): string[] =>
  cardImageCandidates({
    collectorNumber: print.collectorNumber,
    imageUrl: print.imageUrl,
    productId: print.cardmarketId != null ? String(print.cardmarketId) : undefined,
    scryfallId: print.id,
    setCode: print.setCode,
  });

export const DeckPrintingPicker = ({
  actionLabel = 'Add selected edition',
  collectionCards,
  defaultPrinting,
  name,
  onChoose,
  onClose,
}: {
  actionLabel?: string;
  collectionCards: readonly CollectionCard[];
  defaultPrinting?: DeckPrinting;
  name: string;
  onChoose: (printing?: DeckPrinting) => void;
  onClose: () => void;
}) => {
  const owned = useMemo(
    () => collectionCards.filter(card => cardKey(card.name) === cardKey(name)),
    [collectionCards, name],
  );
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [selectedArt, setSelectedArt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchCardPrints(name).then(
      found => {
        if (cancelled) return;
        const ordered = [...found].sort(
          (a, b) => ownedCardPrintScore(b, owned) - ownedCardPrintScore(a, owned),
        );
        const first = ordered[0] ?? null;
        setPrints(ordered);
        setSelectedArt(first ? cardPrintArtKey(first) : null);
        setSelectedId(first?.id ?? null);
        setLoading(false);
      },
      reason => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name, owned]);

  const arts = useMemo(() => {
    const unique = new Map<string, CardPrint>();
    for (const print of prints) {
      const key = cardPrintArtKey(print);
      if (!unique.has(key)) unique.set(key, print);
    }
    return [...unique.entries()].map(([key, print]) => ({ key, print }));
  }, [prints]);
  const editions = useMemo(
    () => prints.filter(print => !selectedArt || cardPrintArtKey(print) === selectedArt),
    [prints, selectedArt],
  );
  const selected = editions.find(print => print.id === selectedId) ?? null;
  const bestOwned = prints.find(print => ownedCardPrintScore(print, owned) > 0);
  const chooseArt = (key: string): void => {
    const first = prints.find(print => cardPrintArtKey(print) === key);
    setSelectedArt(key);
    setSelectedId(first?.id ?? null);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={styles.title}>
              Choose edition
            </Text>
            <Text numberOfLines={1} style={styles.subtitle}>
              {name}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close edition picker"
            onPress={onClose}
            style={styles.close}
          >
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>

        <Pressable
          disabled={loading}
          onPress={() => onChoose(bestOwned ? deckPrintingFromPrint(bestOwned) : defaultPrinting)}
          style={[styles.availability, loading && styles.disabled]}
        >
          <Text style={styles.availabilityTitle}>Based on availability</Text>
          <Text style={styles.availabilityMeta}>
            {bestOwned
              ? `Use an edition you own · ${bestOwned.setCode.toUpperCase()}`
              : 'Use an owned edition when possible, otherwise the default'}
          </Text>
        </Pressable>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#3D7EFF" />
            <Text style={styles.muted}>Loading printings…</Text>
          </View>
        ) : error ? (
          <Text selectable style={styles.error}>
            {error}
          </Text>
        ) : prints.length === 0 ? (
          <Text style={styles.muted}>No other editions found.</Text>
        ) : (
          <>
            {arts.length > 1 ? (
              <>
                <Text style={styles.label}>ART</Text>
                <ScrollView
                  contentContainerStyle={styles.arts}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.artScroll}
                >
                  {arts.map(art => {
                    const artOwned = prints.some(
                      print =>
                        cardPrintArtKey(print) === art.key && ownedCardPrintScore(print, owned) > 0,
                    );
                    return (
                      <Pressable
                        key={art.key}
                        onPress={() => chooseArt(art.key)}
                        style={[
                          styles.art,
                          artOwned && styles.owned,
                          selectedArt === art.key && styles.picked,
                        ]}
                      >
                        <CardThumb
                          candidates={printCandidates(art.print)}
                          style={styles.artImage}
                        />
                        {artOwned ? <Text style={styles.ownedBadge}>Owned</Text> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}
            <Text style={styles.label}>EDITION</Text>
            <FlatList
              columnWrapperStyle={styles.editionRow}
              contentContainerStyle={styles.editionGrid}
              data={editions}
              keyExtractor={print => print.id}
              numColumns={2}
              renderItem={({ item }) => {
                const isOwned = ownedCardPrintScore(item, owned) > 0;
                const picked = item.id === selectedId;
                return (
                  <Pressable
                    accessibilityLabel={`Choose ${item.setName} ${item.collectorNumber}`}
                    onPress={() => setSelectedId(item.id)}
                    style={[
                      styles.edition,
                      isOwned && styles.owned,
                      picked && styles.editionPicked,
                    ]}
                  >
                    <CardThumb candidates={printCandidates(item)} style={styles.editionImage} />
                    {picked ? <Text style={styles.check}>✓</Text> : null}
                    {isOwned ? <Text style={styles.editionOwned}>Owned</Text> : null}
                    <View style={styles.editionText}>
                      <Text numberOfLines={2} style={styles.editionName}>
                        {item.setName}
                      </Text>
                      <Text numberOfLines={1} style={styles.editionMeta}>
                        {item.setCode.toUpperCase()} · #{item.collectorNumber}
                        {item.releasedAt ? ` · ${item.releasedAt.slice(0, 4)}` : ''}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
              style={styles.editions}
            />
          </>
        )}

        <View style={styles.footer}>
          <Pressable
            disabled={!selected}
            onPress={() => selected && onChoose(deckPrintingFromPrint(selected))}
            style={[styles.add, !selected && styles.disabled]}
          >
            <Text style={styles.addText}>{actionLabel}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

export const DeckSuggestionPreview = ({
  candidates,
  collectionCards,
  defaultPrinting,
  faceImages,
  name,
  onAdd,
  onClose,
  placeholderCandidates,
}: {
  candidates: readonly string[];
  collectionCards: readonly CollectionCard[];
  defaultPrinting?: DeckPrinting;
  faceImages?: readonly string[];
  name: string;
  onAdd: (name: string, printing?: DeckPrinting) => void;
  onClose: () => void;
  placeholderCandidates?: readonly string[];
}) => {
  const [picking, setPicking] = useState(false);
  const add = (printing?: DeckPrinting): void => {
    onAdd(name, printing);
    onClose();
  };

  return picking ? (
    <DeckPrintingPicker
      collectionCards={collectionCards}
      defaultPrinting={defaultPrinting}
      name={name}
      onChoose={add}
      onClose={() => setPicking(false)}
    />
  ) : (
    <CardPreviewModal
      candidates={candidates}
      faceImages={faceImages}
      name={name}
      onAdd={() => add(defaultPrinting)}
      onClose={onClose}
      onOtherEdition={() => setPicking(true)}
      placeholderCandidates={placeholderCandidates}
    />
  );
};

const styles = StyleSheet.create({
  add: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    paddingVertical: 12,
  },
  addText: { color: '#FFFFFF', fontWeight: '800' },
  art: { borderColor: 'transparent', borderRadius: 9, borderWidth: 2, overflow: 'hidden' },
  artImage: { backgroundColor: '#1C2636', borderRadius: 7, height: 126, width: 90 },
  artScroll: { flexGrow: 0, maxHeight: 130 },
  arts: { gap: 9, paddingBottom: 4 },
  availability: {
    backgroundColor: '#17345B',
    borderColor: '#3D7EFF',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    padding: 11,
  },
  availabilityMeta: { color: '#AFC7EC', fontSize: 11, marginTop: 3 },
  availabilityTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  center: { alignItems: 'center', flex: 1, gap: 10, justifyContent: 'center', padding: 28 },
  check: {
    backgroundColor: '#3D7EFF',
    borderRadius: 13,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    height: 26,
    lineHeight: 25,
    position: 'absolute',
    right: 7,
    textAlign: 'center',
    top: 7,
    width: 26,
  },
  close: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  closeText: { color: '#AAB6C9', fontSize: 28, lineHeight: 30 },
  disabled: { opacity: 0.42 },
  edition: {
    backgroundColor: '#151E2C',
    borderColor: '#243147',
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    maxWidth: '48.5%',
    overflow: 'hidden',
  },
  editionGrid: { gap: 10, paddingBottom: 10 },
  editionImage: { aspectRatio: 488 / 680, backgroundColor: '#1C2636', width: '100%' },
  editionMeta: { color: '#8290A6', fontSize: 10, marginTop: 3 },
  editionName: { color: '#E8EEF7', fontSize: 12, fontWeight: '700', minHeight: 30 },
  editionOwned: {
    backgroundColor: '#196A49',
    borderRadius: 5,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    left: 7,
    paddingHorizontal: 5,
    paddingVertical: 3,
    position: 'absolute',
    top: 7,
  },
  editionPicked: { backgroundColor: '#172843', borderColor: '#3D7EFF', borderWidth: 2 },
  editionRow: { gap: 10 },
  editionText: { padding: 8 },
  editions: { flex: 1 },
  error: { color: '#E98A8A', flex: 1, padding: 20, textAlign: 'center' },
  footer: {
    borderTopColor: '#243147',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  header: { alignItems: 'center', flexDirection: 'row', marginBottom: 12 },
  headerText: { flex: 1 },
  label: {
    color: '#78879D',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 7,
    marginTop: 6,
  },
  muted: { color: '#8A97AD', padding: 16, textAlign: 'center' },
  owned: { borderColor: '#3CB879' },
  ownedBadge: {
    backgroundColor: '#196A49',
    bottom: 4,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 5,
    paddingVertical: 2,
    position: 'absolute',
    right: 4,
  },
  picked: { borderColor: '#3D7EFF' },
  screen: { backgroundColor: '#0B1220', flex: 1, paddingHorizontal: 14 },
  subtitle: { color: '#8A97AD', fontSize: 12, marginTop: 2 },
  title: { color: '#F4F7FB', fontSize: 18, fontWeight: '800' },
});
