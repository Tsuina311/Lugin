// Build + share a debug dump of the live scanner panel.
//
// No expo-file-system in this APK — Share is the OTA-safe path:
// text report (all on-screen numbers) + recognition-input PNG as the share URL.

import { Share } from 'react-native';

import { CARD_HEIGHT, CARD_WIDTH, type ScanImage } from './sharedCore';
import { scanImageToPngDataUri } from './debug/scanImagePng';

export interface DebugShareImages {
  /** Detector analysis thumbnail (already a data URI is fine). */
  detectorUri?: string | null;
  /** Mapped hi-res source thumbnail. */
  hiresUri?: string | null;
  /** Full-quality 744×1039 recognition input (preferred). */
  recognition?: ScanImage | null;
  /** Already-encoded recognition preview if the ScanImage is gone. */
  recognitionUri?: string | null;
}

export interface DebugSharePayload {
  analysisLongEdge?: number;
  deviceLine?: string;
  images?: DebugShareImages;
  /** Anything already shown on the scan debug panel. */
  panel: Record<string, unknown>;
  preferredSource?: string;
  stamp?: string;
}

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

/**
 * Share a text report of every debug field, plus the recognition PNG when present.
 * The PNG is encoded at full 744×1039 so title/rules/collector stay readable.
 */
export const shareDebugBundle = async (
  payload: DebugSharePayload,
): Promise<{ ok: true; hadImage: boolean } | { ok: false; reason: string }> => {
  const report = buildDebugReport(payload);
  const text = formatDebugReportText(report);

  let imageUri: string | null = null;
  const card = payload.images?.recognition;
  if (card && card.width === CARD_WIDTH && card.height === CARD_HEIGHT) {
    try {
      // Full width — do not shrink; this is what offline replay needs.
      imageUri = scanImageToPngDataUri(card, CARD_WIDTH);
    } catch (err) {
      return {
        ok: false,
        reason: `recognition PNG encode failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else if (payload.images?.recognitionUri) {
    imageUri = payload.images.recognitionUri;
  }

  try {
    await Share.share(
      imageUri
        ? {
            message: text,
            title: 'Lugin scan debug',
            url: imageUri,
          }
        : {
            message: text,
            title: 'Lugin scan debug',
          },
    );
    return { ok: true, hadImage: Boolean(imageUri) };
  } catch (err) {
    // Some Android targets reject huge data-URI urls — retry text-only.
    if (imageUri) {
      try {
        await Share.share({
          message: `${text}\n\n(recognition PNG omitted — share target rejected the image)`,
          title: 'Lugin scan debug',
        });
        return { ok: true, hadImage: false };
      } catch (err2) {
        return {
          ok: false,
          reason: err2 instanceof Error ? err2.message : String(err2),
        };
      }
    }
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};
