// Canonical post-capture recognition — Scanner Lab Current and Live both call this.
//
// Proven baseline: fixture wand-of-wonder-20260908T073958
//   recognitionQuad → warpQuadToCard → enhanceForOcrFast → rgba-bytes → CardNameIndex
//   → "Wand of Wonder" exact / 553ms
//
// Exact first pass returns immediately. Fuzzy titles run at most two more
// variants (raw, enhanceForOcr) and may publish only via strong-fuzzy consensus.
// TITLE_ONLY_MIN stays 0.94.
//
// Do not fork this path. Do not add SessionController / focus / lock here.

import { CARD_HEIGHT, CARD_WIDTH, cornersToQuad, warpQuadToCard } from './geometry';
import { type CardNameIndex, type NameCandidate } from './matchName';
import { extractTitleCrop, hashScanImage } from './ocrInput';
import type { FusedResult } from './ranking/fuse';
import { profileForCard } from './regions';
import type { RecognizeResult } from './session/recognize';
import {
  emptyTitleDecode,
  runBoundedTitleDecode,
  type TitleDecodeResult,
} from './titleDecode';
import type { TextRecognizer } from './textRecognizer';
import type { CardCorners, Rect, ScanImage } from './types';

const clock = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

export const hashRecognitionQuad = (quad: CardCorners | null): string => {
  if (!quad) return 'none';
  const n = (p: { x: number; y: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  return [n(quad.topLeft), n(quad.topRight), n(quad.bottomRight), n(quad.bottomLeft)].join('|');
};

export type CapturedRecognitionStatus =
  | 'identified'
  | 'ocr-empty'
  | 'ocr-unavailable'
  | 'ocr-native-error'
  | 'crop-invalid'
  | 'insufficient-confidence';

export interface FrozenRecognitionInput {
  alreadyWarped?: boolean;
  attemptId: number;
  captureAt: number | null;
  nameIndex: CardNameIndex | null;
  ocr: TextRecognizer | null;
  quadSource?: string | null;
  recognitionQuad: CardCorners | null;
  source: ScanImage;
  trackId: number | null;
}

export interface RecognitionParityHashes {
  recognitionQuadHash: string;
  sourceImageHash: string;
  titleCropHash: string;
  warpedCardHash: string;
}

export interface CapturedRecognitionResult {
  alreadyWarped: boolean;
  attemptId: number;
  crop: Rect;
  error: string | null;
  hashes: RecognitionParityHashes;
  matchName: string | null;
  matchScore: number | null;
  ocrInvoked: boolean;
  ocrText: string;
  ocrTransport: string;
  oracleId: string | null;
  status: CapturedRecognitionStatus;
  timings: {
    cropMs: number;
    fallbackOcrMs: number;
    firstOcrMs: number;
    lookupMs: number;
    ocrMs: number;
    preprocessMs: number;
    totalMs: number;
    warpMs: number;
  };
  titleCandidates: NameCandidate[];
  titleDecode: TitleDecodeResult;
  titleRaw: ScanImage | null;
  trackId: number | null;
  warp: ScanImage | null;
  warpQuad: CardCorners | null;
}

export const acceptCapturedResult = (args: {
  activeTrackId: number | null;
  result: CapturedRecognitionResult;
}): { accepted: boolean; reason: string } => {
  if (
    args.result.trackId != null &&
    args.activeTrackId != null &&
    args.result.trackId !== args.activeTrackId
  ) {
    return { accepted: false, reason: 'stale-track' };
  }
  return { accepted: true, reason: args.result.status };
};

/** Map canonical title output onto the session RecognizeResult contract. */
export const capturedToRecognizeResult = (
  captured: CapturedRecognitionResult,
): RecognizeResult => {
  const identified = captured.status === 'identified';
  const candidates = captured.titleCandidates.map(c => ({
    name: c.name,
    oracleId: `name:${c.name}`,
    possiblePrintingIds: [] as string[],
    score: c.score,
    titleScore: c.score,
  }));
  const top = candidates[0];
  const fused: FusedResult = {
    candidates,
    card:
      identified && captured.matchName
        ? {
            confidence: captured.matchScore ?? top?.score ?? 0,
            name: captured.matchName,
            oracleId: top?.oracleId ?? `name:${captured.matchName}`,
          }
        : undefined,
    margin: captured.titleDecode.titleMargin ?? captured.matchScore ?? 0,
    status: identified ? 'identified' : 'insufficient-confidence',
  };
  return {
    earlyIdentity: identified,
    earlyReason: identified ? 'title-only' : null,
    fused,
    profile: profileForCard(
      captured.warp?.width ?? CARD_WIDTH,
      captured.warp?.height ?? CARD_HEIGHT,
    ),
    readings: captured.ocrText.trim()
      ? [{ source: 'title', text: captured.ocrText }]
      : [],
    titleCandidates: captured.titleCandidates,
    timings: {
      titleMs: captured.timings.ocrMs,
      totalMs: captured.timings.totalMs,
    },
    visualTop: [],
  };
};

export const recognizeCapturedCard = async (
  input: FrozenRecognitionInput,
): Promise<CapturedRecognitionResult> => {
  const t0 = clock();
  const sourceHash = hashScanImage(input.source);
  const quadHash = hashRecognitionQuad(input.recognitionQuad);
  const empty = (
    status: CapturedRecognitionStatus,
    error: string | null,
    extra?: Partial<CapturedRecognitionResult>,
  ): CapturedRecognitionResult => ({
    alreadyWarped: input.alreadyWarped === true,
    attemptId: input.attemptId,
    crop: { h: 0, w: 0, x: 0, y: 0 },
    error,
    hashes: {
      recognitionQuadHash: quadHash,
      sourceImageHash: sourceHash,
      titleCropHash: 'none',
      warpedCardHash: 'none',
    },
    matchName: null,
    matchScore: null,
    ocrInvoked: false,
    ocrText: '',
    ocrTransport: 'none',
    oracleId: null,
    status,
    timings: {
      cropMs: 0,
      fallbackOcrMs: 0,
      firstOcrMs: 0,
      lookupMs: 0,
      ocrMs: 0,
      preprocessMs: 0,
      totalMs: clock() - t0,
      warpMs: 0,
    },
    titleCandidates: [],
    titleDecode: emptyTitleDecode(),
    titleRaw: null,
    trackId: input.trackId,
    warp: null,
    warpQuad: input.recognitionQuad,
    ...extra,
  });

  if (!input.recognitionQuad && input.alreadyWarped !== true) {
    return empty('crop-invalid', 'no recognitionQuad');
  }
  if (!input.ocr) return empty('ocr-unavailable', 'ocr-unavailable');

  let warp: ScanImage;
  let warpMs = 0;
  const alreadyWarped =
    input.alreadyWarped === true ||
    (input.source.width === CARD_WIDTH && input.source.height === CARD_HEIGHT && !input.recognitionQuad);
  if (alreadyWarped) {
    warp = input.source;
  } else {
    const warpAt = clock();
    warp = warpQuadToCard(input.source, cornersToQuad(input.recognitionQuad!));
    warpMs = clock() - warpAt;
  }

  const cropAt = clock();
  const { image: titleRaw, rect: crop } = extractTitleCrop(warp);
  const cropMs = clock() - cropAt;
  const preAt = clock();
  const profile = profileForCard(warp.width, warp.height);
  const preprocessMs = clock() - preAt;

  const ocrAt = clock();
  let decode: TitleDecodeResult;
  try {
    decode = await runBoundedTitleDecode({
      nameIndex: input.nameIndex,
      ocr: input.ocr,
      profile,
      titleRaw,
      warp,
    });
  } catch (err) {
    return empty('ocr-native-error', err instanceof Error ? err.message : String(err), {
      hashes: {
        recognitionQuadHash: quadHash,
        sourceImageHash: sourceHash,
        titleCropHash: hashScanImage(titleRaw),
        warpedCardHash: hashScanImage(warp),
      },
      titleRaw,
      warp,
      warpQuad: input.recognitionQuad,
    });
  }
  const ocrMs = clock() - ocrAt;
  const identified = decode.decision === 'exact-title' || decode.decision === 'strong-fuzzy';
  const status: CapturedRecognitionStatus =
    decode.decision === 'ocr-empty'
      ? 'ocr-empty'
      : identified
        ? 'identified'
        : 'insufficient-confidence';

  return {
    alreadyWarped,
    attemptId: input.attemptId,
    crop,
    error: null,
    hashes: {
      recognitionQuadHash: quadHash,
      sourceImageHash: sourceHash,
      titleCropHash: hashScanImage(titleRaw),
      warpedCardHash: hashScanImage(warp),
    },
    matchName: decode.matchName,
    matchScore: decode.matchScore,
    ocrInvoked: true,
    ocrText: decode.ocrText,
    ocrTransport: 'rgba-bytes',
    oracleId: null,
    status,
    timings: {
      cropMs,
      fallbackOcrMs: decode.fallbackOcrMs,
      firstOcrMs: decode.firstOcrMs,
      lookupMs: 0,
      ocrMs,
      preprocessMs,
      totalMs: clock() - t0,
      warpMs,
    },
    titleCandidates: decode.titleCandidates,
    titleDecode: decode,
    titleRaw,
    trackId: input.trackId,
    warp,
    warpQuad: input.recognitionQuad,
  };
};
