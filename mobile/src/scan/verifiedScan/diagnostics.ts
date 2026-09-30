/**
 * Dev-only Normal Scan diagnostic grouping + parent summary.
 */

import type {
  ParentSessionSummary,
  RecognitionAttempt,
  RecognitionOcrEvidence,
  RecognitionPrintingEvidence,
  RecognitionTerminalStatus,
  VerifiedCorrectionType,
  VerifiedScanTiming,
} from '@/lib/scan/verifiedScan';
import {
  emptyParentSummary,
  noteAttemptCreated,
  noteAttemptTerminal,
  deriveVerifiedScanMs,
  SINGLE_SCAN_DIAGNOSTIC_VERSION,
} from '@/lib/scan/verifiedScan';
import type { ScryfallPrinting } from '../sharedCore';

export type NormalScanParentSession = {
  id: string;
  cardSeq: number;
  startedAt: number;
  summary: ParentSessionSummary;
};

export type NormalScanCardTelemetry = {
  attemptId: number;
  captureId: number;
  cardSessionId: number;
  childId: string;
  correctionType: VerifiedCorrectionType;
  finalCard: string | null;
  finalPrinting: { collectorNumber: string; setCode: string } | null;
  parentSessionId: string;
  proposedCard: string | null;
  proposedPrinting: { collectorNumber: string; setCode: string } | null;
  terminalStatus: RecognitionTerminalStatus | null;
  userAdvancedBeforeTerminal: boolean;
  timing: VerifiedScanTiming;
  ocr: RecognitionOcrEvidence;
  printing: RecognitionPrintingEvidence;
  sharpness: number | null;
  ownershipOk: boolean;
  singleScanDiagnosticVersion?: number;
  provenance?: import('@/lib/scan/verifiedScan').FrozenCaptureProvenance | null;
  derivedMs?: import('@/lib/scan/verifiedScan').VerifiedScanDerivedMs | null;
  channelTiming?: import('@/lib/scan/recognitionChannel').ChannelTimingSummary | null;
};

const stamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export const createNormalScanParentSession = (): NormalScanParentSession => {
  const id = `normal-scan-session-${stamp()}`;
  return {
    id,
    cardSeq: 0,
    startedAt: Date.now(),
    summary: emptyParentSummary(id),
  };
};

export const nextNormalScanChildId = (parent: NormalScanParentSession): string => {
  parent.cardSeq += 1;
  return `card-${String(parent.cardSeq).padStart(3, '0')}`;
};

export const printingRef = (
  p: Pick<ScryfallPrinting, 'collectorNumber' | 'setCode'> | null | undefined,
): { collectorNumber: string; setCode: string } | null =>
  p ? { collectorNumber: p.collectorNumber, setCode: p.setCode } : null;

export const correctionTypeFor = (args: {
  proposedCard: string | null;
  proposedPrinting: { collectorNumber: string; setCode: string } | null;
  finalCard: string | null;
  finalPrinting: { collectorNumber: string; setCode: string } | null;
}): VerifiedCorrectionType => {
  const cardChanged =
    Boolean(args.proposedCard && args.finalCard) && args.proposedCard !== args.finalCard;
  const printingChanged =
    Boolean(args.proposedPrinting && args.finalPrinting) &&
    (args.proposedPrinting!.setCode !== args.finalPrinting!.setCode ||
      args.proposedPrinting!.collectorNumber !== args.finalPrinting!.collectorNumber);
  if (cardChanged) return 'CARD_CHANGED';
  if (printingChanged) return 'PRINTING_CHANGED';
  return 'NONE';
};

export const telemetryFromAttempt = (attempt: RecognitionAttempt): NormalScanCardTelemetry => ({
  attemptId: attempt.attemptId,
  captureId: attempt.captureId,
  cardSessionId: attempt.cardSessionId,
  childId: attempt.childId,
  correctionType: attempt.correctionType,
  finalCard: attempt.finalCard,
  finalPrinting: attempt.finalPrinting,
  parentSessionId: attempt.parentSessionId,
  proposedCard: attempt.proposedCard,
  proposedPrinting: attempt.proposedPrinting,
  terminalStatus: attempt.terminalStatus,
  userAdvancedBeforeTerminal: attempt.userAdvancedBeforeTerminal,
  timing: { ...attempt.timing },
  ocr: { ...attempt.ocr },
  printing: { ...attempt.printing },
  sharpness: attempt.sharpness,
  ownershipOk:
    attempt.attemptId > 0 && attempt.captureId != null && attempt.cardSessionId != null,
  singleScanDiagnosticVersion: SINGLE_SCAN_DIAGNOSTIC_VERSION,
  provenance: attempt.provenance,
  derivedMs: deriveVerifiedScanMs(attempt.timing),
  channelTiming: attempt.channelTiming ?? null,
});

export const recordAttemptCreated = (
  parent: NormalScanParentSession,
  attemptId?: number,
): void => {
  parent.summary = noteAttemptCreated(parent.summary, attemptId);
};

export const recordAttemptTerminal = (
  parent: NormalScanParentSession,
  attempt: RecognitionAttempt,
): void => {
  parent.summary = noteAttemptTerminal(parent.summary, attempt);
};

export const recordRetake = (parent: NormalScanParentSession): void => {
  parent.summary = { ...parent.summary, retakes: parent.summary.retakes + 1 };
};
