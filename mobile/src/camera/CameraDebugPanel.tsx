import { StyleSheet, Text, View } from 'react-native';
import type { CameraDevice } from 'react-native-vision-camera';

type Props = {
  device: CameraDevice | undefined;
  focusPoint: { x: number; y: number } | null;
  focusState: 'idle' | 'focusing' | 'done' | 'error';
  lastFocusError: string | null;
  rearDeviceCount: number;
};

function typesOf(device: CameraDevice): string {
  if (device.isVirtualDevice && device.physicalDevices.length > 0) {
    return device.physicalDevices.map((d) => d.type).join(', ');
  }
  return device.type;
}

export function CameraDebugPanel({
  device,
  focusPoint,
  focusState,
  lastFocusError,
  rearDeviceCount,
}: Props) {
  if (!device) {
    return (
      <View style={styles.panel} pointerEvents="none">
        <Text style={styles.line}>No rear camera device</Text>
      </View>
    );
  }

  const minZoom = Number(device.minZoom).toFixed(2);
  const maxZoom = Number(device.maxZoom).toFixed(2);

  return (
    <View style={styles.panel} pointerEvents="none">
      <Text style={styles.title}>Camera debug</Text>
      <Text style={styles.line}>name: {device.localizedName}</Text>
      <Text style={styles.line}>id: {device.id}</Text>
      <Text style={styles.line}>model: {device.modelID}</Text>
      <Text style={styles.line}>position: {device.position}</Text>
      <Text style={styles.line}>type: {device.type}</Text>
      <Text style={styles.line}>virtual: {String(device.isVirtualDevice)}</Text>
      <Text style={styles.line}>physical: {typesOf(device)}</Text>
      <Text style={styles.line}>
        zoom: {minZoom}–{maxZoom} (default 1.0)
      </Text>
      <Text style={styles.line}>
        focus metering: {String(device.supportsFocusMetering)}
      </Text>
      <Text style={styles.line}>rear devices: {rearDeviceCount}</Text>
      <Text style={styles.line}>focus: {focusState}</Text>
      {focusPoint ? (
        <Text style={styles.line}>
          focus @ {focusPoint.x.toFixed(0)},{focusPoint.y.toFixed(0)}
        </Text>
      ) : null}
      {lastFocusError ? <Text style={styles.error}>{lastFocusError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 96,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  title: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  line: {
    color: '#E8EEF7',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  error: {
    color: '#FF8A80',
    fontSize: 11,
    marginTop: 4,
  },
});
