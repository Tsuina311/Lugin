/**
 * Settings panel: one queue of every incomplete diagnostic / benchmark upload.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  listIncompleteUploads,
  retryAllPendingUploads,
  retryPendingUpload,
  type PendingUploadItem,
} from './pending';

export function PendingUploadsPanel() {
  const [items, setItems] = useState<PendingUploadItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listIncompleteUploads());
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRetryOne = (item: PendingUploadItem) => {
    if (busyId) return;
    setBusyId(item.id);
    setStatus(`Retrying ${item.label}…`);
    void (async () => {
      try {
      const out = await retryPendingUpload(item, msg => setStatus(msg));
        setStatus(out.message);
        await refresh();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    })();
  };

  const onRetryAll = () => {
    if (busyId) return;
    setBusyId('__all__');
    setStatus('Retrying all…');
    void (async () => {
      try {
        const out = await retryAllPendingUploads(msg => setStatus(msg));
        setStatus(
          out.total === 0
            ? 'Nothing pending'
            : `Done · ${out.complete} complete · ${out.failed} still incomplete` +
                (out.lastMessage ? `\n${out.lastMessage}` : ''),
        );
        await refresh();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    })();
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Pending uploads</Text>
      <Text style={styles.note}>
        One queue for Binder / Geometry / Deck / Single Scan diagnostics, inbox, and legacy
        benchmark. Retry here works even after leaving the camera tab.
      </Text>

      <View style={styles.actions}>
        <Pressable
          disabled={Boolean(busyId) || loading}
          hitSlop={8}
          onPress={() => void refresh()}
          style={[styles.btnGhost, (busyId || loading) && styles.btnOff]}
        >
          <Text style={styles.btnGhostLabel}>{loading ? 'Scanning…' : 'Refresh'}</Text>
        </Pressable>
        <Pressable
          disabled={Boolean(busyId) || items.length === 0}
          hitSlop={8}
          onPress={onRetryAll}
          style={[styles.btn, (busyId || items.length === 0) && styles.btnOff]}
        >
          <Text style={styles.btnLabel}>
            {busyId === '__all__' ? 'Uploading…' : `Retry all (${items.length})`}
          </Text>
        </Pressable>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      {items.length === 0 && !loading ? (
        <Text style={styles.empty}>No incomplete uploads on device.</Text>
      ) : (
        <Text style={styles.note}>
          If Retry stops instantly, read the yellow status — usually dead tunnel (re-pair) or files
          missing on device.
        </Text>
      )}

      {items.map(item => {
        const rowBusy = busyId === item.id;
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>
                {item.label} · {item.status}
              </Text>
              <Text style={styles.rowId} numberOfLines={2}>
                {item.runId}
              </Text>
              <Text style={styles.rowMeta}>
                {item.acknowledgedCount} uploaded · {item.missingCount} missing
              </Text>
              {item.detail ? (
                <Text style={styles.rowDetail} numberOfLines={2}>
                  {item.detail}
                </Text>
              ) : null}
            </View>
            <Pressable
              disabled={Boolean(busyId)}
              hitSlop={12}
              onPress={() => onRetryOne(item)}
              style={[styles.retryBtn, busyId && styles.btnOff]}
            >
              <Text style={styles.retryLabel}>{rowBusy ? '…' : 'Retry'}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    marginBottom: 16,
    gap: 8,
  },
  title: {
    color: '#F4F7FB',
    fontSize: 16,
    fontWeight: '800',
  },
  note: {
    color: '#8A97AD',
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnLabel: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: {
    flex: 1,
    borderColor: '#2A3548',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGhostLabel: { color: '#C5D0E0', fontWeight: '600', fontSize: 14 },
  btnOff: { opacity: 0.45 },
  status: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    color: '#7CFFB2',
    fontSize: 13,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#121A28',
    borderRadius: 12,
    borderColor: '#1C2636',
    borderWidth: 1,
    padding: 12,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: '#F4F7FB', fontSize: 13, fontWeight: '700' },
  rowId: { color: '#9AA8BD', fontSize: 11 },
  rowMeta: { color: '#C5D0E0', fontSize: 12, marginTop: 2 },
  rowDetail: { color: '#6E7B91', fontSize: 11 },
  retryBtn: {
    backgroundColor: '#24314A',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 64,
    alignItems: 'center',
  },
  retryLabel: { color: '#9EC1FF', fontWeight: '700', fontSize: 13 },
});
