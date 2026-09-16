import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeckBenchmarkUi } from './useDeckBenchmark';

type Props = {
  ui: DeckBenchmarkUi;
  onCancel?: () => void;
  onManualNext?: () => void;
  onResume?: () => void;
  onDiscard?: () => void;
  onFinish?: () => void;
  onRetryUpload?: () => void;
};

/** Large hands-free overlay for Deck Benchmark. */
export function DeckBenchmarkHud({
  ui,
  onCancel,
  onManualNext,
  onResume,
  onDiscard,
  onFinish,
  onRetryUpload,
}: Props) {
  if (ui.phase === 'idle' || ui.phase === 'config') return null;

  // Complete / upload-retry: compact strip only — never a full-screen blocker.
  if (ui.phase === 'complete') {
    const incomplete = Boolean(ui.uploadIncomplete);
    return (
      <View pointerEvents="box-none" style={styles.bannerWrap}>
        <View style={[styles.banner, incomplete && styles.bannerFail]} pointerEvents="auto">
          <Text style={styles.bannerTitle} numberOfLines={2}>
            {incomplete
              ? ui.message || 'Upload incomplete'
              : ui.message || 'Deck upload complete'}
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

  const swapNow =
    ui.canSwapNow || ui.phase === 'next-card' || ui.phase === 'waiting-next' || ui.showManualNext;
  const identifiedHold =
    !swapNow && Boolean(ui.recognitionName) && (ui.phase === 'recognizing' || ui.phase === 'captured');

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.card, swapNow && styles.cardNext]} pointerEvents="box-none">
        <Text style={styles.title}>DECK BENCHMARK</Text>
        <Text style={styles.modeTag}>Benchmark mode</Text>
        <Text style={styles.big}>
          Card {Math.min(ui.index, ui.targetCount)} / {ui.targetCount}
        </Text>
        <Text style={styles.line}>
          Geometry track: {ui.geometryTrackId ?? '—'} · Session: {ui.cardSessionId ?? '—'}
        </Text>
        <Text style={[styles.phase, swapNow && styles.phaseSwap]}>
          {swapNow
            ? 'SWAP CARD NOW'
            : identifiedHold
              ? 'IDENTIFIED'
              : ui.phase === 'recognizing' || ui.phase === 'captured'
                ? 'SCANNING'
                : ui.phase === 'focusing'
                  ? 'FOCUSING'
                  : 'SCANNING'}
        </Text>
        <Text style={styles.recog} numberOfLines={2}>
          {ui.recognitionName ?? ui.message ?? '—'}
        </Text>
        {swapNow ? (
          <Text style={styles.swapHint}>
            Card recorded. Replace it in the same spot — do not wait. Background save may continue.
          </Text>
        ) : identifiedHold ? (
          <Text style={styles.help}>Hold steady — finishing this card…</Text>
        ) : (
          <Text style={styles.help}>
            Keep phone fixed. Place one card flat in the scan area. Hold steady until identified.
          </Text>
        )}
        {swapNow ? <Text style={styles.next}>SWAP NOW</Text> : null}
        {ui.showManualNext && onManualNext ? (
          <Pressable onPress={onManualNext} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>NEXT CARD MANUALLY</Text>
          </Pressable>
        ) : null}
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
    borderColor: 'rgba(255,210,100,0.45)',
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
    backgroundColor: 'rgba(255, 180, 40, 0.95)',
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
    alignSelf: 'stretch',
    backgroundColor: 'rgba(8,14,28,0.92)',
    borderColor: 'rgba(255,210,100,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardNext: { borderColor: '#FFC857', borderWidth: 2 },
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
  help: { color: '#7A879C', fontSize: 11, marginTop: 8, lineHeight: 15 },
  swapHint: {
    color: '#FFD27A',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 8,
  },
  modeTag: {
    color: '#FFC857',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  phase: { color: '#9EFFC2', fontSize: 16, fontWeight: '800', marginTop: 8 },
  phaseSwap: { color: '#FFC857', fontSize: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  title: { color: '#FFD27A', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  wrap: { left: 12, position: 'absolute', right: 12, top: 56, zIndex: 80 },
});
