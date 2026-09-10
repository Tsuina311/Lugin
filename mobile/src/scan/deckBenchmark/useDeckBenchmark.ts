import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';

import {
  DECK_BENCHMARK_COUNTS,
  classifyDeckFailure,
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
import { enqueueDeckBenchmark } from './enqueue';
import {
  loadDeckActiveMeta,
  loadDeckBundle,
  persistDeckActiveMeta,
  saveDeckBundle,
  saveDeckCardArtifacts,
} from './persist';

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
});

const makeFixtureId = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `deck-test-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const beepNext = () => {
  try {
    Vibration.vibrate([0, 140, 70, 140, 70, 240]);
  } catch {
    /* ignore */
  }
};

export type DeckLivePeek = {
  gates: LockGates | null;
  identity: string | null;
  phase: string | null;
  recognitionDecision: string | null;
  recognitionStatus: string | null;
  recognizeAttempts: number | null;
  matchScore: number | null;
  ocrTexts: string[];
  detectorScore: number | null;
  recognitionSource: string | null;
  lockedAt: number | null;
  finalIdentityAt: number | null;
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
  setLabHold: (held: boolean) => void;
};

type RunState = {
  armedSessionId: number | null;
  bundle: DeckBenchmarkBundle;
  cardStartedAt: number;
  /** One save per physical card slot — session id or timeout attempt key. */
  recordedSlots: Set<string>;
  manualArmed: boolean;
  nextPromptAt: number | null;
  phase: DeckBenchmarkPhase;
  swapKindForNext: DeckSwapKind;
};

const classifyTerminal = (live: DeckLivePeek): DeckCardTerminal | null => {
  const status = (live.recognitionStatus || live.phase || '').toLowerCase();
  if (status === 'found' || status === 'identified') return 'identified';
  if (status === 'ambiguous') return 'ambiguous';
  if (status.includes('empty') || live.recognitionDecision === 'empty') return 'ocr-empty';
  if (status.includes('exhausted') || status.includes('budget')) return 'budget-exhausted';
  if (status === 'failed' || status === 'error') return 'failed';
  return null;
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

const slotKeyFor = (sessionId: number | null, cardStartedAt: number): string =>
  sessionId != null ? `s:${sessionId}` : `t:${cardStartedAt}`;


export const useDeckBenchmark = (args: UseDeckBenchmarkArgs) => {
  const [ui, setUi] = useState<DeckBenchmarkUi>(idleUi);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftCount, setDraftCount] = useState<DeckBenchmarkCount>(60);
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
    await persistRun(run);
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: `Uploading ${run.bundle.cards.length} cards…`,
      showManualNext: false,
    }));
    try {
      const dir = await saveDeckBundle(run.bundle);
      const queued = await enqueueDeckBenchmark({
        dirUri: dir,
        bundle: run.bundle,
      });
      await persistDeckActiveMeta(null);
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: queued.queued
          ? `DECK TEST COMPLETE · ${run.bundle.cards.length} cards · uploaded`
          : `DECK TEST COMPLETE · ${run.bundle.cards.length} cards · saved locally`,
      }));
    } catch (err) {
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      runRef.current = null;
      argsRef.current.setLabHold(false);
    }
  }, [persistRun]);

  const start = useCallback(
    async (opts?: {
      count?: DeckBenchmarkCount;
      expectedMultiset?: DeckExpectedMultisetEntry[] | null;
      expectedDeckId?: string | null;
      expectedDeckName?: string | null;
    }) => {
      if (!isBenchmarkToolsEnabled()) return;
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
        manualArmed: false,
        nextPromptAt: null,
        phase: 'detecting',
        swapKindForNext: 'automatic',
      };
      await persistRun(runRef.current);
      argsRef.current.setLabHold(true);
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
      });
    },
    [draftCount, persistRun],
  );

  const resume = useCallback(async () => {
    const offer = resumeOffer;
    if (!offer) return;
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
      manualArmed: false,
      nextPromptAt: null,
      phase: 'detecting',
      swapKindForNext: 'automatic',
    };
    await persistDeckActiveMeta(offer.fixtureId);
    argsRef.current.setLabHold(true);
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
    });
  }, [resumeOffer]);

  const discardInterrupted = useCallback(async () => {
    if (resumeOffer) await persistDeckActiveMeta(null);
    setResumeOffer(null);
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
          manualArmed: false,
          nextPromptAt: null,
          phase: 'complete',
          swapKindForNext: 'automatic',
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

  // Restore interrupted run on mount
  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void (async () => {
      const meta = await loadDeckActiveMeta();
      if (!meta?.fixtureId) return;
      const bundle = await loadDeckBundle(meta.fixtureId);
      if (!bundle || bundle.phase === 'complete') {
        await persistDeckActiveMeta(null);
        return;
      }
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

      setUi(u => ({
        ...u,
        cardSessionId: gates?.cardSessionId ?? u.cardSessionId,
        geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? u.geometryTrackId,
        index: Math.min(idx + 1, run.bundle.targetCount),
        phase: run.phase,
        recognitionName: live.identity,
        message:
          run.phase === 'next-card'
            ? 'NEXT CARD'
            : run.phase === 'waiting-next'
              ? 'Waiting for new card session'
              : live.identity
                ? live.identity
                : u.message,
      }));

      // Wait for new session after NEXT CARD
      if (run.phase === 'next-card' || run.phase === 'waiting-next') {
        const elapsed = run.nextPromptAt != null ? monoNow() - run.nextPromptAt : 0;
        if (elapsed >= DECK_NEXT_TIMEOUT_MS && !run.manualArmed) {
          setUi(u => ({ ...u, showManualNext: true, message: 'NEXT CARD MANUALLY' }));
        }
        if (gates) {
          const sessionChanged =
            run.armedSessionId != null && gates.cardSessionId !== run.armedSessionId;
          // After a no-session timeout, any new session (or geometry return) arms next card.
          const firstSessionAfterTimeout =
            run.armedSessionId == null &&
            gates.cardSessionId != null &&
            elapsed > 350;
          const gone = !gates.geometryDetected;
          if (
            run.manualArmed ||
            sessionChanged ||
            firstSessionAfterTimeout ||
            (gone && elapsed > 400)
          ) {
            if (run.manualArmed || sessionChanged || firstSessionAfterTimeout) {
              run.phase = 'detecting';
              run.cardStartedAt = monoNow();
              run.manualArmed = false;
              run.nextPromptAt = null;
              run.armedSessionId = gates.cardSessionId;
              setUi(u => ({
                ...u,
                phase: 'detecting',
                showManualNext: false,
                message: 'Place next card',
                recognitionName: null,
              }));
            }
          }
        }
        return;
      }

      // Capture terminal recognition OR wall-clock timeout — never hang.
      // One physical card/session → one benchmark item (recordedSlots).
      const terminal = classifyTerminal(live);
      const sessionId = gates?.cardSessionId ?? null;
      const timedOut = monoNow() - run.cardStartedAt >= DECK_CARD_TIMEOUT_MS;
      const slotKey = slotKeyFor(sessionId, run.cardStartedAt);
      const shouldSave =
        !run.recordedSlots.has(slotKey) &&
        (Boolean(terminal) || timedOut) &&
        // Success path needs a session; timeout always saves even with no geometry.
        (Boolean(terminal) ? sessionId != null : true);

      if (shouldSave) {
        savingRef.current = true;
        const term: DeckCardTerminal = terminal ?? 'timeout';
        const failureClass =
          term === 'identified' || term === 'ambiguous' ? null : classifyDeckFailure(live);
        const record: DeckBenchmarkCardRecord = {
          benchmarkIndex: idx + 1,
          cardSessionId: sessionId,
          geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? null,
          focusAttemptId: gates?.focusAttemptId ?? null,
          recognizeAttempts: live.recognizeAttempts,
          terminal: term,
          failureClass,
          status: live.recognitionStatus,
          matchName: live.identity,
          matchScore: live.matchScore,
          matchMethod: matchMethodOf(live, term),
          ocrTexts: live.ocrTexts ?? [],
          detectorScore: live.detectorScore,
          recognitionSource: live.recognitionSource,
          swapKind: run.swapKindForNext,
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
            source: live.source,
            cardWarp: live.cardWarp,
            title: live.title,
            detector: live.detector,
          });
          run.bundle.cards.push(saved);
          run.recordedSlots.add(slotKey);
          if (sessionId != null) run.recordedSlots.add(`s:${sessionId}`);
          run.armedSessionId = sessionId;
          run.swapKindForNext = 'automatic';
          await persistRun(run);
          beepNext();
          run.phase = 'next-card';
          run.nextPromptAt = monoNow();
          setUi(u => ({
            ...u,
            phase: 'next-card',
            message:
              term === 'timeout'
                ? `NEXT CARD · ${failureClass ?? 'timeout'}`
                : 'NEXT CARD',
            recognitionName: saved.matchName,
            showManualNext: false,
            index: Math.min(run.bundle.cards.length + 1, run.bundle.targetCount),
          }));
          if (run.bundle.cards.length >= run.bundle.targetCount) {
            await finish(run);
          }
        } finally {
          savingRef.current = false;
        }
      }
    };

    const id = setInterval(() => {
      void tick();
    }, 200);
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
    active: ui.phase !== 'idle' && ui.phase !== 'config' && ui.phase !== 'complete' && ui.phase !== 'cancelled',
  };
};
