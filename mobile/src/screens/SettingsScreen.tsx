import Constants from 'expo-constants';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppUpdates } from '../updates/UpdateProvider';

function extraLugin(): { buildId?: string; buildLabel?: string; channel?: string } {
  const extra = Constants.expoConfig?.extra as { lugin?: { buildId?: string; buildLabel?: string; channel?: string } } | undefined;
  return extra?.lugin ?? {};
}

/**
 * Development update panel — version, fingerprint/runtime, channel, check/apply.
 */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const updates = useAppUpdates();
  const expoConfig = Constants.expoConfig;
  const native = Constants.nativeAppVersion ?? '—';
  const lugin = extraLugin();
  const channel = updates.channel ?? lugin.channel ?? 'development';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.section}>Version</Text>
      <Text style={styles.line}>{lugin.buildLabel ?? `Lugin ${expoConfig?.version ?? '—'}`}</Text>
      <Text style={styles.line}>Platform: {Platform.OS} native</Text>
      <Text style={styles.line}>Native app version: {native}</Text>
      <Text style={styles.line}>Source commit: {lugin.buildId ?? '—'}</Text>
      <Text style={styles.line}>Runtime / fingerprint: {updates.runtimeVersion ?? '—'}</Text>
      <Text style={styles.line}>EAS channel: {channel}</Text>
      <Text style={styles.line}>Update ID: {updates.updateId ?? '(embedded)'}</Text>
      <Text style={styles.line}>
        Update created:{' '}
        {updates.createdAt ? updates.createdAt.toISOString() : '—'}
      </Text>
      <Text style={styles.line}>Updates enabled: {String(updates.isEnabled)}</Text>
      <Text style={styles.line}>Update phase: {updates.phase}</Text>
      {updates.error ? <Text style={styles.error}>{updates.error}</Text> : null}

      <View style={styles.actions}>
        <Pressable onPress={() => void updates.checkForUpdate()} style={styles.button}>
          <Text style={styles.buttonLabel}>Check for update</Text>
        </Pressable>
        <Pressable
          disabled={updates.phase !== 'ready'}
          onPress={() => void updates.applyUpdate()}
          style={[styles.button, updates.phase !== 'ready' && styles.buttonDisabled]}
        >
          <Text style={styles.buttonLabel}>Apply downloaded update</Text>
        </Pressable>
      </View>

      {updates.phase === 'ready' ? (
        <Text style={styles.banner}>Development update ready — apply when not scanning.</Text>
      ) : null}

      <Text style={styles.note}>
        JS-only pushes arrive as OTA on channel &quot;development&quot;. Native fingerprint
        changes require installing a new APK from CI (see docs/MOBILE-DEPLOYMENT.md).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 8,
    marginTop: 16,
  },
  banner: {
    color: '#7CFFB2',
    fontSize: 13,
    marginTop: 12,
  },
  button: {
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  error: {
    color: '#FF8A80',
    fontSize: 13,
    marginTop: 4,
  },
  line: {
    color: '#D7DEEA',
    fontFamily: Platform.select({ android: 'monospace', default: 'monospace', ios: 'Menlo' }),
    fontSize: 13,
  },
  note: {
    color: '#6E7B91',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
  root: {
    backgroundColor: '#0B1220',
    flex: 1,
    gap: 6,
    paddingHorizontal: 20,
  },
  section: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    textTransform: 'uppercase',
  },
  title: {
    color: '#F4F7FB',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
});
