// Persist one immutable OCR-debug bundle per unique recognition attempt.

import { attemptDebugDirName, shouldPersistOcrDebugBundle } from '@/lib/scan/ocrAttempt';
import { titleOcrDebugWithoutImages, type ScanImage, type TitleOcrDebug } from './sharedCore';
import { scanImageToPngBytes } from './debug/scanImagePng';
import { enqueueRecognitionDebug } from './debugInbox/enqueueRecognition';
import { getOcrAdapterSnapshot } from './ocrAdapter';

const writtenAttemptIds = new Set<string>();
const writtenHashes = new Set<string>();

export const resetOcrDebugPersistForTests = (): void => {
  writtenAttemptIds.clear();
  writtenHashes.clear();
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      alphabet[(n >> 6) & 63] +
      alphabet[n & 63];
  }
  const rem = bytes.length % 3;
  if (rem === 1) {
    const n = bytes[bytes.length - 1] << 16;
    out += `${alphabet[(n >> 18) & 63]}${alphabet[(n >> 12) & 63]}==`;
  } else if (rem === 2) {
    const n = (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 8);
    out += `${alphabet[(n >> 18) & 63]}${alphabet[(n >> 12) & 63]}${alphabet[(n >> 6) & 63]}=`;
  }
  return out;
};

const writePng = async (
  FileSystem: typeof import('expo-file-system/legacy'),
  path: string,
  image: ScanImage,
): Promise<void> => {
  const png = scanImageToPngBytes(image, image.width);
  await FileSystem.writeAsStringAsync(path, bytesToBase64(png), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

export const saveRecognitionOcrDebug = async (info: {
  attemptNumber: number;
  captureAt: number | null;
  image: ScanImage;
  ocrDebug?: TitleOcrDebug | null;
  quad: {
    bottomLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
  } | null;
  sameInputAsPreviousAttempt?: boolean;
  status: string;
  trackId: number | null;
}): Promise<{ persisted: boolean; uploaded: boolean; reason: string }> => {
  const attemptId = String(info.ocrDebug?.sourceAttemptId ?? info.attemptNumber);
  const hash = info.ocrDebug?.ocrInputHash ?? '';
  const plan = shouldPersistOcrDebugBundle({
    alreadyWrittenAttemptId: writtenAttemptIds.has(attemptId) ? attemptId : null,
    attemptId,
    sameInputAsPreviousAttempt: info.sameInputAsPreviousAttempt === true,
  });
  if (!plan.persist || (hash && writtenHashes.has(hash))) {
    return { persisted: false, uploaded: false, reason: plan.reason };
  }

  try {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return { persisted: false, uploaded: false, reason: 'no-document-dir' };
    const dir = `${root}lugin-post-lock/${attemptDebugDirName(attemptId)}/`;
    const existing = await FileSystem.getInfoAsync(`${dir}ocr-debug.json`);
    if (existing.exists) {
      writtenAttemptIds.add(attemptId);
      if (hash) writtenHashes.add(hash);
      return { persisted: false, uploaded: false, reason: 'already-written' };
    }
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const card = info.ocrDebug?.images?.recognitionCard ?? info.image;
    const raw = info.ocrDebug?.images?.titleCropRaw;
    const ocr = info.ocrDebug?.images?.titleCropOcr;
    if (card) await writePng(FileSystem, `${dir}recognition-card.png`, card);
    if (raw) await writePng(FileSystem, `${dir}title-crop-raw.png`, raw);
    if (ocr) await writePng(FileSystem, `${dir}title-crop-ocr.png`, ocr);

    const adapter = getOcrAdapterSnapshot();
    const slim = info.ocrDebug ? titleOcrDebugWithoutImages(info.ocrDebug) : null;
    const debugJson = {
      ...(slim ?? {}),
      adapter,
      attemptNumber: info.attemptNumber,
      controllerHasOcrDependency: adapter.controllerHasOcrDependency,
      nativeModuleAvailable: adapter.nativeModuleAvailable,
      sameInputAsPreviousAttempt: false,
      status: info.status,
    };
    await FileSystem.writeAsStringAsync(`${dir}ocr-debug.json`, JSON.stringify(debugJson, null, 2));
    await FileSystem.writeAsStringAsync(
      `${dir}post-lock.json`,
      JSON.stringify({
        attemptNumber: info.attemptNumber,
        captureAt: info.captureAt,
        cropHeight: info.image.height,
        cropWidth: info.image.width,
        ocrDebug: debugJson,
        quad: info.quad,
        recognitionQuad: info.quad,
        status: info.status,
        trackId: info.trackId,
      }),
    );

    writtenAttemptIds.add(attemptId);
    if (hash) writtenHashes.add(hash);

    const queued = await enqueueRecognitionDebug({ dirUri: dir, scannerPhase: info.status });
    return { persisted: true, uploaded: queued.queued, reason: queued.reason ?? 'written' };
  } catch (err) {
    return { persisted: false, uploaded: false, reason: err instanceof Error ? err.message : String(err) };
  }
};
