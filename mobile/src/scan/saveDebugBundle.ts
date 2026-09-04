// Export recognition PNG + JSON so the user can send them to another app.
//
// Android's RN `Share` only accepts text (`url` is ignored), so we write real
// files with expo-file-system and open the native share sheet via expo-sharing.
// If sharing isn't linked yet (older APK), fall back to the Storage Access
// Framework picker (Drive / Downloads / Files).

import { Directory, EncodingType, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { pixelOrderFor } from './frameToScanImage';
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
  /** Human eyeball: detector PNG looks color-correct. Default unverified. */
  detectorInputColorCorrect?: 'yes' | 'no' | 'unverified';
  deviceLine?: string;
  images?: DebugShareImages;
  panel: Record<string, unknown>;
  /** VisionCamera / nitro pixelFormat string for the detector (or recognition) path. */
  pixelFormat?: string | null;
  preferredSource?: string;
  /** Human eyeball: recognition PNG looks color-correct. Default unverified. */
  recognitionInputColorCorrect?: 'yes' | 'no' | 'unverified';
  /** Actual recognition mode used (not merely preferred). */
  recognitionSource?: string | null;
  stamp?: string;
}

/** Checklist fields the export must always surface (human + pipeline). */
export interface ColorChecklist {
  channelOrder: string;
  detectorInputColorCorrect: 'yes' | 'no' | 'unverified';
  pixelFormat: string;
  recognitionInputColorCorrect: 'yes' | 'no' | 'unverified';
  /** snapshot | photo | high-res-frame | fallback | unknown */
  recognitionSource: string;
}

/** Android Binder limit is ~1 MB; keep headroom for Intent extras. */
const ANDROID_MESSAGE_MAX = 700_000;
const PNG_PREFIX = 'data:image/png;base64,';

/** Map internal mode onto the checklist labels (fallback, not analysis-fallback). */
export const recognitionSourceLabel = (mode?: string | null): string => {
  if (!mode) return 'unknown';
  if (mode === 'analysis-fallback') return 'fallback';
  return mode;
};

const pixelFormatFromPanel = (panel: Record<string, unknown>): string | null => {
  const meta = panel.frameMeta as { pixelFormat?: string } | null | undefined;
  if (meta?.pixelFormat) return meta.pixelFormat;
  return null;
};

const recognitionSourceFromPanel = (panel: Record<string, unknown>): string | null => {
  const session = panel.session as { recognitionSource?: string | null } | null | undefined;
  return session?.recognitionSource ?? null;
};

export const buildColorChecklist = (payload: DebugSharePayload): ColorChecklist => {
  const pixelFormat =
    payload.pixelFormat ?? pixelFormatFromPanel(payload.panel) ?? 'unknown';
  const order =
    pixelFormat === 'unknown' ? null : pixelOrderFor(pixelFormat, Platform.OS);
  return {
    detectorInputColorCorrect: payload.detectorInputColorCorrect ?? 'unverified',
    recognitionInputColorCorrect: payload.recognitionInputColorCorrect ?? 'unverified',
    recognitionSource: recognitionSourceLabel(
      payload.recognitionSource ?? recognitionSourceFromPanel(payload.panel),
    ),
    pixelFormat,
    channelOrder: order ?? 'unknown',
  };
};

/** Human-readable checklist block (always first in the shared text). */
export const formatColorChecklist = (checklist: ColorChecklist): string =>
  [
    `Detector input color correct? ${checklist.detectorInputColorCorrect}`,
    `Recognition input color correct? ${checklist.recognitionInputColorCorrect}`,
    `Recognition source: ${checklist.recognitionSource}`,
    `pixel format: ${checklist.pixelFormat}`,
    `channel order: ${checklist.channelOrder}`,
  ].join('\n');

export const buildDebugReport = (payload: DebugSharePayload): Record<string, unknown> => {
  const recognition = payload.images?.recognition;
  const checklist = buildColorChecklist(payload);
  return {
    generatedAt: new Date().toISOString(),
    stamp: payload.stamp ?? null,
    device: payload.deviceLine ?? null,
    // Top-level checklist — keep these names stable for offline review.
    'Detector input color correct?': checklist.detectorInputColorCorrect,
    'Recognition input color correct?': checklist.recognitionInputColorCorrect,
    'Recognition source': checklist.recognitionSource,
    'pixel format': checklist.pixelFormat,
    'channel order': checklist.channelOrder,
    preferredSource: payload.preferredSource ?? null,
    analysisLongEdge: payload.analysisLongEdge ?? null,
    colorChecklist: checklist,
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

export const formatDebugReportText = (report: Record<string, unknown>): string => {
  const checklist = report.colorChecklist as ColorChecklist | undefined;
  const header = checklist
    ? `Lugin scan debug\n${formatColorChecklist(checklist)}\n`
    : 'Lugin scan debug\n';
  return `${header}${JSON.stringify(report, null, 2)}`;
};
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

const stampSlug = (stamp?: string): string => {
  const raw = (stamp ?? new Date().toISOString()).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return raw.slice(0, 48) || 'debug';
};

const pngBase64FromPayload = (
  payload: DebugSharePayload,
): { base64: string; previewUri: string } | null => {
  const card = payload.images?.recognition;
  if (card && card.width > 0 && card.height > 0) {
    try {
      // Full card size for replay — do not shrink recognition export.
      const dataUri = scanImageToPngDataUri(card, Math.max(card.width, CARD_WIDTH));
      if (!dataUri.startsWith(PNG_PREFIX)) return null;
      return { base64: dataUri.slice(PNG_PREFIX.length), previewUri: dataUri };
    } catch {
      /* fall through */
    }
  }
  const uri = payload.images?.recognitionUri;
  if (uri?.startsWith(PNG_PREFIX)) {
    return { base64: uri.slice(PNG_PREFIX.length), previewUri: uri };
  }
  return null;
};

const writeExportFiles = async (
  payload: DebugSharePayload,
  report: Record<string, unknown>,
): Promise<{ jsonUri: string; pngUri: string | null; previewUri: string | null }> => {
  const slug = stampSlug(payload.stamp);
  const dir = new Directory(Paths.cache, 'lugin-export');
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }

  const jsonFile = new File(dir, `lugin-scan-${slug}.json`);
  if (jsonFile.exists) jsonFile.delete();
  jsonFile.create();
  jsonFile.write(JSON.stringify(report, null, 2));

  const png = pngBase64FromPayload(payload);
  if (!png) {
    return { jsonUri: jsonFile.uri, pngUri: null, previewUri: null };
  }

  const pngFile = new File(dir, `lugin-recognition-${slug}.png`);
  if (pngFile.exists) pngFile.delete();
  pngFile.create();
  pngFile.write(png.base64, { encoding: EncodingType.Base64 });

  return { jsonUri: jsonFile.uri, pngUri: pngFile.uri, previewUri: png.previewUri };
};

const tryShareFiles = async (pngUri: string | null, jsonUri: string): Promise<boolean> => {
  try {
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return false;
    // Prefer the PNG — that's what other apps (Messages, Drive, WhatsApp) expect.
    // JSON stays in cache next to it for a follow-up share if needed.
    const primary = pngUri ?? jsonUri;
    await Sharing.shareAsync(primary, {
      dialogTitle: pngUri ? 'Export Lugin recognition' : 'Export Lugin scan JSON',
      mimeType: pngUri ? 'image/png' : 'application/json',
      UTI: pngUri ? 'public.png' : 'public.json',
    });
    return true;
  } catch {
    return false;
  }
};

const trySafExport = async (
  pngBase64: string | null,
  jsonText: string,
  slug: string,
): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  try {
    const { StorageAccessFramework } = await import('expo-file-system/legacy');
    const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permissions.granted) return false;
    const dir = permissions.directoryUri;

    const jsonUri = await StorageAccessFramework.createFileAsync(
      dir,
      `lugin-scan-${slug}.json`,
      'application/json',
    );
    await StorageAccessFramework.writeAsStringAsync(jsonUri, jsonText);

    if (pngBase64) {
      const pngUri = await StorageAccessFramework.createFileAsync(
        dir,
        `lugin-recognition-${slug}.png`,
        'image/png',
      );
      await StorageAccessFramework.writeAsStringAsync(pngUri, pngBase64, {
        encoding: 'base64',
      });
    }
    return true;
  } catch {
    return false;
  }
};

export type ExportDebugResult =
  | {
      ok: true;
      /** How the files left the device. */
      method: 'sharing' | 'saf' | 'share-text';
      imageUri: string | null;
      jsonUri?: string;
      pngUri?: string | null;
      reportText: string;
    }
  | { ok: false; reason: string };

/** @deprecated Use ExportDebugResult — kept for call-site compatibility. */
export type ShareDebugResult = ExportDebugResult;

/**
 * Write recognition PNG + JSON, then open the system share sheet (or SAF).
 */
export const exportDebugBundle = async (
  payload: DebugSharePayload,
): Promise<ExportDebugResult> => {
  const report = buildDebugReport(payload);
  const reportText = formatDebugReportText(report);
  const slug = stampSlug(payload.stamp);

  let files: { jsonUri: string; pngUri: string | null; previewUri: string | null };
  try {
    files = await writeExportFiles(payload, report);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Could not write export files: ${reason}` };
  }

  if (await tryShareFiles(files.pngUri, files.jsonUri)) {
    return {
      ok: true,
      method: 'sharing',
      imageUri: files.previewUri,
      jsonUri: files.jsonUri,
      pngUri: files.pngUri,
      reportText,
    };
  }

  const png = pngBase64FromPayload(payload);
  if (await trySafExport(png?.base64 ?? null, JSON.stringify(report, null, 2), slug)) {
    return {
      ok: true,
      method: 'saf',
      imageUri: files.previewUri,
      jsonUri: files.jsonUri,
      pngUri: files.pngUri,
      reportText,
    };
  }

  // Last resort: text-only share (current behaviour on old builds).
  let text = reportText;
  if (Platform.OS === 'android' && text.length > ANDROID_MESSAGE_MAX) {
    text = `${text.slice(0, ANDROID_MESSAGE_MAX)}\n\n…truncated for Android share size limit`;
  }
  try {
    await Share.share(
      { message: text, title: 'Lugin scan debug' },
      { dialogTitle: 'Share Lugin scan debug (text only)' },
    );
    return {
      ok: true,
      method: 'share-text',
      imageUri: files.previewUri,
      jsonUri: files.jsonUri,
      pngUri: files.pngUri,
      reportText: text,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (files.previewUri) {
      return {
        ok: true,
        method: 'share-text',
        imageUri: files.previewUri,
        jsonUri: files.jsonUri,
        pngUri: files.pngUri,
        reportText: text,
      };
    }
    return { ok: false, reason };
  }
};

/** @deprecated Prefer exportDebugBundle. */
export const shareDebugBundle = exportDebugBundle;
