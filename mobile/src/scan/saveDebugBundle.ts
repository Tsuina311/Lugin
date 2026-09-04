// Build + share a debug dump of the live scanner panel.
//
// Android Share only accepts `message` (url is ignored). A full 744×1039 PNG
// data-URI is multi‑MB and freezes/fails the share Intent — so we share the
// text report, and show the recognition image in an on-screen viewer instead.

import { Platform, Share } from 'react-native';

import { CARD_HEIGHT, CARD_WIDTH, type ScanImage } from './sharedCore';
import { scanImageToPngDataUri } from './debug/scanImagePng';

export interface DebugShareImages {
  detectorUri?: string | null;
  hiresUri?: string | null;
  recognition?: ScanImage | null;
  recognitionUri?: string | null;
}

export interface DebugSharePayload {
  analysisLongEdge?: number;
  deviceLine?: string;
  images?: DebugShareImages;
  panel: Record<string, unknown>;
  preferredSource?: string;
  stamp?: string;
}

/** Android Binder limit is ~1 MB; keep headroom for Intent extras. */
const ANDROID_MESSAGE_MAX = 700_000;

export const buildDebugReport = (payload: DebugSharePayload): Record<string, unknown> => {
  const recognition = payload.images?.recognition;
  return {
    generatedAt: new Date().toISOString(),
    stamp: payload.stamp ?? null,
    device: payload.deviceLine ?? null,
    preferredSource: payload.preferredSource ?? null,
    analysisLongEdge: payload.analysisLongEdge ?? null,
    panel: payload.panel,
    images: {
      detectorPreview: Boolean(payload.images?.detectorUri),
      hiresPreview: Boolean(payload.images?.hiresUri),
      recognition:
        recognition && recognition.width === CARD_WIDTH && recognition.height === CARD_HEIGHT
          ? { height: CARD_HEIGHT, width: CARD_WIDTH, fullQuality: true }
          : payload.images?.recognitionUri
            ? { encodedPreview: true }
            : null,
    },
  };
};

export const formatDebugReportText = (report: Record<string, unknown>): string =>
  `Lugin scan debug\n${JSON.stringify(report, null, 2)}`;

export const encodeRecognitionPreview = (
  image: ScanImage | null | undefined,
  maxWidth = 480,
): string | null => {
  if (!image || image.width <= 0 || image.height <= 0) return null;
  try {
    return scanImageToPngDataUri(image, maxWidth);
  } catch {
    return null;
  }
};

export type ShareDebugResult =
  | {
      ok: true;
      /** Data URI for the on-screen image viewer (not put in the Android Intent). */
      imageUri: string | null;
      reportText: string;
      sharedText: boolean;
    }
  | { ok: false; reason: string };

/**
 * Share the text report (works on Android). Returns an image URI for a modal
 * viewer so the user can screenshot / inspect recognition input.
 */
export const shareDebugBundle = async (
  payload: DebugSharePayload,
): Promise<ShareDebugResult> => {
  const report = buildDebugReport(payload);
  let text = formatDebugReportText(report);
  if (Platform.OS === 'android' && text.length > ANDROID_MESSAGE_MAX) {
    text = `${text.slice(0, ANDROID_MESSAGE_MAX)}\n\n…truncated for Android share size limit`;
  }

  const card = payload.images?.recognition;
  const imageUri =
    encodeRecognitionPreview(card ?? null, 520) ?? payload.images?.recognitionUri ?? null;

  try {
    // Android: message only. Do NOT pass a data: URL — it is ignored and can
    // make the Intent explode if someone concatenates it into message.
    await Share.share(
      {
        message: text,
        title: 'Lugin scan debug',
      },
      { dialogTitle: 'Share Lugin scan debug' },
    );
    return { ok: true, imageUri, reportText: text, sharedText: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Still return the image so the viewer can open even if Share was dismissed
    // with an error on some OEMs.
    if (imageUri) {
      return { ok: true, imageUri, reportText: text, sharedText: false };
    }
    return { ok: false, reason };
  }
};
