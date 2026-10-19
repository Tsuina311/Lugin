import { useState } from 'react';

import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { libraryStore } from '../data/libraryStore';
import { useLibrary } from '../data/useLibrary';

import { collectionCardFromPrinting } from './collectionCard';
import type { SessionSnapshot } from './sharedCore';

import type { IntakeStatus } from '@/lib/collectionIntake';

const toStatus = (status: string | undefined): IntakeStatus => {
  if (
    status === 'identified' ||
    status === 'printing-ambiguous' ||
    status === 'card-ambiguous' ||
    status === 'insufficient-confidence'
  ) {
    return status;
  }
  return 'none';
};

/** Add the card the scanner is showing. Does not change recognition. */
export function ScanCollectionBar({ snapshot }: { snapshot: SessionSnapshot | null }) {
  const library = useLibrary();
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const fused = snapshot?.fused;
  const printing = fused?.printing;
  const name = fused?.card?.name ?? printing?.name ?? '';
  const status = toStatus(fused?.status);
  const live = snapshot?.lockGates?.cardSessionId ?? null;
  const owner = snapshot?.resultCardSessionId ?? null;
  const confident = status === 'identified' || status === 'printing-ambiguous';

  const addCard = (next: IntakeStatus, named: string, usePrinting: boolean) => {
    const foil =
      usePrinting && printing
        ? printing.finishes.length === 1 && printing.finishes[0]?.toLowerCase() === 'foil'
        : false;
    const card =
      usePrinting && printing
        ? collectionCardFromPrinting(printing, { confidence: 1, foil, reason: 'user' })
        : { foil: false, name: named, quantity: 1, source: 'import' as const };
    void libraryStore
      .addScan({ card, liveSessionId: live, ownerSessionId: owner, status: next })
      .then(setNote);
  };

  return (
    <View style={styles.wrap}>
      {confident && name ? (
        <View style={styles.row}>
          <Pressable onPress={() => addCard(status, name, true)} style={styles.primary}>
            <Text style={styles.primaryLabel}>
              {status === 'printing-ambiguous' ? 'Add this printing' : 'Add to collection'}
            </Text>
          </Pressable>
          {status === 'printing-ambiguous' ? (
            <Pressable onPress={() => addCard('manual', name, false)} style={styles.ghost}>
              <Text style={styles.ghostLabel}>Add name only</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={styles.hint}>
          {name ? `${name} needs a confirmation before it is added.` : 'No name yet. Search to add one.'}
        </Text>
      )}
      {status === 'printing-ambiguous' ? (
        <Text style={styles.hint}>Printing not resolved.</Text>
      ) : null}
      <Pressable onPress={() => setSearching(value => !value)} style={styles.ghost}>
        <Text style={styles.ghostLabel}>{searching ? 'Close search' : 'Search manually'}</Text>
      </Pressable>
      {searching ? (
        <View style={styles.row}>
          <TextInput
            autoCapitalize="words"
            onChangeText={setQuery}
            placeholder="Card name"
            placeholderTextColor="#8A97AD"
            style={styles.input}
            value={query}
          />
          <Pressable onPress={() => addCard('manual', query, false)} style={styles.primary}>
            <Text style={styles.primaryLabel}>Add</Text>
          </Pressable>
        </View>
      ) : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {library.session.slice(0, 6).map((mark, index) => (
        <Text key={`${mark.name}:${index}`} style={styles.log}>
          {mark.state === 'added' ? 'Added' : 'Review'} · {mark.name}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ghost: {
    alignSelf: 'flex-start',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  ghostLabel: { color: '#E8EEF7', fontSize: 12, fontWeight: '700' },
  hint: { color: '#C5D0E0', fontSize: 12 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#F4F7FB',
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  log: { color: '#8A97AD', fontSize: 11, marginTop: 2 },
  note: { color: '#9EC1FF', fontSize: 12, marginTop: 6 },
  primary: {
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryLabel: { color: '#fff', fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wrap: { marginTop: 8 },
});
