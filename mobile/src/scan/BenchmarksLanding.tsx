import { Pressable, StyleSheet, Text, View } from 'react-native';

type LatestLine = {
  title: string;
  detail: string;
  onPress: () => void;
  disabled?: boolean;
};

type Props = {
  deckLatest: string | null;
  binderLatest: string | null;
  lockReason: string | null;
  onDeck: () => void;
  onBinder: () => void;
  onCardSwap: () => void;
  onFocusSeries: () => void;
  onScannerLab: () => void;
  onBackToScan?: () => void;
};

/** DEV-ONLY landing for real benchmarks + diagnostics. */
export function BenchmarksLanding({
  deckLatest,
  binderLatest,
  lockReason,
  onDeck,
  onBinder,
  onCardSwap,
  onFocusSeries,
  onScannerLab,
  onBackToScan,
}: Props) {
  const locked = Boolean(lockReason);
  const real: LatestLine[] = [
    {
      title: 'Deck Benchmark',
      detail: deckLatest
        ? `Continuous individual-card benchmark\nLatest: ${deckLatest}`
        : 'Continuous individual-card benchmark',
      onPress: onDeck,
      disabled: locked,
    },
    {
      title: 'Binder Benchmark',
      detail: binderLatest
        ? `Real multi-view binder capture\nLatest: ${binderLatest}`
        : 'Real multi-view binder capture',
      onPress: onBinder,
      disabled: locked,
    },
  ];
  const other: LatestLine[] = [
    { title: 'Card Swap Test', detail: 'Session ownership / swap diagnostics', onPress: onCardSwap, disabled: locked },
    { title: 'Focus Series', detail: 'Timed focus capture series', onPress: onFocusSeries, disabled: locked },
    { title: 'Scanner Lab', detail: 'Locked-frame recognition lab', onPress: onScannerLab, disabled: locked },
  ];

  return (
    <View style={styles.root}>
      <Text style={styles.hero}>REAL BENCHMARKS</Text>
      <Text style={styles.sub}>
        Exclusive scanner mode. Production recognition still runs for Deck Benchmark; consumer
        result UI does not.
      </Text>
      {lockReason ? <Text style={styles.lock}>{lockReason}</Text> : null}
      {real.map(item => (
        <Pressable
          key={item.title}
          disabled={item.disabled}
          onPress={item.onPress}
          style={[styles.card, item.disabled && styles.cardDisabled]}
        >
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDetail}>{item.detail}</Text>
        </Pressable>
      ))}
      <Text style={styles.section}>OTHER DIAGNOSTICS</Text>
      {other.map(item => (
        <Pressable
          key={item.title}
          disabled={item.disabled}
          onPress={item.onPress}
          style={[styles.cardSmall, item.disabled && styles.cardDisabled]}
        >
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardDetail}>{item.detail}</Text>
        </Pressable>
      ))}
      {onBackToScan ? (
        <Pressable onPress={onBackToScan} style={styles.back}>
          <Text style={styles.backLabel}>← Back to Scan</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  back: { marginTop: 20, paddingVertical: 10 },
  backLabel: { color: '#9EC1FF', fontSize: 14, fontWeight: '700' },
  card: {
    backgroundColor: 'rgba(255,210,100,0.12)',
    borderColor: 'rgba(255,210,100,0.45)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  cardDetail: { color: '#B8C4D8', fontSize: 13, lineHeight: 18, marginTop: 4 },
  cardDisabled: { opacity: 0.45 },
  cardSmall: {
    backgroundColor: 'rgba(61,126,255,0.12)',
    borderColor: 'rgba(61,126,255,0.35)',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  cardTitle: { color: '#E8EEF7', fontSize: 17, fontWeight: '800' },
  hero: { color: '#FFD27A', fontSize: 22, fontWeight: '900', letterSpacing: 0.4 },
  lock: { color: '#FFB4A8', fontSize: 13, fontWeight: '700', marginTop: 10 },
  root: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  section: {
    color: '#8A97AD',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 28,
  },
  sub: { color: '#8A97AD', fontSize: 13, lineHeight: 18, marginTop: 8 },
});
