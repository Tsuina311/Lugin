/**
 * Pure helpers for Verified Scan attempt finalization + OCR evidence mapping.
 */

import type { CapturedRecognitionResult } from '@/lib/scan/recognizeCaptured';
import { foldName } from '@/lib/scan/matchName';
import type { RecognizeResult } from '@/lib/scan/session/recognize';
import {
  channelTimingFromRecognize,
  getRecognitionChannel,
  type ChannelTimingSummary,
} from '@/lib/scan/recognitionChannel';
import {
  finalizeAttempt,
  type RecognitionAttempt,
  type RecognitionOcrEvidence,
  type RecognitionPrintingEvidence,
  terminalStatusFromCapture,
} from '@/lib/scan/verifiedScan';
import { monoNow } from '@/lib/scan/timing';

export const ocrEvidenceFromCaptured = (
  captured: CapturedRecognitionResult,
): RecognitionOcrEvidence => {
  const cands = captured.titleCandidates ?? [];
  const best = cands[0] ?? null;
  const second = cands[1] ?? null;
  const variants = (captured.titleDecode?.variants ?? [])
    .map(v => v.ocrText)
    .filter(Boolean);
  const raw = captured.ocrText || captured.titleDecode?.ocrText || '';
  return {
    titleCropDimensions: captured.titleRaw
      ? { width: captured.titleRaw.width, height: captured.titleRaw.height }
      : null,
    ocrRawText: raw || null,
    ocrNormalizedText: raw ? foldName(raw) : null,
    ocrVariants: variants.length ? variants : raw ? [raw] : [],
    bestCandidateName: captured.matchName ?? best?.name ?? null,
    bestCandidateScore: captured.matchScore ?? best?.score ?? null,
    runnerUpName: second?.name ?? captured.titleDecode?.variants?.[0]?.secondName ?? null,
    runnerUpScore: second?.score ?? captured.titleDecode?.titleSecondScore ?? null,
    candidateMargin: captured.titleDecode?.titleMargin ?? null,
    recognitionStatus: captured.status,
  };
};

export const ocrEvidenceFromRecognize = (result: RecognizeResult): RecognitionOcrEvidence => {
  const best = result.titleCandidates[0] ?? null;
  const second = result.titleCandidates[1] ?? null;
  const raw = result.ocrDebug?.result.rawText ?? result.readings[0]?.text ?? '';
  return {
    titleCropDimensions: result.ocrDebug?.images?.titleCropRaw
      ? {
          width: result.ocrDebug.images.titleCropRaw.width,
          height: result.ocrDebug.images.titleCropRaw.height,
        }
      : null,
    ocrRawText: raw || null,
    ocrNormalizedText: raw ? foldName(raw) : null,
    ocrVariants: raw ? [raw] : [],
    bestCandidateName: best?.name ?? result.fused.card?.name ?? null,
    bestCandidateScore: best?.score ?? result.fused.card?.confidence ?? null,
    runnerUpName: second?.name ?? null,
    runnerUpScore: second?.score ?? null,
    candidateMargin:
      best && second && best.score != null && second.score != null
        ? best.score - second.score
        : null,
    recognitionStatus: result.fused.status,
  };
};

export const printingEvidenceFromSnap = (args: {
  printing: {
    setCode: string;
    collectorNumber: string;
    lang?: string | null;
  } | null;
  confidence?: number | null;
}): RecognitionPrintingEvidence => {
  if (!args.printing) {
    return {
      printingStatus: 'NOT_RESOLVED',
      proposedSet: null,
      proposedCollectorNumber: null,
      proposedLanguage: null,
      printingConfidence: null,
    };
  }
  return {
    printingStatus: 'RESOLVED',
    proposedSet: args.printing.setCode,
    proposedCollectorNumber: args.printing.collectorNumber,
    proposedLanguage: args.printing.lang ?? null,
    printingConfidence: args.confidence ?? null,
  };
};

export const applyCapturedToAttempt = (
  attempt: RecognitionAttempt,
  captured: CapturedRecognitionResult,
  opts?: {
    phase?: 'found' | 'ambiguous' | null;
    printing?: {
      setCode: string;
      collectorNumber: string;
      lang?: string | null;
    } | null;
  },
): RecognitionAttempt => {
  const at = monoNow();
  const terminal = terminalStatusFromCapture({
    status: captured.status,
    phase: opts?.phase ?? null,
    error: captured.error,
  });
  const channelTiming: ChannelTimingSummary = channelTimingFromRecognize(
    getRecognitionChannel(),
    {
      titleMs: captured.timings.ocrMs,
      totalMs: captured.timings.totalMs,
      earlyReason: captured.status === 'identified' ? 'title-only' : null,
    },
  );
  const withOcrTiming = {
    ...attempt,
    channelTiming,
    timing: {
      ...attempt.timing,
      titleOcrStartedAt: attempt.timing.titleOcrStartedAt ?? at - (captured.timings.ocrMs || 0),
      titleOcrDoneAt: attempt.timing.titleOcrDoneAt ?? at,
      recognitionStartAt: attempt.timing.recognitionStartAt ?? at - (captured.timings.totalMs || 0),
    },
  };
  return finalizeAttempt(withOcrTiming, {
    terminalStatus: terminal,
    at,
    finalCard: captured.matchName,
    proposedCard: captured.matchName,
    ocr: ocrEvidenceFromCaptured(captured),
    printing: printingEvidenceFromSnap({ printing: opts?.printing ?? null }),
    titleCrop: captured.titleRaw,
  });
};

export const applyRecognizeResultToAttempt = (
  attempt: RecognitionAttempt,
  result: RecognizeResult,
): RecognitionAttempt => {
  const at = monoNow();
  const fused = result.fused;
  const terminal = terminalStatusFromCapture({
    status: fused.status,
    phase:
      fused.status === 'identified'
        ? 'found'
        : fused.status === 'printing-ambiguous' || fused.status === 'card-ambiguous'
          ? 'ambiguous'
          : null,
  });
  const printing = fused.printing
    ? {
        setCode: fused.printing.setCode,
        collectorNumber: fused.printing.collectorNumber,
        lang: fused.printing.lang ?? null,
      }
    : null;
  const channelTiming = channelTimingFromRecognize(getRecognitionChannel(), result.timings);
  const withTiming: RecognitionAttempt = {
    ...attempt,
    channelTiming,
    timing: {
      ...attempt.timing,
      titleOcrStartedAt:
        attempt.timing.titleOcrStartedAt ??
        (result.timings.titleMs != null ? at - result.timings.titleMs : null),
      titleOcrDoneAt: attempt.timing.titleOcrDoneAt ?? at,
      recognitionStartAt:
        attempt.timing.recognitionStartAt ??
        (result.timings.totalMs != null ? at - result.timings.totalMs : at),
      printingResolvedAt:
        attempt.timing.printingResolvedAt ??
        (result.timings.printingResolvedAt != null ? at : null),
    },
  };
  return finalizeAttempt(withTiming, {
    terminalStatus: terminal,
    at,
    finalCard: fused.card?.name ?? null,
    proposedCard: fused.card?.name ?? null,
    finalPrinting: printing
      ? { collectorNumber: printing.collectorNumber, setCode: printing.setCode }
      : null,
    proposedPrinting: printing
      ? { collectorNumber: printing.collectorNumber, setCode: printing.setCode }
      : null,
    ocr: ocrEvidenceFromRecognize(result),
    printing: printingEvidenceFromSnap({
      printing,
      confidence: fused.printing?.confidence ?? null,
    }),
    titleCrop: null,
  });
};
