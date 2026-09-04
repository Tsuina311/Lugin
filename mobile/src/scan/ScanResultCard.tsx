// Native scan result. Statuses come from shared fuseEvidence — do not hide
// ambiguity. Persistence is a command, not an automatic upload.

import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMemo, useState } from 'react';

import type {
  CardFinish,
  FusedResult,
  NameCandidate,
  PrintingIndex,
  ScanIdentityStatus,
  ScryfallPrinting,
  SessionSnapshot,
} from './sharedCore';
import {
  entryToScryfallPrinting,
  fetchPrintingsByName,
  finishFromMetadata,
  listPrintingsByName,
  matchReadings,
  type CardNameIndex,
} from './sharedCore';

type Action = 'add' | 'wrong-card' | 'wrong-printing' | 'scan-again' | 'set-finish';

type Props = {
  nameIndex: CardNameIndex | null;
  onAction: (
    action: Action,
    extra?: { name?: string; printing?: ScryfallPrinting; finish?: CardFinish },
  ) => void;
  printingIndex?: PrintingIndex | null;
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

const finishLabel = (finish: CardFinish | null | undefined, supported?: string[]): string => {
  if (finish && finish !== 'unknown') {
    return finish === 'nonfoil' ? 'Nonfoil' : finish === 'foil' ? 'Foil' : 'Etched';
  }
  if (supported && supported.length > 1) return 'Finish: ?';
  return '';
};

export function ScanResultCard({
  nameIndex,
  onAction,
  printingIndex = null,
  snapshot,
}: Props) {
  const fused: FusedResult | undefined = snapshot.fused;
  const card = fused?.card;
  const printing = fused?.printing;
  const [query, setQuery] = useState('');
  const [printings, setPrintings] = useState<ScryfallPrinting[] | null>(null);
  const [mode, setMode] = useState<'result' | 'wrong-card' | 'wrong-printing'>('result');
  const [finishOverride, setFinishOverride] = useState<CardFinish | null>(null);

  const metaFinish = useMemo(() => {
    const finishes = printing?.finishes;
    return finishFromMetadata(finishes);
  }, [printing?.finishes]);

  const finish: CardFinish =
    finishOverride ?? metaFinish?.finish ?? 'unknown';
  const supported = printing?.finishes ?? metaFinish?.supported ?? [];
  const needsFinishPick = Boolean(printing && supported.length > 1 && finish === 'unknown');

  const suggestions: NameCandidate[] = useMemo(() => {
    if (!nameIndex || query.trim().length < 2) return [];
    return matchReadings([{ text: query, source: 'user' }], nameIndex, { limit: 8 });
  }, [nameIndex, query]);

  const show = snapshot.phase === 'found' || snapshot.phase === 'ambiguous';
  if (!show && mode === 'result') return null;

  const setLine = printing
    ? `${printing.setCode.toUpperCase()} #${printing.collectorNumber}`
    : null;

  return (
    <View style={styles.card}>
      {mode === 'result' ? (
        <>
          <Text style={styles.name}>{card?.name ?? printing?.name ?? snapshot.message}</Text>
          {setLine ? <Text style={styles.printing}>{setLine}</Text> : null}
          {printing ? (
            <Text style={styles.meta}>
              {finishLabel(finish, [...supported]) ||
                (supported.length === 1
                  ? finishLabel(finishFromMetadata(supported)?.finish ?? 'unknown')
                  : '')}
              {printing.lang && printing.lang !== 'en' ? ` · ${printing.lang}` : ''}
              {!printing.lang ? ' · language ?' : ''}
            </Text>
          ) : null}
          <Text style={styles.status}>{statusLabel(fused?.status)}</Text>
          {needsFinishPick ? (
            <View style={styles.row}>
              {(['nonfoil', 'foil', 'etched'] as const)
                .filter(f => supported.map(s => s.toLowerCase()).includes(f))
                .map(f => (
                  <Pressable
                    key={f}
                    onPress={() => {
                      setFinishOverride(f);
                      onAction('set-finish', { finish: f });
                    }}
                    style={styles.btnGhost}
                  >
                    <Text style={styles.btnGhostLabel}>
                      {f === 'nonfoil' ? 'Nonfoil' : f === 'foil' ? 'Foil' : 'Etched'}
                    </Text>
                  </Pressable>
                ))}
            </View>
          ) : null}
          {fused ? (
            <Text style={styles.debug}>
              confidence {(card?.confidence ?? fused.candidates[0]?.score ?? 0).toFixed(2)} ·
              margin {fused.margin.toFixed(2)}
              {snapshot.recognition?.earlyReason
                ? ` · early ${snapshot.recognition.earlyReason}`
                : ''}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Pressable
              disabled={fused?.status !== 'identified' && fused?.status !== 'printing-ambiguous'}
              onPress={() => onAction('add')}
              style={[
                styles.btn,
                fused?.status !== 'identified' && fused?.status !== 'printing-ambiguous'
                  ? styles.btnOff
                  : null,
              ]}
            >
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
                const name = card?.name ?? printing?.name;
                if (!name) return;
                const local = listPrintingsByName(printingIndex, name).map(entryToScryfallPrinting);
                if (local.length) {
                  setPrintings(local);
                  return;
                }
                void fetchPrintingsByName(name).then(setPrintings);
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
  btnOff: {
    opacity: 0.4,
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
    paddingVertical: 8,
  },
  hitLabel: {
    color: '#E8EEF7',
    fontSize: 13,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#E8EEF7',
    marginVertical: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  list: {
    maxHeight: 160,
  },
  meta: {
    color: '#B8C4D8',
    fontSize: 13,
    marginTop: 2,
  },
  name: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  printing: {
    color: '#9EC1FF',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  status: {
    color: '#8A97AD',
    fontSize: 12,
    marginTop: 4,
  },
});
