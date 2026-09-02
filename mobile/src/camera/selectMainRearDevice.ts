import type { CameraDevice, DeviceType } from 'react-native-vision-camera';

function deviceTypes(device: CameraDevice): DeviceType[] {
  if (device.isVirtualDevice && device.physicalDevices.length > 0) {
    return device.physicalDevices.map((d) => d.type);
  }
  return [device.type];
}

/**
 * Prefer the physical wide-angle (main / 1x) rear camera for card scanning.
 * Do not hardcode Samsung names — filter by DeviceType capabilities.
 */
export function selectMainRearDevice(devices: CameraDevice[]): CameraDevice | undefined {
  const rear = devices.filter((d) => d.position === 'back');
  if (rear.length === 0) return undefined;

  const score = (device: CameraDevice): number => {
    const types = deviceTypes(device);
    // Prefer a single physical wide-angle lens over multi-cam virtual devices.
    if (!device.isVirtualDevice && device.type === 'wide-angle') return 100;
    if (types.includes('wide-angle') && !types.includes('ultra-wide-angle')) return 80;
    if (types.includes('wide-angle')) return 60;
    if (device.type === 'dual-wide') return 40;
    return 10;
  };

  return [...rear].sort((a, b) => score(b) - score(a))[0];
}

export function describeDevice(device: CameraDevice): string {
  const physical = deviceTypes(device).join('+') || 'unknown';
  const virtual = device.isVirtualDevice ? 'virtual' : 'physical';
  return `${device.localizedName} · ${device.position} · ${virtual} · ${physical}`;
}
