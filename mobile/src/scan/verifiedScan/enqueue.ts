/**
 * Normal Scan diagnostic upload — attempt-owned artifacts.
 * UI NEXT may advance immediately; metadata finalizes after terminal status.
 * Forensic overlays / recognition-quad are required for COMPLETE (dev).
 */

import { type BenchmarkUploadManifest } from '@/lib/scan/benchmarkUpload';
import {
  buildRecognitionQuadArtifact,
  type FrozenCaptureProvenance,
  type ParentSessionSummary,
} from '@/lib/scan/verifiedScan';
import { CARD_HEIGHT, CARD_WIDTH, type CardCorners, type ScanImage } from '../sharedCore';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { bytesToBase64, scanImageToArtifactPngBytes } from '../debug/scanImagePng';
import { isInboxConfigured, loadInboxSettings } from '../debugInbox/settings';
import { runBenchmarkUploadSession } from '../benchmarkUpload/session';
import { annotateSourceWithRecognitionQuad } from '../annotateQuads';
import type { NormalScanCardTelemetry } from './diagnostics';

type LegacyFS = typeof import('expo-file-system/legacy');

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export type EnqueueNormalScanResult =
  | { ok: true; runId: string }
  | { ok: false; reason: string };

const writePngFile = async (
  FileSystem: LegacyFS,
  path: string,
  bytes: Uint8Array,
): Promise<void> => {
  await FileSystem.writeAsStringAsync(path, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

/** Persist pixels early; metadata may be rewritten when terminal. */
export const persistNormalScanArtifacts = async (args: {
  runId: string;
  source: ScanImage | null;
  warp: ScanImage | null;
  titleCrop: ScanImage | null;
  recognitionQuad?: CardCorners | null;
  provenance?: FrozenCaptureProvenance | null;
  telemetry: NormalScanCardTelemetry;
  parentSummary?: ParentSessionSummary | null;
}): Promise<EnqueueNormalScanResult & { dirUri?: string }> => {
  if (!isBenchmarkToolsEnabled()) {
    return { ok: false, reason: 'benchmark tools disabled' };
  }
  await loadInboxSettings();
  if (!isInboxConfigured()) {
    return { ok: false, reason: 'inbox not paired' };
  }
  if (!args.warp) return { ok: false, reason: 'no recognition-card warp' };
  if (!args.source) return { ok: false, reason: 'no source-highres' };
  const quad = args.recognitionQuad ?? args.provenance?.projectedSourceQuad ?? null;
  if (!quad) return { ok: false, reason: 'no recognition-quad' };

  const FileSystem = await fs();
  const root = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  if (!root) return { ok: false, reason: 'no app storage' };
  const runId = args.runId.slice(0, 80);
  const dir = `${root}normal-scan/${runId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  await writePngFile(
    FileSystem,
    `${dir}recognition-card.png`,
    scanImageToArtifactPngBytes(args.warp),
  );

  await writePngFile(
    FileSystem,
    `${dir}source-highres.png`,
    scanImageToArtifactPngBytes(args.source),
  );

  // Dev forensic — exact source + projected quad. Off hot path (caller queues).
  const overlay = annotateSourceWithRecognitionQuad(args.source, quad);
  await writePngFile(
    FileSystem,
    `${dir}source-with-recognition-quad.png`,
    scanImageToArtifactPngBytes(overlay),
  );

  if (args.titleCrop) {
    await writePngFile(
      FileSystem,
      `${dir}title-crop.png`,
      scanImageToArtifactPngBytes(args.titleCrop),
    );
  }

  const provenance =
    args.provenance ??
    ({
      attemptId: args.telemetry.attemptId,
      cardSessionId: args.telemetry.cardSessionId,
      captureId: args.telemetry.captureId,
      analysisDimensions: null,
      sourceDimensions: { width: args.source.width, height: args.source.height },
      analysisQuad: null,
      projectedSourceQuad: quad,
      mappingKind: 'same-fov' as const,
      mappingVersion: 'same-fov-v1',
      warpVersion: 'warpQuadToCard-v1',
      capturePipelineVersion: 'geometry-v2',
      orientation: null,
      rotation: null,
      mirror: false,
      quadSelectionSource: 'OTHER' as const,
      candidateScore: null,
      captureSafe: null,
      selectedQuadAt: null,
      captureRequestedAt: args.telemetry.timing.captureRequestedAt,
      captureDoneAt: args.telemetry.timing.captureDoneAt,
      sourceAvailableAt: args.telemetry.timing.captureDoneAt,
      warpStartedAt: args.telemetry.timing.warpStartedAt,
      warpDoneAt: args.telemetry.timing.warpDoneAt,
      quadAgeAtCaptureMs: null,
      captureLatencyMs: null,
      sourceVsQuadAgeMs: null,
      warpInputStatus: 'OK' as const,
      warpSuspectStatus: 'OK' as const,
      warpSuspectReasons: [],
      geometryFailureClass: 'UNKNOWN' as const,
    } satisfies FrozenCaptureProvenance);

  await FileSystem.writeAsStringAsync(
    `${dir}recognition-quad.json`,
    JSON.stringify(buildRecognitionQuadArtifact(provenance), null, 2),
  );

  await FileSystem.writeAsStringAsync(
    `${dir}metadata.json`,
    JSON.stringify(
      {
        kind: 'normal-scan',
        ...args.telemetry,
        provenance,
        parentSummary: args.parentSummary ?? null,
        artifactNotes: {
          recognitionCard: `${CARD_WIDTH}x${CARD_HEIGHT}`,
          sourceWidth: args.source.width,
          sourceHeight: args.source.height,
          titleCropPresent: Boolean(args.titleCrop),
          recognitionQuadPresent: true,
          sourceWithQuadPresent: true,
        },
      },
      null,
      2,
    ),
  );

  return { ok: true, runId, dirUri: dir };
};

export const enqueueNormalScanDiagnostic = async (args: {
  source: ScanImage | null;
  warp: ScanImage | null;
  titleCrop: ScanImage | null;
  recognitionQuad?: CardCorners | null;
  provenance?: FrozenCaptureProvenance | null;
  telemetry: NormalScanCardTelemetry;
  parentSummary?: ParentSessionSummary | null;
  uploadNow?: boolean;
}): Promise<EnqueueNormalScanResult> => {
  const runId = `${args.telemetry.parentSessionId}--${args.telemetry.childId}`.slice(0, 80);
  const persisted = await persistNormalScanArtifacts({
    runId,
    source: args.source,
    warp: args.warp,
    titleCrop: args.titleCrop,
    recognitionQuad: args.recognitionQuad ?? null,
    provenance: args.provenance ?? args.telemetry.provenance ?? null,
    telemetry: args.telemetry,
    parentSummary: args.parentSummary,
  });
  if (!persisted.ok || !persisted.dirUri) return persisted;

  if (args.uploadNow === false) {
    return { ok: true, runId: persisted.runId };
  }

  const requireTitle =
    Boolean(args.titleCrop) ||
    args.telemetry.terminalStatus === 'FOUND' ||
    args.telemetry.terminalStatus === 'AMBIGUOUS' ||
    args.telemetry.terminalStatus === 'NO_MATCH' ||
    args.telemetry.terminalStatus === 'OCR_ERROR' ||
    args.telemetry.ocr.ocrRawText != null;

  const files: { relativePath: string; required: boolean; role?: BenchmarkUploadManifest['files'][0]['role'] }[] = [
    { relativePath: 'metadata.json', required: true, role: 'metadata' },
    { relativePath: 'recognition-card.png', required: true, role: 'card-warp' },
    { relativePath: 'source-highres.png', required: true, role: 'source' },
    { relativePath: 'source-with-recognition-quad.png', required: true, role: 'source' },
    { relativePath: 'recognition-quad.json', required: true, role: 'quad' },
  ];
  if (requireTitle || args.titleCrop) {
    files.push({ relativePath: 'title-crop.png', required: true, role: 'title-crop' });
  }

  const manifest: BenchmarkUploadManifest = {
    runId: persisted.runId,
    kind: 'normal-scan',
    files: files.map(f => ({
      ...f,
      logicalWidth: f.relativePath === 'recognition-card.png' ? CARD_WIDTH : null,
      logicalHeight: f.relativePath === 'recognition-card.png' ? CARD_HEIGHT : null,
    })),
    createdAt: new Date().toISOString(),
  };

  void runBenchmarkUploadSession({
    manifest,
    dirUri: persisted.dirUri,
  }).catch(() => {
    /* retry via Pending uploads */
  });

  return { ok: true, runId: persisted.runId };
};

export const finalizeNormalScanDiagnostic = async (args: {
  source: ScanImage;
  warp: ScanImage;
  titleCrop: ScanImage | null;
  recognitionQuad?: CardCorners | null;
  provenance?: FrozenCaptureProvenance | null;
  telemetry: NormalScanCardTelemetry;
  parentSummary?: ParentSessionSummary | null;
}): Promise<EnqueueNormalScanResult> =>
  enqueueNormalScanDiagnostic({
    ...args,
    uploadNow: true,
  });
