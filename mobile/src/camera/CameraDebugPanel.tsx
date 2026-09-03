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
    return device.physicalDevices.map(d => d.type).join(', ');
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
      <View pointerEvents="none" style={styles.panel}>
        <Text style={styles.line}>No rear camera device</Text>
      </View>
    );
  }

  const minZoom = Number(device.minZoom).toFixed(2);
  const maxZoom = Number(device.maxZoom).toFixed(2);

  return (
    <View pointerEvents="none" style={styles.panel}>
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
  
  
  error: {
    color: '#FF8A80',
    fontSize: 11,
    marginTop: 4,
  },
  

line: {
    color: '#E8EEF7',
    fontFamily: 'Courier',
    fontSize: 11,
  },
  // Laid out by the parent column (see CameraScanScreen), not self-anchored, so
// it cannot end up underneath the controls.
panel: {
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    padding: 10,
  },
  title: {
    color: '#F5C542',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
});
