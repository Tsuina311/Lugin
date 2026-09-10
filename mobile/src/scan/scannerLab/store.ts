// Replay fixtures live in documentDirectory so they survive OTA.

import type { ScanImage } from '../sharedCore';
import {
  bytesToBase64,
  pngBase64ToScanImage,
  scanImageToPngBytes,
} from '../debug/scanImagePng';
import type { LabQuadSet } from '@/lib/scan/scannerLab/types';

export const LAB_ROOT = 'lugin-scanner-lab/fixtures/';

export interface LabFixtureMeta {
  appStamp: string | null;
  createdAt: string;
  expectedName: string | null;
  fixtureId: string;
  label: string;
  orientation: string | null;
  quadSpace: 'source-highres';
  quads: LabQuadSet;
  recognitionResult: string | null;
  runtimeFingerprint: string | null;
  sourceHeight: number;
  sourceWidth: number;
}

export interface LabFixture {
  detector: ScanImage | null;
  dirUri: string;
  meta: LabFixtureMeta;
  source: ScanImage;
}

const fs = async () => import('expo-file-system/legacy');

const rootUri = async (): Promise<string | null> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  await FileSystem.makeDirectoryAsync(`${root}${LAB_ROOT}`, { intermediates: true });
  return `${root}${LAB_ROOT}`;
};

const writePng = async (path: string, image: ScanImage): Promise<void> => {
  const FileSystem = await fs();
  const png = scanImageToPngBytes(image, image.width);
  await FileSystem.writeAsStringAsync(path, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

const readPng = async (path: string): Promise<ScanImage | null> => {
  const FileSystem = await fs();
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) return null;
  const b64 = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return pngBase64ToScanImage(b64);
};

export const makeFixtureId = (label: string, now = new Date()): string => {
  const slug = (label || 'card')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'card';
  const t = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `${slug}-${t}`;
};

export const listLabFixtures = async (): Promise<LabFixtureMeta[]> => {
  const FileSystem = await fs();
  const root = await rootUri();
  if (!root) return [];
  const listing = await FileSystem.readDirectoryAsync(root);
  const out: LabFixtureMeta[] = [];
  for (const name of listing) {
    try {
      const text = await FileSystem.readAsStringAsync(`${root}${name}/fixture.json`);
      out.push(JSON.parse(text) as LabFixtureMeta);
    } catch {
      /* skip incomplete dirs */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

export const loadLabFixture = async (fixtureId: string): Promise<LabFixture | null> => {
  const FileSystem = await fs();
  const root = await rootUri();
  if (!root) return null;
  const dir = `${root}${fixtureId}/`;
  const source = await readPng(`${dir}source-highres.png`);
  if (!source) return null;
  const meta = JSON.parse(await FileSystem.readAsStringAsync(`${dir}fixture.json`)) as LabFixtureMeta;
  const detector = await readPng(`${dir}detector-input.png`);
  return { detector, dirUri: dir, meta, source };
};

export const saveLabFixture = async (args: {
  appStamp?: string | null;
  detector?: ScanImage | null;
  expectedName?: string | null;
  label: string;
  orientation?: string | null;
  quads: LabQuadSet;
  recognitionResult?: string | null;
  runtimeFingerprint?: string | null;
  source: ScanImage;
}): Promise<{ fixtureId: string; uri: string }> => {
  const FileSystem = await fs();
  const root = await rootUri();
  if (!root) throw new Error('no documentDirectory');
  const fixtureId = makeFixtureId(args.label);
  const dir = `${root}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const meta: LabFixtureMeta = {
    appStamp: args.appStamp ?? null,
    createdAt: new Date().toISOString(),
    expectedName: args.expectedName ?? (args.label || null),
    fixtureId,
    label: args.label || fixtureId,
    orientation: args.orientation ?? null,
    quadSpace: 'source-highres',
    quads: args.quads,
    recognitionResult: args.recognitionResult ?? null,
    runtimeFingerprint: args.runtimeFingerprint ?? null,
    sourceHeight: args.source.height,
    sourceWidth: args.source.width,
  };
  await writePng(`${dir}source-highres.png`, args.source);
  if (args.detector) await writePng(`${dir}detector-input.png`, args.detector);
  await FileSystem.writeAsStringAsync(`${dir}fixture.json`, JSON.stringify(meta, null, 2));
  await FileSystem.writeAsStringAsync(
    `${dir}recognition-quad.json`,
    JSON.stringify({
      quadSpace: 'source-highres',
      raw: args.quads.raw,
      recognition: args.quads.recognition,
      tracked: args.quads.tracked,
    }),
  );
  return { fixtureId, uri: dir };
};
