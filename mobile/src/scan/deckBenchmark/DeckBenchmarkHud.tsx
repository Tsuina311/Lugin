import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeckBenchmarkUi } from './useDeckBenchmark';

type Props = {
  ui: DeckBenchmarkUi;
  onCancel?: () => void;
  onManualNext?: () => void;
  onResume?: () => void;
  onDiscard?: () => void;
  onFinish?: () => void;
};

/** Large hands-free overlay for Deck Benchmark. */
export function DeckBenchmarkHud({
  ui,
  onCancel,
  onManualNext,
  onResume,
  onDiscard,
  onFinish,
}: Props) {
  if (ui.phase === 'idle' || ui.phase === 'config') return null;

  if (ui.interrupted || ui.phase === 'interrupted') {
    return (
      <View pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.title}>Deck Benchmark interrupted</Text>
          <Text style={styles.big}>
            {ui.index} / {ui.targetCount} complete
          </Text>
          <View style={styles.row}>
            {onResume ? (
              <Pressable onPress={onResume} style={styles.btnPrimary}>
                <Text style={styles.btnLabel}>Resume</Text>
              </Pressable>
            ) : null}
            {onFinish ? (
              <Pressable onPress={onFinish} style={styles.btn}>
                <Text style={styles.btnLabel}>Finish</Text>
              </Pressable>
            ) : null}
            {onDiscard ? (
              <Pressable onPress={onDiscard} style={styles.btn}>
                <Text style={styles.btnLabel}>Discard</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  const nextHuge = ui.phase === 'next-card' || ui.showManualNext;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, nextHuge && styles.cardNext]}>
        <Text style={styles.title}>DECK TEST</Text>
        <Text style={styles.big}>
          Card {Math.min(ui.index, ui.targetCount)} / {ui.targetCount}
        </Text>
        <Text style={styles.line}>
          Geometry track: {ui.geometryTrackId ?? '—'} · Session: {ui.cardSessionId ?? '—'}
        </Text>
        <Text style={styles.line}>Phase: {ui.phase}</Text>
        <Text style={styles.recog} numberOfLines={2}>
          {ui.recognitionName ?? ui.message ?? '—'}
        </Text>
        {nextHuge ? <Text style={styles.next}>NEXT CARD</Text> : null}
        {ui.showManualNext && onManualNext ? (
          <Pressable onPress={onManualNext} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>NEXT CARD MANUALLY</Text>
          </Pressable>
        ) : null}
        {ui.phase === 'complete' ? (
          <Text style={styles.done}>{ui.message}</Text>
        ) : null}
        {onCancel && ui.phase !== 'complete' ? (
          <Pressable onPress={onCancel} style={styles.btn}>
            <Text style={styles.btnLabel}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  big: { color: '#FFF6D5', fontSize: 28, fontWeight: '800', marginTop: 4 },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(61,126,255,0.35)',
    borderRadius: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnHuge: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 180, 40, 0.95)',
    borderRadius: 12,
    marginTop: 12,
    paddingVertical: 18,
  },
  btnHugeLabel: {
    color: '#1A1200',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  btnLabel: { color: '#E8EEF7', fontSize: 13, fontWeight: '700' },
  btnPrimary: {
    backgroundColor: 'rgba(80,200,120,0.45)',
    borderRadius: 8,
    marginRight: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  card: {
    backgroundColor: 'rgba(8,14,28,0.92)',
    borderColor: 'rgba(255,210,100,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardNext: { borderColor: '#FFC857', borderWidth: 2 },
  done: { color: '#9EFFC2', fontSize: 14, fontWeight: '700', marginTop: 8 },
  line: { color: '#B8C4D8', fontSize: 13, marginTop: 4 },
  next: {
    color: '#FFC857',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 10,
    textAlign: 'center',
  },
  recog: { color: '#E8EEF7', fontSize: 18, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  title: { color: '#FFD27A', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  wrap: { left: 12, position: 'absolute', right: 12, top: 56, zIndex: 55 },
});
