import { requireOptionalNativeModule } from 'expo-modules-core';

import type { LuginVisualNativeModule } from './LuginVisual.types';

export type {
  LuginVisualNativeModule,
  VisualCandidate,
  VisualCompareResult,
  VisualEngineStatus,
  VisualInitResult,
  VisualRecognizeResult,
  VisualTiming,
} from './LuginVisual.types';

const MODULE_NAME = 'LuginVisual';

export function getLuginVisualModule(): LuginVisualNativeModule | null {
  return requireOptionalNativeModule<LuginVisualNativeModule>(MODULE_NAME);
}

export function requireLuginVisualModule(): LuginVisualNativeModule {
  const mod = getLuginVisualModule();
  if (!mod) {
    throw new Error(
      `Native module '${MODULE_NAME}' is not linked. ` +
        'Rebuild the development client / APK after adding lugin-visual-recognizer.',
    );
  }
  return mod;
}
