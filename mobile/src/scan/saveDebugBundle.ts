// Prepare recognition preview + slim JSON for on-screen report, then Share
// or Download on demand.
//
// Android Binder rejects multi‑MB native writes, so we share a slim report and a
// downscaled PNG. Full-resolution pixels stay on-screen for inspection.
// Prefer expo-sharing (share sheet → ChatGPT / Drive / Messages). Never auto-open
// the share sheet from prepare — that skipped chat pickers and felt like an
// accidental export.

import { Platform, Share } from 'react-native';

import { pixelOrderFor } from './frameToScanImage';
import { CARD_HEIGHT, CARD_WIDTH, type ScanImage } from './sharedCore';
import { scanImageToPngBytes, scanImageToPngDataUri } from './debug/scanImagePng';

export interface DebugShareImages {
  /** Exact ScanImage fed to detectCardQuad (preferred for detector color). */
  detector?: ScanImage | null;
  detectorUri?: string | null;
  hiresUri?: string | null;
  recognition?: ScanImage | null;
  recognitionUri?: string | null;
}

export interface DebugSharePayload {
  analysisLongEdge?: number;
  appStamp?: string | null;
  detectorEngine?: string | null;
  detectorInputColorCorrect?: 'yes' | 'no' | 'unverified';
  deviceLine?: string;
  images?: DebugShareImages;
  ocrEngine?: string | null;
  panel: Record<string, unknown>;
  pixelFormat?: string | null;
  preferredSource?: string;
  recognitionInputColorCorrect?: 'yes' | 'no' | 'unverified';
  recognitionSource?: string | null;
  stamp?: string;
}

export interface ColorChecklist {
  channelOrder: string;
  detectorInputColorCorrect: 'yes' | 'no' | 'unverified';
  pixelFormat: string;
  recognitionInputColorCorrect: 'yes' | 'no' | 'unverified';
  recognitionSource: string;
}

/** Keep share payloads under Android Binder (~1 MB). */
const ANDROID_MESSAGE_MAX = 700_000;
/**
 * Share / download recognition PNG long edge.
 * Encoder is uncompressed; Binder ~1MB caps full 744×1039. 520 keeps title
 * readable on Samsung exports. On-screen modal may still show a larger data URI.
 */
const SHARE_PNG_MAX_WIDTH = 520;
/** Detector analysis FOV can stay smaller. */
const DETECTOR_SHARE_PNG_MAX_WIDTH = 420;

export const recognitionSourceLabel = (mode?: string | null): string => {
  if (!mode) return 'unknown';
  if (mode === 'analysis-fallback') return 'fallback';
  return mode;
};

const pixelFormatFromPanel = (panel: Record<string, unknown>): string | null => {
  const meta = panel.frameMeta as { pixelFormat?: string } | null | undefined;
  return meta?.pixelFormat ?? null;
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

export const formatColorChecklist = (checklist: ColorChecklist): string =>
  [
    `Detector input color correct? ${checklist.detectorInputColorCorrect}`,
    `Recognition input color correct? ${checklist.recognitionInputColorCorrect}`,
    `Recognition source: ${checklist.recognitionSource}`,
    `pixel format: ${checklist.pixelFormat}`,
    `channel order: ${checklist.channelOrder}`,
  ].join('\n');

/** Slim report for share files — omits the huge live panel dump. */
export const buildDebugReport = (payload: DebugSharePayload): Record<string, unknown> => {
  const recognition = payload.images?.recognition;
  const checklist = buildColorChecklist(payload);
  const session = payload.panel.session as Record<string, unknown> | null | undefined;
  const snapshot = payload.panel.snapshot as Record<string, unknown> | null | undefined;
  const frameMeta = payload.panel.frameMeta as Record<string, unknown> | null | undefined;
  const recognitionSnap = snapshot?.recognition as Record<string, unknown> | null | undefined;
  const timings = (recognitionSnap?.timings as Record<string, unknown> | null | undefined) ?? null;
  const titleCandidates = recognitionSnap?.titleCandidates ?? null;
  const readings = recognitionSnap?.readings ?? null;
  const visualTop = recognitionSnap?.visualTop ?? null;
  const fused = snapshot?.fused as Record<string, unknown> | null | undefined;
  const printing = (fused?.printing as Record<string, unknown> | null | undefined) ?? null;
  const collector = (recognitionSnap?.collector as Record<string, unknown> | null | undefined) ?? null;
  const printingLookup =
    (recognitionSnap?.printingLookup as Record<string, unknown> | null | undefined) ?? null;
  const userLatency = (snapshot?.userLatency as Record<string, unknown> | null | undefined) ??
    (session?.userLatency as Record<string, unknown> | null | undefined) ??
    null;

  const top5 = (list: unknown, scoreKey: string): unknown[] | null => {
    if (!Array.isArray(list)) return null;
    return list.slice(0, 5).map((c: Record<string, unknown>) => ({
      name: c.name ?? null,
      score: c[scoreKey] ?? c.score ?? null,
      oracleId: c.oracleId ?? null,
      scryfallId: c.scryfallId ?? null,
      lang: c.lang ?? null,
      finishes: c.finishes ?? null,
    }));
  };

  const finishes = (printing?.finishes as string[] | undefined) ?? null;
  const finishMeta =
    finishes?.length === 1
      ? { finish: finishes[0], confidence: 1, source: 'metadata' }
      : finishes && finishes.length > 1
        ? { finish: 'unknown', confidence: 0, source: 'needs-visual', supported: finishes }
        : { finish: 'unknown', confidence: 0, source: 'unresolved' };

  return {
    generatedAt: new Date().toISOString(),
    stamp: payload.stamp ?? null,
    appStamp: payload.appStamp ?? null,
    device: payload.deviceLine ?? null,
    detectorEngine: payload.detectorEngine ?? null,
    detectorLatencyMs:
      (payload.panel.result as { detector?: { ms?: number } } | null | undefined)?.detector?.ms ??
      timings?.detectMs ??
      null,
    ocrEngine: payload.ocrEngine ?? null,
    'Detector input color correct?': checklist.detectorInputColorCorrect,
    'Recognition input color correct?': checklist.recognitionInputColorCorrect,
    'Recognition source': checklist.recognitionSource,
    'pixel format': checklist.pixelFormat,
    'channel order': checklist.channelOrder,
    preferredSource: payload.preferredSource ?? null,
    analysisLongEdge: payload.analysisLongEdge ?? null,
    colorChecklist: checklist,
    TITLE: {
      cropDimensions: 'profile.title regions (normalized 744×1039)',
      rawOcr: readings,
      normalizedReading: Array.isArray(readings)
        ? (readings as { text?: string }[]).map(r => r.text).filter(Boolean)
        : null,
      topLocalCandidates: top5(titleCandidates, 'score'),
      titleMs: timings?.titleMs ?? null,
      titleDoneAt: timings?.titleDoneAt ?? null,
    },
    FOOTER: {
      cropDimensions: 'profile.collector regions (set-symbol + collector)',
      rawOcr: collector?.raw ?? null,
      parsedSetCode: collector?.setCode ?? null,
      parsedCollectorNumber: collector?.collectorNumber ?? null,
      parseConfidence: collector ? 'parsed' : 'missing',
      printingIndexCandidateCount: Array.isArray(printingLookup?.candidates)
        ? (printingLookup!.candidates as unknown[]).length
        : null,
      topPrintingCandidates: top5(printingLookup?.candidates ?? null, 'confidence'),
      footerMs: timings?.footerMs ?? null,
      footerLookupMs: timings?.footerLookupMs ?? null,
      footerDoneAt: timings?.footerDoneAt ?? null,
    },
    ART: {
      mode: recognitionSnap?.artMode ?? timings?.artMode ?? null,
      indexTotal:
        (session?.art as { entries?: number } | null | undefined)?.entries ??
        (session?.artEntries as number | null | undefined) ??
        null,
      candidatePool: Array.isArray(visualTop) ? visualTop.length : null,
      topMatches: top5(visualTop, 'visualScore'),
      artworkMs: timings?.artworkMs ?? null,
      artworkDescriptorMs: timings?.artworkDescriptorMs ?? null,
      artworkMatcherMs: timings?.artworkMatcherMs ?? null,
      artDoneAt: timings?.artDoneAt ?? null,
    },
    FUSION: {
      firstIdentitySource: recognitionSnap?.earlyReason ?? session?.earlyReason ?? null,
      decisionReason: fused?.reason ?? recognitionSnap?.earlyReason ?? null,
      agreementConflict: recognitionSnap?.titleFooterConflict ?? null,
      status: fused?.status ?? null,
      name: (fused?.card as { name?: string } | null | undefined)?.name ?? printing?.name ?? null,
      oracleId: (fused?.card as { oracleId?: string } | null | undefined)?.oracleId ?? null,
      printing: printing
        ? {
            setCode: printing.setCode ?? null,
            collectorNumber: printing.collectorNumber ?? null,
            scryfallId: printing.scryfallId ?? null,
            lang: printing.lang ?? null,
          }
        : null,
      firstOraclePublishTimestamp: snapshot?.earlyShownAt ?? null,
      printingPublishTimestamp: snapshot?.printingShownAt ?? null,
      lockToOracleTiming: userLatency,
    },
    FINISH: {
      supportedFinishesFromMetadata: finishes,
      visualResult: finishMeta.finish,
      confidence: finishMeta.confidence,
      observationsFrameCount: 0,
      note: 'metadata-first; visual foil classifier is unknown stub',
    },
    DATA: {
      cardNameIndex: {
        count: (session?.namesCount as number | null | undefined) ??
          (session?.names as { names?: number } | null | undefined)?.names ??
          null,
        checksum: (session?.namesChecksum as string | null | undefined) ?? null,
      },
      printingIndex: {
        count: (session?.printingEntries as number | null | undefined) ?? null,
        checksum: (session?.printingChecksum as string | null | undefined) ?? null,
      },
      artworkIndex: {
        entries:
          (session?.art as { entries?: number } | null | undefined)?.entries ??
          (session?.artEntries as number | null | undefined) ??
          null,
        generated:
          (session?.artGenerated as string | null | undefined) ??
          (session?.art as { generated?: string } | null | undefined)?.generated ??
          null,
        checksum: (session?.artChecksum as string | null | undefined) ?? null,
        uniqueOracles: (session?.artUniqueOracles as number | null | undefined) ?? null,
      },
    },
    // Legacy flat fields kept for older parsers.
    artIndex: {
      entries:
        (session?.art as { entries?: number } | null | undefined)?.entries ??
        (session?.artEntries as number | null | undefined) ??
        null,
      generated:
        (session?.artGenerated as string | null | undefined) ??
        (session?.art as { generated?: string } | null | undefined)?.generated ??
        null,
      checksum: (session?.artChecksum as string | null | undefined) ?? null,
      uniqueOracles: (session?.artUniqueOracles as number | null | undefined) ?? null,
    },
    sourceDimensions: {
      width: (session?.sourceWidth as number | null | undefined) ?? null,
      height: (session?.sourceHeight as number | null | undefined) ?? null,
      recognition:
        recognition && recognition.width === CARD_WIDTH && recognition.height === CARD_HEIGHT
          ? { width: CARD_WIDTH, height: CARD_HEIGHT }
          : null,
    },
    rawTitleOcr: readings,
    titleCandidateTop5: top5(titleCandidates, 'score'),
    artworkCandidateTop5: top5(visualTop, 'visualScore'),
    earlyDecisionReason:
      (recognitionSnap?.earlyReason as string | null | undefined) ??
      (session?.earlyReason as string | null | undefined) ??
      (timings?.earlyReason as string | null | undefined) ??
      null,
    finalFusionDecision: fused
      ? {
          status: fused.status ?? null,
          name: (fused.card as { name?: string } | null | undefined)?.name ?? null,
          oracleId: (fused.card as { oracleId?: string } | null | undefined)?.oracleId ?? null,
          printing:
            (fused.card as { setCode?: string; collectorNumber?: string } | null | undefined) ??
            printing ??
            null,
          reason: fused.reason ?? null,
        }
      : null,
    lockToOracleTiming: userLatency,
    recognitionTimings: timings,
    frameMeta: frameMeta
      ? {
          bytesKind: frameMeta.bytesKind ?? null,
          height: frameMeta.height ?? null,
          pixelFormat: frameMeta.pixelFormat ?? null,
          width: frameMeta.width ?? null,
        }
      : null,
    session: session
      ? {
          artEntries:
            (session.art as { entries?: number } | null | undefined)?.entries ??
            (session.artEntries as number | null | undefined) ??
            null,
          artGenerated:
            (session.artGenerated as string | null | undefined) ??
            (session.art as { generated?: string } | null | undefined)?.generated ??
            null,
          printingEntries: session.printingEntries ?? null,
          artworkDescriptorMs: session.artworkDescriptorMs ?? null,
          artworkMatcherMs: session.artworkMatcherMs ?? null,
          artworkMs: session.artworkMs ?? null,
          hiresPhase: session.hiresPhase ?? null,
          phase: session.phase ?? null,
          recognitionSource: session.recognitionSource ?? null,
          sourceHeight: session.sourceHeight ?? null,
          sourceLabel: session.sourceLabel ?? null,
          sourceWidth: session.sourceWidth ?? null,
          earlyReason: session.earlyReason ?? null,
          userLatency: session.userLatency ?? null,
        }
      : null,
    snapshot: snapshot
      ? {
          fused: snapshot.fused ?? null,
          message: snapshot.message ?? null,
          phase: snapshot.phase ?? null,
          recognitionTimings: timings,
          visualTop: visualTop,
          titleCandidates: titleCandidates,
          earlyReason: recognitionSnap?.earlyReason ?? null,
          printing: printing,
          collector: collector,
          printingLookup: printingLookup,
          titleFooterConflict: recognitionSnap?.titleFooterConflict ?? null,
          artMode: recognitionSnap?.artMode ?? null,
          userLatency: snapshot.userLatency ?? null,
          lockedAt: snapshot.lockedAt ?? null,
          earlyShownAt: snapshot.earlyShownAt ?? null,
          finalIdentityAt: snapshot.finalIdentityAt ?? null,
          printingShownAt: snapshot.printingShownAt ?? null,
        }
      : null,
    images: {
      detectorInput: Boolean(payload.images?.detector || payload.images?.detectorUri),
      detectorPreview: Boolean(payload.images?.detectorUri),
      hiresPreview: Boolean(payload.images?.hiresUri),
      recognition:
        recognition && recognition.width === CARD_WIDTH && recognition.height === CARD_HEIGHT
          ? { height: CARD_HEIGHT, width: CARD_WIDTH, fullQuality: true }
          : payload.images?.recognitionUri
            ? { encodedPreview: true }
            : null,
      sharePngMaxWidth: SHARE_PNG_MAX_WIDTH,
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
  const raw = (stamp ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).replace(
    /[^a-zA-Z0-9._-]+/g,
    '-',
  );
  return raw.slice(0, 48) || 'debug';
};

/** Snapshot pixels so a later frame cannot mutate the export buffer. */
export const cloneScanImage = (image: ScanImage): ScanImage => ({
  data: new Uint8ClampedArray(image.data),
  height: image.height,
  width: image.width,
});

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

const recognitionPreviewUri = (payload: DebugSharePayload): string | null => {
  const card = payload.images?.recognition;
  if (card && card.width > 0 && card.height > 0) {
    try {
      return scanImageToPngDataUri(card, 520);
    } catch {
      /* fall through */
    }
  }
  // Do not fall back to a stale debug-panel URI — that caused "same image" on
  // the second report when lastNormalized briefly looked empty.
  return null;
};

const detectorPreviewUri = (payload: DebugSharePayload): string | null => {
  const det = payload.images?.detector;
  if (det && det.width > 0 && det.height > 0) {
    try {
      return scanImageToPngDataUri(det, 420);
    } catch {
      /* fall through */
    }
  }
  return null;
};

const sharePngBytes = (image: ScanImage | null | undefined, maxWidth: number): Uint8Array | null => {
  if (!image || image.width <= 0 || image.height <= 0) return null;
  try {
    return scanImageToPngBytes(image, maxWidth);
  } catch {
    return null;
  }
};

const writePngFile = async (
  FileSystem: typeof import('expo-file-system/legacy'),
  uri: string,
  bytes: Uint8Array,
): Promise<void> => {
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), { encoding: 'base64' });
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || (info.size ?? 0) < 32) {
    throw new Error(`PNG export file is empty after write: ${uri}`);
  }
};

/** Write slim JSON + report.txt + recognition PNG + detector PNG into cache. */
const writeShareFiles = async (
  payload: DebugSharePayload,
  report: Record<string, unknown>,
  reportText: string,
): Promise<{
  detectorPngUri: string | null;
  jsonUri: string;
  pngUri: string | null;
  reportUri: string;
  slug: string;
}> => {
  const FileSystem = await import('expo-file-system/legacy');
  const root = FileSystem.cacheDirectory;
  if (!root) throw new Error('cacheDirectory unavailable');

  const slug = stampSlug(payload.stamp);
  const dir = `${root}lugin-export/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const jsonUri = `${dir}lugin-scan-${slug}.json`;
  const jsonText = JSON.stringify(report, null, 2);
  await FileSystem.writeAsStringAsync(jsonUri, jsonText);

  const info = await FileSystem.getInfoAsync(jsonUri);
  if (!info.exists || (info.size ?? 0) < 8) {
    throw new Error('JSON export file is empty after write');
  }

  const reportUri = `${dir}lugin-scan-${slug}.txt`;
  await FileSystem.writeAsStringAsync(reportUri, reportText);
  const reportInfo = await FileSystem.getInfoAsync(reportUri);
  if (!reportInfo.exists || (reportInfo.size ?? 0) < 8) {
    throw new Error('Report text file is empty after write');
  }

  let pngUri: string | null = null;
  const recBytes = sharePngBytes(payload.images?.recognition, SHARE_PNG_MAX_WIDTH);
  if (recBytes && recBytes.length > 0) {
    pngUri = `${dir}lugin-recognition-${slug}.png`;
    await writePngFile(FileSystem, pngUri, recBytes);
  }

  let detectorPngUri: string | null = null;
  const detBytes = sharePngBytes(payload.images?.detector, DETECTOR_SHARE_PNG_MAX_WIDTH);
  if (detBytes && detBytes.length > 0) {
    detectorPngUri = `${dir}lugin-detector-${slug}.png`;
    await writePngFile(FileSystem, detectorPngUri, detBytes);
  }

  return { detectorPngUri, jsonUri, pngUri, reportUri, slug };
};

export type PreparedDebugBundle = {
  detectorImageUri: string | null;
  detectorPngUri: string | null;
  imageUri: string | null;
  jsonUri: string | null;
  pngUri: string | null;
  reportText: string;
  reportUri: string | null;
  slug: string;
};

export type PrepareDebugResult =
  | { ok: true; bundle: PreparedDebugBundle }
  | { ok: false; reason: string };

const freezePayloadImages = (payload: DebugSharePayload): DebugSharePayload => {
  const images = payload.images;
  if (!images) return payload;
  return {
    ...payload,
    images: {
      ...images,
      detector: images.detector ? cloneScanImage(images.detector) : images.detector,
      recognition: images.recognition ? cloneScanImage(images.recognition) : images.recognition,
    },
    stamp: payload.stamp ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
};

/** Build report + cache files. Does not open any share UI. */
export const prepareDebugBundle = async (
  payload: DebugSharePayload,
): Promise<PrepareDebugResult> => {
  const frozen = freezePayloadImages(payload);
  const report = buildDebugReport(frozen);
  const reportText = formatDebugReportText(report);
  const previewUri = recognitionPreviewUri(frozen);
  const detectorUri = detectorPreviewUri(frozen);

  try {
    const files = await writeShareFiles(frozen, report, reportText);
    return {
      ok: true,
      bundle: {
        detectorImageUri: detectorUri,
        detectorPngUri: files.detectorPngUri,
        imageUri: previewUri,
        jsonUri: files.jsonUri,
        pngUri: files.pngUri,
        reportText,
        reportUri: files.reportUri,
        slug: files.slug,
      },
    };
  } catch {
    // Still show the on-screen report; Share/Download need files and will say so.
    return {
      ok: true,
      bundle: {
        detectorImageUri: detectorUri,
        detectorPngUri: null,
        imageUri: previewUri,
        jsonUri: null,
        pngUri: null,
        reportText,
        reportUri: null,
        slug: stampSlug(frozen.stamp),
      },
    };
  }
};

export type SharePreparedResult =
  | { ok: true; method: 'sharing' | 'share-text'; shareError?: string }
  | { ok: false; reason: string };

const shareTextFallback = async (
  reportText: string,
  shareError?: string,
): Promise<SharePreparedResult> => {
  let text = reportText;
  if (Platform.OS === 'android' && text.length > ANDROID_MESSAGE_MAX) {
    text = `${text.slice(0, ANDROID_MESSAGE_MAX)}\n\n…truncated`;
  }
  try {
    await Share.share(
      { message: text, title: 'Lugin scan debug' },
      { dialogTitle: 'Share Lugin scan report (text)' },
    );
    return { ok: true, method: 'share-text', shareError };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: shareError ? `Share failed (${shareError}); text share failed (${reason})` : reason,
    };
  }
};

/**
 * Share report text, then recognition PNG, then detector-input PNG.
 * expo-sharing only accepts one file per sheet.
 */
export const sharePreparedBundle = async (
  bundle: PreparedDebugBundle,
): Promise<SharePreparedResult> => {
  const textFile = bundle.reportUri ?? bundle.jsonUri;
  try {
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) {
      return shareTextFallback(bundle.reportText, 'expo-sharing is not available in this APK');
    }

    if (textFile) {
      await Sharing.shareAsync(textFile, {
        dialogTitle: 'Share Lugin report (text)',
        mimeType: bundle.reportUri ? 'text/plain' : 'application/json',
        UTI: bundle.reportUri ? 'public.plain-text' : 'public.json',
      });
    } else {
      const textOnly = await shareTextFallback(bundle.reportText);
      if (!textOnly.ok) return textOnly;
    }

    if (bundle.pngUri) {
      await Sharing.shareAsync(bundle.pngUri, {
        dialogTitle: 'Share recognition image',
        mimeType: 'image/png',
        UTI: 'public.png',
      });
    }

    if (bundle.detectorPngUri) {
      await Sharing.shareAsync(bundle.detectorPngUri, {
        dialogTitle: 'Share detector input image',
        mimeType: 'image/png',
        UTI: 'public.png',
      });
    }

    const anyFile = Boolean(textFile || bundle.pngUri || bundle.detectorPngUri);
    return {
      ok: true,
      method: anyFile ? 'sharing' : 'share-text',
      shareError:
        bundle.detectorPngUri || bundle.pngUri
          ? undefined
          : 'Shared report only — no PNG files',
    };
  } catch (err) {
    const shareError = err instanceof Error ? err.message : String(err);
    return shareTextFallback(bundle.reportText, shareError);
  }
};

export type DownloadPreparedResult =
  | { ok: true; method: 'saf' | 'documents'; directoryHint: string; saved: string[] }
  | { ok: false; reason: string; cancelled?: boolean };

const readFileBase64 = async (uri: string): Promise<string> => {
  const FileSystem = await import('expo-file-system/legacy');
  return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
};

const utf8ToBase64 = (text: string): string => bytesToBase64(new TextEncoder().encode(text));

/** Save prepared PNG + report text (+ JSON) to a user-picked folder. */
export const downloadPreparedBundle = async (
  bundle: PreparedDebugBundle,
): Promise<DownloadPreparedResult> => {
  if (!bundle.jsonUri && !bundle.pngUri && !bundle.detectorPngUri && !bundle.reportUri && !bundle.reportText) {
    return { ok: false, reason: 'Nothing to download — prepare the report again after a lock' };
  }

  const FileSystem = await import('expo-file-system/legacy');
  const slug = bundle.slug || 'debug';
  const saved: string[] = [];

  const writeSafText = async (dir: string, name: string, mime: string, text: string) => {
    const dest = await FileSystem.StorageAccessFramework.createFileAsync(dir, name, mime);
    await FileSystem.writeAsStringAsync(dest, utf8ToBase64(text), { encoding: 'base64' });
    saved.push(name);
  };

  const writeSafPng = async (dir: string, name: string, fromUri: string) => {
    const dest = await FileSystem.StorageAccessFramework.createFileAsync(dir, name, 'image/png');
    const b64 = await readFileBase64(fromUri);
    await FileSystem.writeAsStringAsync(dest, b64, { encoding: 'base64' });
    saved.push(name);
  };

  if (Platform.OS === 'android' && FileSystem.StorageAccessFramework) {
    try {
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        return { ok: false, reason: 'Folder picker cancelled', cancelled: true };
      }
      const dir = permissions.directoryUri;

      // Text first so a folder listing shows the report even if image write fails later.
      if (bundle.reportText) {
        await writeSafText(dir, `lugin-scan-${slug}.txt`, 'text/plain', bundle.reportText);
      } else if (bundle.reportUri) {
        const text = await FileSystem.readAsStringAsync(bundle.reportUri);
        await writeSafText(dir, `lugin-scan-${slug}.txt`, 'text/plain', text);
      }

      if (bundle.jsonUri) {
        const text = await FileSystem.readAsStringAsync(bundle.jsonUri);
        await writeSafText(dir, `lugin-scan-${slug}.json`, 'application/json', text);
      } else if (bundle.reportText) {
        // Ensure JSON exists even when cache write failed earlier.
        const report = { note: 'rebuilt from on-screen report', reportText: bundle.reportText };
        await writeSafText(
          dir,
          `lugin-scan-${slug}.json`,
          'application/json',
          JSON.stringify(report, null, 2),
        );
      }

      if (bundle.pngUri) {
        await writeSafPng(dir, `lugin-recognition-${slug}.png`, bundle.pngUri);
      }

      if (bundle.detectorPngUri) {
        await writeSafPng(dir, `lugin-detector-${slug}.png`, bundle.detectorPngUri);
      }

      if (saved.length === 0) {
        return { ok: false, reason: 'No files were written' };
      }
      return { ok: true, method: 'saf', directoryHint: 'chosen folder', saved };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  // iOS / fallback: copy into app documents (Files app → On My iPhone → Lugin).
  try {
    const root = FileSystem.documentDirectory;
    if (!root) return { ok: false, reason: 'documentDirectory unavailable' };
    const dir = `${root}lugin-export/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const txtPath = `${dir}lugin-scan-${slug}.txt`;
    await FileSystem.writeAsStringAsync(txtPath, bundle.reportText);
    saved.push(`lugin-scan-${slug}.txt`);

    if (bundle.jsonUri) {
      await FileSystem.copyAsync({
        from: bundle.jsonUri,
        to: `${dir}lugin-scan-${slug}.json`,
      });
      saved.push(`lugin-scan-${slug}.json`);
    }
    if (bundle.pngUri) {
      await FileSystem.copyAsync({
        from: bundle.pngUri,
        to: `${dir}lugin-recognition-${slug}.png`,
      });
      saved.push(`lugin-recognition-${slug}.png`);
    }
    if (bundle.detectorPngUri) {
      await FileSystem.copyAsync({
        from: bundle.detectorPngUri,
        to: `${dir}lugin-detector-${slug}.png`,
      });
      saved.push(`lugin-detector-${slug}.png`);
    }
    return { ok: true, method: 'documents', directoryHint: 'Documents/lugin-export', saved };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};

export type ExportDebugResult =
  | {
      ok: true;
      method: 'sharing' | 'share-text' | 'prepared';
      imageUri: string | null;
      jsonUri?: string | null;
      pngUri?: string | null;
      reportText: string;
      shareError?: string;
    }
  | { ok: false; reason: string };

/** @deprecated Use ExportDebugResult */
export type ShareDebugResult = ExportDebugResult;

/**
 * @deprecated Prefer prepareDebugBundle + sharePreparedBundle so the UI can
 * show the report before opening a share sheet.
 */
export const exportDebugBundle = async (
  payload: DebugSharePayload,
): Promise<ExportDebugResult> => {
  const prepared = await prepareDebugBundle(payload);
  if (!prepared.ok) return prepared;
  const shared = await sharePreparedBundle(prepared.bundle);
  if (!shared.ok) {
    return {
      ok: true,
      method: 'prepared',
      imageUri: prepared.bundle.imageUri,
      jsonUri: prepared.bundle.jsonUri,
      pngUri: prepared.bundle.pngUri,
      reportText: prepared.bundle.reportText,
      shareError: shared.reason,
    };
  }
  return {
    ok: true,
    method: shared.method,
    imageUri: prepared.bundle.imageUri,
    jsonUri: prepared.bundle.jsonUri,
    pngUri: prepared.bundle.pngUri,
    reportText: prepared.bundle.reportText,
    shareError: shared.shareError,
  };
};

/** @deprecated Prefer prepareDebugBundle. */
export const shareDebugBundle = exportDebugBundle;
