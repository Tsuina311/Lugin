import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import type { CameraRef } from 'react-native-vision-camera';

import {
  BINDER_PAGE_COUNTS,
  binderFrameFile,
  type BinderBenchmarkBundle,
  type BinderFrameMeta,
  type BinderPageCount,
  type BinderPageRecord,
  type BinderBenchmarkPhase,
} from '@/lib/scan/binderBenchmark';
import { monoNow } from '@/lib/scan/timing';
import type { LockGates } from '@/lib/scan/session/controller';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { HIRES_MAX_LONG_EDGE } from '../hiresCapture';
import { imageToScanImage } from '../imageToScanImage';
import { enqueueBinderBenchmark } from './enqueue';
import {
  loadBinderActiveMeta,
  loadBinderBundle,
  persistBinderActiveMeta,
  saveBinderBundle,
  saveBinderPage,
  writeBinderFramePng,
} from './persist';

/** ~3.5 snapshots/sec × ~2.7s ≈ 9–10 frames; avoids hammering AF. */
export const BINDER_CAPTURE_MS = 2700;
export const BINDER_CADENCE_MS = 280;
export const BINDER_TURN_AUTO_MS = 1600;

export type BinderBenchmarkUi = {
  fixtureId: string | null;
  framesCollected: number;
  message: string;
  pageIndex: number;
  phase: BinderBenchmarkPhase;
  targetPages: number;
  interrupted: boolean;
};

const idleUi = (): BinderBenchmarkUi => ({
  fixtureId: null,
  framesCollected: 0,
  message: '',
  pageIndex: 0,
  phase: 'idle',
  targetPages: 5,
  interrupted: false,
});

const makeFixtureId = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `binder-test-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const beepTurn = () => {
  try {
    Vibration.vibrate([0, 180, 90, 180]);
  } catch {
    /* ignore */
  }
};

export type BinderLivePeek = {
  gates: LockGates | null;
  focusState: string | null;
};

export type UseBinderBenchmarkArgs = {
  cameraRef: { current: CameraRef | null };
  peekLive: () => BinderLivePeek;
  setLabHold: (held: boolean) => void;
};

type RunState = {
  bundle: BinderBenchmarkBundle;
  capturing: boolean;
  phase: BinderBenchmarkPhase;
  turnAt: number | null;
};

export const useBinderBenchmark = (args: UseBinderBenchmarkArgs) => {
  const [ui, setUi] = useState<BinderBenchmarkUi>(idleUi);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftPages, setDraftPages] = useState<BinderPageCount>(5);
  const [resumeOffer, setResumeOffer] = useState<BinderBenchmarkBundle | null>(null);

  const runRef = useRef<RunState | null>(null);
  const cancelledRef = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  const openConfig = useCallback(() => {
    if (!isBenchmarkToolsEnabled()) return;
    const run = runRef.current;
    if (run && run.phase !== 'complete' && run.phase !== 'cancelled' && run.phase !== 'idle') return;
    setConfigOpen(true);
    setUi(u => ({ ...u, phase: 'config', message: 'Choose page count' }));
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    runRef.current = null;
    argsRef.current.setLabHold(false);
    void persistBinderActiveMeta(null);
    setConfigOpen(false);
    setResumeOffer(null);
    setUi(idleUi());
  }, []);

  const finish = useCallback(async (run: RunState) => {
    run.phase = 'complete';
    run.bundle.phase = 'complete';
    run.bundle.completedAt = new Date().toISOString();
    const dir = await saveBinderBundle(run.bundle);
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: `Uploading ${run.bundle.pages.length} pages…`,
    }));
    try {
      const queued = await enqueueBinderBenchmark({ dirUri: dir, bundle: run.bundle });
      await persistBinderActiveMeta(null);
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: queued.queued
          ? `BINDER TEST COMPLETE · ${run.bundle.pages.length} pages · uploaded`
          : `BINDER TEST COMPLETE · ${run.bundle.pages.length} pages · saved`,
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
  }, []);

  const capturePage = useCallback(async (run: RunState, pageIndex: number) => {
    const cam = argsRef.current.cameraRef.current;
    if (!cam?.takeSnapshot) throw new Error('takeSnapshot unavailable');
    run.capturing = true;
    run.phase = 'capturing';
    const startedAt = new Date().toISOString();
    const t0 = monoNow();
    const frames: BinderFrameMeta[] = [];
    let frameIndex = 0;

    setUi(u => ({
      ...u,
      phase: 'capturing',
      pageIndex,
      framesCollected: 0,
      message: 'MOVE PHONE SLOWLY OVER PAGE',
    }));

    while (monoNow() - t0 < run.bundle.captureDurationMs && !cancelledRef.current) {
      const loopStart = monoNow();
      let snap: Awaited<ReturnType<NonNullable<CameraRef['takeSnapshot']>>> | null = null;
      try {
        const live = argsRef.current.peekLive();
        snap = await cam.takeSnapshot();
        // VisionCamera snapshot is a nitro Image — not a {path} file.
        const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
        frameIndex += 1;
        const file = binderFrameFile(pageIndex, frameIndex);
        await writeBinderFramePng(run.bundle.fixtureId, file, source);
        frames.push({
          pageIndex,
          frameIndex,
          timestamp: new Date().toISOString(),
          monoMs: monoNow() - t0,
          width: source.width,
          height: source.height,
          orientation: null,
          captureSource: 'snapshot',
          geometryTrackId:
            live.gates?.geometryTrackId ?? live.gates?.currentTrackId ?? null,
          detectorScore: null,
          selectedQuad: null,
          focusState: live.focusState,
          file,
        });
        setUi(u => ({
          ...u,
          framesCollected: frames.length,
          message: `CAPTURING… ${frames.length} frames`,
        }));
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        setUi(u => ({
          ...u,
          message: `snapshot fail · ${why.slice(0, 48)}`,
        }));
      } finally {
        try {
          (snap as { dispose?: () => void } | null)?.dispose?.();
        } catch {
          /* ignore */
        }
      }
      const spent = monoNow() - loopStart;
      const wait = Math.max(0, run.bundle.frameCadenceMs - spent);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }

    if (frames.length === 0) {
      run.capturing = false;
      throw new Error(
        `Binder page ${pageIndex}: 0 frames captured — takeSnapshot produced no images`,
      );
    }

    const page: BinderPageRecord = {
      pageIndex,
      layout: run.bundle.layout,
      frames,
      startedAt,
      endedAt: new Date().toISOString(),
      captureDurationMs: monoNow() - t0,
      targetFrameCount: Math.round(run.bundle.captureDurationMs / run.bundle.frameCadenceMs),
    };
    run.bundle.pages.push(page);
    await saveBinderPage(run.bundle.fixtureId, page);
    await saveBinderBundle(run.bundle);
    await persistBinderActiveMeta(run.bundle.fixtureId);
    run.capturing = false;
    beepTurn();

    if (run.bundle.pages.length >= run.bundle.targetPages) {
      await finish(run);
      return;
    }

    run.phase = 'turn-page';
    run.turnAt = monoNow();
    setUi(u => ({
      ...u,
      phase: 'turn-page',
      pageIndex: pageIndex + 1,
      framesCollected: frames.length,
      message: 'TURN PAGE',
    }));
  }, [finish]);

  const start = useCallback(
    async (opts?: { pages?: BinderPageCount }) => {
      if (!isBenchmarkToolsEnabled()) return;
      cancelledRef.current = false;
      const pages = Math.max(1, Math.floor(opts?.pages ?? Number(draftPages) ?? 5));
      const fixtureId = makeFixtureId();
      const bundle: BinderBenchmarkBundle = {
        kind: 'binder-benchmark',
        fixtureId,
        createdAt: new Date().toISOString(),
        completedAt: null,
        targetPages: pages,
        layout: { rows: 3, cols: 3 },
        captureDurationMs: BINDER_CAPTURE_MS,
        frameCadenceMs: BINDER_CADENCE_MS,
        captureSource: 'snapshot',
        captureNote:
          'JS takeSnapshot → PNG ~280ms cadence × ~2.7s ≈ 8–12 frames/page. Not live Y-plane; host replays from PNG RGBA.',
        pages: [],
        phase: 'capturing',
        note: 'REAL binder capture — geometry replay on Mac only. Phone does not claim 9/9.',
      };
      const run: RunState = { bundle, capturing: false, phase: 'capturing', turnAt: null };
      runRef.current = run;
      try {
        await saveBinderBundle(bundle);
        await persistBinderActiveMeta(fixtureId);
        argsRef.current.setLabHold(true);
        setConfigOpen(false);
        setResumeOffer(null);
        setUi({
          fixtureId,
          framesCollected: 0,
          message: 'MOVE PHONE SLOWLY OVER PAGE',
          pageIndex: 1,
          phase: 'capturing',
          targetPages: pages,
          interrupted: false,
        });
        await capturePage(run, 1);
      } catch (err) {
        argsRef.current.setLabHold(false);
        runRef.current = null;
        await persistBinderActiveMeta(null);
        setUi(u => ({
          ...u,
          phase: 'cancelled',
          message: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [capturePage, draftPages],
  );

  const nextPage = useCallback(async () => {
    const run = runRef.current;
    if (!run || run.capturing) return;
    if (run.phase !== 'turn-page' && run.phase !== 'waiting-next') return;
    const next = run.bundle.pages.length + 1;
    await capturePage(run, next);
  }, [capturePage]);

  const resume = useCallback(async () => {
    const offer = resumeOffer;
    if (!offer) return;
    cancelledRef.current = false;
    const run: RunState = {
      bundle: { ...offer, phase: 'turn-page' },
      capturing: false,
      phase: 'turn-page',
      turnAt: monoNow(),
    };
    runRef.current = run;
    await persistBinderActiveMeta(offer.fixtureId);
    argsRef.current.setLabHold(true);
    setResumeOffer(null);
    setUi({
      fixtureId: offer.fixtureId,
      framesCollected: 0,
      message: `Resumed · ${offer.pages.length}/${offer.targetPages} · TURN PAGE or tap NEXT`,
      pageIndex: offer.pages.length + 1,
      phase: 'turn-page',
      targetPages: offer.targetPages,
      interrupted: false,
    });
  }, [resumeOffer]);

  const discardInterrupted = useCallback(async () => {
    if (resumeOffer) await persistBinderActiveMeta(null);
    setResumeOffer(null);
    setUi(idleUi());
  }, [resumeOffer]);

  const finishEarly = useCallback(async () => {
    const run = runRef.current;
    if (run) {
      await finish(run);
      return;
    }
    if (resumeOffer) {
      runRef.current = {
        bundle: resumeOffer,
        capturing: false,
        phase: 'complete',
        turnAt: null,
      };
      setResumeOffer(null);
      await finish(runRef.current);
    }
  }, [finish, resumeOffer]);

  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    void (async () => {
      const meta = await loadBinderActiveMeta();
      if (!meta?.fixtureId) return;
      const bundle = await loadBinderBundle(meta.fixtureId);
      if (!bundle || bundle.phase === 'complete') {
        await persistBinderActiveMeta(null);
        return;
      }
      setResumeOffer(bundle);
      setUi({
        ...idleUi(),
        fixtureId: bundle.fixtureId,
        pageIndex: bundle.pages.length,
        targetPages: bundle.targetPages,
        phase: 'interrupted',
        interrupted: true,
        message: `Interrupted ${bundle.pages.length}/${bundle.targetPages} pages`,
      });
    })();
  }, []);

  // Auto-advance after TURN PAGE pause
  useEffect(() => {
    if (ui.phase !== 'turn-page') return;
    const id = setTimeout(() => {
      void nextPage();
    }, BINDER_TURN_AUTO_MS);
    return () => clearTimeout(id);
  }, [ui.phase, ui.pageIndex, nextPage]);

  return {
    ui,
    configOpen,
    setConfigOpen,
    draftPages,
    setDraftPages,
    counts: BINDER_PAGE_COUNTS,
    openConfig,
    start,
    cancel,
    nextPage,
    resumeOffer,
    resume,
    discardInterrupted,
    finishEarly,
    active:
      ui.phase !== 'idle' &&
      ui.phase !== 'config' &&
      ui.phase !== 'complete' &&
      ui.phase !== 'cancelled',
  };
};
