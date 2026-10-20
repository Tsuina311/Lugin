import { useMemo, useState } from 'react';

import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { libraryStore } from '../data/libraryStore';
import { useLibrary } from '../data/useLibrary';
import { CardThumb, collectionImageCandidates } from '../ui/CardThumb';

import { cardKey } from '@/lib/cardName';
import { buildCollection } from '@/lib/collection';
import type { CollectionCard } from '@/lib/collection';
import { printingIdentity } from '@/lib/collectionEdit';
import { collectionValue, money, signedMoney } from '@/lib/prices';


export function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const cards = library.data?.collection.value?.cards ?? [];
  const collection = useMemo(
    () => buildCollection(cards, library.data?.collection.value?.source ?? '', 'list'),
    [cards, library.data?.collection.value?.source],
  );
  const worth = useMemo(
    () => collectionValue(cards, library.prices.snapshot),
    [cards, library.prices.snapshot],
  );
  const rows = useMemo(() => {
    const needle = cardKey(query);
    return needle ? cards.filter(card => cardKey(card.name).includes(needle)) : cards;
  }, [cards, query]);
  const open = cards.find(card => printingIdentity(card) === selected) ?? null;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Collection</Text>
        <Text style={styles.meta}>
          {collection.totalCards.toLocaleString()} cards · {collection.uniqueCards.toLocaleString()} unique
        </Text>
        {worth.copies > 0 ? (
          <Text style={styles.value}>
            {money(worth.cents)}
            {worth.gain != null ? `  ${signedMoney(worth.gain)}` : ''}
            {library.prices.stale ? '  · prices stale' : ''}
          </Text>
        ) : (
          <Text style={styles.meta}>
            {library.prices.snapshot ? 'No priced cards' : 'Prices not on this phone yet'}
          </Text>
        )}
      </View>
      <SyncLine />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Search"
        placeholderTextColor="#6E7B91"
        style={styles.input}
        value={query}
      />
      <View style={styles.addRow}>
        <TextInput
          autoCapitalize="words"
          onChangeText={setAdding}
          placeholder="Add a card by name"
          placeholderTextColor="#6E7B91"
          style={[styles.input, styles.addInput]}
          value={adding}
        />
        <Pressable
          onPress={() => {
            void libraryStore.addManualCard(adding).then(ok => {
              if (ok) setAdding('');
            });
          }}
          style={styles.addButton}
        >
          <Text style={styles.addLabel}>Add</Text>
        </Pressable>
      </View>
      <FlatList
        ListEmptyComponent={
          <Text style={styles.empty}>
            {library.status === 'boot'
              ? 'Opening the library…'
              : 'No cards yet. Add one, scan one, or connect Drive.'}
          </Text>
        }
        data={rows}
        initialNumToRender={12}
        keyExtractor={card => printingIdentity(card)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <CardRow card={item} onPress={() => setSelected(printingIdentity(item))} />
        )}
        style={styles.list}
        windowSize={5}
      />
      {open ? <Detail card={open} onClose={() => setSelected(null)} /> : null}
    </View>
  );
}

const SyncLine = () => {
  const library = useLibrary();
  const label =
    library.status === 'busy'
      ? 'Syncing…'
      : library.status === 'choose-sync'
        ? 'Phone and Drive both have a library'
        : library.pending
          ? 'Saved on this phone · sync pending'
          : library.connected
            ? 'Synced'
            : 'On this phone';
  return (
    <View style={styles.syncRow}>
      <Text style={styles.sync}>{label}</Text>
      {library.status === 'choose-sync' ? (
        <View style={styles.syncActions}>
          <Pressable onPress={() => void libraryStore.replacePhoneWithDrive()} style={styles.syncButton}>
            <Text style={styles.syncButtonLabel}>Use Drive</Text>
          </Pressable>
          <Pressable onPress={() => void libraryStore.uploadPhoneCopy()} style={styles.syncButton}>
            <Text style={styles.syncButtonLabel}>Upload phone</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const CardRow = ({ card, onPress }: { card: CollectionCard; onPress: () => void }) => {
  const library = useLibrary();
  const override = library.data?.printings.value[cardKey(card.name)];
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <CardThumb candidates={collectionImageCandidates(card, override)} style={styles.thumb} />
      <View style={styles.rowText}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={styles.meta}>
          {[card.setCode?.toUpperCase(), card.collectorNumber, card.foil ? 'Foil' : null]
            .filter(Boolean)
            .join(' · ') || 'Printing not set'}
        </Text>
      </View>
      <Text style={styles.qty}>{card.quantity}</Text>
    </Pressable>
  );
};

const Detail = ({ card, onClose }: { card: CollectionCard; onClose: () => void }) => {
  const library = useLibrary();
  const identity = printingIdentity(card);
  const price = library.prices.snapshot
    ? collectionValue([card], library.prices.snapshot)
    : null;
  const override = library.data?.printings.value[cardKey(card.name)];
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <CardThumb candidates={collectionImageCandidates(card, override)} style={styles.detailImage} />
        <View style={styles.rowText}>
          <Text style={styles.name}>{card.name}</Text>
          <Text style={styles.meta}>
            {[card.setName, card.setCode?.toUpperCase(), card.collectorNumber].filter(Boolean).join(' · ') ||
              'No printing'}
          </Text>
          <Text style={styles.meta}>
            {[card.foil ? 'Foil' : 'Nonfoil', card.language, card.condition].filter(Boolean).join(' · ')}
          </Text>
          {price && price.copies > 0 ? <Text style={styles.value}>{money(price.cents)}</Text> : null}
        </View>
      </View>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => void libraryStore.setPrintingQuantity(identity, card.quantity - 1)}
          style={styles.step}
        >
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <Text style={styles.qty}>{card.quantity}</Text>
        <Pressable
          onPress={() => void libraryStore.setPrintingQuantity(identity, card.quantity + 1)}
          style={styles.step}
        >
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() =>
          Alert.alert('Remove card', `Remove ${card.name}?`, [
            { style: 'cancel', text: 'Cancel' },
            {
              onPress: () => {
                void libraryStore.deletePrinting(identity);
                onClose();
              },
              style: 'destructive',
              text: 'Remove',
            },
          ])
        }
        style={styles.remove}
      >
        <Text style={styles.removeLabel}>Remove</Text>
      </Pressable>
      <Pressable onPress={onClose} style={styles.close}>
        <Text style={styles.syncButtonLabel}>Close</Text>
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
  addInput: { flex: 1, marginBottom: 0 },
  addLabel: { color: '#fff', fontWeight: '700' },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  close: { alignItems: 'center', paddingVertical: 8 },
  detail: {
    backgroundColor: '#121A28',
    borderColor: '#243044',
    borderRadius: 12,
    borderWidth: 1,
    bottom: 8,
    left: 12,
    padding: 12,
    position: 'absolute',
    right: 12,
  },
  detailHead: { flexDirection: 'row', gap: 10 },
  detailImage: { borderRadius: 6, height: 120, width: 86 },
  empty: { color: '#8A97AD', marginTop: 24, textAlign: 'center' },
  header: { gap: 2, marginBottom: 8 },
  input: {
    backgroundColor: '#121A28',
    borderRadius: 8,
    color: '#F4F7FB',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  list: { flex: 1 },
  meta: { color: '#8A97AD', fontSize: 12 },
  name: { color: '#F4F7FB', fontSize: 16, fontWeight: '700' },
  qty: { color: '#F4F7FB', fontSize: 16, fontVariant: ['tabular-nums'], fontWeight: '700' },
  remove: { alignItems: 'center', paddingVertical: 8 },
  removeLabel: { color: '#E06A6A', fontWeight: '700' },
  root: { backgroundColor: '#0B1220', flex: 1, paddingHorizontal: 16 },
  row: {
    alignItems: 'center',
    borderBottomColor: '#1C2636',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  rowText: { flex: 1, gap: 2 },
  step: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  stepLabel: { color: '#F4F7FB', fontSize: 20 },
  stepper: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginVertical: 12 },
  sync: { color: '#9EC1FF', fontSize: 12 },
  syncActions: { flexDirection: 'row', gap: 8 },
  syncButton: {
    backgroundColor: '#1C2636',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncButtonLabel: { color: '#E8EEF7', fontSize: 12, fontWeight: '700' },
  syncRow: { gap: 8, marginBottom: 8 },
  thumb: { backgroundColor: '#1C2636', borderRadius: 4, height: 46, width: 32 },
  title: { color: '#F4F7FB', fontSize: 22, fontWeight: '700' },
  value: { color: '#F4F7FB', fontSize: 14, fontWeight: '600' },
});
