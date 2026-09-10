import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BinderBenchmarkUi } from './useBinderBenchmark';

type Props = {
  ui: BinderBenchmarkUi;
  onCancel?: () => void;
  onNextPage?: () => void;
  onResume?: () => void;
  onDiscard?: () => void;
  onFinish?: () => void;
};

/** Capture-only overlay — does not claim binder detection results. */
export function BinderBenchmarkHud({
  ui,
  onCancel,
  onNextPage,
  onResume,
  onDiscard,
  onFinish,
}: Props) {
  if (ui.phase === 'idle' || ui.phase === 'config') return null;

  if (ui.interrupted || ui.phase === 'interrupted') {
    return (
      <View pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.title}>Binder Benchmark interrupted</Text>
          <Text style={styles.big}>
            {ui.pageIndex} / {ui.targetPages} pages
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

  const turn = ui.phase === 'turn-page';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, turn && styles.cardNext]}>
        <Text style={styles.title}>BINDER TEST</Text>
        <Text style={styles.big}>
          Page {Math.min(ui.pageIndex, ui.targetPages)} / {ui.targetPages}
        </Text>
        <Text style={styles.line}>{ui.message}</Text>
        {ui.phase === 'capturing' ? (
          <Text style={styles.frames}>{ui.framesCollected} frames collected</Text>
        ) : null}
        {turn ? <Text style={styles.next}>TURN PAGE</Text> : null}
        {turn && onNextPage ? (
          <Pressable onPress={onNextPage} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>NEXT PAGE</Text>
          </Pressable>
        ) : null}
        <Text style={styles.note}>
          Capture only — binder geometry runs on Mac. No fake 9/9 on phone.
        </Text>
        {ui.phase === 'complete' ? <Text style={styles.done}>{ui.message}</Text> : null}
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
    backgroundColor: 'rgba(120,200,255,0.92)',
    borderRadius: 12,
    marginTop: 12,
    paddingVertical: 18,
  },
  btnHugeLabel: {
    color: '#041018',
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
    borderColor: 'rgba(120,200,255,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardNext: { borderColor: '#7EC8FF', borderWidth: 2 },
  done: { color: '#9EFFC2', fontSize: 14, fontWeight: '700', marginTop: 8 },
  frames: { color: '#9EC1FF', fontSize: 16, fontWeight: '700', marginTop: 8 },
  line: { color: '#B8C4D8', fontSize: 15, marginTop: 6 },
  next: {
    color: '#7EC8FF',
    fontSize: 36,
    fontWeight: '900',
    marginTop: 10,
    textAlign: 'center',
  },
  note: { color: '#7A879C', fontSize: 11, marginTop: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  title: { color: '#9EC1FF', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  wrap: { left: 12, position: 'absolute', right: 12, top: 56, zIndex: 55 },
});
