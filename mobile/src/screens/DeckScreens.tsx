import { useMemo, useState } from 'react';

import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { libraryStore } from '../data/libraryStore';
import { useLibrary } from '../data/useLibrary';
import {
  DeckRecommendations,
  type RecommendationSource,
} from './DeckRecommendations';
import { DeckCuts, DeckTags } from './DeckTools';
import { CardThumb, deckImageCandidates } from '../ui/CardThumb';

import { candidatesByName } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import { BRACKET_NAME } from '@/lib/bracket';
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
  parseCardLine,
  withFormat,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckSection,
} from '@/lib/deck';
import { filterDeckTags } from '@/lib/deckTags';
import {
  estimateDeck,
  type DeckBracketEstimate,
} from '@/lib/decks/bracket/estimator';

type DeckView = 'deck' | 'tags' | 'cuts' | RecommendationSource;

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
  const [bracketInfo, setBracketInfo] = useState<DeckBracketEstimate | null>(null);
  const collectionCards = library.data?.collection.value?.cards ?? [];
  const owned = useMemo(() => {
    return buildCollection(collectionCards, '', 'list').byKey;
  }, [collectionCards]);
  const images = useMemo(
    () => candidatesByName(collectionCards),
    [collectionCards],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Decks</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.formats}>
        {DECK_FORMATS.map(item => (
          <Pressable key={item.id} onPress={() => setFormat(item.id)} style={styles.chip}>
            <Text style={[styles.chipLabel, format === item.id && styles.chipOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
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
            void libraryStore.createDeck(format, name).then(id => {
              setName('');
              onOpen(id);
            });
          }}
          style={styles.addButton}
        >
          <Text style={styles.addLabel}>New</Text>
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
        data={decks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const missing = deckShortfall(item.cards, owned);
          const commander = item.cards.find(card => card.section === 'commander');
          const bracket =
            item.format === 'commander' ? estimateDeck(item.cards, null) : null;
          return (
            <Pressable onPress={() => onOpen(item.id)} style={styles.deckRow}>
              {commander ? (
                <CardThumb
                  candidates={deckImageCandidates(commander, images)}
                  style={styles.deckCover}
                />
              ) : (
                <View style={styles.deckCover} />
              )}
              <View style={styles.flex}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {formatInfo(item.format).label} · {countCards(item.cards)} cards
                  {missing.length > 0 ? ` · ${missing.length} missing` : ''}
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
        <BracketInfo
          bracket={bracketInfo}
          onClose={() => setBracketInfo(null)}
          open
        />
      ) : null}
    </View>
  );
};

const DeckEditor = ({ deck, onClose }: { deck: Deck; onClose: () => void }) => {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [view, setView] = useState<DeckView>('deck');
  const [bracketOpen, setBracketOpen] = useState(false);
  const [line, setLine] = useState('');
  const [tagQuery, setTagQuery] = useState('');
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
  const deckQuantities = useMemo(() => {
    const quantities: Record<string, number> = {};
    for (const card of deck.cards) {
      const key = cardKey(card.name);
      quantities[key] = (quantities[key] ?? 0) + card.quantity;
    }
    return quantities;
  }, [deck.cards]);
  const tags = filterDeckTags(tagQuery).slice(0, 12);
  const missing = deckShortfall(deck.cards, owned);

  const save = (update: (current: Deck) => Deck) => {
    void libraryStore.updateDeck(deck.id, update);
  };

  const addLine = () => {
    const parsed = parseCardLine(line);
    if (!parsed) return;
    const section: DeckSection = formatInfo(deck.format).commanderZone && commanders.length === 0
      ? 'commander'
      : 'main';
    save(current => ({
      ...current,
      cards: mergeDeckCards(current.cards, [
        { name: parsed.name, quantity: parsed.quantity, section },
      ]),
    }));
    setLine('');
  };

  const addRecommendation = (name: string) => {
    save(current => ({
      ...current,
      cards: mergeDeckCards(current.cards, [
        { name, quantity: 1, section: paperAddSection(current, 'main') },
      ]),
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

  const deckTabs: readonly { id: DeckView; label: string }[] = commanders.length > 0
    ? [
        { id: 'deck', label: 'Deck' },
        { id: 'tags', label: 'Tags' },
        { id: 'edhrec', label: 'EDHREC' },
        { id: 'goldfish', label: 'Goldfish' },
        { id: 'cuts', label: 'Cuts' },
      ]
    : [
        { id: 'deck', label: 'Deck' },
        { id: 'tags', label: 'Tags' },
      ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.addRow}>
        <Pressable onPress={onClose} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Back</Text>
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, styles.flex]}>
          {deck.name}
        </Text>
      </View>
      <View style={styles.summaryRow}>
        <Text numberOfLines={1} style={[styles.meta, styles.flex]}>
          {formatInfo(deck.format).label} · {countCards(deck.cards)} cards
          {missing.length > 0 ? ` · ${missing.length} short` : ' · collection covers it'}
        </Text>
        {bracket ? (
          <BracketPill bracket={bracket} onPress={() => setBracketOpen(true)} />
        ) : null}
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
      {view === 'deck' ? (
        <>
      <TextInput
        onChangeText={text => save(current => ({ ...current, name: text }))}
        style={styles.input}
        value={deck.name}
      />
      <View style={styles.addRow}>
        <Pressable
          onPress={() => save(current => ({ ...current, frozen: !current.frozen }))}
          style={styles.secondary}
        >
          <Text style={styles.secondaryLabel}>{deck.frozen ? 'Paper locked' : 'Mark paper'}</Text>
        </Pressable>
        <Pressable onPress={() => void libraryStore.shareDeck(deck)} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Share</Text>
        </Pressable>
      </View>
      <View style={styles.addRow}>
        <TextInput
          autoCapitalize="words"
          onChangeText={setLine}
          placeholder="2 Lightning Bolt"
          placeholderTextColor="#6E7B91"
          style={[styles.input, styles.flex]}
          value={line}
        />
        <Pressable onPress={addLine} style={styles.addButton}>
          <Text style={styles.addLabel}>Add</Text>
        </Pressable>
      </View>
      <TextInput
        onChangeText={setTagQuery}
        placeholder="Tag sections"
        placeholderTextColor="#6E7B91"
        style={styles.input}
        value={tagQuery}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.formats}>
        {tags.map(tag => {
          const on = deck.tagSections?.includes(tag.id) === true;
          return (
            <Pressable
              key={tag.id}
              onPress={() =>
                save(current => {
                  const currentTags = current.tagSections ?? [];
                  const tagSections = on
                    ? currentTags.filter(id => id !== tag.id)
                    : [...currentTags, tag.id];
                  return { ...current, tagSections };
                })
              }
              style={styles.chip}
            >
              <Text style={[styles.chipLabel, on && styles.chipOn]}>{tag.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <FlatList
        data={deck.cards}
        keyExtractor={(card, index) => `${card.section}:${cardKey(card.name)}:${index}`}
        renderItem={({ item }) => (
          <DeckRow
            card={item}
            deck={deck}
            decks={library.data?.decks.value ?? []}
            images={images}
            onChange={quantity =>
              save(current => ({
                ...current,
                cards:
                  quantity <= 0
                    ? current.cards.filter(
                        candidate =>
                          !(candidate.section === item.section && cardKey(candidate.name) === cardKey(item.name)),
                      )
                    : current.cards.map(candidate =>
                        candidate.section === item.section && cardKey(candidate.name) === cardKey(item.name)
                          ? { ...candidate, quantity }
                          : candidate,
                      ),
              }))
            }
            owned={owned[cardKey(item.name)]?.total ?? 0}
          />
        )}
        style={styles.flex}
      />
      <ScrollView horizontal style={styles.formats}>
        {DECK_FORMATS.map(item => (
          <Pressable
            key={item.id}
            onPress={() => save(current => withFormat(current, item.id))}
            style={styles.chip}
          >
            <Text style={[styles.chipLabel, deck.format === item.id && styles.chipOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        onPress={() =>
          Alert.alert('Delete deck', `Delete ${deck.name}?`, [
            { style: 'cancel', text: 'Cancel' },
            {
              onPress: () => {
                void libraryStore.removeDeck(deck.id);
                onClose();
              },
              style: 'destructive',
              text: 'Delete',
            },
          ])
        }
      >
        <Text style={styles.remove}>Delete deck</Text>
      </Pressable>
        </>
      ) : view === 'tags' ? (
        <DeckTags
          deckFormat={deck.format}
          deckQuantity={name => deckQuantities[cardKey(name)] ?? 0}
          onAdd={addRecommendation}
          ownedQuantity={name => owned[cardKey(name)]?.total ?? 0}
        />
      ) : view === 'cuts' ? (
        deck.frozen ? (
          <Text style={styles.emptyPanel}>
            This deck is locked as a paper deck. Unlock it before cutting cards.
          </Text>
        ) : (
          <DeckCuts cards={deck.cards} commanderNames={commanders} onCut={cutCard} />
        )
      ) : commanders.length > 0 ? (
        <DeckRecommendations
          commanderNames={commanders}
          deckQuantity={name => deckQuantities[cardKey(name)] ?? 0}
          onAdd={addRecommendation}
          ownedQuantity={name => owned[cardKey(name)]?.total ?? 0}
          source={view}
        />
      ) : null}
      {bracket ? (
        <BracketInfo
          bracket={bracket}
          onClose={() => setBracketOpen(false)}
          open={bracketOpen}
        />
      ) : null}
    </View>
  );
};

const DeckRow = ({
  card,
  deck,
  decks,
  images,
  onChange,
  owned,
}: {
  card: DeckCard;
  deck: Deck;
  decks: readonly Deck[];
  images: Map<string, readonly string[]>;
  onChange: (quantity: number) => void;
  owned: number;
}) => {
  const uses = copiesAcrossDecks(card.name, decks);
  const mark = coverageView(owned, uses, deck.frozen === true);
  const used = copiesUsed(uses);
  return (
    <View style={styles.deckRow}>
      <CardThumb candidates={deckImageCandidates(card, images)} style={styles.thumb} />
      <View style={styles.flex}>
        <Text style={styles.name}>{card.name}</Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {card.section}
          {used > 0
            ? ` · ${owned} owned · ${used} used in ${uses.length} deck${uses.length === 1 ? '' : 's'}`
            : ` · ${owned} owned · ${card.quantity} here`}
          {card.printing?.setCode ? ` · ${card.printing.setCode.toUpperCase()}` : ''}
        </Text>
      </View>
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
            {mark.check ? '✓ ' : ''}{owned}/{used}
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
    <Text style={styles.bracketNumber}>[{bracket.estimatedBracket}]</Text>
    <Text style={styles.bracketName}>{BRACKET_NAME[bracket.estimatedBracket]}</Text>
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
      <Pressable
        onPress={event => event.stopPropagation()}
        style={styles.bracketPanel}
      >
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
  bracket: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  bracketEvidence: { maxHeight: 260 },
  bracketEvidenceLine: { color: '#DCE5F2', fontSize: 13, lineHeight: 19, marginBottom: 7 },
  bracketFour: { backgroundColor: '#3C2516', borderColor: '#A86429' },
  bracketName: { color: '#DCE5F2', fontSize: 10, fontWeight: '700' },
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
  chip: { marginRight: 12, paddingVertical: 6 },
  chipLabel: { color: '#8A97AD', fontSize: 13 },
  chipOn: { color: '#F4F7FB', fontWeight: '700' },
  deckRow: {
    alignItems: 'center',
    borderBottomColor: '#1C2636',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
  },
  deckCover: {
    backgroundColor: '#1C2636',
    borderRadius: 6,
    height: 67,
    width: 48,
  },
  emptyPanel: {
    color: '#8A97AD',
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingVertical: 28,
    textAlign: 'center',
  },
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
  flex: { flex: 1 },
  formats: { flexGrow: 0, marginBottom: 8, maxHeight: 36 },
  input: {
    backgroundColor: '#121A28',
    borderRadius: 8,
    color: '#F4F7FB',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  meta: { color: '#8A97AD', fontSize: 12, marginBottom: 8 },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    flex: 1,
    justifyContent: 'center',
  },
  modalDone: { backgroundColor: '#1C2636', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  modalDoneText: { color: '#DCE5F2', fontSize: 12, fontWeight: '700' },
  name: { color: '#F4F7FB', fontSize: 16, fontWeight: '600' },
  paste: { minHeight: 64 },
  qty: { color: '#F4F7FB', fontVariant: ['tabular-nums'], textAlign: 'center', width: 24 },
  remove: { color: '#E06A6A', fontWeight: '700', paddingVertical: 12 },
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
  step: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  summaryRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, marginBottom: 4 },
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
});
