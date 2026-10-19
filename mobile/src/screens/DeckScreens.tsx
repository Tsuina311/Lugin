import { useMemo, useState } from 'react';

import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { libraryStore } from '../data/libraryStore';
import { useLibrary } from '../data/useLibrary';

import { cardKey } from '@/lib/cardName';
import { buildCollection } from '@/lib/collection';
import {
  countCards,
  coverageView,
  copiesAcrossDecks,
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  mergeDeckCards,
  parseCardLine,
  withFormat,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckSection,
} from '@/lib/deck';
import { filterDeckTags } from '@/lib/deckTags';
import { estimateDeck } from '@/lib/decks/bracket/estimator';
import { commanderSlug, goldfishArchetypeSlug } from '@/lib/siteSlugs';


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
  const owned = useMemo(() => {
    const cards = library.data?.collection.value?.cards ?? [];
    return buildCollection(cards, '', 'list').byKey;
  }, [library.data?.collection.value?.cards]);

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
          return (
            <Pressable onPress={() => onOpen(item.id)} style={styles.deckRow}>
              <View style={styles.flex}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {formatInfo(item.format).label} · {countCards(item.cards)} cards
                  {missing.length > 0 ? ` · ${missing.length} missing` : ''}
                  {item.frozen ? ' · paper' : ''}
                </Text>
              </View>
            </Pressable>
          );
        }}
        style={styles.flex}
      />
    </View>
  );
};

const DeckEditor = ({ deck, onClose }: { deck: Deck; onClose: () => void }) => {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [line, setLine] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const owned = useMemo(() => {
    const cards = library.data?.collection.value?.cards ?? [];
    return buildCollection(cards, '', 'list').byKey;
  }, [library.data?.collection.value?.cards]);
  const bracket = useMemo(
    () => (deck.format === 'commander' ? estimateDeck(deck.cards, null) : null),
    [deck.cards, deck.format],
  );
  const commanders = deck.cards.filter(card => card.section === 'commander').map(card => card.name);
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
      <Text style={styles.meta}>
        {formatInfo(deck.format).label} · {countCards(deck.cards)} cards
        {bracket ? ` · bracket ${bracket.estimatedBracket}` : ''}
        {missing.length > 0 ? ` · ${missing.length} short` : ' · collection covers it'}
      </Text>
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
      {commanders.length > 0 ? (
        <View style={styles.addRow}>
          <Pressable
            onPress={() =>
              void Linking.openURL(`https://edhrec.com/commanders/${commanderSlug(commanders)}`)
            }
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>EDHREC</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              void Linking.openURL(
                `https://www.mtggoldfish.com/archetype/${goldfishArchetypeSlug(commanders)}`,
              )
            }
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>Goldfish</Text>
          </Pressable>
        </View>
      ) : null}
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
    </View>
  );
};

const DeckRow = ({
  card,
  deck,
  decks,
  onChange,
  owned,
}: {
  card: DeckCard;
  deck: Deck;
  decks: readonly Deck[];
  onChange: (quantity: number) => void;
  owned: number;
}) => {
  const uses = copiesAcrossDecks(card.name, decks);
  const mark = coverageView(owned, uses, deck.frozen === true);
  return (
    <View style={styles.deckRow}>
      <View style={styles.flex}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={styles.meta}>
          {card.section}
          {mark?.fraction ? ` · ${mark.fraction}` : ` · ${owned} / ${card.quantity} owned`}
          {card.printing?.setCode ? ` · ${card.printing.setCode.toUpperCase()}` : ''}
        </Text>
      </View>
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

const styles = StyleSheet.create({
  addButton: {
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  addLabel: { color: '#fff', fontWeight: '700' },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
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
  name: { color: '#F4F7FB', fontSize: 16, fontWeight: '600' },
  paste: { minHeight: 64 },
  qty: { color: '#F4F7FB', fontVariant: ['tabular-nums'], textAlign: 'center', width: 24 },
  remove: { color: '#E06A6A', fontWeight: '700', paddingVertical: 12 },
  root: { backgroundColor: '#0B1220', flex: 1, paddingHorizontal: 16 },
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
  title: { color: '#F4F7FB', fontSize: 22, fontWeight: '700', marginBottom: 8 },
});
