/**
 * Binder Mode V0 — multi-card tracking + best-capture acquisition.
 * No recognition / collection. Uses page snapshots + RGBA multi-candidates
 * (live Y-plane is still slim/single until native rebuild).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraRef } from 'react-native-vision-camera';

import {
  applyBestCapture,
  binderOverlays,
  binderPageHud,
  binderSharpnessOf,
  emptyBinderPageSession,
  makeBinderSessionId,
  multiReturnNms,
  nextBinderPage,
  scoreBinderCardQuality,
  shouldTakeBinderPageSnapshot,
  tickBinderTracks,
  type BinderOverlayCard,
  type BinderPageHud,
  type BinderPageSession,
  type BinderSessionDiagBundle,
  type BinderTrack,
} from '@/lib/scan/binder';
import { monoNow } from '@/lib/scan/timing';
import { claimScannerMode, releaseScannerMode, getScannerMode } from '../scannerMode';
import { createNativeDetectorEngine, isNativeDetectorLinked } from '../detectorEngine';
import { imageToScanImage } from '../imageToScanImage';
import { HIRES_MAX_LONG_EDGE } from '../hiresCapture';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cornersToQuad,
  warpQuadToCard,
  type CardCorners,
} from '../sharedCore';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import type { ArchivedBinderPage, RetainedBinderSnapshot } from './persist';
import {
  binderDiagDirUri,
  loadBinderDiagActiveMeta,
} from './persist';
import { enqueueBinderDiagnostics, retryBinderDiagnosticsUpload } from './enqueue';

export type BinderUi = {
  active: boolean;
  autoUploadOnPageDone: boolean;
  candidateSource: 'rgba-snapshot' | 'live-primary' | 'none';
  hud: BinderPageHud;
  inspectTrackId: number | null;
  message: string;
  overlays: BinderOverlayCard[];
  pageIndex: number;
  snapshotInFlight: boolean;
  uploadBusy: boolean;
  uploadIncomplete: boolean;
  uploadMessage: string | null;
};

const idleHud = (): BinderPageHud => ({
  acquiredCount: 0,
  trackedCount: 0,
  expectedSlots: 9,
  hint: 'POINT AT BINDER PAGE',
  pageReady: false,
});

const idleUi = (): BinderUi => ({
  active: false,
  autoUploadOnPageDone: false,
  candidateSource: 'none',
  hud: idleHud(),
  inspectTrackId: null,
  message: '',
  overlays: [],
  pageIndex: 0,
  snapshotInFlight: false,
  uploadBusy: false,
  uploadIncomplete: false,
  uploadMessage: null,
});

export type UseBinderArgs = {
  cameraRef: { current: CameraRef | null };
  liveCorners: CardCorners | null;
  liveScore: number;
  analysisSize: { width: number; height: number } | null;
  enabled: boolean;
};

export const useBinder = (args: UseBinderArgs) => {
  const { cameraRef, liveCorners, liveScore, analysisSize, enabled } = args;
  const [ui, setUi] = useState<BinderUi>(idleUi);
  const sessionRef = useRef<BinderPageSession | null>(null);
  const activeRef = useRef(false);
  const snapshotBusy = useRef(false);
  const lastPublish = useRef(0);
  const parentSessionIdRef = useRef<string | null>(null);
  const createdAtRef = useRef<string | null>(null);
  const pageSnapshotsRef = useRef<RetainedBinderSnapshot[]>([]);
  const archivedPagesRef = useRef<ArchivedBinderPage[]>([]);
  const lastUploadRef = useRef<{ dirUri: string; bundle: BinderSessionDiagBundle } | null>(null);
  const autoUploadRef = useRef(false);
  const snapshotSeq = useRef(0);

  const publish = useCallback((session: BinderPageSession, patch: Partial<BinderUi> = {}) => {
    const overlays = binderOverlays(session);
    const hud = binderPageHud(session);
    setUi(prev => ({
      ...prev,
      active: activeRef.current,
      overlays,
      hud,
      pageIndex: session.pageIndex,
      ...patch,
    }));
  }, []);

  const enter = useCallback(() => {
    if (!claimScannerMode('binder')) {
      setUi(prev => ({ ...prev, message: 'Scanner busy' }));
      return false;
    }
    activeRef.current = true;
    parentSessionIdRef.current = makeBinderSessionId();
    createdAtRef.current = new Date().toISOString();
    archivedPagesRef.current = [];
    pageSnapshotsRef.current = [];
    snapshotSeq.current = 0;
    lastUploadRef.current = null;
    sessionRef.current = emptyBinderPageSession(0, monoNow());
    publish(sessionRef.current, {
      active: true,
      message: 'Binder — multi-card capture',
      candidateSource: 'none',
      uploadMessage: null,
      uploadIncomplete: false,
    });
    return true;
  }, [publish]);

  const exit = useCallback(() => {
    activeRef.current = false;
    sessionRef.current = null;
    pageSnapshotsRef.current = [];
    releaseScannerMode('binder');
    setUi(idleUi());
  }, []);

  const archiveCurrentPage = useCallback((status: ArchivedBinderPage['status']) => {
    const session = sessionRef.current;
    if (!session) return;
    archivedPagesRef.current.push({
      session: {
        ...session,
        tracks: session.tracks.map(t => ({
          ...t,
          best: t.best
            ? {
                ...t.best,
                // Keep warp reference for later persist (still in memory).
                warp: t.best.warp,
              }
            : null,
          qualityHistory: [...(t.qualityHistory ?? [])],
        })),
      },
      snapshots: [...pageSnapshotsRef.current],
      completedAt: monoNow(),
      status,
    });
    pageSnapshotsRef.current = [];
  }, []);

  const nextPage = useCallback(() => {
    if (!sessionRef.current) return;
    archiveCurrentPage('DONE');
    sessionRef.current = nextBinderPage(sessionRef.current, monoNow());
    publish(sessionRef.current, { message: 'Next page — point at binder', inspectTrackId: null });
  }, [archiveCurrentPage, publish]);

  const finishPage = useCallback(() => {
    if (!sessionRef.current) return;
    archiveCurrentPage('DONE');
    publish(sessionRef.current, { message: 'Page done' });
    if (autoUploadRef.current && isBenchmarkToolsEnabled()) {
      void (async () => {
        setUi(prev => ({ ...prev, uploadBusy: true, uploadMessage: 'Uploading…' }));
        try {
          const pages = [...archivedPagesRef.current];
          if (sessionRef.current && !pages.some(p => p.session.pageId === sessionRef.current?.pageId)) {
            // current already archived above
          }
          const out = await enqueueBinderDiagnostics({
            fixtureId: parentSessionIdRef.current ?? makeBinderSessionId(),
            createdAt: createdAtRef.current ?? new Date().toISOString(),
            pages: archivedPagesRef.current,
          });
          lastUploadRef.current = { dirUri: out.dirUri, bundle: out.bundle };
          setUi(prev => ({
            ...prev,
            uploadBusy: false,
            uploadIncomplete: out.uploadStatus !== 'COMPLETE',
            uploadMessage: out.message,
          }));
        } catch (err) {
          setUi(prev => ({
            ...prev,
            uploadBusy: false,
            uploadIncomplete: true,
            uploadMessage: err instanceof Error ? err.message : String(err),
          }));
        }
      })();
    }
  }, [archiveCurrentPage, publish]);

  const setInspect = useCallback((binderTrackId: number | null) => {
    setUi(prev => ({ ...prev, inspectTrackId: binderTrackId }));
  }, []);

  const setAutoUploadOnPageDone = useCallback((on: boolean) => {
    autoUploadRef.current = on;
    setUi(prev => ({ ...prev, autoUploadOnPageDone: on }));
  }, []);

  const uploadDiagnostics = useCallback(async () => {
    if (!isBenchmarkToolsEnabled()) return;
    // Archive in-progress page without requiring Page Done.
    if (sessionRef.current) {
      const already = archivedPagesRef.current.some(
        p => p.session.pageId === sessionRef.current?.pageId,
      );
      if (!already) {
        archivedPagesRef.current.push({
          session: sessionRef.current,
          snapshots: [...pageSnapshotsRef.current],
          completedAt: null,
          status: 'IN_PROGRESS',
        });
      }
    }
    if (!archivedPagesRef.current.length) {
      setUi(prev => ({ ...prev, uploadMessage: 'Nothing to upload yet' }));
      return;
    }
    setUi(prev => ({ ...prev, uploadBusy: true, uploadMessage: 'Uploading…' }));
    try {
      const out = await enqueueBinderDiagnostics({
        fixtureId: parentSessionIdRef.current ?? makeBinderSessionId(),
        createdAt: createdAtRef.current ?? new Date().toISOString(),
        pages: archivedPagesRef.current,
      });
      lastUploadRef.current = { dirUri: out.dirUri, bundle: out.bundle };
      setUi(prev => ({
        ...prev,
        uploadBusy: false,
        uploadIncomplete: out.uploadStatus !== 'COMPLETE',
        uploadMessage: out.message,
      }));
    } catch (err) {
      setUi(prev => ({
        ...prev,
        uploadBusy: false,
        uploadIncomplete: true,
        uploadMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const retryUpload = useCallback(async () => {
    const last = lastUploadRef.current;
    if (!last) {
      await uploadDiagnostics();
      return;
    }
    setUi(prev => ({ ...prev, uploadBusy: true, uploadMessage: 'Retrying missing…' }));
    try {
      const out = await retryBinderDiagnosticsUpload({
        dirUri: last.dirUri,
        bundle: last.bundle,
      });
      lastUploadRef.current = { dirUri: out.dirUri, bundle: out.bundle };
      setUi(prev => ({
        ...prev,
        uploadBusy: false,
        uploadIncomplete: out.uploadStatus !== 'COMPLETE',
        uploadMessage: out.message,
      }));
    } catch (err) {
      setUi(prev => ({
        ...prev,
        uploadBusy: false,
        uploadIncomplete: true,
        uploadMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [uploadDiagnostics]);

  const getInspectTrack = useCallback((): BinderTrack | null => {
    const id = ui.inspectTrackId;
    if (id == null || !sessionRef.current) return null;
    return sessionRef.current.tracks.find(t => t.binderTrackId === id) ?? null;
  }, [ui.inspectTrackId]);

  /** Apply multi-candidates from one page source (RGBA detect or host-like list). */
  const ingestPageCandidates = useCallback(
    (
      source: Parameters<typeof warpQuadToCard>[0],
      candidates: { corners: CardCorners; score: number }[],
      sourceLabel: BinderUi['candidateSource'],
      retained?: Omit<RetainedBinderSnapshot, 'source'> & { source: typeof source },
    ) => {
      let session = sessionRef.current;
      if (!session || !activeRef.current) return;
      const now = monoNow();
      const frame = { width: source.width, height: source.height };
      const sourceFrameId = session.nextSourceFrameId;
      session = {
        ...session,
        nextSourceFrameId: sourceFrameId + 1,
        lastPageSnapshotAt: now,
      };
      if (retained) {
        pageSnapshotsRef.current.push({
          ...retained,
          sourceFrameId,
        });
      }
      session = tickBinderTracks(session, candidates, now, frame);

      for (const c of candidates) {
        const match = session.tracks.find(
          t =>
            t.phase !== 'lost' &&
            Math.abs(t.currentQuad.topLeft.x - c.corners.topLeft.x) < 8 &&
            Math.abs(t.currentQuad.topLeft.y - c.corners.topLeft.y) < 8,
        );
        const track =
          session.tracks.find(
            t =>
              t.phase !== 'lost' &&
              t.lastSeenAt === now &&
              t.currentQuad === c.corners,
          ) ?? match;
        if (!track) continue;
        try {
          const warp = warpQuadToCard(source, cornersToQuad(c.corners));
          if (warp.width !== CARD_WIDTH || warp.height !== CARD_HEIGHT) continue;
          const quality = scoreBinderCardQuality({
            corners: c.corners,
            frame,
            warp,
          });
          const captureId: number = session.nextCaptureId;
          session = { ...session, nextCaptureId: captureId + 1 };
          session = applyBestCapture(session, track.binderTrackId, {
            captureId,
            sourceFrameId,
            quad: c.corners,
            warp,
            quality,
            sharpness: binderSharpnessOf(warp),
            capturedAt: now,
          });
        } catch {
          /* warp failure — leave track amber */
        }
      }

      sessionRef.current = session;
      publish(session, { candidateSource: sourceLabel, snapshotInFlight: false });
    },
    [publish],
  );

  const runPageSnapshot = useCallback(async () => {
    if (!activeRef.current || snapshotBusy.current) return;
    const cam = cameraRef.current;
    if (!cam) return;
    snapshotBusy.current = true;
    setUi(prev => ({ ...prev, snapshotInFlight: true }));
    try {
      const snap = await cam.takeSnapshot();
      // VisionCamera snapshot is a nitro Image — convert in-memory (no PNG wait).
      const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
      let candidates: { corners: CardCorners; score: number }[] = [];
      if (isNativeDetectorLinked()) {
        const engine = createNativeDetectorEngine();
        const det = await Promise.resolve(engine.detect(source));
        const raw = (det.debug.candidates ?? [])
          .filter(c => c.corners && !c.rejectedBecause?.length)
          .map(c => ({ corners: c.corners!, score: c.score }));
        if (raw.length) {
          candidates = multiReturnNms(raw);
        } else if (det.corners) {
          candidates = [{ corners: det.corners, score: det.score }];
        }
      }
      if (!candidates.length && liveCorners && analysisSize) {
        // Fallback: scale live primary into source space roughly by long-edge.
        const sx = source.width / Math.max(1, analysisSize.width);
        const sy = source.height / Math.max(1, analysisSize.height);
        const scale = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
        const c = liveCorners;
        candidates = [
          {
            corners: {
              topLeft: scale(c.topLeft),
              topRight: scale(c.topRight),
              bottomRight: scale(c.bottomRight),
              bottomLeft: scale(c.bottomLeft),
            },
            score: liveScore,
          },
        ];
      }
      ingestPageCandidates(
        source,
        candidates,
        candidates.length > 1 ? 'rgba-snapshot' : 'live-primary',
        {
          snapshotId: (snapshotSeq.current += 1),
          sourceFrameId: 0,
          capturedAt: monoNow(),
          width: source.width,
          height: source.height,
          source,
          candidates,
        },
      );
    } catch (err) {
      setUi(prev => ({
        ...prev,
        snapshotInFlight: false,
        message: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      snapshotBusy.current = false;
    }
  }, [
    analysisSize,
    cameraRef,
    ingestPageCandidates,
    liveCorners,
    liveScore,
  ]);

  // Live primary: update nearest track position between snapshots (no new capture).
  useEffect(() => {
    if (!enabled || !activeRef.current || !sessionRef.current) return;
    if (!liveCorners || !analysisSize) return;
    const now = monoNow();
    let session = tickBinderTracks(
      sessionRef.current,
      [{ corners: liveCorners, score: liveScore }],
      now,
      analysisSize,
    );
    sessionRef.current = session;
    if (now - lastPublish.current > 80) {
      lastPublish.current = now;
      publish(session);
    }
    if (
      shouldTakeBinderPageSnapshot(session, now, {
        pendingTracks: session.tracks.filter(t => !t.acquired && t.phase !== 'lost').length,
      })
    ) {
      void runPageSnapshot();
    }
  }, [analysisSize, enabled, liveCorners, liveScore, publish, runPageSnapshot]);

  // Auto-enter when Binder surface is enabled.
  useEffect(() => {
    if (!enabled) {
      if (activeRef.current) exit();
      return;
    }
    if (!activeRef.current) {
      enter();
      // Restore incomplete upload banner from disk (survives remount / OTA).
      void (async () => {
        try {
          const meta = await loadBinderDiagActiveMeta();
          if (!meta?.fixtureId) return;
          const FileSystem = await import('expo-file-system/legacy');
          const dir = await binderDiagDirUri(meta.fixtureId);
          const root = dir.endsWith('/') ? dir : `${dir}/`;
          const raw = await FileSystem.readAsStringAsync(`${root}summary.json`);
          const bundle = JSON.parse(raw) as BinderSessionDiagBundle;
          lastUploadRef.current = { dirUri: dir, bundle };
          parentSessionIdRef.current = meta.fixtureId;
          setUi(prev => ({
            ...prev,
            uploadIncomplete: bundle.uploadStatus !== 'COMPLETE',
            uploadMessage:
              bundle.uploadStatus === 'COMPLETE'
                ? null
                : 'UPLOAD INCOMPLETE · Retry Missing or Settings → Pending uploads',
          }));
        } catch {
          /* no prior incomplete upload */
        }
      })();
    }
    return () => {
      if (activeRef.current && getScannerMode() === 'binder') exit();
    };
  }, [enabled, enter, exit]);

  return {
    ui,
    enter,
    exit,
    nextPage,
    finishPage,
    setInspect,
    getInspectTrack,
    forceSnapshot: () => void runPageSnapshot(),
    session: () => sessionRef.current,
    isDev: isBenchmarkToolsEnabled(),
    uploadDiagnostics,
    retryUpload,
    setAutoUploadOnPageDone,
    parentSessionId: () => parentSessionIdRef.current,
  };
};
