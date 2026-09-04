import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  checkScannerDataUpdates,
  getScannerDataStatus,
  subscribeScannerData,
  type ScannerDataStatus,
} from '../scan/scannerDataStore';
import {
  clearActiveBenchmarkSession,
  endBenchmarkSession,
  getActiveBenchmarkSession,
  isBenchmarkToolsEnabled,
  loadBenchmarkSettings,
  restoreBenchmarkSession,
  retryFailedBenchmarkUploads,
  saveBenchmarkSettings,
  setBenchmarkExpectedManifest,
  shareBenchmarkZip,
  startBenchmarkSession,
  subscribeBenchmark,
  type BenchmarkSession,
} from '../scan/benchmark';
import { useAppUpdates } from '../updates/UpdateProvider';

function extraLugin(): { buildId?: string; buildLabel?: string; channel?: string } {
  const extra = Constants.expoConfig?.extra as
    | { lugin?: { buildId?: string; buildLabel?: string; channel?: string } }
    | undefined;
  return extra?.lugin ?? {};
}

const formatUpdated = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/**
 * Development update panel — version, fingerprint/runtime, channel, check/apply.
 * Benchmark session controls are development-only.
 */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const updates = useAppUpdates();
  const expoConfig = Constants.expoConfig;
  const native = Constants.nativeAppVersion ?? '—';
  const lugin = extraLugin();
  const channel = updates.channel ?? lugin.channel ?? 'development';
  const [scanner, setScanner] = useState<ScannerDataStatus>(() => getScannerDataStatus());
  const benchEnabled = isBenchmarkToolsEnabled();
  const [benchSession, setBenchSession] = useState<BenchmarkSession | null>(() =>
    getActiveBenchmarkSession(),
  );
  const [ingestionUrl, setIngestionUrl] = useState('');
  const [targetCount, setTargetCount] = useState('50');
  const [manifestText, setManifestText] = useState('');
  const [benchStatus, setBenchStatus] = useState<string | null>(null);

  useEffect(() => subscribeScannerData(() => setScanner(getScannerDataStatus())), []);

  useEffect(() => {
    if (!benchEnabled) return;
    void (async () => {
      const settings = await loadBenchmarkSettings();
      setIngestionUrl(settings.ingestionUrl);
      setTargetCount(String(settings.targetCount));
      await restoreBenchmarkSession();
      setBenchSession(getActiveBenchmarkSession());
    })();
    return subscribeBenchmark(() => setBenchSession(getActiveBenchmarkSession()));
  }, [benchEnabled]);

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
      style={styles.root}
    >
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
        Update created: {updates.createdAt ? updates.createdAt.toISOString() : '—'}
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

      <Text style={styles.section}>Scanner data</Text>
      <Text style={styles.line}>
        Card names: {scanner.names != null ? scanner.names.toLocaleString() : '—'}
        {scanner.namesOrigin ? ` (${scanner.namesOrigin})` : ''}
      </Text>
      <Text style={styles.line}>
        PrintingIndex:{' '}
        {scanner.printingEntries != null ? scanner.printingEntries.toLocaleString() : '—'}
        {scanner.printingOrigin ? ` (${scanner.printingOrigin})` : ''}
      </Text>
      <Text style={styles.line}>
        Artwork: {scanner.artEntries != null ? scanner.artEntries.toLocaleString() : '—'}
        {scanner.artOrigin ? ` (${scanner.artOrigin})` : ''}
      </Text>
      <Text style={styles.line}>
        Updated: {formatUpdated(scanner.artGenerated ?? scanner.manifestGeneratedAt)}
      </Text>
      <Text style={styles.line}>Status: {scanner.statusLabel}</Text>
      {scanner.lastError ? <Text style={styles.error}>{scanner.lastError}</Text> : null}
      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            void checkScannerDataUpdates({ force: true }).then(() =>
              setScanner(getScannerDataStatus()),
            );
          }}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Check scanner data</Text>
        </Pressable>
      </View>

      {benchEnabled ? (
        <>
          <Text style={styles.section}>Scanner Benchmark Session</Text>
          <Text style={styles.note}>
            Dev-only. Each recognition auto-saves JSON + full 744×1039 PNG locally. Uploads never
            block scanning and never run in production builds.
          </Text>
          <Text style={styles.line}>
            Session:{' '}
            {benchSession
              ? `${benchSession.sessionId.slice(0, 12)}… · ${benchSession.scans.length}/${benchSession.targetCount}`
              : 'idle'}
          </Text>
          {benchSession?.summary ? (
            <Text style={styles.line}>
              Summary ready · ambiguity{' '}
              {((benchSession.summary.ambiguityRate ?? 0) * 100).toFixed(0)}%
            </Text>
          ) : null}
          <Text style={styles.label}>Target scan count</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setTargetCount}
            style={styles.input}
            value={targetCount}
          />
          <Text style={styles.label}>Ingestion URL (optional HTTPS)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setIngestionUrl}
            placeholder="https://…"
            placeholderTextColor="#6E7B91"
            style={styles.input}
            value={ingestionUrl}
          />
          <Text style={styles.label}>Expected manifest JSON (optional)</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setManifestText}
            placeholder='[{"name":"Chaos Dragon","setCode":"afc","collectorNumber":"030"}]'
            placeholderTextColor="#6E7B91"
            style={[styles.input, styles.inputTall]}
            value={manifestText}
          />
          {benchStatus ? <Text style={styles.banner}>{benchStatus}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                void (async () => {
                  const n = Math.max(1, Number(targetCount) || 50);
                  await saveBenchmarkSettings({
                    ingestionUrl,
                    targetCount: n,
                  });
                  let expected = null;
                  if (manifestText.trim()) {
                    try {
                      expected = JSON.parse(manifestText);
                    } catch {
                      setBenchStatus('Manifest JSON parse failed');
                      return;
                    }
                  }
                  try {
                    const session = await startBenchmarkSession({
                      expectedManifest: expected
                        ? (
                            await import('../scan/benchmark/expectedManifest')
                          ).parseExpectedManifest(expected)
                        : null,
                      targetCount: n,
                    });
                    setBenchSession(session);
                    setBenchStatus(`Started ${session.sessionId}`);
                  } catch (err) {
                    setBenchStatus(err instanceof Error ? err.message : String(err));
                  }
                })();
              }}
              style={styles.button}
            >
              <Text style={styles.buttonLabel}>Start benchmark session</Text>
            </Pressable>
            <Pressable
              disabled={!benchSession || Boolean(benchSession.endedAt)}
              onPress={() => {
                void endBenchmarkSession().then(s => {
                  setBenchSession(s);
                  setBenchStatus(s?.summary ? 'Session ended — summary written' : 'Ended');
                });
              }}
              style={[
                styles.button,
                (!benchSession || Boolean(benchSession.endedAt)) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonLabel}>End session + summary</Text>
            </Pressable>
            <Pressable
              disabled={!benchSession}
              onPress={() => {
                void shareBenchmarkZip().then(r => {
                  setBenchStatus(r.ok ? 'ZIP share opened' : r.reason);
                });
              }}
              style={[styles.button, !benchSession && styles.buttonDisabled]}
            >
              <Text style={styles.buttonLabel}>Export session ZIP</Text>
            </Pressable>
            <Pressable
              disabled={!benchSession?.ingestionUrl}
              onPress={() => {
                void retryFailedBenchmarkUploads().then(n => {
                  setBenchStatus(`Re-queued ${n} upload(s)`);
                });
              }}
              style={[styles.button, !benchSession?.ingestionUrl && styles.buttonDisabled]}
            >
              <Text style={styles.buttonLabel}>Retry failed uploads</Text>
            </Pressable>
            <Pressable
              disabled={!benchSession}
              onPress={() => {
                void clearActiveBenchmarkSession().then(() => {
                  setBenchSession(null);
                  setBenchStatus('Active session cleared (files kept on disk)');
                });
              }}
              style={[styles.button, !benchSession && styles.buttonDisabled]}
            >
              <Text style={styles.buttonLabel}>Clear active session</Text>
            </Pressable>
            <Pressable
              disabled={!benchSession || !manifestText.trim()}
              onPress={() => {
                void (async () => {
                  try {
                    const raw = JSON.parse(manifestText);
                    const cards = await setBenchmarkExpectedManifest(raw);
                    setBenchStatus(`Manifest loaded · ${cards.length} expected cards`);
                  } catch (err) {
                    setBenchStatus(err instanceof Error ? err.message : String(err));
                  }
                })();
              }}
              style={[
                styles.button,
                (!benchSession || !manifestText.trim()) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.buttonLabel}>Apply manifest to active session</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <Text style={styles.note}>
        JS-only pushes arrive as OTA on channel &quot;development&quot;. Native fingerprint
        changes require installing a new APK from CI (see docs/MOBILE-DEPLOYMENT.md).
        New Magic sets arrive as scanner-data updates (no APK) once Pages publishes a
        newer manifest.
      </Text>
    </ScrollView>
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
  content: {
    gap: 6,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  error: {
    color: '#FF8A80',
    fontSize: 13,
    marginTop: 4,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    borderWidth: 1,
    color: '#E8EEF7',
    fontFamily: Platform.select({ android: 'monospace', default: 'monospace', ios: 'Menlo' }),
    fontSize: 13,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputTall: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  label: {
    color: '#8A97AD',
    fontSize: 12,
    marginTop: 10,
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
