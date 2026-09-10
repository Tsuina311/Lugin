import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';

import {
  SWAP_TEST_COUNTS,
  swapIdForIndex,
  type SwapTestBundle,
  type SwapTestCaptureRecord,
  type SwapTestCount,
  type SwapTestPhase,
  type SwapTestTransition,
} from '@/lib/scan/swapTest';
import { monoNow } from '@/lib/scan/timing';
import type { CardNameIndex } from '@/lib/scan/matchName';
import type { TextRecognizer } from '@/lib/scan/textRecognizer';
import type { LockGates } from '@/lib/scan/session/controller';
import type { CameraRef } from 'react-native-vision-camera';

import type { ScanImage } from '../sharedCore';
import { enqueueSwapTest } from '../debugInbox/enqueueSwapTest';
import { captureSwapSlot, type SwapSlotLatch } from './captureOne';
import { saveSwapTestRun } from './persist';

export const SWAP_DETECT_TIMEOUT_MS = 12_000;
export const SWAP_STABLE_MS = 250;
export const SWAP_GONE_MS = 400;

export type CardSwapUi = {
  cardSessionId: number | null;
  fixtureId: string | null;
  geometryTrackId: number | null;
  index: number;
  message: string;
  phase: SwapTestPhase;
  showMarkSwapped: boolean;
  targetCount: number;
};

const idleUi = (): CardSwapUi => ({
  cardSessionId: null,
  fixtureId: null,
  geometryTrackId: null,
  index: 0,
  message: '',
  phase: 'idle',
  showMarkSwapped: false,
  targetCount: 5,
});

const makeFixtureId = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `swap-test-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const beepSwap = () => {
  try {
    Vibration.vibrate([0, 120, 80, 120, 80, 220]);
  } catch {
    /* ignore */
  }
};

export type LivePeek = {
  gates: LockGates | null;
  identity: string | null;
  latch: SwapSlotLatch | null;
  recognitionDecision: string | null;
  recognitionStatus: string | null;
  recognizeAttempts: number | null;
};

export type UseCardSwapTestArgs = {
  cameraRef: { current: CameraRef | null };
  getOcr: () => TextRecognizer | null;
  getNameIndex: () => CardNameIndex | null;
  markDebugCardSwapped: () => void;
  setLabHold: (held: boolean) => void;
  peekLive: () => LivePeek;
};

type RunState = {
  confirmPeak: number;
  expectedLabels: string[];
  fixtureId: string;
  goneSince: number | null;
  images: { card: ScanImage; index: number; source: ScanImage }[];
  /** After Mark swapped: next stable capture is accepted even if session unchanged. */
  manualArmed: boolean;
  /** Baseline from last capture — used to detect A→B. */
  previous: {
    cardSessionId: number | null;
    focusAttemptId: number | null;
    geometryTrackId: number | null;
    identity: string | null;
    recognizeAttempts: number | null;
  } | null;
  phase: SwapTestPhase;
  promptAt: number | null;
  swaps: SwapTestCaptureRecord[];
  targetCount: number;
  transitions: SwapTestTransition[];
};

export const useCardSwapTest = (args: UseCardSwapTestArgs) => {
  const [ui, setUi] = useState<CardSwapUi>(idleUi);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftCount, setDraftCount] = useState<SwapTestCount>(5);
  const [draftLabels, setDraftLabels] = useState('');

  const runRef = useRef<RunState | null>(null);
  const cancelledRef = useRef(false);
  const capturingRef = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  const openConfig = useCallback(() => {
    const run = runRef.current;
    if (run && run.phase !== 'done' && run.phase !== 'cancelled' && run.phase !== 'idle') return;
    setConfigOpen(true);
    setUi(u => ({ ...u, phase: 'config', message: 'Choose swap count (labels optional)' }));
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    runRef.current = null;
    capturingRef.current = false;
    argsRef.current.setLabHold(false);
    setConfigOpen(false);
    setUi(idleUi());
  }, []);

  const markSwapped = useCallback(() => {
    const run = runRef.current;
    if (!run || (run.phase !== 'swap-now' && run.phase !== 'waiting-next')) return;
    argsRef.current.markDebugCardSwapped();
    run.manualArmed = true;
    run.phase = 'waiting-next';
    setUi(u => ({
      ...u,
      phase: 'waiting-next',
      showMarkSwapped: false,
      message: 'Marked swapped — new session forced; waiting for next card',
    }));
  }, []);

  const finishAndUpload = useCallback(async (run: RunState) => {
    const bundle: SwapTestBundle = {
      capturedAt: new Date().toISOString(),
      expectedLabels: run.expectedLabels,
      fixtureId: run.fixtureId,
      phase: 'done',
      swaps: run.swaps,
      targetCount: run.targetCount,
      transitions: run.transitions,
    };
    setUi(u => ({
      ...u,
      phase: 'done',
      message: `Saving ${run.fixtureId}…`,
      showMarkSwapped: false,
    }));
    try {
      const saved = await saveSwapTestRun({ bundle, images: run.images });
      const queued = await enqueueSwapTest({
        dirUri: saved.dirUri,
        files: saved.files,
        fixtureId: bundle.fixtureId,
      });
      setUi(u => ({
        ...u,
        phase: 'done',
        message: queued.queued
          ? `Uploaded ${bundle.fixtureId}`
          : `Saved ${bundle.fixtureId}${queued.reason ? ` · ${queued.reason}` : ''}`,
      }));
    } catch (err) {
      setUi(u => ({
        ...u,
        phase: 'done',
        message: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      runRef.current = null;
    }
  }, []);

  const start = useCallback(
    (opts?: { count?: SwapTestCount; expectedLabelsText?: string }) => {
      cancelledRef.current = false;
      capturingRef.current = false;
      const count = opts?.count ?? draftCount;
      const labels = (opts?.expectedLabelsText ?? draftLabels)
        .split(/\n+/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, count);
      const fixtureId = makeFixtureId();
      runRef.current = {
        confirmPeak: 0,
        expectedLabels: labels,
        fixtureId,
        goneSince: null,
        images: [],
        manualArmed: false,
        previous: null,
        phase: 'waiting-stable',
        promptAt: null,
        swaps: [],
        targetCount: count,
        transitions: [],
      };
      setConfigOpen(false);
      setUi({
        cardSessionId: null,
        fixtureId,
        geometryTrackId: null,
        index: 0,
        message: 'Waiting for stable card',
        phase: 'waiting-stable',
        showMarkSwapped: false,
        targetCount: count,
      });
    },
    [draftCount, draftLabels],
  );

  useEffect(() => {
    const active =
      ui.phase === 'waiting-stable' ||
      ui.phase === 'swap-now' ||
      ui.phase === 'waiting-next' ||
      ui.phase === 'capturing';
    if (!active) return;

    let alive = true;

    const tick = async () => {
      if (!alive || cancelledRef.current || capturingRef.current) return;
      const run = runRef.current;
      if (!run) return;
      const a = argsRef.current;
      const live = a.peekLive();
      const gates = live.gates;
      const nextIndex = run.swaps.length;

      setUi(u => ({
        ...u,
        cardSessionId: gates?.cardSessionId ?? u.cardSessionId,
        geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? u.geometryTrackId,
        index: Math.min(nextIndex + 1, run.targetCount),
        phase: run.phase,
      }));

      // ——— detect swap after a capture ———
      if ((run.phase === 'swap-now' || run.phase === 'waiting-next') && run.previous && gates) {
        if (gates.visualConfirmPending > run.confirmPeak) {
          run.confirmPeak = gates.visualConfirmPending;
        }
        if ((gates.changeWatchConfirmCount ?? 0) > run.confirmPeak) {
          run.confirmPeak = gates.changeWatchConfirmCount ?? 0;
        }
        if (!gates.geometryDetected) {
          if (run.goneSince == null) run.goneSince = monoNow();
        } else {
          run.goneSince = null;
        }

        const sessionChanged =
          run.previous.cardSessionId != null &&
          gates.cardSessionId !== run.previous.cardSessionId;
        const identityChanged =
          Boolean(run.previous.identity) &&
          Boolean(gates.currentSessionIdentity) &&
          gates.currentSessionIdentity !== run.previous.identity;
        const resetReason = gates.sessionResetReason;
        const visualish =
          resetReason === 'visual-change' ||
          resetReason === 'identity-change' ||
          resetReason === 'card-gone';
        const goneLong = run.goneSince != null && monoNow() - run.goneSince >= SWAP_GONE_MS;

        if (!run.manualArmed && (sessionChanged || identityChanged || visualish || goneLong)) {
          run.phase = 'waiting-next';
          setUi(u => ({
            ...u,
            phase: 'waiting-next',
            message: 'Waiting for next card',
            showMarkSwapped: false,
          }));
        }

        const elapsed = run.promptAt != null ? monoNow() - run.promptAt : 0;
        if (elapsed >= SWAP_DETECT_TIMEOUT_MS && !run.manualArmed) {
          setUi(u => ({
            ...u,
            showMarkSwapped: true,
            message: run.phase === 'swap-now' ? 'SWAP CARD' : u.message,
          }));
        }
      }

      // ——— capture when stable ———
      const canCapturePhase = run.phase === 'waiting-stable' || run.phase === 'waiting-next';
      if (!canCapturePhase) return;

      const stableOk =
        gates?.stable === true &&
        (gates.stableDurationMs == null || gates.stableDurationMs >= SWAP_STABLE_MS) &&
        live.latch != null &&
        Boolean(gates.geometryDetected);

      if (!stableOk) return;

      if (run.phase === 'waiting-next' && run.previous && !run.manualArmed) {
        const sessionChanged =
          run.previous.cardSessionId != null &&
          gates != null &&
          gates.cardSessionId !== run.previous.cardSessionId;
        if (!sessionChanged) return;
      }

      if (nextIndex >= run.targetCount) {
        run.phase = 'done';
        void finishAndUpload(run);
        return;
      }

      capturingRef.current = true;
      run.phase = 'capturing';
      setUi(u => ({
        ...u,
        phase: 'capturing',
        message: `Capturing ${swapIdForIndex(nextIndex)}…`,
        showMarkSwapped: false,
      }));

      try {
        a.setLabHold(true);
        const slot = await captureSwapSlot({
          cameraRef: a.cameraRef,
          expectedLabel: run.expectedLabels[nextIndex] ?? null,
          gates: {
            cardSessionId: gates?.cardSessionId ?? null,
            focusAttemptId: gates?.focusAttemptId ?? null,
            focusCardSessionId: gates?.focusCardSessionId ?? null,
            geometryTrackId: gates?.geometryTrackId ?? gates?.currentTrackId ?? null,
            recognizeAttemptsForTrack: live.recognizeAttempts,
            sessionResetReason: gates?.sessionResetReason ?? null,
            visualChange: gates?.visualChange ?? null,
            fingerprintDelta: gates?.changeWatchDelta ?? gates?.fingerprintDelta ?? null,
            changeWatchBand: gates?.changeWatchBand ?? null,
            changeWatchDelta: gates?.changeWatchDelta ?? null,
            changeWatchState: gates?.cardChangeState ?? null,
            changeWatchConfirmCount: gates?.changeWatchConfirmCount ?? null,
          },
          index: nextIndex,
          liveIdentity: live.identity,
          liveRecognitionDecision: live.recognitionDecision,
          liveRecognitionStatus: live.recognitionStatus,
          nameIndex: a.getNameIndex(),
          ocr: a.getOcr(),
          peekLatch: () => argsRef.current.peekLive().latch,
          recognizeAttemptsForTrack: live.recognizeAttempts,
        });

        if (run.previous && nextIndex > 0) {
          const detection: SwapTestTransition['detection'] = run.manualArmed
            ? 'manual'
            : gates?.sessionResetReason === 'card-gone'
              ? 'auto-gone'
              : gates?.sessionResetReason === 'identity-change'
                ? 'auto-session'
                : gates?.sessionResetReason === 'visual-change'
                  ? 'auto-visual'
                  : 'auto-session';
          run.transitions.push({
            detection,
            focusAttemptAfter: slot.record.focusAttemptId,
            focusAttemptBefore: run.previous.focusAttemptId,
            fromIndex: nextIndex - 1,
            fromSwapId: swapIdForIndex(nextIndex - 1),
            newCardSessionId: slot.record.cardSessionId,
            newGeometryTrackId: slot.record.geometryTrackId,
            newIdentity: slot.record.identity,
            previousCardSessionId: run.previous.cardSessionId,
            previousGeometryTrackId: run.previous.geometryTrackId,
            previousIdentity: run.previous.identity,
            retryBudgetAfter: slot.record.recognizeAttemptsForTrack,
            retryBudgetBefore: run.previous.recognizeAttempts,
            sessionResetReason: slot.record.sessionResetReason ?? gates?.sessionResetReason ?? null,
            timeToDetectSwapMs:
              run.promptAt != null ? Math.max(0, monoNow() - run.promptAt) : null,
            toIndex: nextIndex,
            toSwapId: swapIdForIndex(nextIndex),
            visualConfirmCount: Math.max(
              run.confirmPeak,
              gates?.changeWatchConfirmCount ?? 0,
              slot.record.changeWatchDelta != null ? 1 : 0,
            ),
            visualFingerprintDelta:
              gates?.changeWatchDelta ??
              gates?.fingerprintDelta ??
              slot.record.changeWatchDelta ??
              slot.record.visualFingerprintDelta,
            changeWatchBand: gates?.changeWatchBand ?? slot.record.changeWatchBand,
            changeWatchState: gates?.cardChangeState ?? slot.record.changeWatchState,
          });
        }

        run.swaps.push(slot.record);
        run.images.push({ card: slot.card, index: nextIndex, source: slot.source });
        run.previous = {
          cardSessionId: slot.record.cardSessionId,
          focusAttemptId: slot.record.focusAttemptId,
          geometryTrackId: slot.record.geometryTrackId,
          identity: slot.record.identity,
          recognizeAttempts: slot.record.recognizeAttemptsForTrack,
        };
        run.manualArmed = false;
        run.confirmPeak = 0;
        run.goneSince = null;

        if (run.swaps.length >= run.targetCount) {
          run.phase = 'done';
          void finishAndUpload(run);
          return;
        }

        run.phase = 'swap-now';
        run.promptAt = monoNow();
        beepSwap();
        setUi(u => ({
          ...u,
          cardSessionId: slot.record.cardSessionId,
          geometryTrackId: slot.record.geometryTrackId,
          index: nextIndex + 1,
          message: 'SWAP CARD',
          phase: 'swap-now',
          showMarkSwapped: false,
        }));
      } catch (err) {
        run.phase = run.previous ? 'waiting-next' : 'waiting-stable';
        setUi(u => ({
          ...u,
          phase: run.phase,
          message: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        a.setLabHold(false);
        capturingRef.current = false;
      }
    };

    const id = setInterval(() => {
      void tick();
    }, 120);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [finishAndUpload, ui.phase]);

  return {
    cancel,
    configOpen,
    draftCount,
    draftLabels,
    markSwapped,
    openConfig,
    setDraftCount,
    setDraftLabels,
    start,
    swapCounts: SWAP_TEST_COUNTS,
    ui,
  };
};
