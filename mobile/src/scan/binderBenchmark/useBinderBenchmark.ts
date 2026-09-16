import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import type { CameraRef } from 'react-native-vision-camera';

import {
  BINDER_AUTO_ADVANCE_PAGES,
  BINDER_MAX_PAGE_MS,
  BINDER_MIN_FRAMES_OK,
  BINDER_PAGE_COUNTS,
  BINDER_TARGET_FRAMES,
  binderAfterSaveAction,
  binderCanStartNextPageCapture,
  binderFrameFile,
  classifyBinderPageStatus,
  shouldStopBinderCapture,
  type BinderBenchmarkBundle,
  type BinderFrameMeta,
  type BinderPageCount,
  type BinderPageRecord,
  type BinderBenchmarkPhase,
  type BinderPageStatus,
} from '@/lib/scan/binderBenchmark';
import { monoNow } from '@/lib/scan/timing';
import type { LockGates } from '@/lib/scan/session/controller';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { HIRES_MAX_LONG_EDGE } from '../hiresCapture';
import { imageToScanImage } from '../imageToScanImage';
import { claimScannerMode, releaseScannerMode } from '../scannerMode';
import { enqueueBinderBenchmark } from './enqueue';
import {
  formatUploadIncompleteMessage,
} from '@/lib/scan/benchmarkUpload';
import {
  loadBinderActiveMeta,
  loadBinderBundle,
  persistBinderActiveMeta,
  saveBinderBundle,
  saveBinderPage,
  writeBinderFramePng,
} from './persist';

export {
  BINDER_AUTO_ADVANCE_PAGES,
  BINDER_MAX_PAGE_MS,
  BINDER_MIN_FRAMES_OK,
  BINDER_TARGET_FRAMES,
};

export type BinderBenchmarkUi = {
  fixtureId: string | null;
  framesCollected: number;
  framesTarget: number;
  /** Brief cue after takeSnapshot, before encode finishes. */
  captureCue: string | null;
  message: string;
  pageIndex: number;
  pageStatus: BinderPageStatus | null;
  phase: BinderBenchmarkPhase;
  targetPages: number;
  interrupted: boolean;
  uploadIncomplete?: boolean;
  retryUpload?: boolean;
};

const idleUi = (): BinderBenchmarkUi => ({
  fixtureId: null,
  framesCollected: 0,
  framesTarget: BINDER_TARGET_FRAMES,
  captureCue: null,
  message: '',
  pageIndex: 0,
  pageStatus: null,
  phase: 'idle',
  targetPages: 5,
  interrupted: false,
  uploadIncomplete: false,
  retryUpload: false,
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
  const captureLockRef = useRef(false);
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
    captureLockRef.current = false;
    argsRef.current.setLabHold(false);
    releaseScannerMode('binder-benchmark');
    void persistBinderActiveMeta(null);
    setConfigOpen(false);
    setResumeOffer(null);
    setUi(idleUi());
  }, []);

  const finish = useCallback(async (run: RunState) => {
    run.phase = 'complete';
    run.bundle.phase = 'complete';
    run.bundle.completedAt = new Date().toISOString();
    run.bundle.uploadStatus = 'PENDING';
    const dir = await saveBinderBundle(run.bundle);
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: `Uploading ${run.bundle.pages.length} pages…`,
      uploadIncomplete: false,
      retryUpload: false,
    }));
    try {
      const outcome = await enqueueBinderBenchmark({
        dirUri: dir,
        bundle: run.bundle,
        onProgress: (acked, total) => {
          setUi(u => ({
            ...u,
            message: `Uploading ${acked} / ${total} files…`,
          }));
        },
      });
      await persistBinderActiveMeta(
        outcome.uploadStatus === 'COMPLETE' ? null : run.bundle.fixtureId,
      );
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: outcome.message,
        uploadIncomplete: outcome.uploadStatus !== 'COMPLETE',
        retryUpload: outcome.uploadStatus !== 'COMPLETE',
        fixtureId: run.bundle.fixtureId,
      }));
      if (outcome.uploadStatus === 'COMPLETE') {
        runRef.current = null;
      }
      captureLockRef.current = false;
      argsRef.current.setLabHold(false);
      releaseScannerMode('binder-benchmark');
    } catch (err) {
      setUi(u => ({
        ...u,
        phase: 'complete',
        message: err instanceof Error ? err.message : String(err),
        uploadIncomplete: true,
        retryUpload: true,
      }));
      captureLockRef.current = false;
      argsRef.current.setLabHold(false);
      releaseScannerMode('binder-benchmark');
    }
  }, []);

  const retryMissingUpload = useCallback(async () => {
    const run = runRef.current;
    const fixtureId = run?.bundle.fixtureId ?? ui.fixtureId;
    if (!fixtureId) return;
    const bundle = run?.bundle ?? (await loadBinderBundle(fixtureId));
    if (!bundle) return;
    const dir = await saveBinderBundle(bundle);
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: 'Retrying missing uploads…',
      retryUpload: false,
    }));
    const outcome = await enqueueBinderBenchmark({
      dirUri: dir,
      bundle,
      onProgress: (acked, total) => {
        setUi(u => ({ ...u, message: `Uploading ${acked} / ${total} files…` }));
      },
    });
    if (run) run.bundle = bundle;
    await persistBinderActiveMeta(
      outcome.uploadStatus === 'COMPLETE' ? null : fixtureId,
    );
    setUi(u => ({
      ...u,
      phase: 'complete',
      message: outcome.message,
      uploadIncomplete: outcome.uploadStatus !== 'COMPLETE',
      retryUpload: outcome.uploadStatus !== 'COMPLETE',
    }));
    if (outcome.uploadStatus === 'COMPLETE') {
      runRef.current = null;
    }
    captureLockRef.current = false;
    argsRef.current.setLabHold(false);
    releaseScannerMode('binder-benchmark');
  }, [ui.fixtureId]);

  const upsertPage = (run: RunState, page: BinderPageRecord) => {
    run.bundle.pages = run.bundle.pages.filter(p => p.pageIndex !== page.pageIndex);
    run.bundle.pages.push(page);
    run.bundle.pages.sort((a, b) => a.pageIndex - b.pageIndex);
  };

  const capturePage = useCallback(async (run: RunState, pageIndex: number) => {
    if (captureLockRef.current || run.capturing) {
      throw new Error('Binder capture already in progress — overlapping snapshots forbidden');
    }
    const cam = argsRef.current.cameraRef.current;
    if (!cam?.takeSnapshot) throw new Error('takeSnapshot unavailable');

    captureLockRef.current = true;
    run.capturing = true;
    run.phase = 'capturing';
    const startedAt = new Date().toISOString();
    const t0 = monoNow();
    const frames: BinderFrameMeta[] = [];
    let failedFrames = 0;
    let frameIndex = 0;
    const targetFrames = run.bundle.targetFramesPerPage || BINDER_TARGET_FRAMES;
    const maxPageMs = run.bundle.maxPageMs || BINDER_MAX_PAGE_MS;
    const minOk = run.bundle.minFramesOk || BINDER_MIN_FRAMES_OK;
    let stopReason: BinderPageRecord['stopReason'] = null;

    setUi(u => ({
      ...u,
      phase: 'capturing',
      pageIndex,
      framesCollected: 0,
      framesTarget: targetFrames,
      pageStatus: null,
      message: 'MOVE PHONE SLOWLY',
    }));

    try {
      // Strictly sequential: snapshot → encode → verify write → register → next.
      while (!cancelledRef.current) {
        const stop = shouldStopBinderCapture({
          savedFrames: frames.length,
          failedFrames,
          elapsedMs: monoNow() - t0,
          targetFrames,
          maxPageMs,
        });
        if (stop.stop) {
          stopReason = stop.reason;
          break;
        }

        const loopStart = monoNow();
        let snap: Awaited<ReturnType<NonNullable<CameraRef['takeSnapshot']>>> | null = null;
        try {
          const live = argsRef.current.peekLive();
          const snapT0 = monoNow();
          snap = await cam.takeSnapshot();
          const snapshotMs = monoNow() - snapT0;
          const nextIndex = frameIndex + 1;
          setUi(u => ({
            ...u,
            captureCue: `FRAME ${nextIndex} / ${targetFrames} · CAPTURE ✓`,
            message: `MOVE PHONE SLOWLY\nFrames: ${frames.length} / ${targetFrames}`,
          }));

          const encodeT0 = monoNow();
          // VisionCamera snapshot is a nitro Image — not a {path} file.
          const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
          frameIndex = nextIndex;
          const file = binderFrameFile(pageIndex, frameIndex);
          const written = await writeBinderFramePng(run.bundle.fixtureId, file, source);
          const encodeWriteMs = monoNow() - encodeT0;
          const totalFrameMs = monoNow() - loopStart;

          if (!written.bytes || written.bytes <= 0) {
            failedFrames += 1;
            setUi(u => ({
              ...u,
              message: `write empty · Frames ${frames.length} / ${targetFrames}`,
            }));
            continue;
          }

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
            snapshotMs,
            encodeWriteMs,
            totalFrameMs,
            fileBytes: written.bytes,
          });
          setUi(u => ({
            ...u,
            framesCollected: frames.length,
            framesTarget: targetFrames,
            captureCue: null,
            message: `MOVE PHONE SLOWLY\nFrames: ${frames.length} / ${targetFrames}`,
          }));
        } catch (err) {
          failedFrames += 1;
          const why = err instanceof Error ? err.message : String(err);
          setUi(u => ({
            ...u,
            message: `snapshot fail · ${why.slice(0, 40)}\nFrames: ${frames.length} / ${targetFrames}`,
          }));
        } finally {
          try {
            (snap as { dispose?: () => void } | null)?.dispose?.();
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      run.capturing = false;
      captureLockRef.current = false;
    }

    if (cancelledRef.current) {
      stopReason = 'cancelled';
    }

    const status = classifyBinderPageStatus(frames.length, targetFrames, minOk);
    const page: BinderPageRecord = {
      pageIndex,
      layout: run.bundle.layout,
      frames,
      startedAt,
      endedAt: new Date().toISOString(),
      captureDurationMs: monoNow() - t0,
      targetFrameCount: targetFrames,
      requestedFrames: targetFrames,
      savedFrames: frames.length,
      failedFrames,
      status,
      stopReason,
      maxPageMs,
    };
    upsertPage(run, page);
    await saveBinderPage(run.bundle.fixtureId, page);
    await saveBinderBundle(run.bundle);
    await persistBinderActiveMeta(run.bundle.fixtureId);

    if (status === 'FAILED') {
      run.phase = 'retry-page';
      setUi(u => ({
        ...u,
        phase: 'retry-page',
        pageIndex,
        framesCollected: frames.length,
        framesTarget: targetFrames,
        pageStatus: status,
        message: `CAPTURE FAILED · ${frames.length} frames (need ≥${minOk})`,
      }));
      return;
    }

    // All writes finished — never auto-start the next page.
    beepTurn();
    const nonFailed = run.bundle.pages.filter(p => p.status !== 'FAILED').length;
    const after = binderAfterSaveAction({
      status,
      savedNonFailedPages: nonFailed,
      targetPages: run.bundle.targetPages,
    });

    if (after === 'await-finish') {
      run.phase = 'page-saved';
      run.turnAt = null;
      setUi(u => ({
        ...u,
        phase: 'page-saved',
        pageIndex,
        framesCollected: frames.length,
        framesTarget: targetFrames,
        pageStatus: status,
        message: `PAGE SAVED · ${frames.length} frames${status === 'SPARSE' ? ' · SPARSE' : ''}`,
      }));
      return;
    }

    run.phase = 'turn-page';
    run.turnAt = monoNow();
    setUi(u => ({
      ...u,
      phase: 'turn-page',
      pageIndex: pageIndex + 1,
      framesCollected: frames.length,
      framesTarget: targetFrames,
      pageStatus: status,
      message: `PAGE SAVED · ${frames.length} frames${status === 'SPARSE' ? ' · SPARSE' : ''}`,
    }));
  }, []);

  const start = useCallback(
    async (opts?: { pages?: BinderPageCount }) => {
      if (!isBenchmarkToolsEnabled()) return;
      if (!claimScannerMode('binder-benchmark')) return;
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
        captureDurationMs: BINDER_MAX_PAGE_MS,
        frameCadenceMs: 0,
        targetFramesPerPage: BINDER_TARGET_FRAMES,
        minFramesOk: BINDER_MIN_FRAMES_OK,
        maxPageMs: BINDER_MAX_PAGE_MS,
        captureSource: 'snapshot',
        captureNote:
          'Frame-driven JS takeSnapshot → PNG (sequential). Not live Y-plane; host replays from PNG RGBA. No overlapping snapshot/encode/write.',
        pages: [],
        phase: 'capturing',
        note: 'REAL binder capture — geometry replay on Mac only. Phone does not claim 9/9.',
      };
      const run: RunState = { bundle, capturing: false, phase: 'capturing', turnAt: null };
      runRef.current = run;
      try {
        await saveBinderBundle(bundle);
        await persistBinderActiveMeta(fixtureId);
        // Mode suspends recognition — do not use labHold for exclusivity.
        argsRef.current.setLabHold(false);
        setConfigOpen(false);
        setResumeOffer(null);
        setUi({
          fixtureId,
          framesCollected: 0,
          framesTarget: BINDER_TARGET_FRAMES,
          captureCue: null,
          message: 'MOVE PHONE SLOWLY',
          pageIndex: 1,
          pageStatus: null,
          phase: 'capturing',
          targetPages: pages,
          interrupted: false,
        });
        await capturePage(run, 1);
      } catch (err) {
        argsRef.current.setLabHold(false);
        releaseScannerMode('binder-benchmark');
        runRef.current = null;
        captureLockRef.current = false;
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
    if (!run) return;
    if (
      !binderCanStartNextPageCapture({
        phase: run.phase,
        capturing: run.capturing || captureLockRef.current,
        explicitNextTap: true,
      })
    ) {
      return;
    }
    const next = run.bundle.pages.filter(p => p.status !== 'FAILED').length + 1;
    await capturePage(run, next);
  }, [capturePage]);

  const retryPage = useCallback(async () => {
    const run = runRef.current;
    if (!run || run.capturing || captureLockRef.current) return;
    if (run.phase !== 'retry-page') return;
    const pageIndex = ui.pageIndex || run.bundle.pages.length || 1;
    await capturePage(run, pageIndex);
  }, [capturePage, ui.pageIndex]);

  const resume = useCallback(async () => {
    const offer = resumeOffer;
    if (!offer) return;
    if (!claimScannerMode('binder-benchmark')) return;
    cancelledRef.current = false;
    const run: RunState = {
      bundle: {
        ...offer,
        targetFramesPerPage: offer.targetFramesPerPage ?? BINDER_TARGET_FRAMES,
        minFramesOk: offer.minFramesOk ?? BINDER_MIN_FRAMES_OK,
        maxPageMs: offer.maxPageMs ?? BINDER_MAX_PAGE_MS,
        phase: 'turn-page',
      },
      capturing: false,
      phase: 'turn-page',
      turnAt: monoNow(),
    };
    runRef.current = run;
    await persistBinderActiveMeta(offer.fixtureId);
    argsRef.current.setLabHold(false);
    setResumeOffer(null);
    setUi({
      fixtureId: offer.fixtureId,
      framesCollected: 0,
      framesTarget: run.bundle.targetFramesPerPage,
      captureCue: null,
      message: `Resumed · ${offer.pages.length}/${offer.targetPages} · TURN PAGE or tap NEXT`,
      pageIndex: offer.pages.length + 1,
      pageStatus: null,
      phase: 'turn-page',
      targetPages: offer.targetPages,
      interrupted: false,
    });
  }, [resumeOffer]);

  const discardInterrupted = useCallback(async () => {
    if (resumeOffer && resumeOffer.phase !== 'complete') {
      await persistBinderActiveMeta(null);
    }
    setResumeOffer(null);
    runRef.current = null;
    captureLockRef.current = false;
    argsRef.current.setLabHold(false);
    releaseScannerMode('binder-benchmark');
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
      if (!bundle) {
        await persistBinderActiveMeta(null);
        return;
      }
      if (bundle.phase === 'complete' && bundle.uploadStatus === 'COMPLETE') {
        await persistBinderActiveMeta(null);
        return;
      }
      if (bundle.phase === 'complete' && bundle.uploadStatus === 'INCOMPLETE') {
        runRef.current = {
          bundle,
          capturing: false,
          phase: 'complete',
          turnAt: null,
        };
        setUi({
          ...idleUi(),
          fixtureId: bundle.fixtureId,
          pageIndex: bundle.pages.length,
          targetPages: bundle.targetPages,
          framesTarget: bundle.targetFramesPerPage ?? BINDER_TARGET_FRAMES,
          phase: 'complete',
          uploadIncomplete: true,
          retryUpload: true,
          message: formatUploadIncompleteMessage({
            runId: bundle.fixtureId,
            kind: 'binder-benchmark',
            endpointUrl: null,
            acknowledged: bundle.uploadManifest?.uploadedFiles ?? [],
            failed: [],
            uploadStatus: 'INCOMPLETE',
            missingRequired: bundle.missingFiles ?? bundle.uploadManifest?.missingFiles ?? [],
            updatedAt: new Date().toISOString(),
          }),
        });
        return;
      }
      if (bundle.phase === 'complete') {
        await persistBinderActiveMeta(null);
        return;
      }
      setResumeOffer(bundle);
      setUi({
        ...idleUi(),
        fixtureId: bundle.fixtureId,
        pageIndex: bundle.pages.length,
        targetPages: bundle.targetPages,
        framesTarget: bundle.targetFramesPerPage ?? BINDER_TARGET_FRAMES,
        phase: 'interrupted',
        interrupted: true,
        message: `Interrupted ${bundle.pages.length}/${bundle.targetPages} pages`,
      });
    })();
  }, []);

  // No automatic next-page capture — user must tap NEXT PAGE / FINISH.

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
    retryPage,
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
