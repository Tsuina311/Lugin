import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  CommonResolutions,
  useCameraDevices,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';

import { selectMainRearDevice } from '../../camera/selectMainRearDevice';
import { photoToScanImage } from '../imageToScanImage';
import { decodePairQr } from './decodePairQr';
import { setPairScanActive } from './pairScanGate';

const RELEASE_MS = 400;
const FIRST_CAPTURE_MS = 700;
const RETRY_MS = 800;

export function PairQrScanner({
  onClose,
  onCode,
}: {
  onClose: () => void;
  /** Return true when the payload is a receiver pair / URL and scanning should stop. */
  onCode: (raw: string) => boolean;
}) {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const device = useMemo(() => selectMainRearDevice(devices), [devices]);
  const photoOutput = usePhotoOutput({
    quality: 0.7,
    qualityPrioritization: 'speed',
    targetResolution: CommonResolutions.VGA_4_3,
  });
  const [ready, setReady] = useState(false);
  const [hint, setHint] = useState('Releasing the card camera…');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    setPairScanActive(true);
    const timer = setTimeout(() => {
      setReady(true);
      setHint('Point at the Pair QR on the Mac');
    }, RELEASE_MS);
    return () => {
      clearTimeout(timer);
      setPairScanActive(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !hasPermission || !device) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const tick = async () => {
      if (cancelled) return;
      if (busy) {
        timer = setTimeout(() => void tick(), RETRY_MS);
        return;
      }
      busy = true;
      try {
        const photo = await photoOutput.capturePhoto(
          { enableShutterSound: false, flashMode: 'off' },
          {},
        );
        try {
          const { image } = await photoToScanImage(photo, 640);
          const text = decodePairQr(image.data, image.width, image.height);
          if (!cancelled && text && onCodeRef.current(text)) return;
          if (!cancelled) setHint('Point at the Pair QR on the Mac');
        } finally {
          photo.dispose();
        }
      } catch (err) {
        if (!cancelled) {
          setHint(err instanceof Error ? err.message : 'Camera busy — hold steady');
        }
      } finally {
        busy = false;
      }
      if (!cancelled) timer = setTimeout(() => void tick(), RETRY_MS);
    };

    timer = setTimeout(() => void tick(), FIRST_CAPTURE_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [device, hasPermission, photoOutput, ready]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible>
      <View style={styles.root}>
        {ready && hasPermission && device ? (
          <Camera
            device={device}
            isActive
            orientationSource="interface"
            outputs={[photoOutput]}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.waiting}>
            <Text style={styles.waitingText}>
              {!hasPermission
                ? 'Camera permission is needed to scan the Pair QR.'
                : !device
                  ? 'Waiting for the rear camera…'
                  : 'Starting camera…'}
            </Text>
            {!hasPermission ? (
              <Pressable onPress={() => void requestPermission()} style={styles.permit}>
                <Text style={styles.permitLabel}>Allow camera</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.hint}>{hint}</Text>
          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cancel: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  cancelLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  footer: {
    backgroundColor: 'rgba(11,18,32,0.88)',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  hint: {
    color: '#E8EEF7',
    fontSize: 15,
    textAlign: 'center',
  },
  permit: {
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  permitLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  root: {
    backgroundColor: '#000',
    flex: 1,
    justifyContent: 'flex-end',
  },
  waiting: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  waitingText: {
    color: '#E8EEF7',
    fontSize: 15,
    textAlign: 'center',
  },
});
