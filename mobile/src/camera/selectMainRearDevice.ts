import type { CameraDevice, DeviceType } from 'react-native-vision-camera';

function deviceTypes(device: CameraDevice): DeviceType[] {
  if (device.isVirtualDevice && device.physicalDevices.length > 0) {
    return device.physicalDevices.map(d => d.type);
  }
  return [device.type];
}

/**
 * Pick the rear device to scan cards with.
 *
 * Revised from real Samsung measurements. The earlier heuristic ranked a
 * *physical* wide-angle above virtual multi-camera devices, which was backwards
 * on that hardware:
 *
 *   - "Back Triple Camera" — virtual, wide+ultra-wide+telephoto,
 *     `supportsFocusMetering: true`, image materially better than Chrome.
 *   - "Back Camera" — physical ultra-wide-angle,
 *     `supportsFocusMetering: false`, visibly softer.
 *
 * So focus metering is ranked first and an ultra-wide-only device last. Cards
 * are scanned close up, and a lens that cannot be focus-metered cannot be
 * driven by the scanner's focus gate at all — resolution is irrelevant if the
 * frame is soft.
 *
 * Still capability-based: no model names, no `localizedName` matching. The
 * Samsung result is the evidence, not the rule.
 */
export function selectMainRearDevice(devices: CameraDevice[]): CameraDevice | undefined {
  const rear = devices.filter(d => d.position === 'back');
  if (rear.length === 0) return undefined;

  const score = (device: CameraDevice): number => {
    const types = deviceTypes(device);
    const hasWide = types.includes('wide-angle');
    const ultraWideOnly = types.length > 0 && types.every(t => t === 'ultra-wide-angle');
    const focus = device.supportsFocusMetering;

    // An ultra-wide-only lens is the wrong tool for a close-up card whatever
    // else it offers, so it loses to everything.
    if (ultraWideOnly) return 5;

    let value = 0;
    if (focus) value += 100;
    if (hasWide) value += 40;
    // A virtual multi-camera lets the OS pick the sharpest physical lens for
    // the subject distance, which is exactly the Samsung finding.
    if (device.isVirtualDevice && hasWide && types.length > 1) value += 10;
    return value;
  };

  // Stable: equal scores keep the platform's own device order.
  return rear
    .map((device, index) => ({ device, index, value: score(device) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)[0].device;
}

export function describeDevice(device: CameraDevice): string {
  const physical = deviceTypes(device).join('+') || 'unknown';
  const virtual = device.isVirtualDevice ? 'virtual' : 'physical';
  const focus = device.supportsFocusMetering ? 'focus' : 'no-focus';
  return `${device.localizedName} · ${device.position} · ${virtual} · ${physical} · ${focus}`;
}
