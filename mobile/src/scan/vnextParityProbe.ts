import { getLuginVisualModule } from 'lugin-visual-recognizer';
import type { VNextParityProbeResult } from 'lugin-visual-recognizer';

import {
  createVNextParityFixtureRgba,
  VNEXT_PARITY_FIXTURE_HEIGHT,
  VNEXT_PARITY_FIXTURE_ID,
  VNEXT_PARITY_FIXTURE_WIDTH,
} from '@/lib/scan/vnext/parityFixture';

type LegacyFS = typeof import('expo-file-system/legacy');

export type PersistedVNextParityProbe = VNextParityProbeResult & {
  fixture: {
    format: 'RGBA8888';
    height: number;
    id: string;
    width: number;
  };
  generatedAt: string;
};

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export const runAndShareVNextParityProbe = async (): Promise<string> => {
  const native = getLuginVisualModule();
  if (!native?.runVNextParityProbeFromRgbaBytes) {
    return 'Parity probe is not in this APK. Install the new development build.';
  }
  const rgba = createVNextParityFixtureRgba();
  const result = await native.runVNextParityProbeFromRgbaBytes(
    rgba,
    VNEXT_PARITY_FIXTURE_WIDTH,
    VNEXT_PARITY_FIXTURE_HEIGHT,
  );
  if (result.error) return result.error;
  const payload: PersistedVNextParityProbe = {
    ...result,
    fixture: {
      format: 'RGBA8888',
      height: VNEXT_PARITY_FIXTURE_HEIGHT,
      id: VNEXT_PARITY_FIXTURE_ID,
      width: VNEXT_PARITY_FIXTURE_WIDTH,
    },
    generatedAt: new Date().toISOString(),
  };
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!root) return 'No app storage is available.';
  const dir = `${root}vnext-parity/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const uri = `${dir}android-result.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2));
  try {
    const Sharing = await import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        dialogTitle: 'Share vNext Android parity result',
        mimeType: 'application/json',
      });
      return 'Parity result saved and shared. OCR was not included.';
    }
  } catch {
    // The persisted result remains available for a later retry.
  }
  return `Parity result saved at ${uri}. OCR was not included.`;
};
