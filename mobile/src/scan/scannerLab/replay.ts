// Phone-side lab runner: load fixture, run baseline + current, persist images.

import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';
import { createSessionController } from '../sharedCore';
import { runLabRecognition } from '@/lib/scan/scannerLab/run';
import { compareLabRuns, type LabRunResult } from '@/lib/scan/scannerLab/types';
import type { CardNameIndex } from '../sharedCore';
import { bytesToBase64, scanImageToPngBytes, scanImageToPngDataUri } from '../debug/scanImagePng';
import {
  getOrCreateLegacyOcrRecognizer,
  getOrCreateOcrRecognizer,
  getOcrAdapterSnapshot,
} from '../ocrAdapter';
import { loadLastLiveAttempt, type LastLiveAttempt } from './lastLive';
import { loadLabFixture, type LabFixture } from './store';

export interface LabTableRow {
  cropUri: string | null;
  enhance: string;
  error: string | null;
  match: string;
  ocr: string;
  path: string;
  text: string;
  timeMs: number;
  warp: string;
  warpUri: string | null;
}

const writeRunPng = async (path: string, image: NonNullable<LabRunResult['images']>['warp']) => {
  const FileSystem = await import('expo-file-system/legacy');
  await FileSystem.writeAsStringAsync(path, bytesToBase64(scanImageToPngBytes(image, image.width)), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

export const runFixtureAb = async (args: {
  fixtureId: string;
  nameIndex: CardNameIndex | null;
}): Promise<{
  baseline: LabRunResult;
  compare: ReturnType<typeof compareLabRuns>;
  current: LabRunResult;
  fixture: LabFixture;
  json: Record<string, unknown>;
  rows: LabTableRow[];
}> => {
  const fixture = await loadLabFixture(args.fixtureId);
  if (!fixture) throw new Error(`fixture not found: ${args.fixtureId}`);
  const currentOcr = getOrCreateOcrRecognizer();
  const legacyOcr = getOrCreateLegacyOcrRecognizer();
  const baselineOcr = legacyOcr ?? currentOcr;
  const source = fixture.source;
  const quads = fixture.meta.quads;

  const baseline = await runLabRecognition({
    nameIndex: args.nameIndex,
    ocr: baselineOcr,
    pipeline: 'baseline',
    quads,
    source,
  });
  const current = await runLabRecognition({
    nameIndex: args.nameIndex,
    ocr: currentOcr,
    pipeline: 'current',
    quads,
    source,
  });
  const FileSystem = await import('expo-file-system/legacy');
  const dir = fixture.dirUri;
  if (baseline.images) {
    await writeRunPng(`${dir}baseline-warp.png`, baseline.images.warp);
    await writeRunPng(`${dir}title-crop-baseline.png`, baseline.images.titleRaw);
  }
  if (current.images) {
    await writeRunPng(`${dir}current-warp.png`, current.images.warp);
    await writeRunPng(`${dir}title-crop-current.png`, current.images.titleRaw);
  }
  const compare = compareLabRuns(baseline, current);
  const json = {
    adapter: getOcrAdapterSnapshot(),
    baseline: { ...baseline, images: undefined },
    compare,
    current: { ...current, images: undefined },
    fixtureId: fixture.meta.fixtureId,
    knownGood: '1dd4932 diagnostic only',
    provenBaseline: 'current',
    sameSource: true,
    sessionController: false,
  };
  await FileSystem.writeAsStringAsync(`${dir}lab-compare.json`, JSON.stringify(json, null, 2));
  const row = (label: string, run: LabRunResult, warp: string, enhance: string): LabTableRow => ({
    cropUri: run.images ? scanImageToPngDataUri(run.images.titleRaw, 240) : null,
    enhance,
    error: run.error,
    match: run.matchName ?? 'none',
    ocr: run.ocrTransport,
    path: label,
    text: run.ocrText || '(empty)',
    timeMs: Math.round(run.timings.totalMs),
    warp,
    warpUri: run.images ? scanImageToPngDataUri(run.images.warp, 160) : null,
  });
  return {
    baseline,
    compare,
    current,
    fixture,
    json,
    rows: [
      row('Baseline (diagnostic)', baseline, 'tracked/lock', 'enhanceForOcr'),
      row('Current (proven)', current, 'recognitionQuad', 'enhanceForOcrFast'),
    ],
  };
};

export const replayLastLiveAttempt = async (args: {
  nameIndex: CardNameIndex | null;
}): Promise<{
  json: Record<string, unknown>;
  live: LastLiveAttempt['meta']['live'] | null;
  replay: Awaited<ReturnType<typeof recognizeCapturedCard>> | null;
  rows: LabTableRow[];
}> => {
  const last = await loadLastLiveAttempt();
  if (!last || !last.meta.recognitionQuad) {
    return {
      json: { error: 'no last live attempt' },
      live: last?.meta.live ?? null,
      replay: null,
      rows: [],
    };
  }
  const replay = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: last.meta.attemptId,
    captureAt: last.meta.captureAt,
    nameIndex: args.nameIndex,
    ocr: getOrCreateOcrRecognizer(),
    recognitionQuad: last.meta.recognitionQuad,
    source: last.source,
    trackId: last.meta.trackId,
  });
  const hashesMatch =
    last.meta.hashes.sourceImageHash === replay.hashes.sourceImageHash &&
    last.meta.hashes.recognitionQuadHash === replay.hashes.recognitionQuadHash &&
    last.meta.hashes.warpedCardHash === replay.hashes.warpedCardHash &&
    last.meta.hashes.titleCropHash === replay.hashes.titleCropHash;
  const json = {
    hashesMatch,
    live: last.meta.live,
    liveHashes: last.meta.hashes,
    replay: {
      hashes: replay.hashes,
      matchName: replay.matchName,
      matchScore: replay.matchScore,
      ocrText: replay.ocrText,
      status: replay.status,
    },
  };
  const row = (label: string, text: string, match: string, extra: string): LabTableRow => ({
    cropUri: null,
    enhance: extra,
    error: null,
    match,
    ocr: 'rgba-bytes',
    path: label,
    text: text || '(empty)',
    timeMs: 0,
    warp: 'recognitionQuad',
    warpUri: null,
  });
  return {
    json,
    live: last.meta.live,
    replay,
    rows: [
      row(
        'LIVE',
        last.meta.live.ocrText,
        last.meta.live.matchName ?? 'none',
        last.meta.hashes.titleCropHash,
      ),
      row('REPLAY', replay.ocrText, replay.matchName ?? 'none', replay.hashes.titleCropHash),
    ],
  };
};

export const runLivePipelineOnFixture = async (args: {
  fixtureId: string;
  nameIndex: CardNameIndex | null;
}): Promise<{
  json: Record<string, unknown>;
  rows: LabTableRow[];
}> => {
  const fixture = await loadLabFixture(args.fixtureId);
  if (!fixture) throw new Error(`fixture not found: ${args.fixtureId}`);
  const quad =
    fixture.meta.quads.recognition ?? fixture.meta.quads.tracked ?? fixture.meta.quads.raw;
  if (!quad) throw new Error('fixture has no recognition quad');
  const lab = await runLabRecognition({
    nameIndex: args.nameIndex,
    ocr: getOrCreateOcrRecognizer(),
    pipeline: 'current',
    quads: fixture.meta.quads,
    source: fixture.source,
  });
  const ctrl = createSessionController({
    nameIndex: args.nameIndex,
    ocr: getOrCreateOcrRecognizer(),
  });
  const snap = await ctrl.recognizeFrozenCapture({
    recognitionQuad: quad,
    source: fixture.source,
    trackId: 1,
  });
  const liveName = snap.fused?.card?.name ?? null;
  const json = {
    lab: {
      hashes: lab.hashes,
      matchName: lab.matchName,
      matchScore: lab.matchScore,
      ocrText: lab.ocrText,
      titleDecode: lab.titleDecode ?? null,
    },
    liveOrch: {
      hashes: {
        recognitionQuadHash: snap.postLock?.recognitionQuadHash,
        sourceImageHash: snap.postLock?.sourceImageHash,
        titleCropHash: snap.postLock?.titleCropHash,
        warpedCardHash: snap.postLock?.warpedCardHash,
      },
      matchScore: snap.postLock?.titleScore ?? null,
      name: liveName,
      phase: snap.phase,
      resultAccepted: snap.postLock?.resultAccepted,
      resultRejectReason: snap.postLock?.resultRejectReason,
      status: snap.postLock?.recognitionReturnedStatus,
      titleDecode: snap.postLock?.titleDecode ?? null,
      titleMargin: snap.postLock?.titleMargin ?? null,
      titleRawText: snap.postLock?.titleRawText,
      titleSecondScore: snap.postLock?.titleSecondScore ?? null,
      titleTopCandidate: snap.postLock?.titleTopCandidate ?? null,
      titleTopScore: snap.postLock?.titleTopScore ?? null,
      variantConsensusCount: snap.postLock?.variantConsensusCount ?? null,
    },
    sameHashes:
      lab.hashes?.sourceImageHash === snap.postLock?.sourceImageHash &&
      lab.hashes?.warpedCardHash === snap.postLock?.warpedCardHash &&
      lab.hashes?.titleCropHash === snap.postLock?.titleCropHash,
    sameName: (lab.matchName ?? '') === (liveName ?? ''),
  };
  const FileSystem = await import('expo-file-system/legacy');
  await FileSystem.writeAsStringAsync(
    `${fixture.dirUri}lab-live-orch.json`,
    JSON.stringify(json, null, 2),
  );
  if (lab.images) {
    await writeRunPng(`${fixture.dirUri}current-warp.png`, lab.images.warp);
    await writeRunPng(`${fixture.dirUri}title-crop-current.png`, lab.images.titleRaw);
  }
  const row = (label: string, text: string, match: string): LabTableRow => ({
    cropUri: lab.images ? scanImageToPngDataUri(lab.images.titleRaw, 240) : null,
    enhance: 'enhanceForOcrFast',
    error: null,
    match,
    ocr: 'rgba-bytes',
    path: label,
    text: text || '(empty)',
    timeMs: 0,
    warp: 'recognitionQuad',
    warpUri: lab.images ? scanImageToPngDataUri(lab.images.warp, 160) : null,
  });
  return {
    json,
    rows: [
      row('Lab Current', lab.ocrText, lab.matchName ?? 'none'),
      row('Live orch', snap.postLock?.titleRawText ?? '', liveName ?? 'none'),
    ],
  };
};
