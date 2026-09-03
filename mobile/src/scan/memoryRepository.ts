// Native LocalRepository stand-in until Expo SQLite ships in a new APK.
//
// Same contract as web/chrome. Adding expo-sqlite changes the EAS fingerprint.
// This in-memory port keeps the scanner → collection command path testable
// without inventing a native domain model.

import { InMemoryLocalRepository } from '@/core/sync/memory';
import type { LocalRepository } from '@/core/sync/repository';

export const createNativeLocalRepository = (deviceId = 'native'): LocalRepository =>
  new InMemoryLocalRepository(deviceId);

export { InMemoryLocalRepository };
