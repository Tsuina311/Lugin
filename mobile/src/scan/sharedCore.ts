// The one place the native app reaches into the shared Lugin scanner.
//
// Everything re-exported here is portable by audit (docs/MOBILE-SCANNER-WIRING.md)
// and is already executed outside a browser by the Node evaluation harness.
// Native code imports from this module rather than reaching into `@/lib/scan/*`
// directly, so there is a single boundary to guard: if a browser-only module
// ever gets pulled in transitively, `yarn mobile:test` fails here rather than
// at runtime on the phone.
//
// Do NOT copy scanner logic into mobile/. Do NOT add `Platform.OS` branches to
// anything upstream of this file. Platform behaviour belongs in the adapters
// that implement the seams listed below.

// --- Portable image contract -------------------------------------------------
export type { CardCorners, Point, Rect, RelativeRegion, ScanImage } from '@/lib/scan/types';
export { blankImage, cropImage, cropRect, regionToRect } from '@/lib/scan/types';

// --- Geometry / detection ----------------------------------------------------
export type { Quad } from '@/lib/scan/geometry';
export {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  cornersToQuad,
  quadToCorners,
  warpQuadToCard,
} from '@/lib/scan/geometry';
export type { DetectResult } from '@/lib/scan/detectCard';
export { detectCardQuad } from '@/lib/scan/detectCard';
export type { DetectionDebug } from '@/lib/scan/detection/types';
export { emptyDetectionDebug } from '@/lib/scan/detection/types';
export type { CardSource, PreparedCard } from '@/lib/scan/prepareCard';
export { prepareCard } from '@/lib/scan/prepareCard';

// --- Coordinate mapping (analysis → source → preview) ------------------------
export type { Point2D, Size2D } from '@/lib/scan/videoMap';
export {
  coverLayout,
  coverSourceRect,
  mapAnalysisToOverlay,
  mapAnalysisToSource,
  mapCornersToOverlay,
  mapCoverDestToSource,
  mapCoverSourceToDest,
} from '@/lib/scan/videoMap';

// --- Tracking / quality / focus gating --------------------------------------
export type { TrackSample, TrackState } from '@/lib/scan/tracking';
export {
  emptyTrack,
  geometryChanged,
  latestCorners,
  pushTrack,
  sampleFromQuad,
  trackMotion,
} from '@/lib/scan/tracking';
export type { FrameQuality } from '@/lib/scan/quality';
export { frameQualityScore, pushQualityPool, sharpnessScore } from '@/lib/scan/quality';
export { focusGateDecision, preferredMainLensZoom } from '@/lib/scan/cameraCapabilities';

// --- Session state machine ---------------------------------------------------
export type {
  FrameHelpers,
  ScanContext,
  ScannerPhase,
  SessionController,
  SessionSnapshot,
} from '@/lib/scan/session/controller';
export { createSessionController } from '@/lib/scan/session/controller';

// --- Recognition -------------------------------------------------------------
export type { RecognizeDeps, RecognizeResult } from '@/lib/scan/session/recognize';
export { recognizeCard } from '@/lib/scan/session/recognize';
export type {
  RecognitionMode,
  RecognizeOptions,
  TextRecognitionResult,
  TextRecognizer,
} from '@/lib/scan/textRecognizer';
export { EMPTY_RECOGNITION } from '@/lib/scan/textRecognizer';
export type { CardNameIndex, CardNameIndexData, NameCandidate } from '@/lib/scan/matchName';
export { buildNameIndex, matchReadings, shapeFold } from '@/lib/scan/matchName';
export type { ArtworkIndexData, ArtworkMatcher, VisualCandidate } from '@/lib/scan/artwork/match';
export { createArtworkMatcher, NO_ARTWORK_MATCHER } from '@/lib/scan/artwork/match';
export { describeArtwork } from '@/lib/scan/artwork/descriptors';
export type { TextIndexData } from '@/lib/scan/text/evidence';
export { textEvidenceScore } from '@/lib/scan/text/evidence';
export type { FusedResult, RankedCandidate, ScanIdentityStatus } from '@/lib/scan/ranking/fuse';
export { fuseEvidence } from '@/lib/scan/ranking/fuse';
export type { ScanProfile } from '@/lib/scan/regions';
export { profileForCard } from '@/lib/scan/regions';
export type { ScryfallPrinting } from '@/lib/scan/resolve';
export { cardFromScan, fetchPrintingsByName, pickPrinting } from '@/lib/scan/resolve';
export type { CollectorParts } from '@/lib/scan/parseCollector';
export { parseCollectorParts } from '@/lib/scan/parseCollector';

// --- Tuning constants (shared with web + evaluator; do not fork) -------------
export {
  DETECT_ANALYSIS_MAX_WIDTH,
  DETECT_INTERVAL_MS,
  DETECT_MIN_SCORE,
  QUALITY_MIN_SCORE,
  QUALITY_POOL_SIZE,
  SHARPNESS_MIN,
  TEMPORAL_AGREE_FRAMES,
} from '@/lib/scan/params';
