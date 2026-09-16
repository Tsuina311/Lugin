import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { GeometryTestUi } from './useGeometryTest';

type Props = {
  ui: GeometryTestUi;
  onStart: () => void;
  onNext: () => void;
  onCancel: () => void;
  onFinish: () => void;
  onCaptureCurrent: () => void;
  onRetryUpload?: () => void;
  onToggleDebug: () => void;
  onFocusMode: (mode: 'prefocus-once' | 'no-explicit-focus') => void;
  onPreviewKind: (kind: 'card' | 'source') => void;
  onPreviewDisplayed?: () => void;
};

const fmtSec = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(3)} s`;
};

const fmtMs = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)} ms`;
};

/** Capture-only Geometry Test HUD — no recognition UI. */
export function GeometryTestHud({
  ui,
  onStart,
  onNext,
  onCancel,
  onFinish,
  onCaptureCurrent,
  onRetryUpload,
  onToggleDebug,
  onFocusMode,
  onPreviewKind,
  onPreviewDisplayed,
}: Props) {
  if (ui.phase === 'idle') return null;

  // Compact bottom strip — never under Lens / Detector chips.
  if (ui.phase === 'complete') {
    const incomplete = Boolean(ui.uploadIncomplete);
    return (
      <View pointerEvents="box-none" style={styles.bannerWrap}>
        <View
          style={[styles.banner, incomplete && styles.bannerFail]}
          pointerEvents="auto"
        >
          <Text style={styles.bannerTitle} numberOfLines={3}>
            {ui.uploadMessage || ui.message || 'Geometry test complete'}
          </Text>
          <View style={styles.bannerRow}>
            {incomplete && onRetryUpload ? (
              <Pressable onPress={onRetryUpload} style={styles.bannerBtnPrimary}>
                <Text style={styles.bannerBtnLabel}>Retry upload</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onCancel} style={styles.bannerBtn}>
              <Text style={styles.bannerBtnLabel}>{incomplete ? 'Dismiss' : 'OK'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (ui.phase === 'ready') {
    return (
      <View pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.card} pointerEvents="auto">
          <Text style={styles.title}>GEOMETRY TEST</Text>
          <Text style={styles.sub}>Place one card in view.</Text>
          <Text style={styles.hint}>
            Amber = detected · Green = safe · snaps on green hold
          </Text>
          <Text style={styles.section}>FOCUS MODE</Text>
          <Pressable onPress={() => onFocusMode('prefocus-once')} style={styles.toggle}>
            <Text style={styles.toggleLabel}>
              {ui.focusMode === 'prefocus-once' ? '[x] Prefocus once' : '[ ] Prefocus once'}
            </Text>
          </Pressable>
          <Pressable onPress={() => onFocusMode('no-explicit-focus')} style={styles.toggle}>
            <Text style={styles.toggleLabel}>
              {ui.focusMode === 'no-explicit-focus'
                ? '[x] No explicit focus'
                : '[ ] No explicit focus'}
            </Text>
          </Pressable>
          {ui.initialFocusRequested ? (
            <Text style={styles.hint}>
              Initial focus requested
              {ui.initialFocusReportedSuccess === true
                ? ' · reported success'
                : ui.initialFocusReportedSuccess === false
                  ? ' · no success signal'
                  : ' · waiting…'}
            </Text>
          ) : (
            <Text style={styles.hint}>No explicit focus this session</Text>
          )}
          <Pressable onPress={onToggleDebug} style={styles.toggle}>
            <Text style={styles.toggleLabel}>
              {ui.debugOverlay ? '[x] Debug overlay' : '[ ] Debug overlay'}
            </Text>
          </Pressable>
          <Pressable onPress={onStart} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>START</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={styles.btn}>
            <Text style={styles.btnLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (ui.phase === 'captured') {
    return (
      <View pointerEvents="box-none" style={styles.wrap}>
        <View style={styles.resultCard} pointerEvents="auto">
          <Text style={styles.title}>GEOMETRY TEST</Text>
          <Text style={styles.timerBig}>CAPTURE READY {fmtMs(ui.captureReadyMs)}</Text>
          <Text style={styles.line}>VISIBLE {fmtMs(ui.visibleMs)}</Text>
          <Text style={styles.line}>
            First quad: {fmtMs(ui.derived.firstQuadMs)} · Safe:{' '}
            {fmtMs(ui.derived.firstCaptureSafeMs)} · q→s:{' '}
            {fmtMs(ui.derived.firstQuadToFirstCaptureSafeMs)} · Lock:{' '}
            {fmtMs(ui.derived.lockMs)} · Warp: {fmtMs(ui.derived.warpMs)}
          </Text>
          {ui.debugOverlay ? (
            <Text style={styles.debug}>
              Prefocus:{' '}
              {ui.initialFocusRequested
                ? ui.initialFocusReportedSuccess === true
                  ? 'success'
                  : 'no success signal'
                : 'skipped'}
              {ui.sharpness != null ? ` · Sharpness: ${ui.sharpness.toFixed(1)}` : ''}
              {ui.fullArtifactMs != null
                ? ` · Full artifact saved: ${fmtMs(ui.fullArtifactMs)}`
                : ' · Full artifact saving…'}
            </Text>
          ) : null}
          <View style={styles.previewTabs}>
            <Pressable onPress={() => onPreviewKind('card')} style={styles.tab}>
              <Text style={styles.tabLabel}>
                {ui.previewKind === 'card' ? '· Card crop' : 'Card crop'}
              </Text>
            </Pressable>
            <Pressable onPress={() => onPreviewKind('source')} style={styles.tab}>
              <Text style={styles.tabLabel}>
                {ui.previewKind === 'source' ? '· Source' : 'Source'}
              </Text>
            </Pressable>
          </View>
          {ui.previewUri ? (
            <Image
              source={{ uri: ui.previewUri }}
              style={styles.preview}
              resizeMode="contain"
              onLoad={onPreviewDisplayed}
            />
          ) : (
            <Text style={styles.sub}>No preview</Text>
          )}
          <Text style={styles.hint}>
            {ui.previewTier === 'full-res'
              ? `FULL RES ✓ · ${ui.previewWidth ?? 744}×1039`
              : ui.previewTier === 'display'
                ? `PREVIEW · ~${ui.previewWidth ?? 420}px display-only`
                : 'Preview'}
          </Text>
          <Pressable onPress={onNext} style={styles.btnHuge}>
            <Text style={styles.btnHugeLabel}>NEXT</Text>
          </Pressable>
          <View style={styles.row}>
            <Pressable onPress={onFinish} style={styles.btn}>
              <Text style={styles.btnLabel}>Finish & upload</Text>
            </Pressable>
            <Pressable onPress={onCancel} style={styles.btn}>
              <Text style={styles.btnLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // acquiring / capturing — auto-capture; force button only after waiting with no geometry
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card} pointerEvents="box-none">
        <Text style={styles.title}>GEOMETRY TEST</Text>
        <Text style={styles.timerBig}>{fmtSec(ui.elapsedMs)}</Text>
        <Text
          style={
            ui.acquisitionPhase === 'detected_not_safe'
              ? styles.warn
              : ui.acquisitionPhase === 'confirming' || ui.acquisitionPhase === 'capturing'
                ? styles.safe
                : styles.line
          }
        >
          {ui.message.split('\n')[0]}
        </Text>
        {ui.message.includes('\n') ? (
          <Text
            style={
              ui.acquisitionPhase === 'detected_not_safe' ? styles.warnDetail : styles.line
            }
          >
            {ui.message.split('\n').slice(1).join('\n')}
          </Text>
        ) : null}
        {ui.debugOverlay ? (
          <Text style={styles.debug}>
            quad {fmtMs(ui.derived.firstQuadMs)} · safe{' '}
            {fmtMs(ui.derived.firstCaptureSafeMs)} · q→s{' '}
            {fmtMs(ui.derived.firstQuadToFirstCaptureSafeMs)} · s→L{' '}
            {fmtMs(ui.derived.captureSafeToLockMs)}
          </Text>
        ) : null}
        {ui.searchingLong ? <Text style={styles.warn}>STILL SEARCHING</Text> : null}
        {ui.searchingLong ? (
          <Pressable onPress={onCaptureCurrent} style={styles.btnPrimary}>
            <Text style={styles.btnLabel}>CAPTURE CURRENT QUAD</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onCancel} style={styles.btn}>
          <Text style={styles.btnLabel}>CANCEL</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(16,24,38,0.96)',
    borderColor: 'rgba(124,255,178,0.45)',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bannerBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    marginRight: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerBtnLabel: { color: '#E8EEF7', fontSize: 13, fontWeight: '700' },
  bannerBtnPrimary: {
    backgroundColor: 'rgba(61,126,255,0.45)',
    borderRadius: 8,
    marginRight: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerFail: { borderColor: 'rgba(255,138,128,0.55)' },
  bannerRow: { flexDirection: 'row', flexWrap: 'wrap' },
  bannerTitle: { color: '#E8EEF7', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  bannerWrap: {
    bottom: 24,
    elevation: 40,
    left: 12,
    position: 'absolute',
    right: 12,
    zIndex: 300,
  },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  btnHuge: {
    backgroundColor: 'rgba(124,255,178,0.22)',
    borderColor: 'rgba(124,255,178,0.55)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 16,
  },
  btnHugeLabel: {
    color: '#7CFFB2',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  btnLabel: { color: '#E8EEF7', fontWeight: '700', textAlign: 'center' },
  btnPrimary: {
    backgroundColor: 'rgba(61,126,255,0.3)',
    borderRadius: 10,
    marginTop: 12,
    paddingVertical: 12,
  },
  card: {
    backgroundColor: 'rgba(16,24,38,0.88)',
    borderColor: 'rgba(124,255,178,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
  },
  debug: { color: '#8A97AD', fontSize: 12, marginTop: 6 },
  hint: { color: '#8A97AD', fontSize: 12, marginTop: 6 },
  line: { color: '#B8C4D8', fontSize: 13, marginTop: 6 },
  preview: {
    alignSelf: 'center',
    backgroundColor: '#000',
    height: 320,
    marginTop: 10,
    width: '100%',
  },
  previewTabs: { flexDirection: 'row', gap: 12, marginTop: 10 },
  resultCard: {
    backgroundColor: 'rgba(16,24,38,0.94)',
    borderColor: 'rgba(124,255,178,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 12,
    marginTop: 8,
    maxHeight: '92%',
    padding: 14,
  },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  section: {
    color: '#E8EEF7',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 14,
  },
  sub: { color: '#B8C4D8', fontSize: 14, marginTop: 6 },
  tab: { paddingVertical: 4 },
  tabLabel: { color: '#9EC1FF', fontSize: 13, fontWeight: '700' },
  timerBig: {
    color: '#7CFFB2',
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginTop: 8,
  },
  title: { color: '#E8EEF7', fontSize: 16, fontWeight: '800', letterSpacing: 0.6 },
  toggle: { marginTop: 8, paddingVertical: 4 },
  toggleLabel: { color: '#9EC1FF', fontSize: 13, fontWeight: '600' },
  warn: { color: '#F5C542', fontSize: 14, fontWeight: '800', marginTop: 8 },
  warnDetail: { color: '#F5C542', fontSize: 16, fontWeight: '800', marginTop: 4 },
  safe: { color: '#7CFFB2', fontSize: 14, fontWeight: '700', marginTop: 8 },
  wrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-start',
    zIndex: 60,
  },
});
