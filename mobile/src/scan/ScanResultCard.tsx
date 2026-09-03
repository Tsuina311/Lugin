// Native scan result. Statuses come from shared fuseEvidence — do not hide
// ambiguity. Persistence is a command, not an automatic upload.

import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMemo, useState } from 'react';

import type {
  FusedResult,
  NameCandidate,
  ScanIdentityStatus,
  ScryfallPrinting,
  SessionSnapshot,
} from './sharedCore';
import { fetchPrintingsByName, matchReadings, type CardNameIndex } from './sharedCore';

type Action = 'add' | 'wrong-card' | 'wrong-printing' | 'scan-again';

type Props = {
  nameIndex: CardNameIndex | null;
  onAction: (action: Action, extra?: { name?: string; printing?: ScryfallPrinting }) => void;
  snapshot: SessionSnapshot;
};

const statusLabel = (status: ScanIdentityStatus | undefined): string => {
  switch (status) {
    case 'identified':
      return 'Identified';
    case 'printing-ambiguous':
      return 'Printing ambiguous';
    case 'card-ambiguous':
      return 'Card ambiguous';
    case 'insufficient-confidence':
      return 'Need a clearer view';
    default:
      return 'Recognizing…';
  }
};

export function ScanResultCard({ nameIndex, onAction, snapshot }: Props) {
  const fused: FusedResult | undefined = snapshot.fused;
  const card = fused?.card;
  const [query, setQuery] = useState('');
  const [printings, setPrintings] = useState<ScryfallPrinting[] | null>(null);
  const [mode, setMode] = useState<'result' | 'wrong-card' | 'wrong-printing'>('result');

  const suggestions: NameCandidate[] = useMemo(() => {
    if (!nameIndex || query.trim().length < 2) return [];
    return matchReadings([{ text: query, source: 'user' }], nameIndex, { limit: 8 });
  }, [nameIndex, query]);

  const show = snapshot.phase === 'found' || snapshot.phase === 'ambiguous';
  if (!show && mode === 'result') return null;

  const rec = snapshot.recognition;

  return (
    <View style={styles.card}>
      {mode === 'result' ? (
        <>
          <Text style={styles.name}>{card?.name ?? snapshot.message}</Text>
          <Text style={styles.status}>{statusLabel(fused?.status)}</Text>
          {rec?.collector?.setCode ? (
            <Text style={styles.meta}>
              set {rec.collector.setCode}
              {rec.collector.collectorNumber ? ` · ${rec.collector.collectorNumber}` : ''}
              {rec.collector.foilMarker == null
                ? ''
                : rec.collector.foilMarker
                  ? ' · foil'
                  : ' · nonfoil'}
            </Text>
          ) : null}
          {fused ? (
            <Text style={styles.debug}>
              confidence {(card?.confidence ?? fused.candidates[0]?.score ?? 0).toFixed(2)} ·
              margin {fused.margin.toFixed(2)}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable onPress={() => onAction('add')} style={styles.btn}>
              <Text style={styles.btnLabel}>Add to collection</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode('wrong-card')}
              style={styles.btnGhost}
            >
              <Text style={styles.btnGhostLabel}>Wrong card</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMode('wrong-printing');
                if (card?.name) {
                  void fetchPrintingsByName(card.name).then(setPrintings);
                }
              }}
              style={styles.btnGhost}
            >
              <Text style={styles.btnGhostLabel}>Wrong printing</Text>
            </Pressable>
            <Pressable onPress={() => onAction('scan-again')} style={styles.btnGhost}>
              <Text style={styles.btnGhostLabel}>Scan again</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {mode === 'wrong-card' ? (
        <>
          <Text style={styles.name}>Search the card universe</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Card name"
            placeholderTextColor="#8A97AD"
            style={styles.input}
            value={query}
          />
          <ScrollView style={styles.list}>
            {suggestions.map(s => (
              <Pressable
                key={`${s.name}:${s.score}`}
                onPress={() => {
                  onAction('wrong-card', { name: s.name });
                  setMode('result');
                }}
                style={styles.hit}
              >
                <Text style={styles.hitLabel}>
                  {s.name} · {s.score.toFixed(2)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => setMode('result')} style={styles.btnGhost}>
            <Text style={styles.btnGhostLabel}>Back</Text>
          </Pressable>
        </>
      ) : null}

      {mode === 'wrong-printing' ? (
        <>
          <Text style={styles.name}>Pick a printing</Text>
          <ScrollView style={styles.list}>
            {(printings ?? []).slice(0, 24).map(p => (
              <Pressable
                key={p.id}
                onPress={() => {
                  onAction('wrong-printing', { printing: p });
                  setMode('result');
                }}
                style={styles.hit}
              >
                <Text style={styles.hitLabel}>
                  {p.setCode.toUpperCase()} {p.collectorNumber} · {p.setName}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => setMode('result')} style={styles.btnGhost}>
            <Text style={styles.btnGhostLabel}>Back</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  btnGhost: {
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  btnGhostLabel: {
    color: '#E8EEF7',
    fontSize: 12,
    fontWeight: '600',
  },
  btnLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: 'rgba(11,18,32,0.92)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  debug: {
    color: '#8A97AD',
    fontSize: 11,
    marginTop: 2,
  },
  hit: {
    paddingVertical: 6,
  },
  hitLabel: {
    color: '#E8EEF7',
    fontSize: 13,
  },
  input: {
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 8,
    borderWidth: 1,
    color: '#F4F7FB',
    marginVertical: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  list: {
    maxHeight: 160,
  },
  meta: {
    color: '#A8B3C7',
    fontSize: 12,
    marginTop: 2,
  },
  name: {
    color: '#F4F7FB',
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  status: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
