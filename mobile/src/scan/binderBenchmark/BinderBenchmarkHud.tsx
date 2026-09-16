import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BinderBenchmarkUi } from './useBinderBenchmark';

type Props = {
  ui: BinderBenchmarkUi;
  onCancel?: () => void;
  onNextPage?: () => void;
  onRetryPage?: () => void;
  onResume?: () => void;
  onDiscard?: () => void;
  onFinish?: () => void;
  onRetryUpload?: () => void;
};

/** Capture-only overlay — does not claim binder detection results. */
export function BinderBenchmarkHud({
  ui,
  onCancel,
  onNextPage,
  onRetryPage,
  onResume,
  onDiscard,
  onFinish,
  onRetryUpload,
}: Props) {
  if (ui.phase === 'idle' || ui.phase === 'config') return null;

  if (ui.phase === 'complete') {
    const incomplete = Boolean(ui.uploadIncomplete);
    return (
      <View pointerEvents="box-none" style={styles.bannerWrap}>
        <View style={[styles.banner, incomplete && styles.bannerFail]} pointerEvents="auto">
          <Text style={styles.bannerTitle} numberOfLines={2}>
            {incomplete
              ? ui.message || 'Upload incomplete'
              : ui.message || 'Binder upload complete'}
          </Text>
          <View style={styles.bannerRow}>
            {incomplete && onRetryUpload ? (
              <Pressable onPress={onRetryUpload} style={styles.bannerBtnPrimary}>
                <Text style={styles.bannerBtnLabel}>Retry upload</Text>
              </Pressable>
            ) : null}
            {onDiscard ? (
              <Pressable onPress={onDiscard} style={styles.bannerBtn}>
                <Text style={styles.bannerBtnLabel}>{incomplete ? 'Dismiss' : 'OK'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  if (ui.interrupted || ui.phase === 'interrupted') {
    return (
      <View pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.card} pointerEvents="auto">
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
  const retry = ui.phase === 'retry-page';
  const saved = ui.phase === 'page-saved';
  const showFrames = ui.phase === 'capturing' || saved || turn;
  const finalPage = saved && ui.pageIndex >= ui.targetPages;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, turn && styles.cardNext, retry && styles.cardFail]} pointerEvents="box-none">
        <Text style={styles.title}>BINDER BENCHMARK</Text>
        <Text style={styles.modeTag}>Benchmark mode</Text>
        <Text style={styles.big}>
          Page {Math.min(ui.pageIndex, ui.targetPages)} / {ui.targetPages}
        </Text>
        {showFrames ? (
          <Text style={styles.frames}>
            Frame {Math.min(Math.max(ui.framesCollected, 1), ui.framesTarget)} / {ui.framesTarget}
            {ui.pageStatus ? ` · ${ui.pageStatus}` : ''}
          </Text>
        ) : null}
        <Text style={styles.line}>{ui.message || 'MOVE PHONE SLOWLY'}</Text>
        {ui.captureCue ? <Text style={styles.cue}>{ui.captureCue}</Text> : null}
        {retry ? <Text style={styles.fail}>CAPTURE FAILED</Text> : null}
        {retry && onRetryPage ? (
          <Pressable onPress={onRetryPage} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>RETRY PAGE</Text>
          </Pressable>
        ) : null}
        {turn ? <Text style={styles.next}>TURN PAGE</Text> : null}
        {turn && onNextPage ? (
          <Pressable onPress={onNextPage} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>NEXT PAGE</Text>
          </Pressable>
        ) : null}
        {finalPage && onFinish ? (
          <Pressable onPress={onFinish} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>FINISH BENCHMARK</Text>
          </Pressable>
        ) : null}
        <Text style={styles.note}>
          REAL MULTI-VIEW BINDER CAPTURE — not video-rate. Frames are seconds apart (PNG encode
          ~4s). Keep whole page visible; capture several slightly different angles; move slowly to
          shift glare. Geometry runs on Mac.
        </Text>
        {onCancel ? (
          <Pressable onPress={onCancel} style={styles.btn}>
            <Text style={styles.btnLabel}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(8,14,28,0.94)',
    borderColor: 'rgba(120,200,255,0.45)',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerBtn: {
    backgroundColor: 'rgba(61,126,255,0.35)',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerBtnLabel: { color: '#E8EEF7', fontSize: 13, fontWeight: '700' },
  bannerBtnPrimary: {
    backgroundColor: 'rgba(120,200,255,0.92)',
    borderRadius: 8,
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerFail: { borderColor: 'rgba(255,138,138,0.7)' },
  bannerRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  bannerTitle: { color: '#E8EEF7', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  bannerWrap: {
    bottom: 96,
    left: 12,
    position: 'absolute',
    right: 12,
    zIndex: 80,
  },
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
    alignSelf: 'stretch',
    backgroundColor: 'rgba(8,14,28,0.92)',
    borderColor: 'rgba(120,200,255,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardFail: { borderColor: '#FF8A8A', borderWidth: 2 },
  cardNext: { borderColor: '#7EC8FF', borderWidth: 2 },
  fail: {
    color: '#FF8A8A',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 10,
    textAlign: 'center',
  },
  frames: { color: '#9EC1FF', fontSize: 16, fontWeight: '700', marginTop: 8 },
  cue: { color: '#9EFFC2', fontSize: 15, fontWeight: '800', marginTop: 6 },
  line: { color: '#B8C4D8', fontSize: 15, marginTop: 6 },
  modeTag: {
    color: '#7EC8FF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
    textTransform: 'uppercase',
  },
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
  wrap: { left: 12, position: 'absolute', right: 12, top: 56, zIndex: 80 },
});
