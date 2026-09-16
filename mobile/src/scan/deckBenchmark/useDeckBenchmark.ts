import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';

import {
  DECK_BENCHMARK_COUNTS,
  classifyDeckFailure,
  decideDeckAdvance,
  decideDeckCardSave,
  type DeckBenchmarkBundle,
  type DeckBenchmarkCardRecord,
  type DeckBenchmarkCount,
  type DeckBenchmarkEvidence,
  type DeckBenchmarkPhase,
  type DeckCardTerminal,
  type DeckExpectedMultisetEntry,
  type DeckSwapKind,
} from '@/lib/scan/deckBenchmark';
import { monoNow } from '@/lib/scan/timing';
import type { LockGates } from '@/lib/scan/session/controller';
import type { CardCorners, ScanImage } from '../sharedCore';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { claimScannerMode, releaseScannerMode } from '../scannerMode';
import { enqueueDeckBenchmark } from './enqueue';
import {
  loadDeckActiveMeta,
  loadDeckBundle,
  listDeckRuns,
  persistDeckActiveMeta,
  saveDeckBundle,
  saveDeckCardArtifacts,
} from './persist';
import { formatUploadIncompleteMessage } from '@/lib/scan/benchmarkUpload';

export { classifyDeckFailure } from '@/lib/scan/deckBenchmark';
export type { DeckFailureClass } from '@/lib/scan/deckBenchmark';

export const DECK_CARD_TIMEOUT_MS = 18_000;
export const DECK_NEXT_TIMEOUT_MS = 14_000;

export type DeckBenchmarkUi = {
  cardSessionId: number | null;
  fixtureId: string | null;
  geometryTrackId: number | null;
  index: number;
  message: string;
  phase: DeckBenchmarkPhase;
  recognitionName: string | null;
  showManualNext: boolean;
  targetCount: number;
  interrupted: boolean;
  /** True once this slot is claimed — user may physically swap immediately. */
  canSwapNow: boolean;
  uploadIncomplete: boolean;
  retryUpload: boolean;
};

const idleUi = (): DeckBenchmarkUi => ({
  cardSessionId: null,
  fixtureId: null,
  geometryTrackId: null,
  index: 0,
  message: '',
  phase: 'idle',
  recognitionName: null,
  showManualNext: false,
  targetCount: 60,
  interrupted: false,
  canSwapNow: false,
  uploadIncomplete: false,
  retryUpload: false,
});

const makeFixtureId = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `deck-test-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const beepNext = () => {
  try {
    // Short single pulse — long patterns felt like the UI lag behind the buzz.
    Vibration.vibrate(80);
  } catch {
    /* ignore */
  }
};

/** Let React paint SWAP NOW / name before PNG encode blocks the JS thread. */
const yieldForUiPaint = () =>
  new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export type DeckLivePeek = {
  gates: LockGates | null;
  identity: string | null;
  phase: string | null;
  recognitionDecision: string | null;
  recognitionStatus: string | null;
  recognizeAttempts: number | null;
  matchScore: number | null;
  ocrTexts: string[];
  /** How identity was obtained when OCR texts are empty (telemetry). */
  recognitionSourceChannel?: 'TITLE' | 'ART' | 'HYBRID' | 'OTHER' | null;
  detectorScore: number | null;
  recognitionSource: string | null;
  lockedAt: number | null;
  finalIdentityAt: number | null;
  resultCardSessionId: number | null;
  resultAttemptId?: number | null;
  resultPublishedAt?: number | null;
  identityOwnedByCurrentSession?: boolean;
  freshEvidenceCountForSession?: number | null;
  recognitionAttemptIdsForSession?: number[];
  captureCardSessionId?: number | null;
  captureId?: number | null;
  sourceHash?: string | null;
  warpHash?: string | null;
  titleHash?: string | null;
  attemptCardSessionId?: number | null;
  cardWarp: ScanImage | null;
  title: ScanImage | null;
  source: ScanImage | null;
  detector: ScanImage | null;
  rawCorners: CardCorners | null;
  trackedCorners: CardCorners | null;
  presentedCorners: CardCorners | null;
  recognitionCorners: CardCorners | null;
  ocrAvailable: boolean | null;
  ocrTransport: string | null;
};

export type UseDeckBenchmarkArgs = {
  markDebugCardSwapped: () => void;
  peekLive: () => DeckLivePeek;
  /** Heavy pixels — only call when committing a slot (PNG encode path). */
  peekArtifacts?: () => {
    cardWarp: ScanImage | null;
    title: ScanImage | null;
    source: ScanImage | null;
    detector: ScanImage | null;
  };
  setLabHold: (held: boolean) => void;
};

type RunState = {
  armedSessionId: number | null;
  bundle: DeckBenchmarkBundle;
  cardStartedAt: number;
  /** One save per physical card slot — session id or timeout attempt key. */
  recordedSlots: Set<string>;
  /** Slots that already counted a staleIdentityRejected observation. */
  staleRejectedSlots: Set<string>;
  manualArmed: boolean;
  nextPromptAt: number | null;
  phase: DeckBenchmarkPhase;
  swapKindForNext: DeckSwapKind;
  staleIdentityRejected: number;
};

const matchMethodOf = (
  live: DeckLivePeek,
  terminal: DeckCardTerminal,
): DeckBenchmarkCardRecord['matchMethod'] => {
  const d = (live.recognitionDecision || '').toLowerCase();
  if (terminal === 'ambiguous') return 'ambiguous';
  if (terminal === 'ocr-empty') return 'empty';
  if (d.includes('exact')) return 'exact-title';
  if (d.includes('strong') || d.includes('fuzzy')) return 'strong-fuzzy';
  if (terminal === 'identified') return 'other';
  return null;
};

const evidenceOf = (live: DeckLivePeek): DeckBenchmarkEvidence => ({
  phase: live.phase,
  detectorScore: live.detectorScore,
  focusTimedOut: live.gates?.focusTimedOut ?? null,
  focusSuccesses: live.gates?.focusSuccesses ?? null,
  highResRequests: live.gates?.highResRequests ?? null,
  highResSuccess: live.gates?.highResSuccess ?? null,
  highResFailure: live.gates?.highResFailure ?? null,
  ocrAvailable: live.ocrAvailable,
  ocrTransport: live.ocrTransport,
  recognizeAttempts: live.recognizeAttempts,
  recognitionStatus: live.recognitionStatus,
  rawCorners: live.rawCorners,
  trackedCorners: live.trackedCorners,
  presentedCorners: live.presentedCorners,
  recognitionCorners: live.recognitionCorners,
});


export const useDeckBenchmark = (args: UseDeckBenchmarkArgs) => {
  const [ui, setUi] = useState<DeckBenchmarkUi>(idleUi);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftCount, setDraftCount] = useState<DeckBenchmarkCount>(10);
  const [resumeOffer, setResumeOffer] = useState<DeckBenchmarkBundle | null>(null);

  const runRef = useRef<RunState | null>(null);
  const cancelledRef = useRef(false);
  const savingRef = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  const openConfig = useCallback(() => {
    if (!isBenchmarkToolsEnabled()) return;
    const run = runRef.current;
    if (run && run.phase !== 'complete' && run.phase !== 'cancelled' && run.phase !== 'idle') return;
    setConfigOpen(true);
    setUi(u => ({ ...u, phase: 'config', message: 'Choose target card count' }));
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    runRef.current = null;
    savingRef.current = false;
    argsRef.current.setLabHold(false);
    releaseScannerMode('deck-benchmark');
    void persistDeckActiveMeta(null);
    setConfigOpen(false);
    setResumeOffer(null);
    setUi(idleUi());
  }, []);

  const persistRun = useCallback(async (run: RunState) => {
    await saveDeckBundle(run.bundle);
    await persistDeckActiveMeta(run.bundle.fixtureId);
  }, []);

  const finish = useCallback(async (run: RunState) => {
    run.phase = 'complete';
    run.bundle.phase = 'complete';
    run.bundle.completedAt = new Date().toISOString();
    run.bundle.uploadStatus = 'PENDING';
    await persistRun(run);
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: `Uploading ${run.bundle.cards.length} cards…`,
      showManualNext: false,
      canSwapNow: false,
      uploadIncomplete: false,
      retryUpload: false,
      fixtureId: run.bundle.fixtureId,
    }));
    try {
      const dir = await saveDeckBundle(run.bundle);
      const queued = await enqueueDeckBenchmark({
        dirUri: dir,
        bundle: run.bundle,
      });
      run.bundle.uploadStatus = queued.uploadStatus;
      await saveDeckBundle(run.bundle);
      // Keep active meta when incomplete so Settings → Scan remount can restore retry UI.
      await persistDeckActiveMeta(
        queued.uploadStatus === 'COMPLETE' ? null : run.bundle.fixtureId,
      );
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: queued.message,
        uploadIncomplete: queued.uploadStatus !== 'COMPLETE',
        retryUpload: queued.uploadStatus !== 'COMPLETE',
        fixtureId: run.bundle.fixtureId,
      }));
      // Always release exclusive mode after a finished run — incomplete upload
      // must not keep blocking the rest of the UI.
      runRef.current =
        queued.uploadStatus === 'COMPLETE'
          ? null
          : {
              ...run,
              phase: 'complete',
            };
      argsRef.current.setLabHold(false);
      releaseScannerMode('deck-benchmark');
    } catch (err) {
      run.bundle.uploadStatus = 'INCOMPLETE';
      await saveDeckBundle(run.bundle);
      await persistDeckActiveMeta(run.bundle.fixtureId);
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: err instanceof Error ? err.message : String(err),
        uploadIncomplete: true,
        retryUpload: true,
        fixtureId: run.bundle.fixtureId,
      }));
      argsRef.current.setLabHold(false);
      releaseScannerMode('deck-benchmark');
    }
  }, [persistRun]);

  const retryMissingUpload = useCallback(async () => {
    const run = runRef.current;
    const fixtureId = run?.bundle.fixtureId ?? ui.fixtureId;
    if (!fixtureId) return;
    const bundle = run?.bundle ?? (await loadDeckBundle(fixtureId));
    if (!bundle) return;
    const dir = await saveDeckBundle(bundle);
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: 'Retrying missing uploads…',
      retryUpload: false,
      fixtureId,
    }));
    try {
      const outcome = await enqueueDeckBenchmark({
        dirUri: dir,
        bundle,
      });
      if (run) {
        run.bundle = bundle;
        run.bundle.uploadStatus = outcome.uploadStatus;
      } else {
        bundle.uploadStatus = outcome.uploadStatus;
      }
      await saveDeckBundle(bundle);
      await persistDeckActiveMeta(
        outcome.uploadStatus === 'COMPLETE' ? null : fixtureId,
      );
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: outcome.message,
        uploadIncomplete: outcome.uploadStatus !== 'COMPLETE',
        retryUpload: outcome.uploadStatus !== 'COMPLETE',
        fixtureId,
      }));
      if (outcome.uploadStatus === 'COMPLETE') {
        runRef.current = null;
      }
      argsRef.current.setLabHold(false);
      releaseScannerMode('deck-benchmark');
    } catch (err) {
      await persistDeckActiveMeta(fixtureId);
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: err instanceof Error ? err.message : String(err),
        uploadIncomplete: true,
        retryUpload: true,
        fixtureId,
      }));
      argsRef.current.setLabHold(false);
      releaseScannerMode('deck-benchmark');
    }
  }, [ui.fixtureId]);

  const start = useCallback(
    async (opts?: {
      count?: DeckBenchmarkCount;
      expectedMultiset?: DeckExpectedMultisetEntry[] | null;
      expectedDeckId?: string | null;
      expectedDeckName?: string | null;
    }) => {
      if (!isBenchmarkToolsEnabled()) return;
      if (!claimScannerMode('deck-benchmark')) return;
      cancelledRef.current = false;
      savingRef.current = false;
      const count = Math.max(1, Math.floor(opts?.count ?? Number(draftCount) ?? 60));
      const fixtureId = makeFixtureId();
      const bundle: DeckBenchmarkBundle = {
        kind: 'deck-benchmark',
        fixtureId,
        createdAt: new Date().toISOString(),
        completedAt: null,
        targetCount: count,
        cards: [],
        expectedMultiset: opts?.expectedMultiset ?? null,
        expectedDeckId: opts?.expectedDeckId ?? null,
        expectedDeckName: opts?.expectedDeckName ?? null,
        phase: 'detecting',
        note: 'REAL deck benchmark — phone capture; host report separately.',
      };
      runRef.current = {
        armedSessionId: null,
        bundle,
        cardStartedAt: monoNow(),
        recordedSlots: new Set(),
        staleRejectedSlots: new Set(),
        manualArmed: false,
        nextPromptAt: null,
        phase: 'detecting',
        swapKindForNext: 'automatic',
        staleIdentityRejected: 0,
      };
      await persistRun(runRef.current);
      // Deck exclusivity is scanner-mode ownership, not labHold (keeps recognition live).
      argsRef.current.setLabHold(false);
      setConfigOpen(false);
      setResumeOffer(null);
      setUi({
        cardSessionId: null,
        fixtureId,
        geometryTrackId: null,
        index: 1,
        message: 'Place first card',
        phase: 'detecting',
        recognitionName: null,
        showManualNext: false,
        targetCount: count,
        interrupted: false,
        canSwapNow: false,
        uploadIncomplete: false,
        retryUpload: false,
      });
    },
    [draftCount, persistRun],
  );

  const resume = useCallback(async () => {
    const offer = resumeOffer;
    if (!offer) return;
    if (!claimScannerMode('deck-benchmark')) return;
    cancelledRef.current = false;
    const recorded = new Set(
      offer.cards.map(c =>
        c.cardSessionId != null ? `s:${c.cardSessionId}` : `i:${c.benchmarkIndex}`,
      ),
    );
    runRef.current = {
      armedSessionId: null,
      bundle: { ...offer, phase: 'detecting' },
      cardStartedAt: monoNow(),
      recordedSlots: recorded,
      staleRejectedSlots: new Set(),
      manualArmed: false,
      nextPromptAt: null,
      phase: 'detecting',
      swapKindForNext: 'automatic',
      staleIdentityRejected: offer.cards.filter(c => c.staleIdentityRejected).length,
    };
    await persistDeckActiveMeta(offer.fixtureId);
    argsRef.current.setLabHold(false);
    setResumeOffer(null);
    setUi({
      cardSessionId: null,
      fixtureId: offer.fixtureId,
      geometryTrackId: null,
      index: Math.min(offer.cards.length + 1, offer.targetCount),
      message: `Resumed · ${offer.cards.length}/${offer.targetCount}`,
      phase: 'detecting',
      recognitionName: null,
      showManualNext: false,
      targetCount: offer.targetCount,
      interrupted: false,
      canSwapNow: false,
      uploadIncomplete: false,
      retryUpload: false,
    });
  }, [resumeOffer]);

  const discardInterrupted = useCallback(async () => {
    // Dismiss UI only — keep incomplete upload on disk / active-meta so remount can restore.
    if (resumeOffer && resumeOffer.phase !== 'complete') {
      await persistDeckActiveMeta(null);
    }
    setResumeOffer(null);
    runRef.current = null;
    argsRef.current.setLabHold(false);
    releaseScannerMode('deck-benchmark');
    setUi(idleUi());
  }, [resumeOffer]);

  const finishEarly = useCallback(async () => {
    const run = runRef.current;
    if (!run) {
      if (resumeOffer) {
        runRef.current = {
          armedSessionId: null,
          bundle: resumeOffer,
          cardStartedAt: monoNow(),
          recordedSlots: new Set(),
          staleRejectedSlots: new Set(),
          manualArmed: false,
          nextPromptAt: null,
          phase: 'complete',
          swapKindForNext: 'automatic',
          staleIdentityRejected: resumeOffer.cards.filter(c => c.staleIdentityRejected).length,
        };
        setResumeOffer(null);
        await finish(runRef.current);
      }
      return;
    }
    await finish(run);
  }, [finish, resumeOffer]);

  const markManualNext = useCallback(() => {
    const run = runRef.current;
    if (!run || (run.phase !== 'next-card' && run.phase !== 'waiting-next')) return;
    argsRef.current.markDebugCardSwapped();
    run.manualArmed = true;
    run.swapKindForNext = 'manual';
    run.phase = 'waiting-next';
    run.nextPromptAt = monoNow();
    setUi(u => ({
      ...u,
      phase: 'waiting-next',
      showManualNext: false,
      message: 'Manual session boundary — waiting for next card',
    }));
  }, []);

  // Restore interrupted / incomplete-upload run on mount (survives Settings tab unmount).
  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void (async () => {
      const restoreIncomplete = async (bundle: DeckBenchmarkBundle) => {
        runRef.current = {
          armedSessionId: null,
          bundle,
          cardStartedAt: monoNow(),
          recordedSlots: new Set(
            bundle.cards.map(c =>
              c.cardSessionId != null ? `s:${c.cardSessionId}` : `i:${c.benchmarkIndex}`,
            ),
          ),
          staleRejectedSlots: new Set(),
          manualArmed: false,
          nextPromptAt: null,
          phase: 'complete',
          swapKindForNext: 'automatic',
          staleIdentityRejected: bundle.cards.filter(c => c.staleIdentityRejected).length,
        };
        await persistDeckActiveMeta(bundle.fixtureId);
        setUi({
          ...idleUi(),
          fixtureId: bundle.fixtureId,
          index: bundle.cards.length,
          targetCount: bundle.targetCount,
          phase: 'complete',
          uploadIncomplete: true,
          retryUpload: true,
          message: formatUploadIncompleteMessage({
            runId: bundle.fixtureId,
            kind: 'deck-benchmark',
            endpointUrl: null,
            acknowledged: bundle.uploadManifest?.uploadedFiles ?? [],
            failed: [],
            uploadStatus: 'INCOMPLETE',
            missingRequired: bundle.missingFiles ?? bundle.uploadManifest?.missingFiles ?? [],
            updatedAt: new Date().toISOString(),
          }),
        });
      };

      const meta = await loadDeckActiveMeta();
      if (meta?.fixtureId) {
        const bundle = await loadDeckBundle(meta.fixtureId);
        if (!bundle) {
          await persistDeckActiveMeta(null);
        } else if (bundle.phase === 'complete' && bundle.uploadStatus === 'COMPLETE') {
          await persistDeckActiveMeta(null);
        } else if (
          bundle.phase === 'complete' &&
          (bundle.uploadStatus === 'INCOMPLETE' ||
            (bundle.uploadManifest?.missingFiles?.length ?? 0) > 0)
        ) {
          if (!bundle.uploadStatus) {
            bundle.uploadStatus = 'INCOMPLETE';
            await saveDeckBundle(bundle);
          }
          await restoreIncomplete(bundle);
          return;
        } else if (bundle.phase === 'complete') {
          await persistDeckActiveMeta(null);
        } else {
          setResumeOffer(bundle);
          setUi({
            ...idleUi(),
            fixtureId: bundle.fixtureId,
            index: bundle.cards.length,
            targetCount: bundle.targetCount,
            phase: 'interrupted',
            interrupted: true,
            message: `Interrupted ${bundle.cards.length}/${bundle.targetCount}`,
          });
          return;
        }
      }

      // Fallback: previous builds cleared active-meta on incomplete upload. Recover latest.
      const runs = await listDeckRuns();
      for (const entry of runs) {
        if (entry.phase !== 'complete') continue;
        const bundle = await loadDeckBundle(entry.fixtureId);
        if (!bundle) continue;
        const missing = bundle.uploadManifest?.missingFiles?.length ?? 0;
        if (bundle.uploadStatus === 'INCOMPLETE' || missing > 0) {
          if (bundle.uploadStatus !== 'INCOMPLETE') {
            bundle.uploadStatus = 'INCOMPLETE';
            await saveDeckBundle(bundle);
          }
          await restoreIncomplete(bundle);
          return;
        }
      }
    })();
  }, []);

  useEffect(() => {
    const active =
      ui.phase === 'detecting' ||
      ui.phase === 'focusing' ||
      ui.phase === 'recognizing' ||
      ui.phase === 'captured' ||
      ui.phase === 'next-card' ||
      ui.phase === 'waiting-next';
    if (!active) return;

    let alive = true;
    const tick = async () => {
      if (!alive || cancelledRef.current || savingRef.current) return;
      const run = runRef.current;
      if (!run) return;
      const live = argsRef.current.peekLive();
      const gates = live.gates;
      const idx = run.bundle.cards.length;

      let phaseLabel: DeckBenchmarkPhase = run.phase;
      const p = (live.phase || '').toLowerCase();
      if (run.phase === 'detecting' || run.phase === 'focusing' || run.phase === 'recognizing') {
        if (p.includes('focus')) phaseLabel = 'focusing';
        else if (p.includes('recog') || p.includes('lock')) phaseLabel = 'recognizing';
        else phaseLabel = 'detecting';
        run.phase = phaseLabel;
      }

      if (run.phase === 'next-card' || run.phase === 'waiting-next') {
        setUi(u => ({
          ...u,
          cardSessionId: gates?.cardSessionId ?? u.cardSessionId,
          geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? u.geometryTrackId,
          index: Math.min(idx + 1, run.bundle.targetCount),
          phase: run.phase,
          canSwapNow: true,
          // Keep saved name + SWAP NOW copy — do not replace with live peek.
        }));
      } else {
        setUi(u => ({
          ...u,
          cardSessionId: gates?.cardSessionId ?? u.cardSessionId,
          geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? u.geometryTrackId,
          index: Math.min(idx + 1, run.bundle.targetCount),
          phase: run.phase,
          canSwapNow: false,
          recognitionName: live.identity,
          message: live.identity
            ? live.identity
            : u.message,
        }));
      }

      // Wait for new session after NEXT CARD
      if (run.phase === 'next-card' || run.phase === 'waiting-next') {
        const elapsed = run.nextPromptAt != null ? monoNow() - run.nextPromptAt : 0;
        const adv = decideDeckAdvance({
          armedSessionId: run.armedSessionId,
          cardSessionId: gates?.cardSessionId ?? null,
          geometryDetected: gates?.geometryDetected ?? null,
          elapsedSinceNextPromptMs: elapsed,
          manualArmed: run.manualArmed,
          nextTimeoutMs: DECK_NEXT_TIMEOUT_MS,
        });
        if (adv.showManualNext) {
          setUi(u => ({
            ...u,
            showManualNext: true,
            canSwapNow: true,
            message: 'SWAP NOW · tap if session did not advance',
          }));
        }
        if (adv.advance) {
          run.phase = 'detecting';
          run.cardStartedAt = monoNow();
          run.manualArmed = false;
          run.nextPromptAt = null;
          run.armedSessionId = gates?.cardSessionId ?? null;
          setUi(u => ({
            ...u,
            phase: 'detecting',
            showManualNext: false,
            canSwapNow: false,
            message: 'Place next card',
            recognitionName: null,
          }));
        }
        return;
      }

      // Capture terminal recognition OR wall-clock timeout — never hang.
      // Defense-in-depth: IDENTIFIED only with owned result + fresh evidence.
      const sessionId = gates?.cardSessionId ?? null;
      const decision = decideDeckCardSave({
        recordedSlots: run.recordedSlots,
        cardStartedAt: run.cardStartedAt,
        now: monoNow(),
        timeoutMs: DECK_CARD_TIMEOUT_MS,
        live: {
          phase: live.phase,
          recognitionStatus: live.recognitionStatus,
          recognitionDecision: live.recognitionDecision,
          identity: live.identity,
          cardSessionId: sessionId,
          resultCardSessionId: live.resultCardSessionId ?? null,
          resultAttemptId: live.resultAttemptId ?? null,
          resultPublishedAt: live.resultPublishedAt ?? null,
          identityOwnedByCurrentSession: live.identityOwnedByCurrentSession,
          freshEvidenceCountForSession:
            live.freshEvidenceCountForSession ?? live.recognizeAttempts ?? null,
          geometryDetected: gates?.geometryDetected ?? null,
          geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? null,
          focusAttemptId: gates?.focusAttemptId ?? null,
          titlePresent: Boolean(live.title || live.titleHash || live.warpHash),
          recognizeAttempts: live.recognizeAttempts,
          recognitionAttemptIdsForSession: live.recognitionAttemptIdsForSession,
        },
      });
      if (decision.staleIdentityRejected) {
        if (!run.staleRejectedSlots.has(decision.slotKey)) {
          run.staleRejectedSlots.add(decision.slotKey);
          run.staleIdentityRejected += 1;
        }
        setUi(u => ({
          ...u,
          message: 'Waiting for fresh recognition…',
          recognitionName: null,
        }));
        return;
      }

      if (decision.shouldSave) {
        savingRef.current = true;
        const term: DeckCardTerminal = decision.terminal ?? 'timeout';
        const failureClass =
          term === 'identified' || term === 'ambiguous' ? null : classifyDeckFailure(live);
        const owned =
          live.identityOwnedByCurrentSession === true ||
          (sessionId != null &&
            live.resultCardSessionId != null &&
            sessionId === live.resultCardSessionId);
        const freshCount =
          live.freshEvidenceCountForSession ?? live.recognizeAttempts ?? null;
        const swapKind = run.swapKindForNext;
        const savedName = live.identity;

        // Claim slot + prompt swap BEFORE PNG encode (that was the multi-second lag).
        run.recordedSlots.add(decision.slotKey);
        if (sessionId != null) run.recordedSlots.add(`s:${sessionId}`);
        run.armedSessionId = sessionId;
        run.swapKindForNext = 'automatic';
        run.phase = 'next-card';
        run.nextPromptAt = monoNow();
        setUi(u => ({
          ...u,
          phase: 'next-card',
          canSwapNow: true,
          message:
            term === 'timeout'
              ? `SWAP NOW · ${failureClass ?? 'timeout'}`
              : 'SWAP NOW · you can change the card',
          recognitionName: savedName,
          showManualNext: false,
          index: Math.min(idx + 1, run.bundle.targetCount),
        }));
        // Paint name + SWAP NOW first; vibrate after so buzz matches visible UI.
        await yieldForUiPaint();
        beepNext();

        const artifacts = argsRef.current.peekArtifacts?.() ?? {
          cardWarp: live.cardWarp,
          title: live.title,
          source: live.source,
          detector: live.detector,
        };
        const warpImg = artifacts.cardWarp;
        const isAnalysisSized = Boolean(warpImg && warpImg.width < 400);
        const hasHires = live.captureId != null && !isAnalysisSized;

        const record: DeckBenchmarkCardRecord = {
          benchmarkIndex: idx + 1,
          cardSessionId: sessionId,
          resultCardSessionId: live.resultCardSessionId ?? null,
          resultAttemptId: live.resultAttemptId ?? null,
          resultPublishedAt: live.resultPublishedAt ?? null,
          identityOwnedByCurrentSession: owned,
          recognitionAttemptIdsForSession: live.recognitionAttemptIdsForSession ?? [],
          freshEvidenceCountForSession: freshCount,
          terminalSource: decision.terminalSource,
          captureCardSessionId: live.captureCardSessionId ?? null,
          captureId: live.captureId ?? null,
          sourceHash: live.sourceHash ?? null,
          warpHash: live.warpHash ?? null,
          titleHash: live.titleHash ?? null,
          analysisWarpHash: isAnalysisSized ? live.warpHash ?? null : null,
          analysisWarpSize: isAnalysisSized && warpImg
            ? { width: warpImg.width, height: warpImg.height }
            : null,
          recognitionWarpHash: !isAnalysisSized ? live.warpHash ?? null : null,
          recognitionWarpSize:
            !isAnalysisSized && warpImg
              ? { width: warpImg.width, height: warpImg.height }
              : null,
          hasTrueHiresCapture: hasHires,
          recognitionSourceChannel: live.recognitionSourceChannel ?? null,
          attemptCardSessionId: live.attemptCardSessionId ?? sessionId,
          geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? null,
          focusAttemptId: gates?.focusAttemptId ?? null,
          recognizeAttempts: live.recognizeAttempts,
          terminal: term,
          failureClass,
          staleIdentityRejected: false,
          status: live.recognitionStatus,
          matchName: live.identity,
          matchScore: live.matchScore,
          matchMethod: matchMethodOf(live, term),
          ocrTexts: live.ocrTexts ?? [],
          detectorScore: live.detectorScore,
          recognitionSource: live.recognitionSource,
          swapKind,
          timings: {
            totalMs: monoNow() - run.cardStartedAt,
            lockToIdentityMs:
              live.lockedAt != null && live.finalIdentityAt != null
                ? Math.max(0, live.finalIdentityAt - live.lockedAt)
                : null,
          },
          evidence: evidenceOf(live),
          files: { metadata: '' },
          recordedAt: new Date().toISOString(),
        };

        try {
          const saved = await saveDeckCardArtifacts({
            fixtureId: run.bundle.fixtureId,
            record,
            source: artifacts.source,
            cardWarp: artifacts.cardWarp,
            title: artifacts.title,
            detector: artifacts.detector,
          });
          run.bundle.cards.push(saved);
          await persistRun(run);
          setUi(u => ({
            ...u,
            phase: 'next-card',
            canSwapNow: true,
            message: 'SWAP NOW · replace the card',
            recognitionName: saved.matchName,
            showManualNext: false,
            index: Math.min(run.bundle.cards.length + 1, run.bundle.targetCount),
          }));
          if (run.bundle.cards.length >= run.bundle.targetCount) {
            await finish(run);
          }
        } catch (err) {
          setUi(u => ({
            ...u,
            phase: 'next-card',
            canSwapNow: true,
            message: err instanceof Error ? err.message : String(err),
          }));
        } finally {
          savingRef.current = false;
        }
      }
    };

    const id = setInterval(() => {
      void tick();
    }, 100);
    void tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ui.phase, finish, persistRun]);

  return {
    ui,
    configOpen,
    setConfigOpen,
    draftCount,
    setDraftCount,
    counts: DECK_BENCHMARK_COUNTS,
    openConfig,
    start,
    cancel,
    markManualNext,
    resumeOffer,
    resume,
    discardInterrupted,
    finishEarly,
    retryMissingUpload,
    active:
      ui.phase !== 'idle' &&
      ui.phase !== 'config' &&
      ui.phase !== 'cancelled' &&
      ui.phase !== 'complete',
  };
};
