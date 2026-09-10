import type { SwapTestBundle, SwapTestCaptureRecord, SwapTestTransition } from '@/lib/scan/swapTest';
import { swapFilePrefix } from '@/lib/scan/swapTest';

import { bytesToBase64, scanImageToPngBytes } from '../debug/scanImagePng';
import type { ScanImage } from '../sharedCore';

export const SWAP_TEST_ROOT = 'lugin-swap-test/';

export const swapTestAllowedFiles = (count: number): string[] => {
  const files = ['summary.json', 'transitions.json'];
  for (let i = 0; i < count; i += 1) {
    const p = swapFilePrefix(i);
    files.push(`${p}-source.png`, `${p}-card.png`);
  }
  return files;
};

const fs = async () => import('expo-file-system/legacy');

export const swapTestDir = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('no documentDirectory');
  const dir = `${root}${SWAP_TEST_ROOT}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const writePng = async (path: string, image: ScanImage, maxWidth: number) => {
  const FileSystem = await fs();
  const png = scanImageToPngBytes(image, maxWidth);
  await FileSystem.writeAsStringAsync(path, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

const writeJson = async (path: string, value: unknown) => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export type SwapTestPersistInput = {
  bundle: SwapTestBundle;
  images: { card: ScanImage; index: number; source: ScanImage }[];
};

export const saveSwapTestRun = async (
  input: SwapTestPersistInput,
): Promise<{ dirUri: string; files: string[] }> => {
  const dir = await swapTestDir(input.bundle.fixtureId);
  await writeJson(`${dir}summary.json`, input.bundle);
  await writeJson(`${dir}transitions.json`, input.bundle.transitions);
  const files = ['summary.json', 'transitions.json'];
  for (const img of input.images) {
    const p = swapFilePrefix(img.index);
    await writePng(`${dir}${p}-source.png`, img.source, 960);
    await writePng(`${dir}${p}-card.png`, img.card, 400);
    files.push(`${p}-source.png`, `${p}-card.png`);
  }
  return { dirUri: dir, files };
};

export type { SwapTestCaptureRecord, SwapTestTransition };
