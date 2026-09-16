import { StyleSheet, Text, View } from 'react-native';

import type { ContinuousScanUi } from './useContinuousScan';

type Props = {
  ui: ContinuousScanUi;
};

/**
 * Compact Continuous overlay — camera stays live; no Verified result panel.
 */
export function ContinuousHud({ ui }: Props) {
  if (!ui.active) return null;
  const clipOk = ui.visualState === 'READY';
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.topRow}>
        <Text style={[styles.badge, clipOk ? styles.badgeOk : styles.badgeWarn]}>
          {clipOk ? 'CLIP READY' : `CLIP ${ui.visualState}`}
        </Text>
        <Text style={styles.meta}>
          {ui.phase}
          {ui.lastIdentityMs != null ? ` · ID ${Math.round(ui.lastIdentityMs)}ms` : ''}
        </Text>
      </View>

      {ui.publishedName ? (
        <Text style={styles.identity}>{ui.publishedName} ✓</Text>
      ) : (
        <Text style={styles.searching}>{ui.message || 'SEARCHING…'}</Text>
      )}

      {ui.recentIdentities.length > 0 ? (
        <View style={styles.strip}>
          {ui.recentIdentities
            .slice()
            .reverse()
            .map((id, i) => (
              <Text key={`${id.name}-${i}`} style={styles.stripItem}>
                {id.name} ✓
              </Text>
            ))}
        </View>
      ) : null}

      <Text style={styles.timing}>
        {ui.lastEncoderMs != null ? `enc ${Math.round(ui.lastEncoderMs)}` : 'enc —'}
        {ui.lastSearchMs != null ? ` · nn ${Math.round(ui.lastSearchMs)}` : ''}
        {ui.lastOcrMs != null ? ` · ocr ${Math.round(ui.lastOcrMs)}` : ''}
        {ui.modelLoadMs != null ? ` · load ${Math.round(ui.modelLoadMs)}` : ''}
        {` · q ${ui.clipQueries}`}
        {ui.droppedTriggers ? ` · drop ${ui.droppedTriggers}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 56,
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
    borderRadius: 4,
  },
  badgeOk: {
    color: '#0b1a0b',
    backgroundColor: '#8dff9a',
  },
  badgeWarn: {
    color: '#1a1200',
    backgroundColor: '#ffd27a',
  },
  meta: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  identity: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  searching: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 16,
    fontWeight: '600',
  },
  strip: {
    gap: 2,
  },
  stripItem: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
  },
  timing: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
