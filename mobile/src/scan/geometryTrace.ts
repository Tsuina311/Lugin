// Debug-only geometry capture. Works in any scanner phase — no identity needed.

import type { ContinuityDecision, CardCorners, ScanImage } from './sharedCore';
import { annotateGeometryImage, cloneScanImage } from './annotateQuads';

export const GEOMETRY_TRACE_MAX_SAMPLES = 40;
export const GEOMETRY_TRACE_MAX_MS = 3000;

export interface GeometryTraceContext {
  actualDetectorEngine?: string | null;
  consecutiveStable?: number | null;
  detectorInput?: { height: number; width: number } | null;
  detectorIntervalP50?: number | null;
  detectorIntervalP95?: number | null;
  focusKind?: string | null;
  focusReentries?: number | null;
  focusRequests?: number | null;
  focusSuccesses?: number | null;
  focusTimedOut?: boolean | null;
  focusTimeouts?: number | null;
  focusWaitMs?: number | null;
  highResFailure?: number | null;
  highResRequests?: number | null;
  highResSuccess?: number | null;
  lastHighResError?: string | null;
  lastHitAgeMs?: number | null;
  lockBlocker?: string | null;
  orientation?: string | null;
  phase?: string | null;
  phaseAfterRecognition?: string | null;
  postLockStall?: boolean | null;
  recognizeInvocations?: number | null;
  recognitionStatus?: string | null;
  retryReason?: string | null;
  retryScheduledAt?: number | null;
  previewCrop?: { height: number; width: number; x: number; y: number } | null;
  rowStride?: number | null;
  stableDurationMs?: number | null;
  titleRawText?: string | null;
  titleTopCandidate?: string | null;
  trackHoldReason?: string | null;
  trackUpdateReason?: string | null;
  trackedQuadUpdatedAt?: number | null;
}

export interface GeometryTraceSample {
  areaDelta: number;
  candidateCount: number;
  candidates: Array<{
    aspect?: number;
    corners: CardCorners;
    score: number;
  }>;
  centerDelta: number;
  consecutiveStable?: number | null;
  cornerDelta: number;
  detectorIntervalMs: number | null;
  focusKind?: string | null;
  focusReentries?: number | null;
  focusRequests?: number | null;
  focusSuccesses?: number | null;
  focusTimedOut?: boolean | null;
  focusTimeouts?: number | null;
  focusWaitMs?: number | null;
  highResFailure?: number | null;
  highResRequests?: number | null;
  highResSuccess?: number | null;
  hit: boolean;
  iou: number;
  lastHighResError?: string | null;
  lastHitAgeMs: number | null;
  lockBlocker: string | null;
  phase: string | null;
  phaseAfterRecognition?: string | null;
  postLockStall?: boolean | null;
  recognizeInvocations?: number | null;
  recognitionStatus?: string | null;
  retryReason?: string | null;
  presentedCorners: CardCorners | null;
  previousCorners: CardCorners | null;
  rawCorners: CardCorners | null;
  recognitionCorners: CardCorners | null;
  recognitionQuadSource?: string | null;
  recognitionQuadValid?: boolean | null;
  recognitionRejectReasons?: string[];
  rawScore: number;
  resetReason: string | null;
  role: string;
  roleSwitchCount: number;
  rotationDelta: number;
  selectedIndex: number;
  selectionReason: string;
  sequence: number;
  stableDurationMs?: number | null;
  t: number;
  titleRawText?: string | null;
  titleTopCandidate?: string | null;
  trackActive: boolean;
  trackAge: number;
  trackHoldReason?: string | null;
  trackId: number | null;
  trackUpdateReason?: string | null;
  trackedCorners: CardCorners | null;
  trackedQuadUpdatedAt?: number | null;
}

export interface GeometryTraceBundle {
  images: {
    first: ScanImage | null;
    last: ScanImage | null;
    middle: ScanImage | null;
  };
  meta: GeometryTraceContext & {
    capturedAt: string;
    sampleCount: number;
    durationMs: number;
  };
  samples: GeometryTraceSample[];
}

type ActiveTrace = {
  context: GeometryTraceContext;
  firstImage: ScanImage | null;
  lastImage: ScanImage | null;
  lastRaw: CardCorners | null;
  lastT: number | null;
  middleImage: ScanImage | null;
  previousTracked: CardCorners | null;
  samples: GeometryTraceSample[];
  startedAt: number;
};

let active: ActiveTrace | null = null;
let latestContext: GeometryTraceContext = {};

export const setGeometryTraceContext = (ctx: GeometryTraceContext): void => {
  latestContext = { ...latestContext, ...ctx };
  if (active) active.context = { ...active.context, ...ctx };
};

export const isGeometryTraceActive = (): boolean => active != null;

export const geometryTraceSampleCount = (): number => active?.samples.length ?? 0;

export const startGeometryTrace = (context: GeometryTraceContext = {}): boolean => {
  if (active) return false;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  latestContext = { ...latestContext, ...context };
  active = {
    context: { ...latestContext },
    firstImage: null,
    lastImage: null,
    lastRaw: null,
    lastT: null,
    middleImage: null,
    previousTracked: null,
    samples: [],
    startedAt: now,
  };
  return true;
};

const snapshotImage = (
  image: ScanImage | null | undefined,
  decision: ContinuityDecision,
  previous: CardCorners | null,
): ScanImage | null => {
  if (!image) return null;
  return annotateGeometryImage(cloneScanImage(image), {
    presented: decision.presentedCorners,
    previous,
    raw: decision.rawCorners,
    recognition: decision.recognitionQuad,
    tracked: decision.trackedCorners,
  });
};

export const recordGeometrySample = (input: {
  candidates?: Array<{ aspect?: number; corners: CardCorners; score: number }>;
  decision: ContinuityDecision;
  image?: ScanImage | null;
  rawScore: number;
}): void => {
  if (!active) return;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  if (
    active.samples.length >= GEOMETRY_TRACE_MAX_SAMPLES ||
    now - active.startedAt >= GEOMETRY_TRACE_MAX_MS
  ) {
    return;
  }
  const d = input.decision;
  const interval = active.lastT == null ? null : now - active.lastT;
  const sample: GeometryTraceSample = {
    areaDelta: d.metrics.areaDelta,
    candidateCount: input.candidates?.length ?? 0,
    candidates: (input.candidates ?? []).slice(0, 6),
    centerDelta: d.metrics.centerDelta,
    consecutiveStable: latestContext.consecutiveStable ?? null,
    cornerDelta: d.metrics.cornerDelta,
    detectorIntervalMs: interval,
    focusKind: latestContext.focusKind ?? null,
    focusReentries: latestContext.focusReentries ?? null,
    focusRequests: latestContext.focusRequests ?? null,
    focusSuccesses: latestContext.focusSuccesses ?? null,
    focusTimedOut: latestContext.focusTimedOut ?? null,
    focusTimeouts: latestContext.focusTimeouts ?? null,
    focusWaitMs: latestContext.focusWaitMs ?? null,
    highResFailure: latestContext.highResFailure ?? null,
    highResRequests: latestContext.highResRequests ?? null,
    highResSuccess: latestContext.highResSuccess ?? null,
    hit: d.hit,
    iou: d.metrics.iou,
    lastHighResError: latestContext.lastHighResError ?? null,
    lastHitAgeMs: latestContext.lastHitAgeMs ?? null,
    lockBlocker: latestContext.lockBlocker ?? null,
    phase: latestContext.phase ?? null,
    phaseAfterRecognition: latestContext.phaseAfterRecognition ?? null,
    postLockStall: latestContext.postLockStall ?? null,
    recognizeInvocations: latestContext.recognizeInvocations ?? null,
    recognitionStatus: latestContext.recognitionStatus ?? null,
    retryReason: latestContext.retryReason ?? null,
    presentedCorners: d.presentedCorners,
    previousCorners: active.previousTracked,
    rawCorners: d.rawCorners,
    recognitionCorners: d.recognitionQuad,
    recognitionQuadSource: d.recognitionQuadSource,
    recognitionQuadValid: d.recognitionQuadValid,
    recognitionRejectReasons: d.recognitionRejectReasons,
    rawScore: input.rawScore,
    resetReason: d.state.lastResetReason,
    role: d.selectedRole,
    roleSwitchCount: d.state.roleSwitchCount,
    rotationDelta: d.metrics.rotationDelta,
    selectedIndex: d.selectedIndex,
    selectionReason: d.selectionReason,
    sequence: active.samples.length,
    stableDurationMs: latestContext.stableDurationMs ?? null,
    t: now,
    titleRawText: latestContext.titleRawText ?? null,
    titleTopCandidate: latestContext.titleTopCandidate ?? null,
    trackActive: Boolean(d.track),
    trackAge: d.track?.age ?? 0,
    trackHoldReason: d.trackHoldReason ?? latestContext.trackHoldReason ?? null,
    trackId: d.track?.id ?? null,
    trackUpdateReason: d.trackUpdateReason ?? latestContext.trackUpdateReason ?? null,
    trackedCorners: d.trackedCorners,
    trackedQuadUpdatedAt: d.trackedQuadUpdatedAt ?? latestContext.trackedQuadUpdatedAt ?? null,
  };
  active.samples.push(sample);
  if (!active.firstImage && input.image) {
    active.firstImage = snapshotImage(input.image, d, active.previousTracked);
  }
  if (input.image) {
    active.lastImage = snapshotImage(input.image, d, active.previousTracked);
    if (!active.middleImage && (active.samples.length >= 15 || now - active.startedAt >= 1400)) {
      active.middleImage = active.lastImage;
    }
  }
  active.lastRaw = d.rawCorners;
  active.lastT = now;
  active.previousTracked = d.trackedCorners;
};

export const finishGeometryTrace = (): GeometryTraceBundle | null => {
  if (!active) return null;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const bundle: GeometryTraceBundle = {
    images: {
      first: active.firstImage,
      last: active.lastImage,
      middle: active.middleImage,
    },
    meta: {
      ...active.context,
      capturedAt: new Date().toISOString(),
      durationMs: now - active.startedAt,
      sampleCount: active.samples.length,
    },
    samples: active.samples,
  };
  active = null;
  return bundle;
};
