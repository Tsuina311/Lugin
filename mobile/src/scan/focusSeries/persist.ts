import type { FocusSeriesBundle } from '@/lib/scan/focusSeries';
import { FOCUS_SERIES_OFFSETS_MS, focusSeriesFilePrefix } from '@/lib/scan/focusSeries';

import { bytesToBase64, scanImageToPngBytes } from '../debug/scanImagePng';
import type { FocusSeriesRun } from './runSeries';

export const FOCUS_SERIES_ROOT = 'lugin-focus-series/';

export const FOCUS_SERIES_FILES = [
  'metadata.json',
  'ocr-results.json',
  ...FOCUS_SERIES_OFFSETS_MS.flatMap(n => {
    const p = focusSeriesFilePrefix(n);
    return [`${p}-source.png`, `${p}-overlay.png`, `${p}-card.png`, `${p}-title.png`];
  }),
] as const;

const fs = async () => import('expo-file-system/legacy');

export const focusSeriesDir = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('no documentDirectory');
  const dir = `${root}${FOCUS_SERIES_ROOT}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const writePng = async (path: string, image: import('../sharedCore').ScanImage, maxWidth: number) => {
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

export const saveFocusSeriesRun = async (run: FocusSeriesRun): Promise<{ dirUri: string }> => {
  const dir = await focusSeriesDir(run.fixtureId);
  const bundle: FocusSeriesBundle = {
    capturedAt: run.capturedAt,
    currentTrackId: run.currentTrackId,
    fixtureId: run.fixtureId,
    focusAttemptId: run.focusAttemptId,
    focusRequestedAt: run.focusRequestedAt,
    focusTrackId: run.focusTrackId,
    label: run.label,
    quadMode: run.quadMode,
    sameTrackFocus: run.sameTrackFocus,
    samples: run.samples,
    tags: run.tags,
    trackChangedDuringSeries: run.trackChangedDuringSeries,
  };
  await writeJson(`${dir}metadata.json`, bundle);
  await writeJson(
    `${dir}ocr-results.json`,
    Object.fromEntries(run.samples.map(s => [`t${s.nominalDelayMs}`, s.ocr])),
  );
  for (const n of FOCUS_SERIES_OFFSETS_MS) {
    const p = focusSeriesFilePrefix(n);
    const imgs = run.images[n];
    await writePng(`${dir}${p}-source.png`, imgs.source, 960);
    await writePng(`${dir}${p}-overlay.png`, imgs.overlay, 720);
    await writePng(`${dir}${p}-card.png`, imgs.card, 400);
    await writePng(`${dir}${p}-title.png`, imgs.title, 536);
  }
  return { dirUri: dir };
};
