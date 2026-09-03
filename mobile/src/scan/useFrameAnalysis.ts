// Native camera → shared detector, instrumented as a boundary ladder.
//
// Phase C.2 baseline (see docs/MOBILE-SCANNER-WIRING.md): keep the shared
// TypeScript `detectCardQuad` and feed it RGBA, so web, native and the offline
// evaluator all run the same detector.
//
// The second Samsung run localised the failure precisely. Camera output ran at
// ~40/s and the worklet sampled ~11.5/s, but nothing ever reached the RN
// runtime: delivered 0, with `nobuf` and `planar` both 0. Since the heartbeat
// that reported those very counters is itself a `scheduleOnRN` call, the
// scheduling mechanism and the RN callback wiring were already proven to work
// — so the fault had to be in the payload path, somewhere between `sampled++`
// and the pixel handoff. That stretch had a `finally` but no `catch`, so a
// throw inside it was invisible: counters kept climbing and no error surfaced.
//
// The worklet now walks four rungs per sampled frame, each independently
// guarded, each with its own counter on both sides of the boundary:
//
//   1. ping   — primitives only. Isolates scheduling from serialization.
//   2. meta   — read the pixel buffer, copy it, send only numbers/strings
//               about it. Proves the read and copy survive, and reports the
//               size arithmetic even when no pixels can cross.
//   3. tiny   — a 64-byte ArrayBuffer plus primitives. Isolates ArrayBuffer
//               serialization from payload size.
//   4. full   — the whole copied analysis buffer.
//
// A rung that throws records its stage and message and does not stop the
// others, so one device run distinguishes "cannot read pixels" from "cannot
// serialize an ArrayBuffer" from "cannot serialize a 1.2 MB one".
//
// Payloads are positional primitives plus at most one ArrayBuffer. No object
// wrapper, no typed-array view, no `Frame` reference: `react-native-worklets`
// 0.10 serializes each argument recursively, and keeping the shape flat means
// a serialization failure can only be about the buffer itself.
//
// The worklet uses built-ins only. Calling an imported function from a worklet
// requires bundle mode, and worklet-izing the shared scanner would mean putting
// platform directives in portable code — exactly what the boundary exists to
// prevent. So the worklet copies bytes and the tested pure converter
// (`frameToScanImage`) runs on the JS thread, where the detector is anyway.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useFrameOutput, type Frame, type FrameDroppedReason } from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

import { createRate, createStage, type AnalysisMetrics } from './analysisStats';
import { scanImageToPngDataUri } from './debug/scanImagePng';
import {
  frameToScanImage,
  imageBrightness,
  pixelOrderFor,
  validateFrameView,
  type FrameOrientation,
} from './frameToScanImage';
import {
  createSessionController,
  detectCardQuad,
  DETECT_MIN_SCORE,
  type CardCorners,
  type ScanImage,
} from './sharedCore';

/** How far up the transfer ladder the worklet is allowed to climb. */
export const RUNGS = ['ping', 'meta', 'tiny', 'full'] as const;
export type Rung = (typeof RUNGS)[number];

/** Analysis resolutions offered for the payload-size experiment. */
export const RESOLUTIONS = [
  { height: 480, width: 640 },
  { height: 360, width: 480 },
  { height: 240, width: 320 },
] as const;

/** Bytes in the tiny-ArrayBuffer rung. Small enough that size cannot be the issue. */
const TINY_BYTES = 64;
/** Thumbnail refresh. Roughly 1–2 per second. */
const PREVIEW_MS = 700;

/** Per-stage tallies. The first one that stops moving is the broken boundary. */
export interface StageCounters {
  bufferCopied: number;
  cameraFrames: number;
  detectorCalls: number;
  detectorHits: number;
  droppedByCamera: number;
  pixelBufferFromPlane: number;
  pixelBufferRead: number;
  rnFull: number;
  rnMeta: number;
  rnPing: number;
  rnTiny: number;
  sampled: number;
  scanImages: number;
  scheduleAttempted: number;
  skippedForCadence: number;
  skippedNoPixelBuffer: number;
  skippedPlanar: number;
  supersededOnJs: number;
}

/** The actual VisionCamera metadata for the latest frame, from the meta rung. */
export interface FrameMetadata {
  /**
   * Which pixel source the worklet actually read, and — when the contiguous
   * frame buffer was unavailable — why it could not be used.
   */
  bufferSource: string;
  /** What the RN runtime actually received for the pixel payload. */
  bytesKind: string;
  /** Row pitch of the buffer that was actually read, not of the frame. */
  bytesPerRow: number;
  /** Bytes the worklet's own copy holds. */
  copiedByteLength: number;
  /** `width * height * 4`, for comparison against the reported stride. */
  expectedPacked: number;
  height: number;
  isMirrored: boolean;
  orientation: string;
  pixelFormat: string;
  /** Bytes `getPixelBuffer()` returned. */
  sourceByteLength: number;
  timestamp: number;
  width: number;
}

/** Primitive args echoed back from the ping rung, proving they arrive intact. */
export interface PingEcho {
  height: number;
  sequence: number;
  width: number;
}

/** Result of the tiny-ArrayBuffer rung: did the bytes cross unchanged? */
export interface TransferCheck {
  byteLength: number;
  firstBytes: string;
  matched: number;
  probed: number;
}

/** A throw inside the worklet, reported over the channel known to work. */
export interface WorkletFailure {
  count: number;
  message: string;
  stage: string;
}

/** `detectCardQuad`'s own diagnostics, not re-derived here. */
export interface DetectorDiagnostics {
  bestCandidateScore: number;
  candidates: number;
  detectMs: number;
  detected: boolean;
  rejectReasons: string[];
  score: number;
  selectedIndex: number;
  workSize: { height: number; width: number };
}

export interface AnalysisResult {
  analysis: { height: number; width: number };
  brightness: number;
  corners: CardCorners | null;
  detected: boolean;
  detector: DetectorDiagnostics;
  score: number;
}

export interface FrameProbeResult {
  brightness: number;
  controllerPhase: string;
  rawDetected: boolean;
  rawMs: number;
  rawScore: number;
  rejectReasons: string[];
  size: string;
}

export interface FrameAnalysisOptions {
  analysisMaxWidth?: number;
  debugPreview?: boolean;
  enabled?: boolean;
  /** Index into `RESOLUTIONS`. */
  resolutionIndex?: number;
  /** Highest ladder rung to attempt. Lower it to isolate a failure. */
  rung?: Rung;
  targetAnalysisFps?: number;
}

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const ORIENTATIONS: readonly string[] = ['up', 'right', 'down', 'left'];

const emptyCounters = (): StageCounters => ({
  bufferCopied: 0,
  cameraFrames: 0,
  detectorCalls: 0,
  detectorHits: 0,
  droppedByCamera: 0,
  pixelBufferFromPlane: 0,
  pixelBufferRead: 0,
  rnFull: 0,
  rnMeta: 0,
  rnPing: 0,
  rnTiny: 0,
  sampled: 0,
  scanImages: 0,
  scheduleAttempted: 0,
  skippedForCadence: 0,
  skippedNoPixelBuffer: 0,
  skippedPlanar: 0,
  supersededOnJs: 0,
});

/** Rank rejection reasons by how often the detector cited them. */
const topRejectReasons = (reasons: string[][]): string[] => {
  const counts = new Map<string, number>();
  for (const list of reasons) {
    for (const reason of list) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, count]) => `${reason} ×${count}`);
};

/** Describe what actually arrived, rather than assuming it is an ArrayBuffer. */
const describeBytes = (value: unknown): string => {
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength})`;
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor?.name ?? 'view'}(${value.byteLength})`;
  }
  return value === null || value === undefined ? String(value) : typeof value;
};

export const useFrameAnalysis = ({
  analysisMaxWidth = 640,
  debugPreview = true,
  enabled = true,
  resolutionIndex = 0,
  rung = 'full',
  targetAnalysisFps = 10,
}: FrameAnalysisOptions = {}) => {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [metrics, setMetrics] = useState<AnalysisMetrics | null>(null);
  const [counters, setCounters] = useState<StageCounters>(emptyCounters);
  const [frameMeta, setFrameMeta] = useState<FrameMetadata | null>(null);
  const [transfer, setTransfer] = useState<TransferCheck | null>(null);
  const [ping, setPing] = useState<PingEcho | null>(null);
  const [failure, setFailure] = useState<WorkletFailure | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<FrameProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stages = useMemo(
    () => ({
      convert: createStage(),
      detect: createStage(),
      total: createStage(),
      transfer: createStage(),
    }),
    [],
  );
  const rates = useMemo(
    () => ({
      analysis: createRate(),
      camera: createRate(),
      delivery: createRate(),
      sample: createRate(),
    }),
    [],
  );

  const tally = useRef(emptyCounters());
  const dropReason = useRef<FrameDroppedReason | null>(null);
  const lastImage = useRef<ScanImage | null>(null);
  const lastPreviewAt = useRef(0);
  const lastMeta = useRef<FrameMetadata | null>(null);
  const pending = useRef<{
    bytes: ArrayBuffer;
    bytesPerRow: number;
    height: number;
    isMirrored: boolean;
    orientation: string;
    width: number;
  } | null>(null);
  const draining = useRef(false);

  const publish = useCallback(() => {
    const t = now();
    setCounters({ ...tally.current });
    setMetrics({
      analysisRate: rates.analysis.read(t),
      convertMs: stages.convert.read(),
      deliveryRate: rates.delivery.read(t),
      detectMs: stages.detect.read(),
      droppedByCamera: tally.current.droppedByCamera,
      frameRate: rates.camera.read(t),
      lastDropReason: dropReason.current,
      sampleRate: rates.sample.read(t),
      skippedForCadence: tally.current.skippedForCadence,
      supersededOnJs: tally.current.supersededOnJs,
      totalMs: stages.total.read(),
      transferMs: stages.transfer.read(),
    });
  }, [rates, stages]);

  // ---------------------------------------------------------------------------
  // RN-runtime callbacks.
  //
  // Every one is a stable `useCallback` with no changing dependencies, defined
  // on the RN runtime and never marked `'worklet'`. The worklet captures them
  // by reference and `scheduleOnRN` turns each into a remote function handle.
  // ---------------------------------------------------------------------------

  /**
   * Rung 1. Primitives only — proves scheduling independently of serialization.
   *
   * The values are echoed back to the panel rather than discarded, so this also
   * shows that primitive arguments arrive intact and in order.
   */
  const onPing = useCallback(
    (sequence: number, width: number, height: number) => {
      tally.current.rnPing++;
      rates.delivery.mark(now());
      setPing({ height, sequence, width });
    },
    [rates],
  );

  /** Rung 2. Numbers and strings describing the frame; no pixels. */
  const onMeta = useCallback(
    (
      width: number,
      height: number,
      bytesPerRow: number,
      sourceByteLength: number,
      copiedByteLength: number,
      pixelFormat: string,
      orientation: string,
      isMirrored: boolean,
      timestamp: number,
      bufferSource: string,
    ) => {
      tally.current.rnMeta++;
      lastMeta.current = {
        bufferSource,
        bytesKind: 'n/a (meta rung)',
        bytesPerRow,
        copiedByteLength,
        expectedPacked: width * height * 4,
        height,
        isMirrored,
        orientation,
        pixelFormat,
        sourceByteLength,
        timestamp,
        width,
      };
      setFrameMeta(lastMeta.current);
    },
    [],
  );

  /** Rung 3. A 64-byte ArrayBuffer plus the same bytes as primitives. */
  const onTiny = useCallback(
    (bytes: ArrayBuffer, a: number, b: number, c: number, d: number) => {
      tally.current.rnTiny++;
      const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(0);
      const expected = [a, b, c, d];
      const at = [0, 1, TINY_BYTES >> 1, TINY_BYTES - 1];
      let matched = 0;
      for (let i = 0; i < at.length; i++) {
        if (view[at[i]] === expected[i]) matched++;
      }
      setTransfer({
        byteLength: view.length,
        firstBytes: [...view.slice(0, 8)].join(' '),
        matched,
        probed: at.length,
      });
      if (lastMeta.current) {
        setFrameMeta({ ...lastMeta.current, bytesKind: describeBytes(bytes) });
      }
    },
    [],
  );

  const analyse = useCallback(
    (payload: {
      bytes: ArrayBuffer;
      bytesPerRow: number;
      height: number;
      isMirrored: boolean;
      orientation: string;
      width: number;
    }) => {
      const meta = lastMeta.current;
      const pixelOrder = pixelOrderFor(meta?.pixelFormat ?? '');
      if (!pixelOrder) {
        // Planar/private formats have no contiguous RGBA buffer to read. Fail
        // loudly rather than draw a plausible-looking wrong overlay.
        setError(
          `Camera delivered '${meta?.pixelFormat ?? 'unknown'}', which is not an 8-bit RGB ` +
            'format. The RGBA baseline needs rgb-bgra-8-bit, rgb-rgba-8-bit or rgb-rgb-8-bit.',
        );
        publish();
        return;
      }
      const orientation = (
        ORIENTATIONS.includes(payload.orientation) ? payload.orientation : 'up'
      ) as FrameOrientation;

      const bytes = new Uint8Array(payload.bytes);
      const validation = validateFrameView({
        byteLength: bytes.length,
        bytesPerRow: payload.bytesPerRow,
        height: payload.height,
        isMirrored: payload.isMirrored,
        orientation,
        pixelOrder,
        width: payload.width,
      });
      if (validation.reason) {
        setError(`Frame buffer does not match its geometry: ${validation.reason}.`);
        publish();
        return;
      }

      const startedAt = now();
      const image = frameToScanImage(
        {
          bytes,
          bytesPerRow: payload.bytesPerRow,
          height: payload.height,
          isMirrored: payload.isMirrored,
          orientation,
          pixelOrder,
          width: payload.width,
        },
        { maxWidth: analysisMaxWidth },
      );
      const convertedAt = now();
      tally.current.scanImages++;
      lastImage.current = image;

      tally.current.detectorCalls++;
      const detection = detectCardQuad(image);
      const finishedAt = now();

      const detected = Boolean(detection.corners) && detection.score >= DETECT_MIN_SCORE;
      if (detected) tally.current.detectorHits++;

      stages.convert.push(convertedAt - startedAt);
      stages.detect.push(finishedAt - convertedAt);
      stages.total.push(finishedAt - startedAt);
      rates.analysis.mark(finishedAt);

      const candidates = detection.debug.candidates;
      setResult({
        analysis: { height: image.height, width: image.width },
        brightness: imageBrightness(image),
        corners: detection.corners,
        detected,
        detector: {
          bestCandidateScore: candidates.reduce((best, c) => Math.max(best, c.score), 0),
          candidates: candidates.length,
          detectMs: detection.debug.ms,
          detected,
          rejectReasons: topRejectReasons(candidates.map(c => c.rejectedBecause)),
          score: detection.score,
          selectedIndex: detection.debug.selectedIndex,
          workSize: detection.debug.workSize,
        },
        score: detection.score,
      });
      setError(null);

      if (debugPreview && finishedAt - lastPreviewAt.current >= PREVIEW_MS) {
        lastPreviewAt.current = finishedAt;
        try {
          setPreview(scanImageToPngDataUri(image));
        } catch (err) {
          setPreview(null);
          setError(`Preview encode failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      publish();
    },
    [analysisMaxWidth, debugPreview, publish, rates, stages],
  );

  const drain = useCallback(() => {
    draining.current = false;
    const payload = pending.current;
    pending.current = null;
    if (!payload) return;
    try {
      analyse(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [analyse]);

  /** Rung 4. The full copied analysis buffer, positional args only. */
  const onFull = useCallback(
    (
      bytes: ArrayBuffer,
      width: number,
      height: number,
      bytesPerRow: number,
      orientation: string,
      isMirrored: boolean,
      postedAt: number,
    ) => {
      const transferMs = Date.now() - postedAt;
      if (transferMs >= 0 && transferMs < 1000) stages.transfer.push(transferMs);

      tally.current.rnFull++;
      if (lastMeta.current) {
        setFrameMeta({ ...lastMeta.current, bytesKind: describeBytes(bytes) });
      }

      if (!(bytes instanceof ArrayBuffer)) {
        setError(`Full rung delivered ${describeBytes(bytes)}, expected an ArrayBuffer.`);
        publish();
        return;
      }

      if (pending.current) tally.current.supersededOnJs++;
      pending.current = { bytes, bytesPerRow, height, isMirrored, orientation, width };

      // A macrotask, not a microtask: any further deliveries already queued
      // collapse into this one drain, so we detect on the newest frame.
      if (!draining.current) {
        draining.current = true;
        setTimeout(drain, 0);
      }
    },
    [drain, publish, stages],
  );

  /**
   * A throw inside the worklet, reported over the primitive channel.
   *
   * The previous build had a `finally` but no `catch`, so a failure in the
   * pixel path was completely silent — counters kept climbing and no error
   * ever surfaced. This is the fix for that blind spot.
   */
  const onWorkletError = useCallback((stage: string, message: string) => {
    setFailure(current =>
      current && current.stage === stage && current.message === message
        ? { ...current, count: current.count + 1 }
        : { count: 1, message, stage },
    );
  }, []);

  /**
   * Primitive-only counter report from the worklet, on a timer.
   *
   * Deliberately independent of the ladder: it is what proved, last run, that
   * the camera and the worklet were both healthy while nothing crossed.
   */
  const heartbeat = useCallback(
    (
      cameraFrames: number,
      sampled: number,
      skippedForCadence: number,
      skippedNoPixelBuffer: number,
      skippedPlanar: number,
      pixelBufferRead: number,
      bufferCopied: number,
      scheduleAttempted: number,
      pixelBufferFromPlane: number,
    ) => {
      const previousCamera = tally.current.cameraFrames;
      const previousSampled = tally.current.sampled;
      tally.current.bufferCopied = bufferCopied;
      tally.current.cameraFrames = cameraFrames;
      tally.current.pixelBufferFromPlane = pixelBufferFromPlane;
      tally.current.pixelBufferRead = pixelBufferRead;
      tally.current.sampled = sampled;
      tally.current.scheduleAttempted = scheduleAttempted;
      tally.current.skippedForCadence = skippedForCadence;
      tally.current.skippedNoPixelBuffer = skippedNoPixelBuffer;
      tally.current.skippedPlanar = skippedPlanar;

      // Rates need one mark per event, but the heartbeat is a batch. Replay the
      // delta so camera/sample fps stay honest without a mark per frame.
      const t = now();
      for (let i = previousCamera; i < cameraFrames; i++) rates.camera.mark(t);
      for (let i = previousSampled; i < sampled; i++) rates.sample.mark(t);

      publish();
    },
    [publish, rates],
  );

  const onFrameDropped = useCallback((reason: FrameDroppedReason) => {
    tally.current.droppedByCamera++;
    dropReason.current = reason;
  }, []);

  const minIntervalMs = Math.max(1, Math.round(1000 / Math.max(1, targetAnalysisFps)));
  const maxRung = RUNGS.indexOf(rung) + 1;

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      // Worklet-runtime globals persist between calls, which is the only
      // cross-call state a worklet gets without a Synchronizable.
      const store = globalThis as {
        __luginScan?: {
          at: number;
          beat: number;
          cameraFrames: number;
          copied: number;
          errorAt: number;
          fromPlane: number;
          read: number;
          sampled: number;
          scheduled: number;
          seq: number;
          skipCadence: number;
          skipNoBuffer: number;
          skipPlanar: number;
        };
      };
      const state =
        store.__luginScan ??
        (store.__luginScan = {
          at: 0,
          beat: 0,
          cameraFrames: 0,
          copied: 0,
          errorAt: 0,
          fromPlane: 0,
          read: 0,
          sampled: 0,
          scheduled: 0,
          seq: 0,
          skipCadence: 0,
          skipNoBuffer: 0,
          skipPlanar: 0,
        });

      // Report a throw without hiding it: the stage name says which rung died,
      // and the ladder continues so one run diagnoses every boundary at once.
      const report = (stage: string, err: unknown) => {
        const stamp = Date.now();
        if (stamp - state.errorAt < 500) return;
        state.errorAt = stamp;
        const message =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : typeof err === 'string'
              ? err
              : `non-error: ${String(err)}`;
        scheduleOnRN(onWorkletError, stage, message);
      };

      try {
        const stamp = Date.now();
        state.cameraFrames++;

        // Before any early return, so a stalled pipeline still reports.
        if (stamp - state.beat >= 500) {
          state.beat = stamp;
          scheduleOnRN(
            heartbeat,
            state.cameraFrames,
            state.sampled,
            state.skipCadence,
            state.skipNoBuffer,
            state.skipPlanar,
            state.read,
            state.copied,
            state.scheduled,
            state.fromPlane,
          );
        }

        if (stamp - state.at < minIntervalMs) {
          state.skipCadence++;
          return;
        }
        if (!frame.hasPixelBuffer) {
          state.skipNoBuffer++;
          return;
        }
        if (frame.isPlanar) {
          state.skipPlanar++;
          return;
        }
        state.at = stamp;
        state.sampled++;
        state.seq++;

        // Rung 1: primitives only.
        try {
          scheduleOnRN(onPing, state.seq, frame.width, frame.height);
        } catch (err) {
          report('ping', err);
        }
        if (maxRung < 2) return;

        // Rung 2: read the pixel buffer and take an independent copy, both
        // while the frame is still valid, then describe it with primitives.
        //
        // Two sources, tried in order, because `hasPixelBuffer` being true does
        // not mean the *contiguous whole-frame* buffer is readable:
        //
        //   1. `frame.getPixelBuffer()`. On Android this prefers the frame's
        //      GPU `HardwareBuffer` and has to `AHardwareBuffer_lock` it for CPU
        //      reads. The lock is a device-dependent operation and throws
        //      outright when it fails, even though the usage flags that
        //      `hasPixelBuffer` inspects said CPU reads were allowed.
        //   2. Plane 0 of `frame.getPlanes()`. A non-planar RGB frame has
        //      exactly one plane holding the same pixels behind a plain CPU
        //      `ByteBuffer`, with no lock and no GPU download — so it works
        //      wherever the frame buffer does not. Its `bytesPerRow` is the
        //      authoritative row pitch, which is why the stride travels with
        //      the payload from here rather than being read off the frame.
        //
        // iOS only ever needs the first: `getPlanes()` returns `[]` for
        // non-planar frames there, so the fallback is a no-op.
        let copy: Uint8Array | null = null;
        let sourceLength = 0;
        let stride = frame.bytesPerRow;
        let bufferSource = 'frame buffer';
        let frameBufferError = '';
        try {
          const source = new Uint8Array(frame.getPixelBuffer());
          sourceLength = source.length;
          state.read++;
          // A standalone Hermes-owned buffer. Nothing downstream may touch
          // frame memory, which stops being valid at `dispose()` below.
          const copied = new Uint8Array(source.length);
          copied.set(source);
          copy = copied;
          state.copied++;
        } catch (err) {
          if (sourceLength > 0) {
            // The read succeeded and the copy did not, so falling back to a
            // second source would only hit the same allocation failure.
            report('bufferCopy', err);
            return;
          }
          frameBufferError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        }

        if (copy === null) {
          try {
            const planes = frame.getPlanes();
            if (planes.length === 0) {
              throw new Error('frame exposes no planes either');
            }
            const plane = planes[0];
            const source = new Uint8Array(plane.getPixelBuffer());
            sourceLength = source.length;
            state.read++;
            const copied = new Uint8Array(source.length);
            copied.set(source);
            copy = copied;
            state.copied++;
            state.fromPlane++;
            stride = plane.bytesPerRow;
            bufferSource = `plane 0 (frame buffer failed: ${frameBufferError})`;
          } catch (err) {
            const planeError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            report('pixelBufferRead', `frame buffer — ${frameBufferError}; plane 0 — ${planeError}`);
            return;
          }
        }

        try {
          scheduleOnRN(
            onMeta,
            frame.width,
            frame.height,
            stride,
            sourceLength,
            copy.length,
            frame.pixelFormat,
            frame.orientation,
            frame.isMirrored,
            frame.timestamp,
            bufferSource,
          );
        } catch (err) {
          report('metaTransfer', err);
        }
        if (maxRung < 3) return;

        // Rung 3: a small ArrayBuffer, to separate "ArrayBuffer serialization
        // does not work" from "this ArrayBuffer is too big".
        try {
          const size = Math.min(64, copy.length);
          const tiny = new Uint8Array(size);
          for (let i = 0; i < size; i++) tiny[i] = copy[i];
          scheduleOnRN(
            onTiny,
            // Freshly allocated above, so this is a plain ArrayBuffer.
            tiny.buffer as ArrayBuffer,
            tiny[0],
            tiny[1],
            tiny[size >> 1],
            tiny[size - 1],
          );
        } catch (err) {
          report('tinyArrayBuffer', err);
        }
        if (maxRung < 4) return;

        // Rung 4: the whole copy.
        try {
          state.scheduled++;
          scheduleOnRN(
            onFull,
            copy.buffer as ArrayBuffer,
            frame.width,
            frame.height,
            stride,
            frame.orientation,
            frame.isMirrored,
            Date.now(),
          );
        } catch (err) {
          report('fullArrayBuffer', err);
        }
      } catch (err) {
        // Anything outside the rungs — frame property access, for instance.
        report('worklet', err);
      } finally {
        // Unconditional, and only after every copy and schedule is done: a
        // retained frame stalls the camera pipeline, and frame-owned memory is
        // invalid the moment this returns.
        frame.dispose();
      }
    },
    [heartbeat, maxRung, minIntervalMs, onFull, onMeta, onPing, onTiny, onWorkletError],
  );

  /**
   * Run the detector once, synchronously, on the last detector input.
   *
   * Removes cadence, the worklet and the transfer from the equation.
   */
  const testCurrentFrame = useCallback(() => {
    const image = lastImage.current;
    if (!image) {
      setProbeResult(null);
      setError('No detector input captured yet — nothing to test.');
      return;
    }

    const startedAt = now();
    const detection = detectCardQuad(image);
    const rawMs = now() - startedAt;

    setProbeResult({
      brightness: imageBrightness(image),
      controllerPhase: 'running…',
      rawDetected: Boolean(detection.corners) && detection.score >= DETECT_MIN_SCORE,
      rawMs,
      rawScore: detection.score,
      rejectReasons: topRejectReasons(detection.debug.candidates.map(c => c.rejectedBecause)),
      size: `${image.width}×${image.height}`,
    });
    setPreview(scanImageToPngDataUri(image));

    // The controller is not in the live path — the overlay is driven straight
    // from `detectCardQuad`. Running it here on the same pixels is what lets us
    // say whether it *would* suppress a valid detection.
    const controller = createSessionController({ nameIndex: null });
    void controller
      .onFrame(image)
      .then(snapshot =>
        setProbeResult(current =>
          current ? { ...current, controllerPhase: snapshot.phase } : current,
        ),
      )
      .catch((err: unknown) =>
        setProbeResult(current =>
          current
            ? {
                ...current,
                controllerPhase: `threw: ${err instanceof Error ? err.message : String(err)}`,
              }
            : current,
        ),
      );
  }, []);

  const resetCounters = useCallback(() => {
    tally.current = emptyCounters();
    dropReason.current = null;
    stages.convert.reset();
    stages.detect.reset();
    stages.total.reset();
    stages.transfer.reset();
    rates.analysis.reset();
    rates.camera.reset();
    rates.delivery.reset();
    rates.sample.reset();
    setProbeResult(null);
    setFailure(null);
    setTransfer(null);
    setPing(null);
    setError(null);
    publish();
  }, [publish, rates, stages]);

  // Memoized: a fresh object each render would reconfigure the camera session.
  const resolution = RESOLUTIONS[resolutionIndex] ?? RESOLUTIONS[0];
  const targetResolution = useMemo(
    () => ({ height: resolution.height, width: resolution.width }),
    [resolution.height, resolution.width],
  );

  const frameOutput = useFrameOutput({
    // Latest-frame-wins on the native side.
    dropFramesWhileBusy: true,
    onFrame: enabled ? onFrame : undefined,
    onFrameDropped,
    // RGBA in the camera pipeline. Costs bandwidth versus YUV, which is the
    // trade being measured; converting YUV by hand in JS would cost more.
    pixelFormat: 'rgb',
    // The one thing that keeps full-resolution frames out of this pipeline.
    targetResolution,
  });

  useEffect(() => {
    if (enabled) return;
    pending.current = null;
    setResult(null);
  }, [enabled]);

  return {
    counters,
    error,
    failure,
    frameMeta,
    frameOutput,
    metrics,
    ping,
    preview,
    probeResult,
    resetCounters,
    resolution,
    result,
    testCurrentFrame,
    transfer,
  };
};
