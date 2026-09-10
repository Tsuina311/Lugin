import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  applyInboxPairInput,
  getInboxSettings,
  loadInboxSettings,
  saveInboxSettings,
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

  useEffect(() => {
    void (async () => {
      const settings = await loadInboxSettings();
      setUrl(settings.url);
      setToken(settings.token);
      setReplayWorker(settings.replayWorker);
      setSnap(await restoreInboxQueue());
    })();
    return subscribeInbox(() => setSnap(getInboxSnapshot()));
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
        <Text style={styles.note}>Paste Pair / HTTPS URL from yarn scan:inbox:tunnel</Text>
      ) : (
        <Text style={styles.note}>
          Paste the Mac Pair line or HTTPS URL + token. Images go only to that receiver.
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
          <Pressable onPress={() => setEdit(true)} style={styles.button}>
            <Text style={styles.buttonLabel}>Change receiver</Text>
          </Pressable>
        </>
      ) : (
        <>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onUrlChange}
        placeholder="https://….trycloudflare.com or lugin-debug://pair?…"
        placeholderTextColor="#6E7B91"
        style={styles.input}
        value={url}
      />
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
    </View>
  );
}

const styles = StyleSheet.create({
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
