import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getVNextDebug,
  subscribeVNextDebug,
  type VNextDebugSnapshot,
} from '@/lib/scan/vnext/debug';

import { CAPTURE_GAP_MS, holdScannerWork } from './capturePace';
import { downloadVNextGallery, vnextGalleryInstalled } from './vnextGalleryDownload';
import { getSendJobs, subscribeSendJobs, type SendJob } from './sendProgress';

const COOLDOWN_MS = CAPTURE_GAP_MS;

type CaptureResult = {
  naming: boolean;
  ok: boolean;
  message: string;
  previewUri: string | null;
};

export function VNextCoach({
  onAdd,
  onCapture,
  onPreview,
}: {
  onAdd: (snapshot: VNextDebugSnapshot) => Promise<string>;
  onCapture: () => Promise<CaptureResult>;
  onPreview: (uri: string) => void;
}) {
  const [jobs, setJobs] = useState<SendJob[]>(() => getSendJobs());
  const [taken, setTaken] = useState(0);
  const [cooling, setCooling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [galleryOnPhone, setGalleryOnPhone] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const [named, setNamed] = useState<string | null>(null);
  const [published, setPublished] = useState<VNextDebugSnapshot | null>(null);
  const [frozenIdentity, setFrozenIdentity] = useState<Record<string, string> | null>(null);
  const [adding, setAdding] = useState(false);
  const [collectionNote, setCollectionNote] = useState<string | null>(null);
  const coolingUntil = useRef(0);
  useEffect(() => subscribeSendJobs(() => setJobs(getSendJobs())), []);
  useEffect(() => {
    void vnextGalleryInstalled().then(setGalleryOnPhone);
  }, []);
  useEffect(
    () =>
      subscribeVNextDebug(() => {
        const snap = getVNextDebug();
        if (!snap) return;
        setFrozenIdentity(snap.frozenIdentity);
        if (snap.source === 'VISUAL_AGREEMENT' || snap.source === 'OCR_EXACT_TOP5_RECOVERY') {
          const published = snap.prototypeTop5.find(
            hit => hit.oracleId === snap.finalPublishedOracle,
          );
          setNamed(published?.name ?? 'Named');
          setPublished(snap);
          setCollectionNote(null);
          return;
        }
        setPublished(null);
        if (snap.prototypeTop1?.name) setNamed(`Closest: ${snap.prototypeTop1.name}`);
      }),
    [],
  );
  const sent = jobs.filter(job => job.status === 'done').length;
  const failed = jobs.filter(job => job.status === 'failed');
  const pending = Math.max(0, taken - sent - failed.length);
  const latestFail = failed[failed.length - 1];
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Scanner capture</Text>
      <Text style={styles.title}>Point at one card</Text>
      <Text style={styles.detail}>
        {note ??
          (named
            ? named
            : galleryOnPhone
              ? 'The card list is on the phone. A capture now also tries to name the card.'
              : 'Tap Capture. The picture is saved and sent on its own. You can move to the next card.')}
      </Text>
      {downloadLabel ? <Text style={styles.count}>{downloadLabel}</Text> : null}
      {frozenIdentity ? (
        <Text style={styles.detail}>
          {`${frozenIdentity.geometryId} · ${frozenIdentity.adapterId}`}
        </Text>
      ) : null}
      <Text style={styles.count}>
        {`${taken} captured · ${sent} sent${pending > 0 ? ` · ${pending} sending` : ''}${failed.length > 0 ? ` · ${failed.length} not sent` : ''}`}
      </Text>
      {published ? (
        <Pressable
          disabled={adding}
          onPress={() => {
            if (adding) return;
            setAdding(true);
            void onAdd(published)
              .then(setCollectionNote)
              .finally(() => setAdding(false));
          }}
          style={[styles.save, adding && styles.buttonDown]}
        >
          <Text style={styles.saveLabel}>{adding ? 'Adding…' : 'Add to collection'}</Text>
        </Pressable>
      ) : null}
      {collectionNote ? <Text style={styles.count}>{collectionNote}</Text> : null}
      {latestFail?.detail ? <Text style={styles.fail}>{latestFail.detail}</Text> : null}
      <Pressable
        onPress={() => {
          const tappedAt = Date.now();
          if (tappedAt < coolingUntil.current) return;
          coolingUntil.current = tappedAt + COOLDOWN_MS;
          holdScannerWork(COOLDOWN_MS);
          setCooling(true);
          setNote(null);
          const unlock = setTimeout(() => setCooling(false), COOLDOWN_MS);
          // Paint the press before the picture is copied.
          setTimeout(() => {
            void onCapture()
              .then(result => {
                if (!result.ok) {
                  clearTimeout(unlock);
                  coolingUntil.current = 0;
                  setCooling(false);
                  setNote(result.message);
                  return;
                }
                setTaken(count => count + 1);
                if (result.naming) setNamed('Naming the last picture…');
                if (result.previewUri) onPreview(result.previewUri);
              })
              .catch(err => {
                clearTimeout(unlock);
                coolingUntil.current = 0;
                setCooling(false);
                setNote(err instanceof Error ? err.message : 'Could not take a picture');
              });
          }, 0);
        }}
        style={({ pressed }) => [styles.button, (pressed || cooling) && styles.buttonDown]}
      >
        <Text style={styles.buttonLabel}>{cooling ? 'Captured' : 'Capture this card'}</Text>
      </Pressable>
      {galleryOnPhone ? null : (
        <Pressable
          disabled={downloading}
          onPress={() => {
            if (downloading) return;
            setDownloading(true);
            setDownloadLabel('Starting the card list…');
            void downloadVNextGallery(progress => {
              const pct =
                progress.totalBytes > 0
                  ? Math.min(100, Math.round((100 * progress.doneBytes) / progress.totalBytes))
                  : 0;
              setDownloadLabel(`${progress.label} · ${pct}%`);
            }).then(message => {
              setDownloadLabel(message);
              setDownloading(false);
              if (message.startsWith('Card list is on the phone')) setGalleryOnPhone(true);
            });
          }}
          style={[styles.save, downloading && styles.buttonDown]}
        >
          <Text style={styles.saveLabel}>
            {downloading ? 'Downloading the card list…' : 'Download card list'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(8,12,20,0.94)',
    borderRadius: 16,
    gap: 8,
    padding: 16,
  },
  kicker: {
    color: '#8A97AD',
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    color: '#F4F7FB',
    fontSize: 22,
    fontWeight: '700',
  },
  detail: {
    color: '#C5D0DE',
    fontSize: 15,
    lineHeight: 21,
  },
  count: {
    color: '#F5C542',
    fontSize: 16,
    fontWeight: '700',
  },
  fail: {
    color: '#F0A8A8',
    fontSize: 14,
    lineHeight: 19,
  },
  button: {
    backgroundColor: '#F5C542',
    borderRadius: 12,
    marginTop: 4,
    paddingVertical: 14,
    transform: [{ scale: 1 }],
  },
  buttonDown: {
    backgroundColor: '#C9971A',
    transform: [{ scale: 0.96 }],
  },
  buttonLabel: {
    color: '#1A1404',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  save: {
    borderColor: '#F5C542',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
  },
  saveLabel: {
    color: '#F5C542',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
