/**
 * Product names and platform capabilities shared by the two mobile
 * presentations. This is feature configuration, not a UI abstraction: React
 * DOM and React Native remain free to render the same feature differently.
 */
export const PRODUCT_NAMES = {
  chrome: 'Lugin Chrome',
  native: 'Lugin Native',
  web: 'Lugin Web',
} as const;

export type LuginSurface = 'chrome' | 'native-android' | 'native-ios' | 'web';

export interface PlatformCapabilities {
  binderScanner: boolean;
  browserScanner: boolean;
  indexedDb: boolean;
  nativeFilesystem: boolean;
  nativeScanner: boolean;
  nativeShare: boolean;
  secureStore: boolean;
  sqlite: boolean;
}

export const PLATFORM_CAPABILITIES: Readonly<Record<LuginSurface, PlatformCapabilities>> = {
  chrome: {
    binderScanner: false,
    browserScanner: false,
    indexedDb: false,
    nativeFilesystem: false,
    nativeScanner: false,
    nativeShare: false,
    secureStore: false,
    sqlite: false,
  },
  'native-android': {
    binderScanner: true,
    browserScanner: false,
    indexedDb: false,
    nativeFilesystem: true,
    nativeScanner: true,
    nativeShare: true,
    secureStore: true,
    sqlite: true,
  },
  'native-ios': {
    binderScanner: false,
    browserScanner: false,
    indexedDb: false,
    nativeFilesystem: true,
    nativeScanner: false,
    nativeShare: true,
    secureStore: true,
    sqlite: true,
  },
  web: {
    binderScanner: false,
    browserScanner: true,
    indexedDb: true,
    nativeFilesystem: false,
    nativeScanner: false,
    nativeShare: true,
    secureStore: false,
    sqlite: false,
  },
};

export const capabilitiesFor = (surface: LuginSurface): PlatformCapabilities =>
  PLATFORM_CAPABILITIES[surface];
