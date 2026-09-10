// Save the current detector-input (and optional recognition) frame for training.
// Use when geometry looks good but identity fails / never becomes ambiguous.

import type { ScanImage } from './sharedCore';
import { CARD_HEIGHT, CARD_WIDTH } from './sharedCore';
import { scanImageToPngBytes } from './debug/scanImagePng';

export interface TrainingCaptureMeta {
  actualDetectorEngine?: string | null;
  detected?: boolean;
  detectorEngine?: string | null;
  detectorFallbackReason?: string | null;
  note?: string | null;
  phase?: string | null;
  recognitionSource?: string | null;
  requestedDetectorEngine?: string | null;
  score?: number | null;
  status?: string | null;
}

export type SaveTrainingResult =
  | { ok: true; directoryHint: string; saved: string[] }
  | { ok: false; reason: string };

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

/**
 * Persist detector input (+ recognition if present) under
 * documentDirectory/lugin-training/{stamp}/ for offline corpus import.
 */
export const saveTrainingCapture = async (opts: {
  detector: ScanImage | null | undefined;
  meta?: TrainingCaptureMeta;
  recognition?: ScanImage | null | undefined;
}): Promise<SaveTrainingResult> => {
  const detector = opts.detector;
  if (!detector || detector.width <= 0 || detector.height <= 0) {
    return { ok: false, reason: 'no detector input latched yet' };
  }

  try {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return { ok: false, reason: 'documentDirectory unavailable' };

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = `${root}lugin-training/${stamp}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const saved: string[] = [];

    // Full detector buffer — do not downscale (training wants the exact input).
    const detPng = scanImageToPngBytes(detector, detector.width);
    const detName = `detector-${detector.width}x${detector.height}.png`;
    await FileSystem.writeAsStringAsync(`${dir}${detName}`, bytesToBase64(detPng), {
      encoding: 'base64',
    });
    saved.push(detName);

    const recognition = opts.recognition;
    if (
      recognition &&
      recognition.width === CARD_WIDTH &&
      recognition.height === CARD_HEIGHT
    ) {
      const recPng = scanImageToPngBytes(recognition, CARD_WIDTH);
      const recName = `recognition-${CARD_WIDTH}x${CARD_HEIGHT}.png`;
      await FileSystem.writeAsStringAsync(`${dir}${recName}`, bytesToBase64(recPng), {
        encoding: 'base64',
      });
      saved.push(recName);
    }

    const meta = {
      createdAt: new Date().toISOString(),
      detector: { height: detector.height, width: detector.width },
      kind: 'lugin-training-capture',
      recognition:
        recognition && recognition.width > 0
          ? { height: recognition.height, width: recognition.width }
          : null,
      ...(opts.meta ?? {}),
    };
    await FileSystem.writeAsStringAsync(`${dir}meta.json`, JSON.stringify(meta, null, 2));
    saved.push('meta.json');

    return { ok: true, directoryHint: `Documents/lugin-training/${stamp}`, saved };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};

/** Share the just-saved detector PNG if the caller wants an immediate export. */
export const shareTrainingDetectorPng = async (
  directoryHintStampPath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return { ok: false, reason: 'documentDirectory unavailable' };
    // directoryHint is like Documents/lugin-training/{stamp}
    const stamp = directoryHintStampPath.replace(/^Documents\//, '');
    const dir = `${root}${stamp}/`;
    const listing = await FileSystem.readDirectoryAsync(dir);
    const det = listing.find(n => n.startsWith('detector-') && n.endsWith('.png'));
    if (!det) return { ok: false, reason: 'detector png missing' };
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, reason: 'sharing unavailable' };
    }
    await Sharing.shareAsync(`${dir}${det}`, {
      dialogTitle: 'Share detector training frame',
      mimeType: 'image/png',
      UTI: 'public.png',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};
