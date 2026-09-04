import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  count: number;
  lastCorrect: boolean | null;
  lastLatencyOracleMs: number | null;
  lastLatencyPrintingMs: number | null;
  lastName: string | null;
  onEnd?: () => void;
  summaryText: string | null;
  target: number;
};

const ms = (n: number | null) => (n == null ? '—' : `${Math.round(n)}ms`);

/** Compact overlay while a benchmark session is active. */
export function BenchmarkHud({
  count,
  lastCorrect,
  lastLatencyOracleMs,
  lastLatencyPrintingMs,
  lastName,
  onEnd,
  summaryText,
  target,
}: Props) {
  const correctLabel =
    lastCorrect == null ? '—' : lastCorrect ? 'OK' : 'MISS';
  const done = count >= target || Boolean(summaryText);

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>
          Benchmark {count}/{target}
          {done ? ' · done' : ''}
        </Text>
        <Text style={styles.line} numberOfLines={1}>
          last {lastName ?? '—'} · {correctLabel}
        </Text>
        <Text style={styles.line}>
          lock→oracle {ms(lastLatencyOracleMs)} · lock→print {ms(lastLatencyPrintingMs)}
        </Text>
        {summaryText ? (
          <Text style={styles.summary} numberOfLines={6}>
            {summaryText}
          </Text>
        ) : null}
        {onEnd && !done ? (
          <Pressable onPress={onEnd} style={styles.btn}>
            <Text style={styles.btnLabel}>End session</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(61,126,255,0.35)',
    borderRadius: 6,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  btnLabel: {
    color: '#E8EEF7',
    fontSize: 11,
    fontWeight: '700',
  },
  card: {
    backgroundColor: 'rgba(11,18,32,0.88)',
    borderColor: 'rgba(255,200,80,0.45)',
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 320,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  line: {
    color: '#B8C4D8',
    fontSize: 11,
    marginTop: 2,
  },
  summary: {
    color: '#9EC1FF',
    fontSize: 10,
    marginTop: 6,
  },
  title: {
    color: '#FFD27A',
    fontSize: 12,
    fontWeight: '700',
  },
  wrap: {
    left: 10,
    position: 'absolute',
    right: 10,
    top: 8,
    zIndex: 40,
  },
});
