import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Camera,
  useCameraDevices,
  useCameraPermission,
  type CameraDevice,
  type CameraRef,
} from 'react-native-vision-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraDebugPanel } from '../camera/CameraDebugPanel';
import { describeDevice, selectMainRearDevice } from '../camera/selectMainRearDevice';

type FocusState = 'idle' | 'focusing' | 'done' | 'error';

/**
 * Milestone B — native camera proof of concept.
 * Prove Samsung focus/sharpness beats Chrome before migrating the rest of the app.
 */
export function CameraProofScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const devices = useCameraDevices();
  const rearDevices = useMemo(
    () => devices.filter((d) => d.position === 'back'),
    [devices],
  );

  const preferred = useMemo(() => selectMainRearDevice(rearDevices), [rearDevices]);
  const [overrideId, setOverrideId] = useState<string | null>(null);
  const device: CameraDevice | undefined = useMemo(() => {
    if (overrideId) {
      return rearDevices.find((d) => d.id === overrideId) ?? preferred;
    }
    return preferred;
  }, [overrideId, preferred, rearDevices]);

  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [focusState, setFocusState] = useState<FocusState>('idle');
  const [lastFocusError, setLastFocusError] = useState<string | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [showDebug, setShowDebug] = useState(true);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  };

  const cycleDevice = useCallback(() => {
    if (rearDevices.length === 0) return;
    const currentId = device?.id ?? rearDevices[0].id;
    const idx = rearDevices.findIndex((d) => d.id === currentId);
    const next = rearDevices[(idx + 1) % rearDevices.length];
    setOverrideId(next.id);
  }, [device?.id, rearDevices]);

  const focusAt = useCallback(async (x: number, y: number) => {
    const cam = cameraRef.current;
    if (!cam) return;
    setFocusPoint({ x, y });
    setFocusState('focusing');
    setLastFocusError(null);
    try {
      // Keep AF locked on the card briefly — scanning distance, not video.
      await cam.focusTo(
        { x, y },
        { adaptiveness: 'continuous', autoResetAfter: null, responsiveness: 'snappy' },
      );
      setFocusState('done');
    } catch (err) {
      setFocusState('error');
      setLastFocusError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onTap = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      void focusAt(locationX, locationY);
    },
    [focusAt],
  );

  if (!hasPermission) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Camera permission</Text>
        <Text style={styles.body}>
          Lugin needs the camera to scan cards. Microphone is not requested.
        </Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonLabel}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>No rear camera</Text>
        <Text style={styles.body}>
          Waiting for VisionCamera devices… Use a development build (not Expo Go).
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root} onLayout={onLayout}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        enableNativeTapToFocusGesture={false}
        // VisionCamera default zoom is 1.0 (main / wide), avoiding ultrawide.
        zoom={1}
      />

      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} />

      {focusPoint ? (
        <View
          pointerEvents="none"
          style={[
            styles.reticle,
            {
              left: focusPoint.x - 28,
              top: focusPoint.y - 28,
              borderColor:
                focusState === 'error'
                  ? '#FF8A80'
                  : focusState === 'focusing'
                    ? '#F5C542'
                    : '#7CFFB2',
            },
          ]}
        />
      ) : null}

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Text style={styles.badge}>NATIVE CAMERA POC</Text>
        <Text style={styles.deviceLine} numberOfLines={2}>
          {describeDevice(device)}
        </Text>
        <Text style={styles.hint}>
          Tap the card to focus · compare sharpness vs Samsung Camera & Chrome Lugin
        </Text>
      </View>

      {showDebug ? (
        <CameraDebugPanel
          device={device}
          focusPoint={focusPoint}
          focusState={focusState}
          lastFocusError={lastFocusError}
          rearDeviceCount={rearDevices.length}
        />
      ) : null}

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={styles.chip} onPress={cycleDevice}>
          <Text style={styles.chipLabel}>Lens ({rearDevices.length})</Text>
        </Pressable>
        <Pressable style={styles.chip} onPress={() => setShowDebug((v) => !v)}>
          <Text style={styles.chipLabel}>{showDebug ? 'Hide debug' : 'Show debug'}</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => {
            if (layout.width > 0) void focusAt(layout.width / 2, layout.height / 2);
          }}
        >
          <Text style={styles.chipLabel}>Focus center</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  centered: {
    flex: 1,
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    color: '#F4F7FB',
    fontSize: 22,
    fontWeight: '700',
  },
  body: {
    color: '#A8B3C7',
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    backgroundColor: '#3D7EFF',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonLabel: {
    color: '#fff',
    fontWeight: '600',
  },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    color: '#0B1220',
    backgroundColor: '#F5C542',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
    borderRadius: 4,
  },
  deviceLine: {
    color: '#F4F7FB',
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    color: '#C5D0E0',
    fontSize: 12,
  },
  bottomBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: 'rgba(20,28,44,0.88)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipLabel: {
    color: '#E8EEF7',
    fontSize: 13,
    fontWeight: '600',
  },
  reticle: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderWidth: 2,
    borderRadius: 4,
  },
});
