import { requireOptionalNativeModule } from 'expo-modules-core';

import type { LuginOcrNativeModule } from './LuginOcr.types';

export type {
  ImplementationStatus,
  LuginOcrNativeModule,
  NativeOcrRect,
  NativeOcrResult,
  NativeOcrWord,
} from './LuginOcr.types';

const MODULE_NAME = 'LuginOcr';

/** Optional: null when the native binary was built before this module linked. */
export function getLuginOcrModule(): LuginOcrNativeModule | null {
  return requireOptionalNativeModule<LuginOcrNativeModule>(MODULE_NAME);
}

/**
 * Throws if the Expo module is not present in this binary.
 * Use after a fresh prebuild / EAS APK that includes `lugin-ocr`.
 */
export function requireLuginOcrModule(): LuginOcrNativeModule {
  const mod = getLuginOcrModule();
  if (!mod) {
    throw new Error(
      `Native module '${MODULE_NAME}' is not linked. ` +
        'Rebuild the development client / APK (expo prebuild + native build) ' +
        'after adding the lugin-ocr dependency.',
    );
  }
  return mod;
}
