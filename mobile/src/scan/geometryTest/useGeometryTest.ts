/**
 * Geometry Test — exclusive scanner owner.
 * START → live quad → short lock → ONE hi-res capture → preview → NEXT.
 * Never invokes recognition / OCR / collection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraRef } from 'react-native-vision-camera';

import {
  accumulateUnsafeReasonMs,
  dominantUnsafeReason,
  emptyGeometryLockState,
  emptyGeometryTiming,
  deriveGeometryTestMs,
  evaluateCaptureSafe,
  evaluateSourceCaptureSafe,
  geometryFixtureId,
  markFirstTiming,
  meanCornerDisplacementPx,
  monoNow,
  quadOccupancy,
  refinePhysicalCardBoundary,
  tickGeometryLock,
  GEOMETRY_TEST_SEARCHING_HINT_MS,
  type GeometryAcquisitionPhase,
  type GeometryEngineId,
  type GeometryFocusMode,
  type GeometryTestBundle,
  type GeometryTestFrameDiag,
  type GeometryTestItemRecord,
  type GeometryTestPhase,
  type GeometryTestTiming,
  type GeometryLockState,
  type PhysicalRefineResult,
} from '@/lib/scan/geometryTest';
import type { CardCorners, ScanImage } from '@/lib/scan/types';
import type { HiResSpaces } from '../hiresCapture';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { softResetContinuityForCardSession } from '../continuityBridge';
import { claimScannerMode, releaseScannerMode } from '../scannerMode';
import { captureGeometryOnce } from './capture';
import { enqueueGeometryTest } from './enqueue';
import {
  fileUriForGeometryArtifact,
  GEOMETRY_DISPLAY_PREVIEW_MAX_WIDTH,
  loadGeometryBundle,
  persistGeometryActiveMeta,
  saveGeometryBundle,
  saveGeometryCardArtifact,
  saveGeometryItemMetadata,
  saveGeometrySourceArtifact,
} from './persist';
import { scanImageToThumbnailPngDataUri } from '../debug/scanImagePng';

export type GeometryLivePeek = {
  detectorScore: number;
  rawCorners: CardCorners | null;
  plausibleCorners: CardCorners | null;
  spaces: HiResSpaces | null;
  frame: { width: number; height: number };
  /** Latest analysis ScanImage for cheap physical refine (may be null). */
  analysisImage: ScanImage | null;
  focusReportedSuccess: boolean | null;
  focusTimedOut: boolean | null;
  fastAccept: boolean;
  aspect: number | null;
  occupancy: number | null;
  /** Detector forensics (no OCR / identity). */
  rawCandidateCount: number | null;
  selectedCandidateScore: number | null;
  selectedRole: string | null;
};

export type GeometryTestUi = {
  phase: GeometryTestPhase;
  fixtureId: string | null;
  itemIndex: number;
  itemCount: number;
  message: string;
  elapsedMs: number;
  /** @deprecated Prefer captureReadyMs — was conflated with PNG path. */
  finalElapsedMs: number | null;
  /** button → warpDone (recognition-relevant). */
  captureReadyMs: number | null;
  /** button → first visible preview. */
  visibleMs: number | null;
  /** button → full card+source artifacts saved. */
  fullArtifactMs: number | null;
  liveQuad: CardCorners | null;
  /** Detector / sleeve outer (debug). */
  originalLiveQuad: CardCorners | null;
  /** Sleeve outer when dual-boundary (debug). */
  sleeveLiveQuad: CardCorners | null;
  /** Physical card when dual-boundary (debug). */
  physicalLiveQuad: CardCorners | null;
  lockedQuad: CardCorners | null;
  previewUri: string | null;
  previewKind: 'card' | 'source';
  /** display = cheap screen preview; full-res = 744×1039 file. */
  previewTier: 'display' | 'full-res' | null;
  previewWidth: number | null;
  debugOverlay: boolean;
  focusMode: GeometryFocusMode;
  initialFocusRequested: boolean;
  initialFocusReportedSuccess: boolean | null;
  derived: {
    firstQuadMs: number | null;
    firstQuadToFirstCaptureSafeMs: number | null;
    lockMs: number | null;
    captureMs: number | null;
    warpMs: number | null;
    firstCaptureSafeMs: number | null;
    captureSafeToLockMs: number | null;
  };
  focusReportedSuccess: boolean | null;
  sharpness: number | null;
  searchingLong: boolean;
  /** Live acquisition sub-state while phase === acquiring|capturing. */
  acquisitionPhase: GeometryAcquisitionPhase | null;
  captureSafe: boolean | null;
  captureSafeMessage: string | null;
  uploadMessage: string | null;
  uploadIncomplete: boolean;
};

const idleUi = (): GeometryTestUi => ({
  phase: 'idle',
  fixtureId: null,
  itemIndex: 0,
  itemCount: 0,
  message: '',
  elapsedMs: 0,
  finalElapsedMs: null,
  captureReadyMs: null,
  visibleMs: null,
  fullArtifactMs: null,
  liveQuad: null,
  originalLiveQuad: null,
  sleeveLiveQuad: null,
  physicalLiveQuad: null,
  lockedQuad: null,
  previewUri: null,
  previewKind: 'card',
  previewTier: null,
  previewWidth: null,
  debugOverlay: false,
  focusMode: 'prefocus-once',
  initialFocusRequested: false,
  initialFocusReportedSuccess: null,
  derived: {
    firstQuadMs: null,
    firstQuadToFirstCaptureSafeMs: null,
    lockMs: null,
    captureMs: null,
    warpMs: null,
    firstCaptureSafeMs: null,
    captureSafeToLockMs: null,
  },
  focusReportedSuccess: null,
  sharpness: null,
  searchingLong: false,
  acquisitionPhase: null,
  captureSafe: null,
  captureSafeMessage: null,
  uploadMessage: null,
  uploadIncomplete: false,
});

type ItemRuntime = {
  geometryTestId: string;
  itemIndex: number;
  captureId: number;
  timing: GeometryTestTiming;
  lock: GeometryLockState;
  frames: GeometryTestFrameDiag[];
  detectorFrameCount: number;
  lockFrameCount: number;
  manualCapture: boolean;
  capturing: boolean;
  captured: boolean;
  /** Whole-acquisition unsafe duration by reason (survives frame ring truncate). */
  captureUnsafeReasonMs: Record<string, number>;
  lastFrameAt: number | null;
  /** Telemetry snapshot at first CAPTURE_SAFE / lock (analysis space). */
  minCornerMarginNormalized: number | null;
  minCornerMarginPixelsAnalysis: number | null;
  minCornerMarginPixelsSource: number | null;
  lastRefine: PhysicalRefineResult | null;
  physicalRefineTelemetry: GeometryTestItemRecord['physicalRefine'];
  sourceSafetyTelemetry: GeometryTestItemRecord['sourceSafety'];
};

type RunState = {
  bundle: GeometryTestBundle;
  item: ItemRuntime | null;
  /** Background card+source persist for the latest capture. */
  pendingPersist: Promise<void> | null;
};

type Args = {
  cameraRef: { current: CameraRef | null };
  peekLive: () => GeometryLivePeek;
  /**
   * At most one call when Geometry tab opens (prefocus-once).
   * Must NEVER be invoked from START/NEXT → capture.
   */
  requestInitialFocus?: () => void;
};

const mintItem = (index: number, captureId: number): ItemRuntime => {
  const now = monoNow();
  return {
    geometryTestId: `g${index}-${Math.round(now)}`,
    itemIndex: index,
    captureId,
    timing: { ...emptyGeometryTiming(), buttonPressedAt: now },
    lock: emptyGeometryLockState(),
    frames: [],
    detectorFrameCount: 0,
    lockFrameCount: 0,
    manualCapture: false,
    capturing: false,
    captured: false,
    captureUnsafeReasonMs: {},
    lastFrameAt: null,
    minCornerMarginNormalized: null,
    minCornerMarginPixelsAnalysis: null,
    minCornerMarginPixelsSource: null,
    lastRefine: null,
    physicalRefineTelemetry: null,
    sourceSafetyTelemetry: null,
  };
};

const toRecord = (
  item: ItemRuntime,
  extras: Partial<GeometryTestItemRecord> & {
    geometryEngine: GeometryEngineId;
  },
): GeometryTestItemRecord => {
  const derivedMs = deriveGeometryTestMs(item.timing);
  const lastSafe = [...item.frames].reverse().find(f => f.captureSafe);
  const lastFrame = item.frames[item.frames.length - 1];
  const unsafeMs = item.captureUnsafeReasonMs;
  return {
    itemIndex: item.itemIndex,
    geometryTestId: item.geometryTestId,
    captureId: item.captureId,
    geometryEngine: extras.geometryEngine,
    manualCapture: item.manualCapture,
    focusReportedSuccess: extras.focusReportedSuccess ?? null,
    sharpness: extras.sharpness ?? null,
    sourceWidth: extras.sourceWidth ?? null,
    sourceHeight: extras.sourceHeight ?? null,
    warpWidth: extras.warpWidth ?? null,
    warpHeight: extras.warpHeight ?? null,
    detectorFrameCount: item.detectorFrameCount,
    lockFrameCount: item.lockFrameCount,
    captureSafe: lastSafe?.captureSafe ?? lastFrame?.captureSafe ?? null,
    captureUnsafeReasons: lastSafe ? [] : lastFrame?.captureUnsafeReasons ?? [],
    captureUnsafeReasonMs: { ...unsafeMs },
    dominantUnsafeReason: dominantUnsafeReason(unsafeMs),
    minCornerMarginNormalized: item.minCornerMarginNormalized,
    minCornerMarginPixelsAnalysis: item.minCornerMarginPixelsAnalysis,
    minCornerMarginPixelsSource: item.minCornerMarginPixelsSource,
    physicalRefine: item.physicalRefineTelemetry,
    sourceSafety: item.sourceSafetyTelemetry,
    timing: item.timing,
    derivedMs,
    frames: item.frames.slice(-120),
    lockedQuad: item.lock.locked,
    files: { metadata: '' },
    recordedAt: new Date().toISOString(),
  };
};

export const useGeometryTest = (args: Args) => {
  const [ui, setUi] = useState<GeometryTestUi>(idleUi);
  const runRef = useRef<RunState | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  const captureSeq = useRef(1);
  const cancelledRef = useRef(false);
  const focusModeRef = useRef<GeometryFocusMode>('prefocus-once');
  const initialFocusIssuedRef = useRef(false);

  const syncElapsed = useCallback(() => {
    const run = runRef.current;
    const item = run?.item;
    if (!item?.timing.buttonPressedAt || item.captured) return;
    const elapsed = monoNow() - item.timing.buttonPressedAt;
    setUi(u => ({
      ...u,
      elapsedMs: elapsed,
      // Only "still searching" when we truly have no geometry — not DETECTED_NOT_SAFE.
      searchingLong:
        elapsed >= GEOMETRY_TEST_SEARCHING_HINT_MS &&
        u.phase === 'acquiring' &&
        u.acquisitionPhase === 'searching',
    }));
  }, []);

  useEffect(() => {
    if (ui.phase !== 'acquiring' && ui.phase !== 'capturing') return;
    const id = setInterval(syncElapsed, 50);
    return () => clearInterval(id);
  }, [ui.phase, syncElapsed]);

  const softResetAcquisition = useCallback(() => {
    softResetContinuityForCardSession('geometry-test-next');
  }, []);

  const finishUpload = useCallback(async (bundle: GeometryTestBundle, dirUri: string) => {
    try {
      const out = await enqueueGeometryTest({ dirUri, bundle });
      const ackAt = monoNow();
      for (const it of bundle.items) {
        it.timing = markFirstTiming(it.timing, 'uploadAckAt', ackAt);
        it.derivedMs = deriveGeometryTestMs(it.timing);
      }
      bundle.uploadStatus = out.uploadStatus;
      await saveGeometryBundle(bundle);
      const incomplete = out.uploadStatus !== 'COMPLETE';
      await persistGeometryActiveMeta(incomplete ? bundle.fixtureId : null);
      setUi(u => ({
        ...u,
        phase: 'complete',
        fixtureId: bundle.fixtureId,
        uploadMessage: out.message,
        uploadIncomplete: incomplete,
        message: out.message,
      }));
      // Keep scanner claim until Dismiss so chrome stays hidden and Retry is reachable.
      if (!incomplete) {
        releaseScannerMode('geometry-test');
      }
    } catch (err) {
      await persistGeometryActiveMeta(bundle.fixtureId);
      setUi(u => ({
        ...u,
        phase: 'complete',
        fixtureId: bundle.fixtureId,
        uploadIncomplete: true,
        uploadMessage: err instanceof Error ? err.message : String(err),
        message: 'Upload failed',
      }));
    }
  }, []);

  const retryMissingUpload = useCallback(async () => {
    const fixtureId = runRef.current?.bundle.fixtureId ?? ui.fixtureId;
    if (!fixtureId) return;
    const bundle = runRef.current?.bundle ?? (await loadGeometryBundle(fixtureId));
    if (!bundle) return;
    const dir = await saveGeometryBundle(bundle);
    setUi(u => ({
      ...u,
      phase: 'complete',
      fixtureId,
      message: 'Retrying missing uploads…',
      uploadIncomplete: true,
    }));
    try {
      const out = await enqueueGeometryTest({ dirUri: dir, bundle });
      bundle.uploadStatus = out.uploadStatus;
      await saveGeometryBundle(bundle);
      if (runRef.current) runRef.current.bundle = bundle;
      const incomplete = out.uploadStatus !== 'COMPLETE';
      await persistGeometryActiveMeta(incomplete ? fixtureId : null);
      setUi(u => ({
        ...u,
        phase: 'complete',
        fixtureId,
        message: out.message,
        uploadMessage: out.message,
        uploadIncomplete: incomplete,
      }));
      if (!incomplete) {
        runRef.current = null;
        releaseScannerMode('geometry-test');
      }
    } catch (err) {
      await persistGeometryActiveMeta(fixtureId);
      setUi(u => ({
        ...u,
        phase: 'complete',
        fixtureId,
        uploadIncomplete: true,
        uploadMessage: err instanceof Error ? err.message : String(err),
        message: 'Retry failed',
      }));
    }
  }, [ui.fixtureId]);

  const runCapture = useCallback(async (manual: boolean) => {
    const run = runRef.current;
    const item = run?.item;
    if (!run || !item || item.capturing || item.captured) return;
    const live = argsRef.current.peekLive();
    const quad = item.lock.locked ?? live.plausibleCorners ?? live.rawCorners;
    if (!quad || !live.spaces) {
      setUi(u => ({ ...u, message: 'No plausible quad to capture' }));
      return;
    }
    if (!item.lock.locked) {
      item.lock = {
        ...item.lock,
        locked: quad,
        lockedAt: monoNow(),
        confirmationStartedAt: item.lock.confirmationStartedAt ?? monoNow(),
      };
      item.manualCapture = true;
    } else if (manual) {
      item.manualCapture = true;
    }

    item.capturing = true;
    const now = monoNow();
    item.timing = markFirstTiming(item.timing, 'captureQuadLockedAt', item.lock.lockedAt ?? now);
    item.timing = markFirstTiming(item.timing, 'captureRequestedAt', now);
    item.lockFrameCount = Math.max(item.lockFrameCount, item.lock.agreeingStreak);

    setUi(u => ({
      ...u,
      phase: 'capturing',
      acquisitionPhase: 'capturing',
      lockedQuad: item.lock.locked,
      message: 'CAPTURE',
      searchingLong: false,
    }));

    try {
      const shot = await captureGeometryOnce({
        cameraRef: argsRef.current.cameraRef,
        frozenQuad: item.lock.locked!,
        spaces: live.spaces,
      });
      item.timing = markFirstTiming(item.timing, 'captureCompletedAt', shot.captureDoneAt);
      item.timing = markFirstTiming(item.timing, 'warpDoneAt', shot.warpDoneAt);
      item.captured = true;
      if (shot.minCornerMarginPixelsSource != null) {
        item.minCornerMarginPixelsSource = shot.minCornerMarginPixelsSource;
      }

      const record = toRecord(item, {
        geometryEngine: run.bundle.geometryEngine,
        focusReportedSuccess: run.bundle.initialFocusReportedSuccess,
        sharpness: shot.sharpness,
        sourceWidth: shot.source.width,
        sourceHeight: shot.source.height,
        warpWidth: shot.card.width,
        warpHeight: shot.card.height,
      });

      // Cheap display-only preview (data URI) — NOT the benchmark artifact.
      item.timing = markFirstTiming(item.timing, 'cardPreviewEncodeStartAt', monoNow());
      const displayPreviewUri = scanImageToThumbnailPngDataUri(
        shot.card,
        GEOMETRY_DISPLAY_PREVIEW_MAX_WIDTH,
      );
      item.timing = markFirstTiming(item.timing, 'cardPreviewEncodeDoneAt', monoNow());
      item.timing = markFirstTiming(item.timing, 'previewLoadStartAt', monoNow());
      // visibleMs uses encode-done until Image onLoad refines previewDisplayedAt.

      const derivedPreview = deriveGeometryTestMs(item.timing);
      const interimVisible =
        item.timing.buttonPressedAt != null && item.timing.cardPreviewEncodeDoneAt != null
          ? item.timing.cardPreviewEncodeDoneAt - item.timing.buttonPressedAt
          : null;
      setUi(u => ({
        ...u,
        phase: 'captured',
        message: 'CAPTURED',
        captureReadyMs: derivedPreview.buttonToCaptureReadyMs,
        visibleMs: interimVisible,
        fullArtifactMs: null,
        finalElapsedMs: derivedPreview.buttonToCaptureReadyMs,
        elapsedMs: derivedPreview.buttonToCaptureReadyMs ?? u.elapsedMs,
        previewUri: displayPreviewUri,
        previewKind: 'card',
        previewTier: 'display',
        previewWidth: GEOMETRY_DISPLAY_PREVIEW_MAX_WIDTH,
        focusReportedSuccess: run.bundle.initialFocusReportedSuccess,
        sharpness: shot.sharpness,
        lockedQuad: item.lock.locked,
        derived: {
          firstQuadMs:
            derivedPreview.buttonToFirstQuadMs ??
            derivedPreview.buttonToFirstPlausibleMs ??
            derivedPreview.buttonToFirstRawMs,
          firstQuadToFirstCaptureSafeMs: derivedPreview.firstQuadToFirstCaptureSafeMs,
          lockMs:
            item.timing.buttonPressedAt != null && item.timing.captureQuadLockedAt != null
              ? item.timing.captureQuadLockedAt - item.timing.buttonPressedAt
              : null,
          captureMs: derivedPreview.buttonToCaptureDoneMs,
          warpMs: derivedPreview.buttonToWarpDoneMs,
          firstCaptureSafeMs: derivedPreview.buttonToFirstCaptureSafeMs,
          captureSafeToLockMs: derivedPreview.captureSafeToLockMs,
        },
      }));

      // Benchmark artifacts in background — yield so React can paint the cheap preview
      // before the heavy 744×1039 encode runs on the JS thread.
      const captureId = item.captureId;
      const persistPromise = (async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        item.timing = markFirstTiming(item.timing, 'artifactEncodeStartAt', monoNow());
        const cardSaved = await saveGeometryCardArtifact({
          fixtureId: run.bundle.fixtureId,
          record,
          cardWarp: shot.card,
        });
        item.timing = markFirstTiming(
          item.timing,
          'cardArtifactEncodeStartAt',
          cardSaved.encodeStartAt,
        );
        item.timing = markFirstTiming(
          item.timing,
          'cardArtifactEncodeDoneAt',
          cardSaved.encodeDoneAt,
        );
        item.timing = markFirstTiming(item.timing, 'cardFileWriteStartAt', cardSaved.writeStartAt);
        item.timing = markFirstTiming(item.timing, 'cardFileWriteDoneAt', cardSaved.writeDoneAt);
        item.timing = markFirstTiming(item.timing, 'fullResPreviewReadyAt', monoNow());

        setUi(u => {
          if (u.previewKind !== 'card') return u;
          return {
            ...u,
            previewUri: cardSaved.cardUri,
            previewTier: 'full-res',
            previewWidth: cardSaved.encodedWidth,
          };
        });

        let finalized = await saveGeometrySourceArtifact({
          fixtureId: run.bundle.fixtureId,
          record: cardSaved.record,
          source: shot.source,
        });
        item.timing = markFirstTiming(item.timing, 'artifactEncodeDoneAt', monoNow());
        finalized = {
          ...finalized,
          timing: item.timing,
          derivedMs: deriveGeometryTestMs(item.timing),
        };
        finalized = await saveGeometryItemMetadata({
          fixtureId: run.bundle.fixtureId,
          record: finalized,
        });
        const idx = run.bundle.items.findIndex(i => i.captureId === captureId);
        if (idx >= 0) run.bundle.items[idx] = finalized;
        else run.bundle.items.push(finalized);
        await saveGeometryBundle(run.bundle);
        const fullMs =
          item.timing.buttonPressedAt != null && item.timing.artifactEncodeDoneAt != null
            ? item.timing.artifactEncodeDoneAt - item.timing.buttonPressedAt
            : null;
        setUi(u => ({ ...u, fullArtifactMs: fullMs }));
      })();
      run.pendingPersist = persistPromise;
      void persistPromise.finally(() => {
        if (run.pendingPersist === persistPromise) run.pendingPersist = null;
      });
    } catch (err) {
      item.capturing = false;
      item.lock = emptyGeometryLockState();
      setUi(u => ({
        ...u,
        phase: 'acquiring',
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const beginItem = useCallback(
    (index: number) => {
      softResetAcquisition();
      const item = mintItem(index, captureSeq.current++);
      const run = runRef.current;
      if (!run) return;
      run.item = item;
      // START/NEXT: timer starts in mintItem; NO autofocus in this path.
      setUi(u => ({
        ...idleUi(),
        phase: 'acquiring',
        fixtureId: run.bundle.fixtureId,
        itemIndex: index,
        itemCount: run.bundle.items.length,
        message: 'ACQUIRING',
        debugOverlay: u.debugOverlay,
        focusMode: u.focusMode,
        initialFocusRequested: run.bundle.initialFocusRequested,
        initialFocusReportedSuccess: run.bundle.initialFocusReportedSuccess,
        elapsedMs: 0,
        finalElapsedMs: null,
      }));
    },
    [softResetAcquisition],
  );

  const maybeIssueInitialFocus = useCallback((bundle: GeometryTestBundle) => {
    if (focusModeRef.current !== 'prefocus-once') return;
    if (initialFocusIssuedRef.current) return;
    initialFocusIssuedRef.current = true;
    bundle.initialFocusRequested = true;
    bundle.initialFocusRequestedAt = monoNow();
    argsRef.current.requestInitialFocus?.();
  }, []);

  const enter = useCallback(() => {
    if (!isBenchmarkToolsEnabled()) return;
    if (!claimScannerMode('geometry-test')) {
      setUi(u => ({ ...u, message: 'Scanner owned by another tool' }));
      return;
    }
    cancelledRef.current = false;
    initialFocusIssuedRef.current = false;
    const fixtureId = geometryFixtureId();
    const focusMode = focusModeRef.current;
    const bundle: GeometryTestBundle = {
      kind: 'geometry-test',
      fixtureId,
      createdAt: new Date().toISOString(),
      completedAt: null,
      geometryEngine: 'current',
      focusMode,
      initialFocusRequested: false,
      initialFocusRequestedAt: null,
      initialFocusReportedSuccess: null,
      items: [],
      phase: 'ready',
      note: 'Geometry → one hi-res capture. No recognition. Focus not in START path.',
    };
    maybeIssueInitialFocus(bundle);
    runRef.current = { bundle, item: null, pendingPersist: null };
    void persistGeometryActiveMeta(fixtureId);
    void saveGeometryBundle(bundle);
    setUi({
      ...idleUi(),
      phase: 'ready',
      fixtureId,
      focusMode,
      initialFocusRequested: bundle.initialFocusRequested,
      initialFocusReportedSuccess: bundle.initialFocusReportedSuccess,
      message: 'Place one card in view. Lens may settle before START.',
    });
  }, [maybeIssueInitialFocus]);

  const awaitPendingPersist = useCallback(async () => {
    const run = runRef.current;
    const pending = run?.pendingPersist;
    if (pending) await pending;
  }, []);

  const start = useCallback(() => {
    if (!runRef.current) enter();
    if (!runRef.current) return;
    void (async () => {
      await awaitPendingPersist();
      beginItem(runRef.current!.bundle.items.length + 1);
    })();
  }, [awaitPendingPersist, beginItem, enter]);

  const next = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    void (async () => {
      await awaitPendingPersist();
      beginItem(run.bundle.items.length + 1);
    })();
  }, [awaitPendingPersist, beginItem]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    initialFocusIssuedRef.current = false;
    const run = runRef.current;
    runRef.current = null;
    if (run) {
      run.bundle.phase = 'cancelled';
      run.bundle.completedAt = new Date().toISOString();
      void saveGeometryBundle(run.bundle);
    }
    void persistGeometryActiveMeta(null);
    releaseScannerMode('geometry-test');
    setUi(idleUi());
  }, []);

  const finish = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.bundle.phase = 'complete';
    run.bundle.completedAt = new Date().toISOString();
    void (async () => {
      await awaitPendingPersist();
      const dir = await saveGeometryBundle(run.bundle);
      setUi(u => ({ ...u, phase: 'complete', message: 'Uploading…' }));
      await finishUpload(run.bundle, dir);
      runRef.current = null;
    })();
  }, [awaitPendingPersist, finishUpload]);

  const captureCurrent = useCallback(() => {
    void runCapture(true);
  }, [runCapture]);

  const setDebugOverlay = useCallback((on: boolean) => {
    setUi(u => ({ ...u, debugOverlay: on }));
  }, []);

  const setFocusMode = useCallback((mode: GeometryFocusMode) => {
    focusModeRef.current = mode;
    const run = runRef.current;
    if (run && run.bundle.phase === 'ready') {
      run.bundle.focusMode = mode;
      // Switching to prefocus-once after enter can still issue once if not yet issued.
      if (mode === 'prefocus-once') maybeIssueInitialFocus(run.bundle);
      void saveGeometryBundle(run.bundle);
      setUi(u => ({
        ...u,
        focusMode: mode,
        initialFocusRequested: run.bundle.initialFocusRequested,
        initialFocusReportedSuccess: run.bundle.initialFocusReportedSuccess,
      }));
      return;
    }
    setUi(u => ({ ...u, focusMode: mode }));
  }, [maybeIssueInitialFocus]);

  const setPreviewKind = useCallback((kind: 'card' | 'source') => {
    const run = runRef.current;
    const last = run?.bundle.items[run.bundle.items.length - 1];
    if (!last || !run) {
      setUi(u => ({ ...u, previewKind: kind }));
      return;
    }
    void (async () => {
      if (kind === 'card' && last.files.cardWarp) {
        const uri = await fileUriForGeometryArtifact(run.bundle.fixtureId, last.files.cardWarp);
        setUi(u => ({
          ...u,
          previewKind: 'card',
          previewUri: uri,
          previewTier: 'full-res',
          previewWidth: last.cardEncodedWidth ?? 744,
        }));
        return;
      }
      if (kind === 'source' && last.files.source) {
        const uri = await fileUriForGeometryArtifact(run.bundle.fixtureId, last.files.source);
        setUi(u => ({
          ...u,
          previewKind: 'source',
          previewUri: uri,
          previewTier: 'full-res',
          previewWidth: last.sourceEncodedWidth ?? null,
        }));
        return;
      }
      setUi(u => ({ ...u, previewKind: kind }));
    })();
  }, []);

  const markPreviewDisplayed = useCallback(() => {
    const item = runRef.current?.item;
    if (!item?.timing.buttonPressedAt) return;
    const at = monoNow();
    const wasUnset = item.timing.previewDisplayedAt == null;
    item.timing = markFirstTiming(item.timing, 'previewDisplayedAt', at);
    item.timing = markFirstTiming(item.timing, 'imageDisplayedAt', at);
    if (!wasUnset) return;
    setUi(u => ({
      ...u,
      visibleMs: at - item.timing.buttonPressedAt!,
    }));
  }, []);

  // While waiting for START, observe whether the one-shot prefocus reported success.
  useEffect(() => {
    if (ui.phase !== 'ready') return;
    const id = setInterval(() => {
      const run = runRef.current;
      if (!run?.bundle.initialFocusRequested) return;
      if (run.bundle.initialFocusReportedSuccess != null) return;
      const live = argsRef.current.peekLive();
      if (live.focusReportedSuccess === true) {
        run.bundle.initialFocusReportedSuccess = true;
        void saveGeometryBundle(run.bundle);
        setUi(u => ({ ...u, initialFocusReportedSuccess: true }));
      } else if (live.focusTimedOut === true) {
        run.bundle.initialFocusReportedSuccess = false;
        void saveGeometryBundle(run.bundle);
        setUi(u => ({ ...u, initialFocusReportedSuccess: false }));
      }
    }, 200);
    return () => clearInterval(id);
  }, [ui.phase]);

  // Acquisition tick — detector frames only; never recognition; never AF.
  useEffect(() => {
    if (ui.phase !== 'acquiring') return;
    let alive = true;
    const tick = () => {
      if (!alive || cancelledRef.current) return;
      const run = runRef.current;
      const item = run?.item;
      if (!run || !item || item.capturing || item.captured) return;

      const live = argsRef.current.peekLive();
      const now = monoNow();
      item.detectorFrameCount += 1;
      item.timing = markFirstTiming(item.timing, 'firstDetectorFrameAt', now);

      const raw = live.rawCorners;
      const detectorPlausible = live.plausibleCorners ?? live.rawCorners;
      if (raw) item.timing = markFirstTiming(item.timing, 'firstRawQuadAt', now);
      if (detectorPlausible) {
        item.timing = markFirstTiming(item.timing, 'firstPlausibleQuadAt', now);
      }

      // Show detector polygon immediately. Dual-boundary refine is fail-closed.
      const frameSize = live.frame ?? { width: 1, height: 1 };
      let refine: PhysicalRefineResult | null = null;
      let plausible = detectorPlausible;
      if (detectorPlausible && live.analysisImage) {
        refine = refinePhysicalCardBoundary({
          image: live.analysisImage,
          corners: detectorPlausible,
          candidateRole: live.selectedRole,
          frame: frameSize,
        });
        item.lastRefine = refine;
        // BAD_SEED / AMBIGUOUS keep original — never launder oversized seeds to safe.
        plausible = refine.selectedQuad;
      }

      const originalSafe = evaluateCaptureSafe({
        corners: detectorPlausible,
        frame: frameSize,
      });
      // Analysis CAPTURE_SAFE on selected quad.
      const analysisSafe = evaluateCaptureSafe({
        corners: plausible,
        frame: frameSize,
      });

      // Source-space anti-clip (independent of 2.5% analysis margin).
      const jitterAnalysisPx =
        item.lock.lastPlausible && plausible
          ? meanCornerDisplacementPx(item.lock.lastPlausible, plausible)
          : null;
      const sourceSafe = evaluateSourceCaptureSafe({
        corners: plausible,
        detector: frameSize,
        oriented: live.spaces?.oriented ?? null,
        cornerJitterAnalysisPx: jitterAnalysisPx,
      });

      const combinedReasons = [...analysisSafe.reasons];
      if (plausible && analysisSafe.captureSafe && !sourceSafe.sourceSafe) {
        combinedReasons.push('source_near_edge');
      }
      const readiness = {
        ...analysisSafe,
        captureSafe: analysisSafe.captureSafe && (!plausible || sourceSafe.sourceSafe),
        reasons: combinedReasons,
        message:
          analysisSafe.captureSafe && plausible && !sourceSafe.sourceSafe
            ? 'TOO CLOSE TO EDGE'
            : analysisSafe.message,
      };

      const toTelemetry = (r: PhysicalRefineResult) => ({
        status: r.status,
        classification: r.classification,
        boundaryModel: r.boundaryModel,
        refinementMs: r.refinementMs,
        selectedForCapture: r.selectedForCapture,
        outerCandidateQuad: r.outerCandidateQuad,
        sleeveQuad: r.sleeveQuad,
        physicalCardQuad: r.physicalCardQuad,
        originalQuad: r.originalQuad,
        refinedQuad: r.physicalCardQuad,
        captureSelectedQuad: r.captureSelectedQuad,
        cornerEvidence: r.cornerEvidence,
        edgeEvidence: r.edgeEvidence,
        edgeInsetNormalized: r.edgeInsetNormalized,
        sleeveInset: r.sleeveInset,
        meanInset: r.meanInset,
        maxInset: r.maxInset,
        globalConsensusScore: r.globalConsensusScore,
        outwardPaddingApplied: r.outwardPaddingApplied,
        rejectionReason: r.rejectionReason,
        originalOccupancy: detectorPlausible
          ? quadOccupancy(detectorPlausible, frameSize)
          : null,
        refinedOccupancy: r.physicalCardQuad
          ? quadOccupancy(r.physicalCardQuad, frameSize)
          : null,
        originalCaptureSafe: originalSafe.captureSafe,
        refinedCaptureSafe:
          r.selectedForCapture === 'PHYSICAL_CARD' ? analysisSafe.captureSafe : null,
        candidateRoleBefore: live.selectedRole,
        candidateRoleAfter:
          r.selectedForCapture === 'PHYSICAL_CARD' ? 'physical-card' : live.selectedRole,
        confidence: r.confidence,
        reason: r.reason,
      });

      const toSourceTelemetry = () => ({
        sourceSafe: sourceSafe.sourceSafe,
        predictedSourceQuad: sourceSafe.predictedSourceQuad,
        sourceCornerMarginsPx: sourceSafe.sourceCornerMarginsPx,
        minSourceMarginPx: sourceSafe.minSourceMarginPx,
        cornerJitterPx: sourceSafe.cornerJitterPx,
        effectiveSourceMarginPx: sourceSafe.effectiveSourceMarginPx,
        reason: sourceSafe.reason,
      });

      if (readiness.captureSafe) {
        item.timing = markFirstTiming(item.timing, 'firstCaptureSafeAt', now);
        if (item.minCornerMarginNormalized == null) {
          item.minCornerMarginNormalized = analysisSafe.minCornerMarginNormalized;
          item.minCornerMarginPixelsAnalysis = analysisSafe.minCornerMarginPixelsAnalysis;
        }
        if (refine && item.physicalRefineTelemetry == null) {
          item.physicalRefineTelemetry = toTelemetry(refine);
        }
        if (item.sourceSafetyTelemetry == null) {
          item.sourceSafetyTelemetry = toSourceTelemetry();
        }
      } else if (refine?.status === 'BAD_SEED' && item.physicalRefineTelemetry == null) {
        // Persist bad-seed rejection even when never capture-safe.
        item.physicalRefineTelemetry = toTelemetry(refine);
      } else if (!sourceSafe.sourceSafe && analysisSafe.captureSafe) {
        // Persist source-gate blocks for calibration.
        item.sourceSafetyTelemetry = toSourceTelemetry();
      }

      const dtMs = item.lastFrameAt != null ? Math.max(0, now - item.lastFrameAt) : 0;
      if (!readiness.captureSafe) {
        item.captureUnsafeReasonMs = accumulateUnsafeReasonMs(
          item.captureUnsafeReasonMs,
          readiness.reasons,
          dtMs,
        );
      }
      item.lastFrameAt = now;

      let lockResult: ReturnType<typeof tickGeometryLock>;
      if (!readiness.captureSafe) {
        // Pause / reset confirmation streak — do not freeze or capture.
        const hadProgress = item.lock.agreeingStreak > 0 || item.lock.lastPlausible != null;
        if (hadProgress && !item.lock.locked) {
          item.lock = emptyGeometryLockState();
          lockResult = {
            state: item.lock,
            decision: 'unsafe',
            iouVsPrev: null,
            cornerMovement: null,
          };
        } else if (item.lock.locked) {
          lockResult = {
            state: item.lock,
            decision: 'locked',
            iouVsPrev: null,
            cornerMovement: null,
          };
        } else {
          lockResult = {
            state: item.lock,
            decision: 'unsafe',
            iouVsPrev: null,
            cornerMovement: null,
          };
        }
      } else {
        lockResult = tickGeometryLock(item.lock, {
          now,
          score: live.detectorScore,
          plausible,
        });
        item.lock = lockResult.state;
        if (lockResult.decision === 'confirming' || lockResult.decision === 'locked') {
          item.timing = markFirstTiming(
            item.timing,
            'confirmationStartedAt',
            lockResult.state.confirmationStartedAt ?? now,
          );
        }
        if (lockResult.decision === 'locked' && lockResult.state.lockedAt != null) {
          item.timing = markFirstTiming(item.timing, 'captureQuadLockedAt', lockResult.state.lockedAt);
          item.lockFrameCount = lockResult.state.agreeingStreak;
          if (refine) {
            item.physicalRefineTelemetry = toTelemetry(refine);
          }
          item.sourceSafetyTelemetry = toSourceTelemetry();
        }
      }

      const frame: GeometryTestFrameDiag = {
        timestamp: now,
        detectorScore: live.detectorScore,
        rawQuad: raw,
        plausibleQuad: plausible,
        iouVsPrev: lockResult.iouVsPrev,
        cornerMovement: lockResult.cornerMovement,
        aspect: readiness.aspect ?? live.aspect,
        occupancy: readiness.occupancy ?? live.occupancy,
        minEdgeMarginNorm: readiness.minEdgeMarginNorm,
        maxOppositeSideRatio: readiness.maxOppositeSideRatio,
        frameWidth: live.frame?.width ?? null,
        frameHeight: live.frame?.height ?? null,
        rawCandidateCount: live.rawCandidateCount,
        selectedCandidateScore: live.selectedCandidateScore,
        selectedRole: live.selectedRole,
        fastAccept: live.fastAccept,
        captureSafe: readiness.captureSafe,
        captureUnsafeReasons: readiness.reasons,
        lockDecision: lockResult.decision,
      };
      item.frames.push(frame);
      if (item.frames.length > 160) item.frames.splice(0, item.frames.length - 160);

      const derived = deriveGeometryTestMs(item.timing);
      const acquisitionPhase: GeometryAcquisitionPhase = !plausible
        ? 'searching'
        : !readiness.captureSafe
          ? 'detected_not_safe'
          : lockResult.decision === 'confirming' || lockResult.decision === 'locked'
            ? 'confirming'
            : 'confirming';
      const phaseTitle =
        acquisitionPhase === 'searching'
          ? 'SEARCHING'
          : acquisitionPhase === 'detected_not_safe'
            ? 'DETECTED · HOLD IN FRAME'
            : `CONFIRMING · ${item.lock.agreeingStreak}`;
      const phaseDetail =
        acquisitionPhase === 'searching'
          ? 'NO CARD GEOMETRY'
          : acquisitionPhase === 'detected_not_safe'
            ? readiness.message || 'MOVE CARD INTO FRAME'
            : '';
      const acquiringMessage = phaseDetail ? `${phaseTitle}\n${phaseDetail}` : phaseTitle;
      setUi(u => ({
        ...u,
        liveQuad: plausible ?? raw,
        originalLiveQuad: detectorPlausible ?? raw,
        sleeveLiveQuad: refine?.sleeveQuad ?? null,
        physicalLiveQuad: refine?.physicalCardQuad ?? null,
        lockedQuad: item.lock.locked,
        focusReportedSuccess: run.bundle.initialFocusReportedSuccess,
        acquisitionPhase,
        captureSafe: readiness.captureSafe,
        captureSafeMessage: readiness.captureSafe ? null : readiness.message || null,
        searchingLong:
          acquisitionPhase === 'searching' &&
          item.timing.buttonPressedAt != null &&
          now - item.timing.buttonPressedAt >= GEOMETRY_TEST_SEARCHING_HINT_MS,
        derived: {
          firstQuadMs: derived.buttonToFirstQuadMs ?? derived.buttonToFirstPlausibleMs ?? derived.buttonToFirstRawMs,
          firstQuadToFirstCaptureSafeMs: derived.firstQuadToFirstCaptureSafeMs,
          lockMs:
            item.timing.buttonPressedAt != null && item.timing.captureQuadLockedAt != null
              ? item.timing.captureQuadLockedAt - item.timing.buttonPressedAt
              : null,
          captureMs: null,
          warpMs: null,
          firstCaptureSafeMs: derived.buttonToFirstCaptureSafeMs,
          captureSafeToLockMs: derived.captureSafeToLockMs,
        },
        message: acquiringMessage,
      }));

      if (lockResult.decision === 'locked') {
        void runCapture(false);
      }
    };
    const id = setInterval(tick, 50);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ui.phase, runCapture]);

  return {
    ui,
    enter,
    start,
    next,
    cancel,
    finish,
    captureCurrent,
    retryMissingUpload,
    setDebugOverlay,
    setFocusMode,
    setPreviewKind,
    markPreviewDisplayed,
  };
};
