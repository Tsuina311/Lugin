/** Portable Deck Benchmark types — phone + host. */

export const DECK_BENCHMARK_COUNTS = [10, 20, 40, 60, 100] as const;
export type DeckBenchmarkCount = (typeof DECK_BENCHMARK_COUNTS)[number] | number;

export type DeckBenchmarkPhase =
  | 'idle'
  | 'config'
  | 'detecting'
  | 'focusing'
  | 'recognizing'
  | 'captured'
  | 'next-card'
  | 'waiting-next'
  | 'complete'
  | 'interrupted'
  | 'cancelled';

export type DeckCardTerminal =
  | 'identified'
  | 'ambiguous'
  | 'ocr-empty'
  | 'budget-exhausted'
  | 'timeout'
  | 'failed';

/** Why a timed-out / non-terminal card was saved (host triage). */
export type DeckFailureClass =
  | 'NO_DETECTION'
  | 'DETECTED_NEVER_STABLE'
  | 'FOCUS_TIMEOUT'
  | 'NO_HIRES_CAPTURE'
  | 'OCR_UNAVAILABLE'
  | 'RECOGNITION_TIMEOUT'
  | 'OTHER';

export type DeckSwapKind = 'automatic' | 'manual';

export interface DeckExpectedMultisetEntry {
  name: string;
  quantity: number;
  setCode?: string | null;
  collectorNumber?: string | null;
}

export interface DeckBenchmarkEvidence {
  phase: string | null;
  detectorScore: number | null;
  focusTimedOut: boolean | null;
  focusSuccesses: number | null;
  highResRequests: number | null;
  highResSuccess: number | null;
  highResFailure: number | null;
  ocrAvailable: boolean | null;
  ocrTransport: string | null;
  recognizeAttempts: number | null;
  recognitionStatus: string | null;
  rawCorners: unknown | null;
  trackedCorners: unknown | null;
  presentedCorners: unknown | null;
  recognitionCorners: unknown | null;
}

export type DeckTerminalSource =
  | 'fresh-result'
  | 'empty'
  | 'timeout'
  | 'stale-rejected'
  | 'other';

export interface DeckBenchmarkCardRecord {
  benchmarkIndex: number;
  cardSessionId: number | null;
  /** Session that owned the published identity when saved — always serialized (null OK). */
  resultCardSessionId: number | null;
  resultAttemptId?: number | null;
  resultPublishedAt?: number | null;
  identityOwnedByCurrentSession?: boolean;
  recognitionAttemptIdsForSession?: number[];
  freshEvidenceCountForSession?: number | null;
  terminalSource?: DeckTerminalSource | null;
  /** Capture that fed recognition — must match cardSessionId when present. */
  captureCardSessionId?: number | null;
  captureId?: number | null;
  sourceHash?: string | null;
  warpHash?: string | null;
  titleHash?: string | null;
  /** Explicit analysis vs recognition warp provenance. */
  analysisWarpHash?: string | null;
  analysisWarpSize?: { width: number; height: number } | null;
  recognitionWarpHash?: string | null;
  recognitionWarpSize?: { width: number; height: number } | null;
  hasTrueHiresCapture?: boolean;
  recognitionSourceChannel?: 'TITLE' | 'ART' | 'HYBRID' | 'OTHER' | null;
  attemptCardSessionId?: number | null;
  geometryTrackId: number | null;
  focusAttemptId: number | null;
  recognizeAttempts: number | null;
  terminal: DeckCardTerminal;
  /** Set when terminal is timeout/failed — host triage class. */
  failureClass?: DeckFailureClass | null;
  /** True if a stale previous-session FOUND was observed and ignored. */
  staleIdentityRejected?: boolean;
  status: string | null;
  matchName: string | null;
  matchScore: number | null;
  matchMethod: 'exact-title' | 'strong-fuzzy' | 'ambiguous' | 'empty' | 'other' | null;
  ocrTexts: string[];
  detectorScore: number | null;
  recognitionSource: string | null;
  swapKind: DeckSwapKind;
  timings: {
    totalMs: number | null;
    lockToIdentityMs: number | null;
  };
  evidence?: DeckBenchmarkEvidence | null;
  files: {
    source?: string;
    cardWarp?: string;
    title?: string;
    art?: string;
    footer?: string;
    detector?: string;
    metadata: string;
  };
  /** Artifacts that metadata expected but were never on disk. */
  missingFiles?: string[];
  recordedAt: string;
}

export interface DeckBenchmarkBundle {
  kind: 'deck-benchmark';
  fixtureId: string;
  createdAt: string;
  completedAt: string | null;
  targetCount: number;
  cards: DeckBenchmarkCardRecord[];
  expectedMultiset: DeckExpectedMultisetEntry[] | null;
  expectedDeckId: string | null;
  expectedDeckName: string | null;
  phase: DeckBenchmarkPhase;
  note: string;
  /** Phone upload outcome — retained so incomplete runs can retry after tab change. */
  uploadStatus?: 'PENDING' | 'INCOMPLETE' | 'COMPLETE';
  missingFiles?: string[];
  /** Present after phone upload packaging — host can verify bytes landed. */
  uploadManifest?: {
    expectedFiles: string[];
    uploadedFiles: string[];
    missingFiles: string[];
    skippedEmpty?: string[];
  };
}

export const deckCardFileStem = (index: number) =>
  `deck-${String(index).padStart(3, '0')}`;
