// Detector engine seam for the native companion.
//
// Shared JS wraps portable `detectCardQuad`.
// Native live path: Y/luma plane → detectFromYPlane (no full RGBA through RN).
// Native RGBA detectFromRgba remains for parity / offline fixtures.
// Do not import this from `sharedCore.ts` — it pulls `expo-modules-core`.

import { getLuginCardDetectorModule } from 'lugin-card-detector';

import type {
  DetectorEngine,
  DetectorEngineId,
  NativeDetectionResult,
} from '@/lib/scan/detection/engine';

import {
  detectCardQuad,
  emptyDetectionDebug,
  type CardCorners,
  type DetectionDebug,
  type Point,
  type ScanImage,
} from './sharedCore';

export type { DetectorEngine, DetectorEngineId, NativeDetectionResult };

const STUB_REJECT = 'ERR_NOT_IMPLEMENTED';

export const createSharedJsDetectorEngine = (): DetectorEngine => ({
  id: 'shared-js',
  detect: (input: ScanImage) => {
    const result = detectCardQuad(input);
    return {
      corners: result.corners,
      score: result.score,
      debug: result.debug,
    };
  },
});

/**
 * Native geometric engine.
 *
 * Live: prefer `detectYPlane` (Y buffer only).
 * Parity: `detect` encodes RGBA → `detectFromRgba`.
 */
export const createNativeDetectorEngine = (): DetectorEngine => {
  const native = getLuginCardDetectorModule();
  if (!native) {
    throw new Error(
      "Detector engine 'native' requires the LuginCardDetector Expo module. " +
        'It is not linked in this binary — run expo prebuild and rebuild the ' +
        'development APK after adding lugin-card-detector.',
    );
  }

  return {
    id: 'native',
    detect: (input: ScanImage) => {
      if (native.implementationStatus === 'stub') {
        return {
          corners: null,
          score: 0,
          debug: stubDebug('native-stub: port detectCard.ts — see modules/lugin-card-detector'),
        };
      }

      // Pass packed RGBA bytes directly — Expo ByteArrayTypeConverter, no base64.
      const rgba = new Uint8Array(input.data.buffer, input.data.byteOffset, input.data.byteLength);
      const raw = native.detectFromRgba(rgba, input.width, input.height);
      return mapNativeResult(raw, 'native-rgba');
    },
    detectYPlane: async (y, width, height, rowStride) => {
      if (native.implementationStatus === 'stub') {
        return {
          corners: null,
          score: 0,
          debug: stubDebug('native-stub: Y-plane path'),
        };
      }
      const raw = await Promise.resolve(native.detectFromYPlane(y, width, height, rowStride));
      if (!raw || typeof raw !== 'object') {
        throw new Error(
          'detectFromYPlane returned no result (native AsyncFunction mismatch). Rebuild the APK.',
        );
      }
      return mapNativeResult(raw, 'native-y');
    },
  };
};

/** Toggle nested sleeve scoring on the native module (debug bisection). */
export const setNativeNestedSleeveEnabled = (enabled: boolean): void => {
  getLuginCardDetectorModule()?.setNestedSleeveEnabled?.(enabled);
};

/** True when the Expo module is present in this binary (even if still stubbed). */
export const isNativeDetectorLinked = (): boolean => getLuginCardDetectorModule() != null;

export const getNativeDetectorImplementationStatus = (): string | null =>
  getLuginCardDetectorModule()?.implementationStatus ?? null;

const stubDebug = (reason: string): DetectionDebug => ({
  ...emptyDetectionDebug(),
  candidates: [
    {
      corners: null,
      method: 'native-stub',
      components: { aspect: 0, area: 0, center: 0, parallel: 0 },
      rejectedBecause: [reason],
      score: 0,
    },
  ],
  selectedIndex: -1,
});

const parseCorner = (value: unknown): Point | null => {
  if (!value || typeof value !== 'object') return null;
  const rec = value as { x?: unknown; y?: unknown };
  const x = Number(rec.x);
  const y = Number(rec.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const parseCorners = (value: unknown): CardCorners | null => {
  if (!Array.isArray(value) || value.length < 4) return null;
  const tl = parseCorner(value[0]);
  const tr = parseCorner(value[1]);
  const br = parseCorner(value[2]);
  const bl = parseCorner(value[3]);
  if (!tl || !tr || !br || !bl) return null;
  return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
};

const mapNativeResult = (
  raw: NativeDetectionResult,
  method: string,
): {
  corners: CardCorners | null;
  score: number;
  debug: DetectionDebug;
} => {
  const reject = raw.diagnostics?.rejectReason;
  const corners = raw.detected ? parseCorners(raw.corners) : null;
  if (!raw.detected || !corners) {
    const reason =
      reject ??
      (raw.detected === false ? 'native: no card' : 'native: missing corners');
    return {
      corners: null,
      score: raw.score ?? 0,
      debug: {
        ...emptyDetectionDebug(),
        ms: raw.timingMs,
        candidates: [
          {
            corners: null,
            method: reject?.startsWith(STUB_REJECT) ? 'native-stub' : method,
            components: { aspect: 0, area: 0, center: 0, parallel: 0 },
            rejectedBecause: [reason],
            score: raw.score ?? 0,
          },
        ],
        selectedIndex: -1,
      },
    };
  }

  const extras = (raw.candidates ?? [])
    .map(c => {
      const parsed = parseCorners(c.corners);
      if (!parsed) return null;
      return {
        corners: parsed,
        method: c.method ?? method,
        components: {
          aspect: c.aspectRatio ?? 0,
          area: c.areaRatio ?? 0,
          center: 0,
          parallel: 0,
        },
        rejectedBecause: [] as string[],
        score: c.score,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);
  const candidates =
    extras.length > 0
      ? extras
      : [
          {
            corners,
            method,
            components: {
              aspect: raw.diagnostics?.aspectRatio ?? 0,
              area: raw.diagnostics?.areaRatio ?? 0,
              center: 0,
              parallel: 0,
            },
            rejectedBecause: [],
            score: raw.score ?? 0,
          },
        ];

  return {
    corners,
    score: raw.score ?? 0,
    debug: {
      candidates,
      ms: raw.timingMs,
      selectedIndex: 0,
      workSize: {
        height: raw.diagnostics?.workHeight ?? 0,
        width: raw.diagnostics?.workWidth ?? 0,
      },
    },
  };
};
