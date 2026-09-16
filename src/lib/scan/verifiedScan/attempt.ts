/**
 * Verified Scan recognition attempt — owns frozen capture artifacts and
 * survives UI NEXT. Results publish to UI only when cardSessionId is still active.
 */

import type { CardCorners, ScanImage } from '../types';
import type { VerifiedCorrectionType, VerifiedScanTiming } from './types';
import { emptyVerifiedScanTiming, markFirstVerified } from './types';
import type { FrozenCaptureProvenance } from './forensics';
import { freezeCorners } from './forensics';

export type RecognitionTerminalStatus =
  | 'FOUND'
  | 'AMBIGUOUS'
  | 'NO_MATCH'
  | 'QUALITY_REJECT'
  | 'OCR_ERROR'
  | 'RECOGNITION_ERROR'
  | 'SKIPPED';

export type RecognitionAttemptPhase =
  | 'captured'
  | 'awaiting-paint'
  | 'recognizing'
  | 'terminal';

export type PrintingTelemetryStatus = 'RESOLVED' | 'NOT_RESOLVED';

export type RecognitionOcrEvidence = {
  titleCropDimensions: { width: number; height: number } | null;
  ocrRawText: string | null;
  ocrNormalizedText: string | null;
  ocrVariants: string[];
  bestCandidateName: string | null;
  bestCandidateScore: number | null;
  runnerUpName: string | null;
  runnerUpScore: number | null;
  candidateMargin: number | null;
  recognitionStatus: string | null;
};

export type RecognitionPrintingEvidence = {
  printingStatus: PrintingTelemetryStatus;
  proposedSet: string | null;
  proposedCollectorNumber: string | null;
  proposedLanguage: string | null;
  printingConfidence: number | null;
};

export type RecognitionAttemptArtifacts = {
  source: ScanImage;
  warp: ScanImage;
  /** Source-space quad used for warp (frozen copy). */
  recognitionQuad: CardCorners;
  /** Detector-space quad frozen at lock (may be null if unavailable). */
  analysisQuad: CardCorners | null;
  titleCrop: ScanImage | null;
  titleEnhanced: ScanImage | null;
};

export type RecognitionAttempt = {
  attemptId: number;
  cardSessionId: number;
  captureId: number;
  childId: string;
  parentSessionId: string;
  phase: RecognitionAttemptPhase;
  terminalStatus: RecognitionTerminalStatus | null;
  userAdvancedBeforeTerminal: boolean;
  artifacts: RecognitionAttemptArtifacts;
  provenance: FrozenCaptureProvenance | null;
  timing: VerifiedScanTiming;
  ocr: RecognitionOcrEvidence;
  printing: RecognitionPrintingEvidence;
  proposedCard: string | null;
  proposedPrinting: { collectorNumber: string; setCode: string } | null;
  finalCard: string | null;
  finalPrinting: { collectorNumber: string; setCode: string } | null;
  correctionType: VerifiedCorrectionType;
  sharpness: number | null;
  createdAt: number;
  terminalAt: number | null;
  /** Channel timing when recognition used OCR/art/edition modes. */
  channelTiming?: import('../recognitionChannel').ChannelTimingSummary | null;
};

export const emptyOcrEvidence = (): RecognitionOcrEvidence => ({
  titleCropDimensions: null,
  ocrRawText: null,
  ocrNormalizedText: null,
  ocrVariants: [],
  bestCandidateName: null,
  bestCandidateScore: null,
  runnerUpName: null,
  runnerUpScore: null,
  candidateMargin: null,
  recognitionStatus: null,
});

export const emptyPrintingEvidence = (): RecognitionPrintingEvidence => ({
  printingStatus: 'NOT_RESOLVED',
  proposedSet: null,
  proposedCollectorNumber: null,
  proposedLanguage: null,
  printingConfidence: null,
});

export const assertAttemptOwnership = (args: {
  attemptId: number | null | undefined;
  captureId: number | null | undefined;
  cardSessionId: number | null | undefined;
}): void => {
  if (
    args.attemptId == null ||
    args.attemptId === 0 ||
    args.captureId == null ||
    args.cardSessionId == null
  ) {
    throw new Error(
      `invalid recognition ownership attemptId=${args.attemptId} captureId=${args.captureId} cardSessionId=${args.cardSessionId}`,
    );
  }
};

export const createRecognitionAttempt = (args: {
  attemptId: number;
  cardSessionId: number;
  captureId: number;
  childId: string;
  parentSessionId: string;
  source: ScanImage;
  warp: ScanImage;
  recognitionQuad: CardCorners;
  analysisQuad?: CardCorners | null;
  provenance?: FrozenCaptureProvenance | null;
  timing?: VerifiedScanTiming;
  sharpness?: number | null;
}): RecognitionAttempt => {
  assertAttemptOwnership(args);
  return {
    attemptId: args.attemptId,
    cardSessionId: args.cardSessionId,
    captureId: args.captureId,
    childId: args.childId,
    parentSessionId: args.parentSessionId,
    phase: 'captured',
    terminalStatus: null,
    userAdvancedBeforeTerminal: false,
    artifacts: {
      source: args.source,
      warp: args.warp,
      recognitionQuad: freezeCorners(args.recognitionQuad),
      analysisQuad: args.analysisQuad ? freezeCorners(args.analysisQuad) : null,
      titleCrop: null,
      titleEnhanced: null,
    },
    provenance: args.provenance ?? null,
    timing: args.timing ?? emptyVerifiedScanTiming(),
    ocr: emptyOcrEvidence(),
    printing: emptyPrintingEvidence(),
    proposedCard: null,
    proposedPrinting: null,
    finalCard: null,
    finalPrinting: null,
    correctionType: 'NONE',
    sharpness: args.sharpness ?? null,
    createdAt: performance.now(),
    terminalAt: null,
  };
};

export const markAttemptAwaitingPaint = (a: RecognitionAttempt, at: number): RecognitionAttempt => ({
  ...a,
  phase: 'awaiting-paint',
  timing: markFirstVerified(a.timing, 'previewStateCommittedAt', at),
});

export const markAttemptRecognizing = (a: RecognitionAttempt, at: number): RecognitionAttempt => ({
  ...a,
  phase: 'recognizing',
  // Paint only — recognitionStartAt is stamped when OCR actually begins.
  timing: markFirstVerified(a.timing, 'previewPaintConfirmedAt', at),
});

export const markAttemptRecognitionStarted = (
  a: RecognitionAttempt,
  at: number,
): RecognitionAttempt => ({
  ...a,
  phase: 'recognizing',
  timing: markFirstVerified(a.timing, 'recognitionStartAt', at),
});

export const markAttemptAdvancedEarly = (a: RecognitionAttempt, at: number): RecognitionAttempt => ({
  ...a,
  userAdvancedBeforeTerminal: true,
  timing: markFirstVerified(a.timing, 'nextPressedAt', at),
});

/**
 * Match a finished recognition payload to its frozen attempt by pinned pixels.
 * Never use the *active* UI cardSessionId — after NEXT that belongs to card B.
 */
export const matchAttemptByArtifacts = (
  candidates: RecognitionAttempt[],
  args: { source: ScanImage; warp: ScanImage | null },
): RecognitionAttempt | null => {
  const open = candidates.filter(a => a.terminalStatus == null);
  const hit =
    open.find(
      a =>
        a.artifacts.warp === args.source ||
        a.artifacts.source === args.source ||
        (args.warp != null && a.artifacts.warp === args.warp),
    ) ?? null;
  return hit;
};

/** UI may show result only when the attempt still owns the active card session. */
export const mayPublishAttemptToUi = (
  attempt: RecognitionAttempt,
  activeCardSessionId: number | null | undefined,
): boolean =>
  activeCardSessionId != null && attempt.cardSessionId === activeCardSessionId;

export const terminalStatusFromCapture = (args: {
  status: string | null | undefined;
  phase: 'found' | 'ambiguous' | null;
  error?: string | null;
}): RecognitionTerminalStatus => {
  if (args.error) {
    const e = args.error.toLowerCase();
    if (e.includes('ocr')) return 'OCR_ERROR';
    return 'RECOGNITION_ERROR';
  }
  if (args.phase === 'found' || args.status === 'identified') return 'FOUND';
  if (args.phase === 'ambiguous' || args.status === 'printing-ambiguous' || args.status === 'card-ambiguous') {
    return 'AMBIGUOUS';
  }
  if (args.status === 'ocr-empty' || args.status === 'insufficient-confidence') return 'NO_MATCH';
  if (args.status === 'ocr-native-error' || args.status === 'ocr-unavailable') return 'OCR_ERROR';
  if (args.status === 'crop-invalid') return 'RECOGNITION_ERROR';
  return 'NO_MATCH';
};

export const finalizeAttempt = (
  a: RecognitionAttempt,
  args: {
    terminalStatus: RecognitionTerminalStatus;
    at: number;
    finalCard?: string | null;
    finalPrinting?: { collectorNumber: string; setCode: string } | null;
    ocr?: Partial<RecognitionOcrEvidence>;
    printing?: Partial<RecognitionPrintingEvidence>;
    titleCrop?: ScanImage | null;
    proposedCard?: string | null;
    proposedPrinting?: { collectorNumber: string; setCode: string } | null;
  },
): RecognitionAttempt => {
  if (a.terminalStatus != null) return a;
  const ocr = { ...a.ocr, ...(args.ocr ?? {}) };
  const printing = { ...a.printing, ...(args.printing ?? {}) };
  return {
    ...a,
    phase: 'terminal',
    terminalStatus: args.terminalStatus,
    terminalAt: args.at,
    finalCard: args.finalCard ?? a.finalCard,
    finalPrinting: args.finalPrinting ?? a.finalPrinting,
    proposedCard: args.proposedCard ?? a.proposedCard,
    proposedPrinting: args.proposedPrinting ?? a.proposedPrinting,
    ocr,
    printing,
    artifacts: {
      ...a.artifacts,
      titleCrop: args.titleCrop !== undefined ? args.titleCrop : a.artifacts.titleCrop,
    },
    timing: markFirstVerified(
      markFirstVerified(
        args.finalCard
          ? markFirstVerified(a.timing, 'identityAt', args.at)
          : a.timing,
        'resultShownAt',
        args.at,
      ),
      'terminalAt',
      args.at,
    ),
  };
};

export type ParentSessionSummary = {
  parentSessionId: string;
  attemptsCreated: number;
  attemptsTerminal: number;
  found: number;
  ambiguous: number;
  noMatch: number;
  qualityReject: number;
  skipped: number;
  ocrError: number;
  recognitionError: number;
  retakes: number;
  userAdvancesBeforeTerminal: number;
  cardsAdded: number;
  printingCorrections: number;
  /** Idempotency keys — each attemptId counted at most once. */
  createdAttemptIds: number[];
  terminalAttemptIds: number[];
};

export const emptyParentSummary = (parentSessionId: string): ParentSessionSummary => ({
  parentSessionId,
  attemptsCreated: 0,
  attemptsTerminal: 0,
  found: 0,
  ambiguous: 0,
  noMatch: 0,
  qualityReject: 0,
  skipped: 0,
  ocrError: 0,
  recognitionError: 0,
  retakes: 0,
  userAdvancesBeforeTerminal: 0,
  cardsAdded: 0,
  printingCorrections: 0,
  createdAttemptIds: [],
  terminalAttemptIds: [],
});

export const noteAttemptCreated = (
  s: ParentSessionSummary,
  attemptId?: number,
): ParentSessionSummary => {
  if (attemptId != null && s.createdAttemptIds.includes(attemptId)) return s;
  return {
    ...s,
    attemptsCreated: s.attemptsCreated + 1,
    createdAttemptIds:
      attemptId != null ? [...s.createdAttemptIds, attemptId] : s.createdAttemptIds,
  };
};

export const noteAttemptTerminal = (
  s: ParentSessionSummary,
  attempt: RecognitionAttempt,
): ParentSessionSummary => {
  if (attempt.attemptId == null || s.terminalAttemptIds.includes(attempt.attemptId)) return s;
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    s.attemptsTerminal + 1 > s.attemptsCreated &&
    s.createdAttemptIds.length > 0
  ) {
    console.warn(
      `[verifiedScan] attemptsTerminal would exceed attemptsCreated (${s.attemptsTerminal + 1} > ${s.attemptsCreated})`,
    );
  }
  const next = {
    ...s,
    attemptsTerminal: s.attemptsTerminal + 1,
    terminalAttemptIds: [...s.terminalAttemptIds, attempt.attemptId],
  };
  if (attempt.userAdvancedBeforeTerminal) {
    next.userAdvancesBeforeTerminal += 1;
  }
  switch (attempt.terminalStatus) {
    case 'FOUND':
      next.found += 1;
      break;
    case 'AMBIGUOUS':
      next.ambiguous += 1;
      break;
    case 'NO_MATCH':
      next.noMatch += 1;
      break;
    case 'QUALITY_REJECT':
      next.qualityReject += 1;
      break;
    case 'SKIPPED':
      next.skipped += 1;
      break;
    case 'OCR_ERROR':
      next.ocrError += 1;
      break;
    case 'RECOGNITION_ERROR':
      next.recognitionError += 1;
      break;
    default:
      break;
  }
  if (attempt.correctionType === 'PRINTING_CHANGED') next.printingCorrections += 1;
  return next;
};
