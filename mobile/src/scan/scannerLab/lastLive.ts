// Persist the latest live recognition input so Lab can replay it.

import type { CardCorners, ScanImage } from '../sharedCore';
import type { CapturedRecognitionResult } from '@/lib/scan/recognizeCaptured';
import type { LastLiveAttemptMeta } from '@/lib/scan/scannerLab/lastLive';
import { bytesToBase64, pngBase64ToScanImage, scanImageToPngBytes } from '../debug/scanImagePng';

const LAST_DIR = 'lugin-scanner-lab/last-live-attempt/';

export interface LastLiveAttempt {
  meta: LastLiveAttemptMeta;
  source: ScanImage;
}

const fs = async () => import('expo-file-system/legacy');

const dirUri = async (): Promise<string | null> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  const dir = `${root}${LAST_DIR}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

export const saveLastLiveAttempt = async (args: {
  published: boolean;
  recognitionQuad: CardCorners | null;
  rejectReason: string | null;
  result: CapturedRecognitionResult;
  source: ScanImage;
}): Promise<void> => {
  const FileSystem = await fs();
  const dir = await dirUri();
  if (!dir) return;
  const meta: LastLiveAttemptMeta = {
    attemptId: args.result.attemptId,
    captureAt: null,
    hashes: args.result.hashes,
    live: {
      matchName: args.result.matchName,
      matchScore: args.result.matchScore,
      ocrText: args.result.ocrText,
      published: args.published,
      rejectReason: args.rejectReason,
      status: args.result.status,
    },
    quadSource: args.result.alreadyWarped ? 'already-warped' : 'frozen-hires',
    recognitionQuad: args.recognitionQuad,
    savedAt: new Date().toISOString(),
    sourceHeight: args.source.height,
    sourceWidth: args.source.width,
    trackId: args.result.trackId,
  };
  const png = scanImageToPngBytes(args.source, args.source.width);
  await FileSystem.writeAsStringAsync(`${dir}source-highres.png`, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.writeAsStringAsync(`${dir}input.json`, JSON.stringify(meta, null, 2));
};

export const loadLastLiveAttempt = async (): Promise<LastLiveAttempt | null> => {
  const FileSystem = await fs();
  const dir = await dirUri();
  if (!dir) return null;
  const info = await FileSystem.getInfoAsync(`${dir}input.json`);
  if (!info.exists) return null;
  const pngInfo = await FileSystem.getInfoAsync(`${dir}source-highres.png`);
  if (!pngInfo.exists) return null;
  const meta = JSON.parse(await FileSystem.readAsStringAsync(`${dir}input.json`)) as LastLiveAttemptMeta;
  const b64 = await FileSystem.readAsStringAsync(`${dir}source-highres.png`, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { meta, source: pngBase64ToScanImage(b64) };
};
