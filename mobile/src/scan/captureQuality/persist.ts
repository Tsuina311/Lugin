import type { CaptureQualityBundle } from '@/lib/scan/captureQuality';

import {
  bytesToBase64,
  scanImageToPngBytes,
} from '../debug/scanImagePng';
import type { ScanImage } from '../sharedCore';
import type { CaptureQualityRun } from './runPair';

export const QUALITY_ROOT = 'lugin-capture-quality/';

export const QUALITY_FILES = [
  'metadata.json',
  'ocr-results.json',
  'fast-source.png',
  'fast-overlay.png',
  'fast-card-744x1039.png',
  'fast-title.png',
  'photo-source.png',
  'photo-overlay.png',
  'photo-card-744x1039.png',
  'photo-title.png',
] as const;

const fs = async () => import('expo-file-system/legacy');

export const qualityDir = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('no documentDirectory');
  const dir = `${root}${QUALITY_ROOT}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

export const writeQualityPng = async (path: string, image: ScanImage, maxWidth: number): Promise<void> => {
  const FileSystem = await fs();
  const png = scanImageToPngBytes(image, maxWidth);
  await FileSystem.writeAsStringAsync(path, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

export const writeQualityJson = async (path: string, value: unknown): Promise<void> => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const saveCaptureQualityRun = async (run: CaptureQualityRun): Promise<{ dirUri: string }> => {
  const dir = await qualityDir(run.fixtureId);
  const bundle: CaptureQualityBundle = {
    capturedAt: run.capturedAt,
    fixtureId: run.fixtureId,
    focus: run.focus,
    gapAbMs: run.gapAbMs,
    label: run.label,
    lockToCaptureStartMs: run.lockToCaptureStartMs,
    motion: run.motion,
    photo: run.photo,
    snapshot: run.snapshot,
    tags: run.tags,
  };
  await writeQualityJson(`${dir}metadata.json`, bundle);
  await writeQualityJson(`${dir}ocr-results.json`, {
    photo: run.photo.ocr,
    snapshot: run.snapshot.ocr,
  });
  await writeQualityPng(`${dir}fast-source.png`, run.images.fastSource, 960);
  await writeQualityPng(`${dir}fast-overlay.png`, run.images.fastOverlay, 720);
  await writeQualityPng(`${dir}fast-card-744x1039.png`, run.images.fastCard, 400);
  await writeQualityPng(`${dir}fast-title.png`, run.images.fastTitle, 536);
  await writeQualityPng(`${dir}photo-source.png`, run.images.photoSource, 960);
  await writeQualityPng(`${dir}photo-overlay.png`, run.images.photoOverlay, 720);
  await writeQualityPng(`${dir}photo-card-744x1039.png`, run.images.photoCard, 400);
  await writeQualityPng(`${dir}photo-title.png`, run.images.photoTitle, 536);
  return { dirUri: dir };
};
