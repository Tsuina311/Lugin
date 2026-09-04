import { requireOptionalNativeModule } from 'expo-modules-core';

import type { LuginCardDetectorNativeModule } from './LuginCardDetector.types';

export type {
  DetectorCorners,
  ImplementationStatus,
  LuginCardDetectorNativeModule,
  NativeDetectionResult,
} from './LuginCardDetector.types';

const MODULE_NAME = 'LuginCardDetector';

/** Optional: null when the native binary was built before this module linked. */
export function getLuginCardDetectorModule(): LuginCardDetectorNativeModule | null {
  return requireOptionalNativeModule<LuginCardDetectorNativeModule>(MODULE_NAME);
}

/**
 * Throws if the Expo module is not present in this binary.
 * Use after a fresh prebuild / EAS APK that includes `lugin-card-detector`.
 */
export function requireLuginCardDetectorModule(): LuginCardDetectorNativeModule {
  const mod = getLuginCardDetectorModule();
  if (!mod) {
    throw new Error(
      `Native module '${MODULE_NAME}' is not linked. ` +
        'Rebuild the development client / APK (expo prebuild + native build) ' +
        'after adding the lugin-card-detector dependency.',
    );
  }
  return mod;
}
