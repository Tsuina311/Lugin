import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { applyReceiverInput } from './protocol';
import { PairQrScanner } from './PairQrScanner';
import {
  applyInboxPairInput,
  getInboxSettings,
  loadInboxSettings,
  saveInboxSettings,
  subscribeInboxSettings,
} from './settings';
import {
  clearUploadedInboxTraces,
  getInboxSnapshot,
  restoreInboxQueue,
  retryInboxUploads,
  subscribeInbox,
  testInboxConnection,
  type InboxSnapshot,
} from './queue';

const connectionLabel = (snap: InboxSnapshot): string => {
  if (snap.connection === 'not_configured') return 'Not configured';
  if (snap.connection === 'connected') return 'Connected';
  if (snap.connection === 'failed') return 'Failed';
  return '—';
};

export function DebugInboxPanel({ compact = false }: { compact?: boolean }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [replayWorker, setReplayWorker] = useState(false);
  const [snap, setSnap] = useState<InboxSnapshot>(() => getInboxSnapshot());
  const [status, setStatus] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    void (async () => {
      const settings = await loadInboxSettings();
      setUrl(settings.url);
      setToken(settings.token);
      setReplayWorker(settings.replayWorker);
      setSnap(await restoreInboxQueue());
    })();
    const unsubQueue = subscribeInbox(() => setSnap(getInboxSnapshot()));
    const unsubSettings = subscribeInboxSettings(saved => {
      setUrl(saved.url);
      setToken(saved.token);
      setReplayWorker(saved.replayWorker);
      setSnap(getInboxSnapshot());
    });
    return () => {
      unsubQueue();
      unsubSettings();
    };
  }, []);

  const onUrlChange = (text: string) => {
    setUrl(text);
    if (text.includes('pair') && text.includes('token=')) {
      void applyInboxPairInput(text).then(saved => {
        setUrl(saved.url);
        setToken(saved.token);
        setStatus('Paired — token stored on device');
      });
    }
  };

  const onPairCode = (raw: string): boolean => {
    if (!applyReceiverInput(raw).url) return false;
    setScanning(false);
    void (async () => {
      const saved = await applyInboxPairInput(raw);
      setUrl(saved.url);
      setToken(saved.token);
      const next = await testInboxConnection();
      setSnap(next);
      setEdit(false);
      setStatus(next.connection === 'connected' ? 'Paired' : (next.lastError ?? 'Paired — connection failed'));
    })();
    return true;
  };

  const onTest = () => {
    void (async () => {
      if (url.includes('pair') && url.includes('token=')) {
        await applyInboxPairInput(url);
      } else {
        await saveInboxSettings({ token, url });
      }
      const saved = getInboxSettings();
      setUrl(saved.url);
      setToken(saved.token);
      const next = await testInboxConnection();
      setSnap(next);
      setStatus(next.connection === 'connected' ? 'Connected' : (next.lastError ?? 'Failed'));
    })();
  };

  const hideFields = compact && snap.connection === 'connected' && !edit;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Debug receiver</Text>
      {hideFields ? (
        <Text style={styles.note}>Connected. Point at one card, then Capture geometry trace.</Text>
      ) : compact ? (
        <Text style={styles.note}>Scan the Pair QR, or paste the HTTPS URL from yarn scan:inbox:tunnel</Text>
      ) : (
        <Text style={styles.note}>
          Scan the Pair QR on the Mac, or paste the Pair line. Images go only to that receiver.
        </Text>
      )}
      {hideFields ? (
        <>
          {snap.lastError ? <Text style={styles.error}>{snap.lastError}</Text> : null}
          {snap.pending ? (
            <Pressable
              onPress={() => {
                void retryInboxUploads().then(n => {
                  setSnap(getInboxSnapshot());
                  setStatus(`Retrying ${n} upload(s)`);
                });
              }}
              style={styles.button}
            >
              <Text style={styles.buttonLabel}>Retry uploads ({snap.pending})</Text>
            </Pressable>
          ) : null}
          {status ? <Text style={styles.ok}>{status}</Text> : null}
          <View style={styles.actionRow}>
            <Pressable onPress={() => setScanning(true)} style={[styles.button, styles.actionGrow]}>
              <Text style={styles.buttonLabel}>Scan Pair QR</Text>
            </Pressable>
            <Pressable onPress={() => setEdit(true)} style={[styles.button, styles.actionGrow]}>
              <Text style={styles.buttonLabel}>Change receiver</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
      <View style={styles.inputRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onUrlChange}
          placeholder="https://….trycloudflare.com or lugin-debug://pair?…"
          placeholderTextColor="#6E7B91"
          style={[styles.input, styles.inputFlex]}
          value={url}
        />
        <Pressable
          accessibilityLabel="Scan pair QR"
          onPress={() => setScanning(true)}
          style={styles.scanButton}
        >
          <ScanGlyph />
        </Pressable>
      </View>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setToken}
        placeholder="token"
        placeholderTextColor="#6E7B91"
        secureTextEntry
        style={styles.input}
        value={token}
      />
      <Text style={styles.line}>
        {connectionLabel(snap)}
        {snap.lastUpload ? ` · ${snap.lastUpload.traceId} ✓` : ''}
        {snap.pending ? ` · pending ${snap.pending}` : ''}
      </Text>
      {snap.lastError ? <Text style={styles.error}>{snap.lastError}</Text> : null}
      {status ? <Text style={styles.ok}>{status}</Text> : null}
      <Pressable onPress={onTest} style={styles.button}>
        <Text style={styles.buttonLabel}>Test connection</Text>
      </Pressable>
        </>
      )}
      <Pressable
        onPress={() => {
          void (async () => {
            const next = !getInboxSettings().replayWorker;
            const saved = await saveInboxSettings({ ...getInboxSettings(), replayWorker: next });
            setReplayWorker(saved.replayWorker);
            setStatus(
              saved.replayWorker
                ? 'Device replay worker ON — polls only this receiver'
                : 'Device replay worker OFF',
            );
          })();
        }}
        style={[styles.button, replayWorker ? styles.workerOn : styles.button]}
      >
        <Text style={styles.buttonLabel}>
          Device replay worker {replayWorker ? 'ON' : 'OFF'}
        </Text>
      </Pressable>
      {!compact ? (
        <View style={styles.row}>
          <Pressable
            onPress={() => {
              void retryInboxUploads().then(n => {
                setSnap(getInboxSnapshot());
                setStatus(`Retrying ${n} upload(s)`);
              });
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>Retry uploads</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              void clearUploadedInboxTraces().then(n => {
                setSnap(getInboxSnapshot());
                setStatus(`Cleared ${n} uploaded queue record(s)`);
              });
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>Clear uploaded</Text>
          </Pressable>
        </View>
      ) : null}
      {scanning ? <PairQrScanner onClose={() => setScanning(false)} onCode={onPairCode} /> : null}
    </View>
  );
}

function ScanGlyph() {
  return (
    <View style={styles.glyph}>
      <View style={[styles.mark, styles.markTL]} />
      <View style={[styles.mark, styles.markTR]} />
      <View style={[styles.mark, styles.markBL]} />
      <View style={[styles.mark, styles.markBR]} />
    </View>
  );
}

const styles = StyleSheet.create({
  actionGrow: {
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonLabel: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  error: {
    color: '#FF8A80',
    fontSize: 12,
    marginTop: 4,
  },
  glyph: {
    height: 18,
    width: 18,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 8,
    borderWidth: 1,
    color: '#E8EEF7',
    fontFamily: Platform.select({ android: 'monospace', default: 'monospace', ios: 'Menlo' }),
    fontSize: 12,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputFlex: {
    flex: 1,
    marginTop: 0,
  },
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  mark: {
    borderColor: '#fff',
    height: 7,
    position: 'absolute',
    width: 7,
  },
  markBL: {
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    bottom: 0,
    left: 0,
  },
  markBR: {
    borderBottomWidth: 2,
    borderRightWidth: 2,
    bottom: 0,
    right: 0,
  },
  markTL: {
    borderLeftWidth: 2,
    borderTopWidth: 2,
    left: 0,
    top: 0,
  },
  markTR: {
    borderRightWidth: 2,
    borderTopWidth: 2,
    right: 0,
    top: 0,
  },
  line: {
    color: '#D7DEEA',
    fontSize: 12,
    marginTop: 6,
  },
  note: {
    color: '#8A97AD',
    fontSize: 11,
    marginTop: 2,
  },
  ok: {
    color: '#7CFFB2',
    fontSize: 12,
    marginTop: 4,
  },
  row: {
    gap: 0,
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  title: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  workerOn: {
    backgroundColor: '#2E7D4F',
  },
  wrap: {
    backgroundColor: 'rgba(11,18,32,0.88)',
    borderColor: 'rgba(245,197,66,0.35)',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    padding: 10,
  },
});
