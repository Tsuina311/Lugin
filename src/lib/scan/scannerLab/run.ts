// Deterministic recognition replay. No SessionController, focus, or lock.

import { cornersToQuad, warpQuadToCard } from '../geometry';
import { matchReadings } from '../matchName';
import { enhanceForOcr, enhanceForOcrFast } from '../preprocess';
import { extractTitleCrop } from '../ocrInput';
import { TITLE_TOP_N } from '../params';
import { recognizeCapturedCard } from '../recognizeCaptured';
import { readTitle } from '../readCard';
import { profileForCard } from '../regions';
import type { CardCorners, ScanImage } from '../types';
import type { LabInput, LabPipelineId, LabQuadSet, LabRunResult } from './types';

const clock = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export const pickLabWarpQuad = (pipeline: LabPipelineId, quads: LabQuadSet): CardCorners | null => {
  if (pipeline === 'baseline') return quads.tracked ?? quads.raw ?? quads.recognition;
  return quads.recognition ?? quads.tracked ?? quads.raw;
};

export const runLabRecognition = async (input: LabInput): Promise<LabRunResult> => {
  const t0 = clock();
  const quad = pickLabWarpQuad(input.pipeline, input.quads);
  if (!quad) {
    return {
      crop: { h: 0, w: 0, x: 0, y: 0 },
      error: 'no quad in fixture',
      matchName: null,
      matchScore: null,
      ocrInvoked: false,
      ocrText: '',
      ocrTransport: 'none',
      pipeline: input.pipeline,
      timings: { cropMs: 0, lookupMs: 0, ocrMs: 0, preprocessMs: 0, totalMs: clock() - t0, warpMs: 0 },
      warpQuad: null,
    };
  }
  if (!input.ocr) {
    return {
      crop: { h: 0, w: 0, x: 0, y: 0 },
      error: 'ocr-unavailable',
      matchName: null,
      matchScore: null,
      ocrInvoked: false,
      ocrText: '',
      ocrTransport: 'none',
      pipeline: input.pipeline,
      timings: { cropMs: 0, lookupMs: 0, ocrMs: 0, preprocessMs: 0, totalMs: clock() - t0, warpMs: 0 },
      warpQuad: quad,
    };
  }

  if (input.pipeline === 'current') {
    const captured = await recognizeCapturedCard({
      alreadyWarped: false,
      attemptId: 1,
      captureAt: null,
      nameIndex: input.nameIndex,
      ocr: input.ocr,
      recognitionQuad: quad,
      source: input.source,
      trackId: null,
    });
    return {
      crop: captured.crop,
      error: captured.error,
      hashes: captured.hashes,
      images: captured.warp
        ? {
            titleEnhanced: captured.titleRaw ?? captured.warp,
            titleRaw: captured.titleRaw ?? captured.warp,
            warp: captured.warp,
          }
        : undefined,
      matchName: captured.matchName,
      matchScore: captured.matchScore,
      ocrInvoked: captured.ocrInvoked,
      ocrText: captured.ocrText,
      ocrTransport: captured.ocrTransport,
      pipeline: 'current',
      timings: captured.timings,
      titleDecode: captured.titleDecode,
      warpQuad: captured.warpQuad,
    };
  }

  const warpAt = clock();
  const warp = warpQuadToCard(input.source, cornersToQuad(quad));
  const warpMs = clock() - warpAt;

  const cropAt = clock();
  const { image: titleRaw, rect: crop } = extractTitleCrop(warp);
  const cropMs = clock() - cropAt;

  const preAt = clock();
  const titleEnhanced =
    input.pipeline === 'baseline' ? enhanceForOcr(titleRaw) : enhanceForOcrFast(titleRaw);
  const preprocessMs = clock() - preAt;

  const profile = profileForCard(warp.width, warp.height);
  const ocrAt = clock();
  const title = await readTitle(warp, input.ocr, {
    profile,
    keepCrops: true,
    fastPreprocess: input.pipeline !== 'baseline',
    stopAfterFirstTitle: input.pipeline !== 'baseline',
  });
  const ocrMs = clock() - ocrAt;

  const lookupAt = clock();
  const candidates = input.nameIndex
    ? matchReadings(title.readings, input.nameIndex, { limit: TITLE_TOP_N })
    : [];
  const lookupMs = clock() - lookupAt;
  const top = candidates[0] ?? null;
  const sample = title.samples[0];
  const ocrText = title.readings[0]?.text ?? title.name ?? sample?.rawText ?? '';

  return {
    crop,
    error: null,
    images: { titleEnhanced, titleRaw, warp },
    matchName: top?.name ?? null,
    matchScore: top?.score ?? null,
    ocrInvoked: true,
    ocrText,
    ocrTransport: sample?.engineTransport ?? (input.pipeline === 'baseline' ? 'legacy-base64' : 'rgba-bytes'),
    pipeline: input.pipeline,
    timings: {
      cropMs,
      lookupMs,
      ocrMs,
      preprocessMs,
      totalMs: clock() - t0,
      warpMs,
    },
    warpQuad: quad,
  };
};

export const cloneScanImage = (image: ScanImage): ScanImage => ({
  data: new Uint8ClampedArray(image.data),
  height: image.height,
  width: image.width,
});
