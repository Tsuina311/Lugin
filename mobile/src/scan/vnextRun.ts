/**
 * Development-only recognition attempt.
 * Existing candidate generator → frozen GBM → upright warp → art crop →
 * CLIP + linear adapter → clean gallery and prototype gallery → agreement.
 * Title OCR runs once per card session, and only after visual agreement
 * does not publish.
 */

import { decideVNext, type VNextDecision } from '@/lib/scan/vnext/decide';
import {
  setVNextDebug,
  type VNextDebugSnapshot,
  type VNextHit,
} from '@/lib/scan/vnext/debug';
import { cropRecognitionArt } from '@/lib/scan/vnext/artCrop';
import { rankLiveCandidatesPaced } from '@/lib/scan/vnext/features';
import { FROZEN_GBM_ID } from '@/lib/scan/vnext/gbm';
import { selectVNextPublishedHit } from '@/lib/scan/vnext/published';
import { recordVNextTiming, type VNextTimingSample } from '@/lib/scan/vnext/timing';
import { detectCardQuadPaced } from '@/lib/scan/detectCard';
import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import type { ScanImage } from '@/lib/scan/types';
import { shapeFold, type CardNameIndex } from '@/lib/scan/matchName';
import { normalizedExactTitleNameForRecovery } from '@/lib/scan/titleDecode';
import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';
import type { TextRecognizer } from '@/lib/scan/textRecognizer';
import { finalizeAttempt, type RecognitionAttempt } from '@/lib/scan/verifiedScan';

import { waitUntilCaptureGap } from './capturePace';
import { getVisualRecognizerError } from './visualRecognizer';
import { lookupVNextExactName, recognizeVNextArt } from './vnextNative';
import { recordVNextBenchmarkDecision } from './vnextBenchmark';
import * as attemptRegistry from './verifiedScan/registry';

const ocrBySession = new Map<number, ExactOcr>();

type ExactOcr = {
  raw: string;
  normalized: string;
  exactOracleId: string | null;
  titleCropMs: number;
  ocrMs: number;
  lookupMs: number;
};

const clock = (): number =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

const hit = (row: { oracleId?: string; name?: string; score?: number } | undefined): VNextHit | null => {
  if (!row?.oracleId) return null;
  return { oracleId: String(row.oracleId), name: row.name ?? '', score: Number(row.score ?? 0) };
};

export const runScannerVNext = async (args: {
  attempt: RecognitionAttempt;
  nameIndex: CardNameIndex | null;
  ocr: TextRecognizer | null;
  now: () => number;
  /** Warp already made from the capture outline. Skips a second card search. */
  preparedWarp?: ScanImage | null;
}): Promise<RecognitionAttempt | null> => {
  const started = clock();
  // Naming waits until the last tap is a second behind, so a burst of
  // pictures is saved before any of them is named.
  await waitUntilCaptureGap();
  const prepared = args.preparedWarp ?? null;
  let candidateGenerationMs = 0;
  let featureMs = 0;
  let gbmMs = 0;
  let candidateCount = 0;
  let selected: { index: number; utility: number } | null = null;
  let chosen: { corners: RecognitionAttempt['artifacts']['recognitionQuad'] | null } | null = null;
  let card = prepared;
  let warpMs = 0;
  if (!prepared) {
    const source = args.attempt.artifacts.source;
    const tGen = clock();
    const detected = await detectCardQuadPaced(source);
    candidateGenerationMs = clock() - tGen;
    const ranked = await rankLiveCandidatesPaced(source, detected.debug.candidates);
    featureMs = ranked.featureMs;
    gbmMs = ranked.gbmMs;
    candidateCount = ranked.candidateCount;
    selected = ranked.selected;
    chosen = selected ? detected.debug.candidates[selected.index] ?? null : null;
    if (chosen?.corners != null) {
      const tWarp = clock();
      card = warpQuadToCard(source, cornersToQuad(chosen.corners));
      warpMs = clock() - tWarp;
    }
  }
  let artMs = 0;
  let artAnchor: string | null = null;
  let clipMs: number | null = null;
  let preprocessMs: number | null = null;
  let adapterMs: number | null = null;
  let searchMs: number | null = null;
  let agreementMs = 0;
  let titleCropMs: number | null = null;
  let ocrMs: number | null = null;
  let lookupMs: number | null = null;
  let ocrInvoked = false;
  let ocrRaw: string | null = null;
  let ocrNormalized: string | null = null;
  let exactOracle: string | null = null;
  let note: string | null = null;
  let cleanTop: VNextHit | null = null;
  let prototypeTop: VNextHit[] = [];
  let galleryBytes: number | null = null;
  let nativeHeapBytes: number | null = null;
  let frozenIdentity: Record<string, string> | null = null;

  if (card) {
    const art = cropRecognitionArt(card);
    artMs = art.artMs;
    artAnchor = art.anchor;
    const rgba = new Uint8Array(art.crop.data.buffer, art.crop.data.byteOffset, art.crop.data.byteLength);
    const visual = await recognizeVNextArt(rgba, art.crop.width, art.crop.height);
    clipMs = visual.encoderMs;
    preprocessMs = visual.preprocessMs;
    adapterMs = visual.adapterMs;
    searchMs = visual.searchMs;
    galleryBytes = visual.galleryBytes;
    nativeHeapBytes = visual.nativeHeapBytes;
    frozenIdentity = visual.frozenIdentity;
    cleanTop = hit(visual.cleanTop[0]);
    prototypeTop = visual.prototypeTop.map(row => hit(row)).filter((row): row is VNextHit => row != null);
    if (!visual.ok) {
      const initError = getVisualRecognizerError();
      note =
        visual.error?.includes('not READY') && initError
          ? initError
          : visual.error;
    }
  } else {
    note = prepared ? 'no capture warp' : 'no GBM candidate';
  }

  const proto1 = prototypeTop[0] ?? null;
  const proto2 = prototypeTop[1] ?? null;
  const margin = proto1 && proto2 ? proto1.score - proto2.score : null;
  const top5 = prototypeTop.slice(0, 5).map(row => row.oracleId);
  const tAgree = clock();
  let decision: VNextDecision = decideVNext({
    cleanTop1OracleId: cleanTop?.oracleId ?? null,
    prototypeTop1OracleId: proto1?.oracleId ?? null,
    prototypeMargin: margin,
    prototypeTop5OracleIds: top5,
    exactUniqueOracleId: null,
  });
  agreementMs = clock() - tAgree;

  if (!decision.publish && card && top5.length && !note) {
    const cached = ocrBySession.get(args.attempt.cardSessionId);
    let exact = cached ?? null;
    if (!exact) {
      ocrInvoked = true;
      const captured = await recognizeCapturedCard({
        alreadyWarped: true,
        attemptId: args.attempt.attemptId,
        captureAt: args.attempt.timing.captureDoneAt,
        nameIndex: args.nameIndex,
        ocr: args.ocr,
        recognitionQuad: chosen?.corners ?? null,
        source: card,
        trackId: null,
      });
      titleCropMs = captured.timings.cropMs;
      ocrMs = captured.timings.ocrMs;
      const tLookup = clock();
      const name = normalizedExactTitleNameForRecovery(
        captured.titleDecode.variants,
      );
      let oracleId: string | null = null;
      if (name) {
        const lookup = await lookupVNextExactName(name);
        lookupMs = clock() - tLookup;
        if (lookup.unique && lookup.oracleIds.length === 1) oracleId = lookup.oracleIds[0];
      } else {
        lookupMs = clock() - tLookup;
      }
      exact = {
        raw: captured.ocrText,
        normalized: name ? shapeFold(name) : shapeFold(captured.ocrText),
        exactOracleId: oracleId,
        titleCropMs: titleCropMs ?? 0,
        ocrMs: ocrMs ?? 0,
        lookupMs: lookupMs ?? 0,
      };
      ocrBySession.set(args.attempt.cardSessionId, exact);
    } else {
      titleCropMs = exact.titleCropMs;
      ocrMs = exact.ocrMs;
      lookupMs = exact.lookupMs;
    }
    ocrRaw = exact.raw;
    ocrNormalized = exact.normalized;
    exactOracle = exact.exactOracleId;
    const tAgree2 = clock();
    decision = decideVNext({
      cleanTop1OracleId: cleanTop?.oracleId ?? null,
      prototypeTop1OracleId: proto1?.oracleId ?? null,
      prototypeMargin: margin,
      prototypeTop5OracleIds: top5,
      exactUniqueOracleId: exact.exactOracleId,
    });
    agreementMs += clock() - tAgree2;
  } else if (!decision.publish && note) {
    ocrInvoked = false;
  }

  const published = selectVNextPublishedHit(decision, prototypeTop);
  const at = args.now();
  const timing: VNextTimingSample = {
    source: decision.source,
    candidateGenerationMs,
    featureMs,
    gbmMs,
    candidateCount,
    warpMs,
    artMs,
    preprocessMs,
    clipMs,
    adapterMs,
    searchMs,
    agreementMs,
    titleCropMs,
    ocrMs,
    lookupMs,
    totalMs: clock() - started,
    ocrInvoked,
  };
  recordVNextTiming(timing);
  const debugSnapshot: VNextDebugSnapshot = {
    at,
    cardSessionId: args.attempt.cardSessionId,
    candidateIndex: selected?.index ?? null,
    candidateCount,
    gbmUtility: selected?.utility ?? null,
    geometrySource: prepared ? 'capture-outline' : FROZEN_GBM_ID,
    artAnchor,
    cleanTop1: cleanTop,
    prototypeTop1: proto1,
    prototypeMargin: margin,
    agreement: decision.agreement,
    prototypeTop5: prototypeTop.slice(0, 5),
    ocrRaw,
    ocrNormalized,
    ocrExactOracle: exactOracle,
    ocrInTop5: exactOracle != null ? top5.includes(exactOracle) : null,
    recoveredOracle:
      decision.source === 'OCR_EXACT_TOP5_RECOVERY' ? decision.oracleId : null,
    finalPublishedOracle: decision.publish ? decision.oracleId : null,
    frozenIdentity,
    source: decision.source,
    note: [
      note,
      galleryBytes != null ? `gallery ${Math.round(galleryBytes / (1024 * 1024))}MB` : null,
      nativeHeapBytes != null ? `nativeHeap ${Math.round(nativeHeapBytes / (1024 * 1024))}MB` : null,
    ]
      .filter(part => part != null && part !== '')
      .join(' · '),
    timing,
  };
  setVNextDebug(debugSnapshot);
  recordVNextBenchmarkDecision(debugSnapshot);

  return attemptRegistry.updateAttempt(args.attempt.attemptId, attempt =>
    finalizeAttempt(attempt, {
      terminalStatus: decision.publish ? 'FOUND' : cleanTop || ocrRaw ? 'AMBIGUOUS' : 'NO_MATCH',
      at,
      finalCard: decision.publish ? published?.name ?? null : null,
      proposedCard: decision.publish ? published?.name ?? null : null,
      ocr: {
        titleCropDimensions: null,
        ocrRawText: ocrRaw,
        ocrNormalizedText: ocrNormalized,
        ocrVariants: [],
        bestCandidateName: decision.publish ? published?.name ?? null : null,
        bestCandidateScore: decision.publish ? published?.score ?? null : null,
        runnerUpName: prototypeTop[1]?.name ?? null,
        runnerUpScore: prototypeTop[1]?.score ?? null,
        candidateMargin: margin,
        recognitionStatus: decision.publish ? 'identified' : 'insufficient',
      },
      printing: {
        printingStatus: 'NOT_RESOLVED',
        proposedSet: null,
        proposedCollectorNumber: null,
        proposedLanguage: null,
        printingConfidence: null,
      },
    }),
  );
};
