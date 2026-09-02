// Portable camera capability / constraint helpers (no DOM).
//
// Browser MediaTrackCapabilities are partial and inconsistent — every control
// must be capability-gated. These helpers normalize and build constraints.

export interface NumberRange {
  max?: number;
  min?: number;
  step?: number;
}

export interface ScannerCameraCapabilities {
  deviceId?: string;
  exposureModes?: string[];
  facingMode?: string | string[];
  focusDistance?: NumberRange;
  focusModes?: string[];
  frameRate?: NumberRange;
  height?: NumberRange;
  pointsOfInterest?: boolean;
  torch?: boolean;
  width?: NumberRange;
  zoom?: NumberRange;
}

export interface ScannerCameraSettings {
  deviceId?: string;
  exposureMode?: string;
  facingMode?: string;
  focusDistance?: number;
  focusMode?: string;
  frameRate?: number;
  height?: number;
  width?: number;
  zoom?: number;
}

export interface CameraConstraintPlan {
  /** Human-readable steps attempted (for debug). */
  fallbacks: string[];
  /** Preferred getUserMedia video constraints (ideal-based). */
  preferred: Record<string, unknown>;
}

const asRange = (v: unknown): NumberRange | undefined => {
  if (v == null) return undefined;
  if (typeof v === 'number') return { max: v, min: v };
  if (typeof v === 'object') {
    const o = v as { max?: number; min?: number; step?: number };
    return {
      max: typeof o.max === 'number' ? o.max : undefined,
      min: typeof o.min === 'number' ? o.min : undefined,
      step: typeof o.step === 'number' ? o.step : undefined,
    };
  }
  return undefined;
};

const asStringList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length ? out : undefined;
};

/** Normalize raw MediaTrackCapabilities into a typed summary. */
export const normalizeCapabilities = (
  raw: Record<string, unknown> | null | undefined,
): ScannerCameraCapabilities => {
  if (!raw) return {};
  const poi = raw.pointsOfInterest;
  return {
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : undefined,
    exposureModes: asStringList(raw.exposureMode),
    facingMode: (raw.facingMode as string | string[] | undefined) ?? undefined,
    focusDistance: asRange(raw.focusDistance),
    focusModes: asStringList(raw.focusMode),
    frameRate: asRange(raw.frameRate),
    height: asRange(raw.height),
    pointsOfInterest: poi === true || (typeof poi === 'number' && poi > 0),
    torch: raw.torch === true,
    width: asRange(raw.width),
    zoom: asRange(raw.zoom),
  };
};

/** Normalize raw MediaTrackSettings. */
export const normalizeSettings = (
  raw: Record<string, unknown> | null | undefined,
): ScannerCameraSettings => {
  if (!raw) return {};
  return {
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : undefined,
    exposureMode: typeof raw.exposureMode === 'string' ? raw.exposureMode : undefined,
    facingMode: typeof raw.facingMode === 'string' ? raw.facingMode : undefined,
    focusDistance: typeof raw.focusDistance === 'number' ? raw.focusDistance : undefined,
    focusMode: typeof raw.focusMode === 'string' ? raw.focusMode : undefined,
    frameRate: typeof raw.frameRate === 'number' ? raw.frameRate : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    zoom: typeof raw.zoom === 'number' ? raw.zoom : undefined,
  };
};

/**
 * Preferred + fallback getUserMedia video constraint sequence.
 * Prefer 1080p environment over brittle 4K exact constraints.
 */
export const buildCameraConstraintPlan = (deviceId?: string): CameraConstraintPlan => {
  const baseFacing = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } };

  return {
    fallbacks: [
      'environment 1920×1080 @30',
      'environment 1280×720',
      'environment any',
      'any videoinput',
    ],
    preferred: {
      ...baseFacing,
      frameRate: { ideal: 30 },
      height: { ideal: 1080 },
      width: { ideal: 1920 },
    },
  };
};

/** Staged video constraint list for robust startup. */
export const cameraConstraintFallbacks = (
  deviceId?: string,
): Record<string, unknown>[] => {
  const plan = buildCameraConstraintPlan(deviceId);
  if (deviceId) {
    return [
      plan.preferred,
      { deviceId: { exact: deviceId }, height: { ideal: 720 }, width: { ideal: 1280 } },
      { deviceId: { exact: deviceId } },
    ];
  }
  return [
    plan.preferred,
    {
      facingMode: { ideal: 'environment' },
      height: { ideal: 720 },
      width: { ideal: 1280 },
    },
    { facingMode: { ideal: 'environment' } },
    true as unknown as Record<string, unknown>,
  ];
};

/** Advanced constraints for continuous AF/AE when capabilities allow. */
export const buildContinuousFocusConstraints = (
  caps: ScannerCameraCapabilities,
): Record<string, unknown> | null => {
  const advanced: Record<string, unknown> = {};
  if (caps.focusModes?.includes('continuous')) advanced.focusMode = 'continuous';
  if (caps.exposureModes?.includes('continuous')) advanced.exposureMode = 'continuous';
  return Object.keys(advanced).length ? advanced : null;
};

/** Advanced constraints for tap / card-center focus. */
export const buildPointFocusConstraints = (
  caps: ScannerCameraCapabilities,
  point: { x: number; y: number },
): Record<string, unknown>[] => {
  const x = Math.min(1, Math.max(0, point.x));
  const y = Math.min(1, Math.max(0, point.y));
  const modes = caps.focusModes ?? [];
  // Try several shapes: Samsung Chrome often omits pointsOfInterest from
  // capabilities even when a single-shot / continuous toggle still nudges AF.
  const attempts: Record<string, unknown>[] = [
    { focusMode: 'single-shot', pointsOfInterest: [{ x, y }] },
    { pointsOfInterest: [{ x, y }] },
    { focusMode: 'single-shot' },
    { focusMode: 'manual' },
    { focusMode: 'continuous' },
  ];
  if (modes.includes('continuous')) {
    attempts.push({ focusMode: 'continuous', pointsOfInterest: [{ x, y }] });
  }
  if (caps.exposureModes?.includes('continuous')) {
    attempts.unshift({
      exposureMode: 'continuous',
      focusMode: 'single-shot',
      pointsOfInterest: [{ x, y }],
    });
  }
  return attempts;
};

/**
 * Whether the UI should advertise tap-to-focus.
 * Capability lists on Android are incomplete — treat any focus control as yes.
 */
export const supportsTapFocus = (caps: ScannerCameraCapabilities): boolean =>
  Boolean(caps.focusModes?.length) ||
  Boolean(caps.pointsOfInterest) ||
  Boolean(caps.focusDistance);

/**
 * Prefer the main rear lens over ultrawide.
 * On multi-camera Samsung/Pixel Chrome streams, zoom.min < 1 is usually ultrawide
 * and zoom ≈ 1 is the primary camera — which focuses much better on a desk card.
 */
export const preferredMainLensZoom = (caps: ScannerCameraCapabilities): number | null => {
  const z = caps.zoom;
  if (!z) return null;
  const min = z.min ?? 1;
  const max = z.max ?? min;
  if (!(min < 1) || !(max >= 1)) return null;
  return Math.min(max, Math.max(min, 1));
};
/**
 * Focus / sharpness gate decision (portable).
 * Geometry-stable + soft → focusing; sharp enough → locked.
 */
export const focusGateDecision = (input: {
  focusingSince: number | null;
  minQuality: number;
  minSharpness: number;
  now: number;
  qualityScore: number;
  sharpness: number;
  stable: boolean;
  timeoutMs: number;
}): {
  guidance?: string;
  kind: 'unstable' | 'focusing' | 'ready' | 'timeout';
} => {
  if (!input.stable) return { kind: 'unstable' };
  const sharpEnough =
    input.qualityScore >= input.minQuality && input.sharpness >= input.minSharpness;
  if (sharpEnough) return { kind: 'ready' };
  const since = input.focusingSince ?? input.now;
  if (input.now - since >= input.timeoutMs) {
    return { guidance: 'Move slightly farther away', kind: 'timeout' };
  }
  return { kind: 'focusing' };
};
