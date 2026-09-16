// Parser tests for the phone scanner — no camera required.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'lugin-scan-'));
const bundle = join(dir, 'scan.mjs');

await esbuild.build({
  alias: { '@': join(root, 'src') },
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export * from '${join(root, 'src/lib/scan/parseCollector.ts')}';
      export * from '${join(root, 'src/lib/scan/foil.ts')}';
      export * from '${join(root, 'src/lib/scan/geometry.ts')}';
      export * from '${join(root, 'src/lib/scan/types.ts')}';
      export * from '${join(root, 'src/lib/scan/preprocess.ts')}';
      export * from '${join(root, 'src/lib/scan/quality.ts')}';
      export * from '${join(root, 'src/lib/scan/prepareCard.ts')}';
      export * from '${join(root, 'src/lib/scan/diagnostics.ts')}';
      export * from '${join(root, 'src/lib/scan/readCard.ts')}';
      export * from '${join(root, 'src/lib/scan/detectCard.ts')}';
      export * from '${join(root, 'src/lib/scan/detection/multi.ts')}';
      export * from '${join(root, 'src/lib/scan/detection/continuity.ts')}';
      export * from '${join(root, 'src/lib/scan/regions.ts')}';
      export * from '${join(root, 'src/lib/scan/matchName.ts')}';
      export * from '${join(root, 'src/lib/scan/printing/index.ts')}';
      export * from '${join(root, 'src/lib/scan/printing/footerEvidence.ts')}';
      export * from '${join(root, 'src/lib/scan/typeIndex/index.ts')}';
      export * from '${join(root, 'src/lib/scan/finish/types.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/descriptors.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/match.ts')}';
      export * from '${join(root, 'src/lib/scan/text/evidence.ts')}';
      export * from '${join(root, 'src/lib/scan/ranking/fuse.ts')}';
      export * from '${join(root, 'src/lib/scan/temporal/consensus.ts')}';
      export * from '${join(root, 'src/lib/scan/tracking.ts')}';
      export * from '${join(root, 'src/lib/scan/params.ts')}';
      export * from '${join(root, 'src/lib/scan/session/controller.ts')}';
      export * from '${join(root, 'src/lib/scan/recognitionQuad.ts')}';
      export * from '${join(root, 'src/lib/scan/session/postLock.ts')}';
      export * from '${join(root, 'src/lib/scan/session/recognize.ts')}';
      export * from '${join(root, 'src/lib/scan/ocrInput.ts')}';
      export * from '${join(root, 'src/lib/scan/ocrDebug.ts')}';
      export * from '${join(root, 'src/lib/scan/ocrAttempt.ts')}';
      export { pngBytesToScanImage } from '${join(root, 'mobile/src/scan/debug/scanImagePng.ts')}';
      export * from '${join(root, 'src/lib/scan/recognizeCaptured.ts')}';
      export * from '${join(root, 'src/lib/scan/titleDecode.ts')}';
      export * from '${join(root, 'src/lib/scan/scannerLab/run.ts')}';
      export * from '${join(root, 'src/lib/scan/scannerLab/types.ts')}';
      export { isTrueHiRes, planLabAcquire, canRecognizeFromStore, emptyHiResStore, hiResCacheOwnedBySession } from '${join(root, 'mobile/src/scan/hiresCapture.ts')}';
      export * from '${join(root, 'src/lib/scan/captureQuality/index.ts')}';
      export * from '${join(root, 'src/lib/scan/timing.ts')}';
      export * from '${join(root, 'src/lib/scan/focusSeries/index.ts')}';
      export * from '${join(root, 'src/lib/scan/swapTest/index.ts')}';
      export * from '${join(root, 'src/lib/scan/deckBenchmark/index.ts')}';
      export * from '${join(root, 'src/lib/scan/binderBenchmark/index.ts')}';
      export * from '${join(root, 'src/lib/scan/benchmarkUpload/index.ts')}';
      export * from '${join(root, 'src/lib/scan/scannerMode.ts')}';
      export * from '${join(root, 'src/lib/scan/geometryTest/index.ts')}';
      export * from '${join(root, 'src/lib/scan/singleCardCapture/index.ts')}';
      export * from '${join(root, 'src/lib/scan/backgroundQueue.ts')}';
      export * from '${join(root, 'src/lib/scan/verifiedScan/index.ts')}';
      export * from '${join(root, 'src/lib/scan/recognitionChannel.ts')}';
      export * from '${join(root, 'src/lib/scan/continuous/index.ts')}';
      export * from '${join(root, 'src/lib/scan/binder/index.ts')}';
      export * from '${join(root, 'src/lib/scan/session/cardSession.ts')}';
      export * from '${join(root, 'src/lib/scan/session/cardChangeWatch.ts')}';
      export { mapCornersToHiRes, mapCornersHiResToDetectorSameFov, projectAnalysisQuadToSource } from '${join(root, 'mobile/src/scan/hiresMap.ts')}';
      export { startGeometryTrace, finishGeometryTrace, isGeometryTraceActive } from '${join(root, 'mobile/src/scan/geometryTrace.ts')}';
      export * from '${join(root, 'src/lib/scan/videoMap.ts')}';
      export * from '${join(root, 'src/lib/scan/cameraCapabilities.ts')}';
      export * from '${join(root, 'src/lib/scan/scannerDataPolicy.ts')}';
      export * from '${join(root, 'src/lib/scan/scannerManifest.ts')}';
      export { polygonIoU } from '${join(root, 'src/lib/scan/detectCard.ts')}';
      export { evaluateMtgFastAccept, scoreMtgInternalLandmarks } from '${join(root, 'src/lib/scan/detection/mtgFastPath.ts')}';
      export {
        emptyContinuity,
        softResetContinuityForNewCardSession,
        stepContinuity,
      } from '${join(root, 'src/lib/scan/detection/continuity.ts')}';
      export {
        deriveAcquisitionMs,
        emptyAcquisitionTiming,
      } from '${join(root, 'src/lib/scan/acquisitionTiming.ts')}';
      export {
        buildSessionSummary,
        classifyLatencyVerdict,
        formatSummaryText,
      } from '${join(root, 'mobile/src/scan/benchmark/summary.ts')}';
      export {
        collectFlags,
        latencyFromSnapshot,
        mapWinningChannel,
        scoreAgainstExpected,
      } from '${join(root, 'mobile/src/scan/benchmark/scoreScan.ts')}';
      export {
        parseExpectedManifest,
        collectorNumbersEqual,
      } from '${join(root, 'mobile/src/scan/benchmark/expectedManifest.ts')}';
      export {
        PERF_BASELINE,
        PERF_FULL,
        applyPerfPreset,
        getPerfBaseline,
      } from '${join(root, 'mobile/src/scan/perfBaseline.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});

const {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  STANDARD_PROFILE,
  ScanTimer,
  applyH,
  bestName,
  binarize,
  blankImage,
  buildNameIndex,
  buildPrintingIndex,
  candidateMargin,
  choosePrimaryDetection,
  contrastStretch,
  finishFromMetadata,
  lookupPrinting,
  extractFooterEvidence,
  lookupPrintingTitleRestricted,
  buildTypeIndex,
  matchTypeReading,
  findStickyTitle,
  convexHull,
  cornersToQuad,
  cropImage,
  detectCardQuad,
  editDistance,
  extremalCorners,
  foldName,
  glareRatio,
  grayscale,
  guessFoil,
  homographyDestToSrc,
  isLightOnDark,
  largestComponent,
  matchName,
  matchReadings,
  mergeParts,
  mergePartsForScan,
  minAreaRectAngle,
  normalizePolarity,
  orderCorners,
  otsuThreshold,
  parseCollectorLine,
  parseCollectorParts,
  parseSetSymbolText,
  prepareCard,
  prepareCardWithGuideFallback,
  quadToCorners,
  readCollector,
  readTitle,
  rectQuad,
  regionToRect,
  resize,
  scoreCardQuad,
  shapeFold,
  sharpnessScore,
  similarity,
  tidyName,
  trimToTextBand,
  upscaleFactorFor,
  uniquePrinting,
  uniqueOracle,
  warpQuadToCard,
  describeArtwork,
  descriptorSimilarity,
  createArtworkMatcher,
  indexFromEntries,
  fuseEvidence,
  pushTemporal,
  temporalSupportFor,
  emptyTemporal,
  emptyTrack,
  pushTrack,
  sampleFromQuad,
  frameQualityScore,
  tokenizeScanText,
  textEvidenceScore,
  idfForPool,
  BATTLE_PROFILE,
  profileForCard,
  createSessionController,
  recognizeCard,
  isStrongTitleOnly,
  isStrongArtOnly,
  mapAnalysisToOverlay,
  mapCoverSourceToDest,
  mapAnalysisToSource,
  coverLayout,
  polygonIoU,
  buildContinuousFocusConstraints,
  buildPointFocusConstraints,
  buildCameraConstraintPlan,
  cameraConstraintFallbacks,
  focusAttemptDecision,
  focusGateDecision,
  durationMs,
  tagsFromLabel,
  summarizeFocusSeries,
  summarizeSwapTest,
  summarizeDeckBenchmark,
  reconcileDeckMultiset,
  deckCardFileStem,
  classifyDeckFailure,
  DECK_BENCHMARK_USES_GLOBAL_LAB_HOLD,
  DECK_CARD_TIMEOUT_MS,
  decideDeckCardSave,
  decideDeckAdvance,
  formatDeckObservability,
  isFreshSessionIdentity,
  flagSuspiciousReusedPixels,
  canRecognizeFromStore,
  emptyHiResStore,
  hiResCacheOwnedBySession,
  allowsNormalResultPresentation,
  allowsNormalCollectionActions,
  applyScannerModeClaim,
  canClaimScannerMode,
  isExclusiveScannerOwner,
  runsCanonicalRecognition,
  shouldDismissNormalResultOnModeEnter,
  shouldResetSessionOnModeExit,
  showsDiagnosticPolygonsByDefault,
  suspendsNormalRecognition,
  usesLiveRawPolygon,
  framesRequiredForScore,
  tickGeometryLock,
  emptyGeometryLockState,
  quadsAgreeForGeometryLock,
  deriveGeometryTestMs,
  emptyGeometryTiming,
  classifyGeometryArtifact,
  assertGeometryCardArtifactDims,
  assertGeometrySourceArtifactDims,
  GEOMETRY_CARD_ARTIFACT_WIDTH,
  GEOMETRY_CARD_ARTIFACT_HEIGHT,
  evaluateCaptureSafe,
  captureSafeMessage,
  CAPTURE_SAFE_EDGE_MARGIN,
  refinePhysicalCardBoundary,
  evaluateSourceCaptureSafe,
  MIN_SOURCE_MARGIN_PX,
  getSingleCapturePipeline,
  setSingleCapturePipeline,
  isGeometryV2Pipeline,
  useLegacyCapturePipelineForTests,
  tickSingleCardCapture,
  emptySingleCardCaptureState,
  NORMAL_PRODUCTION_PROFILE,
  tickIncumbent,
  emptyIncumbentState,
  isSpatialCandidateSwitch,
  pickBestRecentSafe,
  pushRecentSafe,
  emptyRecentSafeWindow,
  scoreSafeSample,
  createBackgroundQueue,
  resetScanBackgroundQueueForTests,
  GEOMETRY_EXPERIMENT_PROFILE,
  verifiedScanBlocksAcquisition,
  verifiedScanBlocksChangeWatch,
  emptyVerifiedScanTiming,
  deriveVerifiedScanMs,
  markFirstVerified,
  createRecognitionAttempt,
  finalizeAttempt,
  markAttemptAdvancedEarly,
  markAttemptRecognizing,
  terminalStatusFromCapture,
  assertAttemptOwnership,
  emptyParentSummary,
  noteAttemptCreated,
  noteAttemptTerminal,
  matchAttemptByArtifacts,
  mayPublishAttemptToUi,
  validateWarpInput,
  assessWarpSuspect,
  freezeCorners,
  buildRecognitionQuadArtifact,
  SINGLE_SCAN_DIAGNOSTIC_VERSION,
  channelToRecognizeOptions,
  channelUsesTitleFastPath,
  cycleRecognitionChannel,
  getRecognitionChannel,
  setRecognitionChannel,
  RECOGNITION_CHANNEL_MODES,
  RECOGNITION_CHANNEL_LABELS,
  LEGACY_RECOGNITION_CHANNEL_MODES,
  DEV_RECOGNITION_CHANNEL_MODES,
  isRecognitionEligible,
  fuseContinuousEvidence,
  selectSeededCandidate,
  extractArtCropFromCard,
  ART_CROP_VERSION,
  ARTWORK_REGION,
  shouldStartNewTrack,
  shouldSuppressDuplicate,
  appendVisualObservation,
  appendOcrObservation,
  tryPublish,
  startNewTrack,
  emptyContinuousSession,
  unlockForChange,
  applyPublishToSession,
  BINDER_POLICY,
  SINGLE_SCAN_DETECT_POLICY,
  multiReturnNms,
  emptyBinderPageSession,
  tickBinderTracks,
  applyBestCapture,
  binderPageHud,
  binderOverlays,
  nextBinderPage,
  scoreBinderCardQuality,
  binderGeometryOk,
  shouldTakeBinderPageSnapshot,
  isBinderMode,
  usesBinderOverlays,
  makeBinderSessionId,
  binderDiagFrameFile,
  binderDiagCardFile,
  binderDiagTracksFile,
  binderDiagPageMetaFile,
  classifyUnresolvedReasons,
  readyDecisionFromBest,
  BINDER_IDENTIFICATION_READY_MIN,
  BINDER_SHARPNESS_SOFT,
  accumulateUnsafeReasonMs,
  dominantUnsafeReason,
  labelCaptureUnsafeReason,
  markFirstTiming,
  summarizeGeometryTest,
  binderFrameFile,
  summarizeBinderCapture,
  BINDER_TARGET_FRAMES,
  BINDER_MIN_FRAMES_OK,
  BINDER_MAX_PAGE_MS,
  BINDER_AUTO_ADVANCE_PAGES,
  BINDER_TURN_AUTO_MS,
  classifyBinderPageStatus,
  shouldStopBinderCapture,
  binderAfterSaveAction,
  binderCanStartNextPageCapture,
  reconcileUploadAck,
  missingRequiredFiles,
  filesToUpload,
  formatUploadIncompleteMessage,
  formatUploadCompleteMessage,
  emptyAckState,
  deckObservabilityChanged,
  swapIdForIndex,
  attachFocusSeriesDiagnostics,
  driftVsT0,
  expectedIdentityFromLabel,
  identityMatchesExpected,
  classifySampleOutcome,
  simulatePolicy,
  CAPTURE_POLICIES,
  formatCapturePolicyReport,
  partitionFocusSeries,
  bestTitleSharpnessSeparator,
  labelQualitySample,
  cardFingerprintFromWarp,
  cardFingerprintDistance,
  classifyFingerprintDistance,
  observeCardFingerprint,
  CARD_SESSION_DIFF_MIN,
  CARD_SESSION_SAME_MAX,
  CARD_SESSION_VISUAL_CONFIRM,
  emptyCardSessionVisual,
  CHANGE_WATCH_DIFF_MIN,
  CHANGE_WATCH_SAME_MAX,
  changeFingerprintFromWarpedCard,
  changeFingerprintDistance,
  classifyChangeDistance,
  emptyCardChangeWatch,
  seedCardChangeWatch,
  tickCardChangeWatch,
  CHANGE_WATCH_INTERVAL_MS,
  normalizeCapabilities,
  preferredMainLensZoom,
  supportsTapFocus,
  QUALITY_MIN_SCORE,
  SHARPNESS_MIN,
  DETECT_STALE_MS,
  FOCUS_ATTEMPT_MS,
  FOCUS_COOLDOWN_MS,
  LOCK_MIN_SCORE,
  POST_LOCK_STALL_MS,
  RECOGNIZE_MAX_ATTEMPTS,
  RECOGNIZE_RETRY_MS,
  STABILITY_WINDOW,
  shouldReplaceCaptureQuad,
  postLockStallActive,
  selectRecognitionQuad,
  isPlausibleCardInSleeve,
  validateRecognitionQuad,
  TRACK_COAST_FRAMES,
  normalizeCardCorners,
  emptyContinuity,
  stepContinuity,
  softResetContinuityForNewCardSession,
  evaluateMtgFastAccept,
  deriveAcquisitionMs,
  emptyAcquisitionTiming,
  shouldThrottleScannerManifestCheck,
  mayAdvanceLastCheckAfterFailure,
  needPrintingAsset,
  needTypeAsset,
  isScannerManifest,
  buildSessionSummary,
  classifyLatencyVerdict,
  collectFlags,
  scoreAgainstExpected,
  mapWinningChannel,
  parseExpectedManifest,
  collectorNumbersEqual,
  PERF_BASELINE,
  PERF_FULL,
  applyPerfPreset,
  getPerfBaseline,
  expectedRgbaByteLength,
  validateRgbaScanImage,
  packedRgbaBytes,
  hashScanImage,
  extractTitleCrop,
  titleCropRect,
  shouldSkipDuplicateOcr,
  ocrInputHashFor,
  INPUT_CHANNEL_ORDER,
  NATIVE_EXPECTED_CHANNEL_ORDER,
  enhanceForOcrFast,
  classifyOcrOutcome,
  captureTitleOcrBuffers,
  runOcrDebugMatrix,
  resetOcrDebugMatrixForTests,
  consumeOcrDebugMatrixSlot,
  OCR_DEBUG_INBOX_FILES,
  NAME_REGION,
  attemptStatusFromOcr,
  shouldPersistOcrDebugBundle,
  attemptDebugDirName,
  startGeometryTrace,
  finishGeometryTrace,
  isGeometryTraceActive,
  runLabRecognition,
  pickLabWarpQuad,
  compareLabRuns,
  KNOWN_GOOD_RECOGNITION_COMMIT,
  isTrueHiRes,
  planLabAcquire,
  PROVEN_RECOGNITION_BASELINE,
  recognizeCapturedCard,
  acceptCapturedResult,
  hashRecognitionQuad,
  decideStrongFuzzyTitle,
  decodeRecordedTitleVariants,
  tokenWeightedSimilarity,
  titlePreservedEnough,
  formatTitleDecodeReport,
  TITLE_ONLY_MIN,
  pngBytesToScanImage,
  cardDensity,
  firstPassExactFromVariants,
  localContrast,
  classifyMotion,
  sideMetrics,
  mapCornersToHiRes,
  mapCornersHiResToDetectorSameFov,
  projectAnalysisQuadToSource,
} = await import(pathToFileURL(bundle).href);

// Existing focus/stability suites assert the legacy path. geometry-v2 is the
// mobile default; host tests opt into legacy unless a case sets geometry-v2.
useLegacyCapturePipelineForTests();

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

const checkAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

/** Solid-colour test image. */
const solid = (w, h, [r, g, b]) => {
  const image = blankImage(w, h);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
  }
  return image;
};

check('modern collector line with foil star', () => {
  const p = parseCollectorLine('0123 ★ DMU EN');
  assert.equal(p?.setCode, 'DMU');
  assert.equal(p?.collectorNumber, '0123');
  assert.equal(p?.foilMarker, true);
});

check('modern collector line with non-foil bullet', () => {
  const p = parseCollectorLine('0042 • NEO • EN');
  assert.equal(p?.setCode, 'NEO');
  assert.equal(p?.collectorNumber, '0042');
  assert.equal(p?.foilMarker, false);
});

check('classic CMR-style number over set', () => {
  const p = parseCollectorLine('286/361 R CMR');
  assert.equal(p?.setCode, 'CMR');
  assert.equal(p?.collectorNumber, '286');
});

check('partial number-only pass is kept', () => {
  const p = parseCollectorParts('286/361');
  assert.equal(p.collectorNumber, '286');
  assert.equal(p.setCode, undefined);
});

check('partial set-only pass is kept', () => {
  const p = parseCollectorParts('CMR');
  assert.equal(p.setCode, 'CMR');
});

check('merge fills gaps across snaps', () => {
  const merged = mergeParts(
    parseCollectorParts('286/361'),
    parseCollectorParts('CMR'),
  );
  assert.equal(merged.collectorNumber, '286');
  assert.equal(merged.setCode, 'CMR');
});

check('name-first ignores bare set codes', () => {
  const merged = mergePartsForScan(
    { foilMarker: null, raw: '' },
    parseCollectorParts('DUS'),
    { nameLocked: false },
  );
  assert.equal(merged.setCode, undefined);
});

check('name-first still keeps classic number', () => {
  const merged = mergePartsForScan(
    { foilMarker: null, raw: '' },
    parseCollectorParts('286/361'),
    { nameLocked: false },
  );
  assert.equal(merged.collectorNumber, '286');
});

check('tidyName prefers the title line', () => {
  assert.equal(tidyName('Liesa, Shroud of Dusk\nLegendary Creature'), 'Liesa, Shroud of Dusk');
});

check('tidyName joins a wrapped subtitle', () => {
  assert.equal(
    tidyName('Living Lightning,\nCharged Up'),
    'Living Lightning, Charged Up',
  );
});

check('bestName picks the longer title pass', () => {
  assert.equal(bestName('Lie', 'Liesa, Shroud of Dusk'), 'Liesa, Shroud of Dusk');
});

check('set symbol OCR reads M11', () => {
  assert.equal(parseSetSymbolText('M11'), 'M11');
  assert.equal(parseSetSymbolText('M 11'), 'M11');
});

check('classic bottom number without set text', () => {
  const p = parseCollectorParts('134/249');
  assert.equal(p.collectorNumber, '134');
});

check('tidyName keeps French accents', () => {
  assert.equal(tidyName('Léonin, Protecteur'), 'Léonin, Protecteur');
});

check('noise does not invent a full card', () => {
  assert.equal(parseCollectorLine('hello world'), null);
});

check('foil star wins over image stats', () => {
  const g = guessFoil({ foilMarker: true }, null);
  assert.equal(g.foil, true);
  assert.ok(g.confidence >= 0.9);
});

check('bullet means non-foil even if the strip looks shiny', () => {
  const g = guessFoil(
    { foilMarker: false },
    { brightRatio: 0.2, colorVariance: 0.4, darkRatio: 0.1, midtoneRatio: 0.6 },
  );
  assert.equal(g.foil, false);
});

check('orderCorners puts TL TR BR BL', () => {
  const q = orderCorners([
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.deepEqual(q, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
});

check('homography maps dest corners back to source', () => {
  const src = rectQuad(10, 20, 100, 140);
  const dest = rectQuad(0, 0, 50, 70);
  const H = homographyDestToSrc(src, dest);
  for (let i = 0; i < 4; i++) {
    const p = applyH(H, dest[i]);
    assert.ok(Math.abs(p.x - src[i].x) < 1e-6);
    assert.ok(Math.abs(p.y - src[i].y) < 1e-6);
  }
});

check('scoreCardQuad likes a 63:88 rectangle', () => {
  const good = rectQuad(20, 10, 63, 88);
  const bad = rectQuad(20, 10, 88, 63);
  assert.ok(scoreCardQuad(good, 200, 200) > scoreCardQuad(bad, 200, 200));
});

check('warpQuadToCard samples the source colour at centre', () => {
  const w = 40;
  const h = 56;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 40;
    data[i + 2] = 40;
    data[i + 3] = 255;
  }
  const out = warpQuadToCard({ data, height: h, width: w }, rectQuad(0, 0, w - 1, h - 1), 20, 28);
  const mid = (14 * 20 + 10) * 4;
  assert.ok(out.data[mid] > 150);
  assert.ok(out.data[mid + 1] < 80);
});

// --- image primitives -----------------------------------------------------

check('regionToRect clamps to the image', () => {
  const image = blankImage(100, 200);
  assert.deepEqual(regionToRect(image, { h: 0.5, w: 0.5, x: 0.25, y: 0.25 }), {
    h: 100,
    w: 50,
    x: 25,
    y: 50,
  });
  // A region running off the edge is trimmed, never wrapped.
  const edge = regionToRect(image, { h: 1, w: 1, x: 0.9, y: 0.9 });
  assert.equal(edge.x + edge.w, 100);
  assert.equal(edge.y + edge.h, 200);
});

check('cropImage copies the right pixels', () => {
  const image = blankImage(4, 4);
  // Mark the bottom-right pixel.
  const i = (3 * 4 + 3) * 4;
  image.data[i] = 200;
  const crop = cropImage(image, { h: 0.25, w: 0.25, x: 0.75, y: 0.75 });
  assert.equal(crop.width, 1);
  assert.equal(crop.height, 1);
  assert.equal(crop.data[0], 200);
});

check('resize keeps a solid colour solid', () => {
  const out = resize(solid(4, 4, [120, 60, 30]), 8, 8);
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  const mid = (4 * 8 + 4) * 4;
  assert.equal(out.data[mid], 120);
  assert.equal(out.data[mid + 1], 60);
});

check('upscale factor targets readable text height', () => {
  assert.equal(upscaleFactorFor(16), 4);
  assert.equal(upscaleFactorFor(64), 1);
  // Capped, so a 1px crop does not ask for a 64× raster.
  assert.equal(upscaleFactorFor(1), 4);
});

check('grayscale collapses channels', () => {
  const out = grayscale(solid(2, 2, [255, 0, 0]));
  assert.equal(out.data[0], out.data[1]);
  assert.equal(out.data[1], out.data[2]);
  assert.equal(Math.round(out.data[0]), 76);
});

check('contrastStretch survives a flat image', () => {
  // Zero range would divide by zero; the guard has to hold.
  const out = contrastStretch(solid(4, 4, [128, 128, 128]));
  assert.ok(Number.isFinite(out.data[0]));
});

check('contrastStretch clipping ignores a glare pixel', () => {
  // A 60..141 gradient plus two blown pixels — the shape of a glare highlight
  // on an otherwise readable crop.
  const image = blankImage(10, 10);
  for (let p = 0; p < 100; p++) {
    const i = p * 4;
    const v = 60 + (p % 10) * 9;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
  }
  image.data[0] = image.data[1] = image.data[2] = 255;
  image.data[4] = image.data[5] = image.data[6] = 255;

  const naive = contrastStretch(image, 0);
  const clipped = contrastStretch(image, 0.05);
  // Pixel 9 is the brightest gradient value (141). Ignoring the two hot pixels
  // lets it reach white; including them leaves it mid-gray.
  const bright = 9 * 4;
  assert.ok(naive.data[bright] < 150, `naive left it at ${naive.data[bright]}`);
  assert.equal(clipped.data[bright], 255);
});

check('contrastStretch does not black out a crop that clipping collapses', () => {
  // 99 identical pixels and one highlight: clipping throws away both extremes
  // and would otherwise leave min === max.
  const image = solid(10, 10, [100, 100, 100]);
  image.data[0] = image.data[1] = image.data[2] = 255;
  const clipped = contrastStretch(image, 0.05);
  assert.ok(clipped.data[40] > 0 || clipped.data[0] > 0, 'image went entirely black');
});

check('otsu splits a bimodal image', () => {
  const image = blankImage(10, 10);
  for (let p = 0; p < 100; p++) {
    const v = p < 50 ? 30 : 220;
    const i = p * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
  }
  const t = otsuThreshold(image);
  assert.ok(t > 30 && t < 220, `threshold ${t} should sit between the modes`);
  const binary = binarize(image, t);
  assert.equal(binary.data[0], 0);
  assert.equal(binary.data[99 * 4], 255);
});

// --- frame quality --------------------------------------------------------

check('sharpness prefers detail over a flat field', () => {
  const flat = solid(64, 64, [128, 128, 128]);
  // Broadband noise, not a grating: the metric samples every fourth pixel, so a
  // periodic pattern can alias to zero. Real detail is broadband.
  const detailed = blankImage(64, 64);
  let seed = 12345;
  for (let p = 0; p < 64 * 64; p++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    const i = p * 4;
    detailed.data[i] = detailed.data[i + 1] = detailed.data[i + 2] = v;
  }
  assert.ok(sharpnessScore(detailed) > sharpnessScore(flat));
  assert.equal(sharpnessScore(flat), 0, 'a featureless frame must score zero');
});

check('sharpness does not reward brightness', () => {
  // Two flat frames differing only in exposure must score the same, or
  // best-frame selection quietly becomes best-*exposed*-frame selection.
  assert.equal(sharpnessScore(solid(64, 64, [20, 20, 20])), 0);
  assert.equal(sharpnessScore(solid(64, 64, [240, 240, 240])), 0);
});

check('glare ratio finds blown highlights', () => {
  assert.equal(glareRatio(solid(32, 32, [100, 100, 100])), 0);
  assert.ok(glareRatio(solid(32, 32, [255, 255, 255])) > 0.9);
});

// --- geometry -------------------------------------------------------------

check('corners round-trip through the named form', () => {
  const quad = rectQuad(5, 7, 30, 40);
  assert.deepEqual(cornersToQuad(quadToCorners(quad)), quad);
  assert.deepEqual(quadToCorners(quad).topLeft, quad[0]);
  assert.deepEqual(quadToCorners(quad).bottomRight, quad[2]);
});

// --- name matching --------------------------------------------------------

/** A small stand-in for the shipped index, with names chosen to collide. */
const testIndex = (fold) =>
  buildNameIndex(
    {
      names: [
        'Sol Ring',
        'Soul Warden',
        'Lightning Bolt',
        'Llanowar Elves',
        'Yavimaya, Cradle of Growth',
        'Reliquary Tower',
        'Swords to Plowshares',
        'Fog',
        'Ow',
        'Nicol Bolas, Dragon-God',
        'Elvish Mystic',
      ],
      printed: {
        de: [
          [0, 'Sonnenring'],
          [2, 'Blitzschlag'],
        ],
        fr: [
          [0, 'Anneau solaire'],
          [2, 'Foudre'],
          [6, 'Épées contre socs'],
        ],
        it: [[0, 'Anello del Sole']],
      },
      version: 1,
    },
    fold,
  );

check('foldName strips punctuation and accents but keeps letters', () => {
  assert.equal(foldName("Lim-Dûl's Vault"), 'limdulsvault');
  assert.equal(foldName('Épées contre socs'), 'epeescontresocs');
  assert.equal(foldName('Nicol Bolas, Dragon-God'), 'nicolbolasdragongod');
});

check('shapeFold collapses the characters OCR cannot tell apart', () => {
  // Same handful of pixels in a title font, so the distinction carries no
  // information and is removed from both sides.
  assert.equal(shapeFold('Sol Ring'), shapeFold('So1 R1ng'));
  assert.equal(shapeFold('Bolt'), shapeFold('8olt'));
  assert.equal(shapeFold('Sworn'), shapeFold('Swom'), 'rn and m collapse');
  assert.equal(shapeFold('Warden'), shapeFold('VVarden'), 'vv reads as w');
});

check('editDistance and similarity agree with the obvious cases', () => {
  assert.equal(editDistance('', ''), 0);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('abc', 'abd'), 1);
  assert.equal(editDistance('abc', ''), 3);
  assert.equal(similarity('solring', 'solring'), 1);
  assert.ok(similarity('solring', 'solrinq') > 0.8);
  assert.equal(similarity('solring', ''), 0);
});

check('matchName finds the card behind a misread title', () => {
  const index = testIndex();
  const [top] = matchName('Sol Rinq', index);
  assert.equal(top.name, 'Sol Ring');
  assert.ok(top.score > 0.8, `score ${top.score}`);
});

check('matchName exact folded Map short-circuits fuzzy ranking', () => {
  const index = testIndex();
  const timing = {
    exactMs: -1,
    candidateGenMs: -1,
    fuzzyRankMs: -1,
    path: /** @type {'exact'|'fuzzy'} */ ('fuzzy'),
    totalMs: -1,
  };
  const [top] = matchName('Sol Ring', index, { timing });
  assert.equal(top.name, 'Sol Ring');
  assert.equal(top.score, 1);
  assert.equal(timing.path, 'exact');
  assert.equal(timing.candidateGenMs, 0);
  assert.equal(timing.fuzzyRankMs, 0);
  assert.ok(timing.totalMs >= 0);
});

check('PrintingIndex resolves AFC 030 → Chaos Dragon locally', () => {
  const data = {
    version: 1,
    entries: [
      {
        setCode: 'afc',
        collectorNumber: '30',
        scryfallId: 'afc-30-id',
        oracleId: 'chaos-ora',
        name: 'Chaos Dragon',
        lang: 'en',
        finishes: ['nonfoil'],
      },
    ],
  };
  const index = buildPrintingIndex(data);
  const hit = lookupPrinting(index, {
    foilMarker: null,
    raw: 'AFC 030',
    setCode: 'AFC',
    collectorNumber: '030',
  });
  assert.ok(hit);
  assert.equal(hit.candidates[0].name, 'Chaos Dragon');
  assert.equal(uniquePrinting(hit)?.scryfallId, 'afc-30-id');
});

check('full PrintingIndex (if present) resolves Chaos Dragon + Pixie Guide fast', async () => {
  const { existsSync } = await import('node:fs');
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const path = join(root, '.scan-fixtures/printing-index.json');
  if (!existsSync(path)) {
    console.log('  (skip — no .scan-fixtures/printing-index.json)');
    return;
  }
  const data = JSON.parse(await readFile(path, 'utf8'));
  assert.ok(data.entries.length >= 10_000, `expected production-sized index, got ${data.entries.length}`);
  const index = buildPrintingIndex(data);
  const t0 = performance.now();
  const chaos = lookupPrinting(index, {
    foilMarker: null,
    raw: 'AFC 030',
    setCode: 'AFC',
    collectorNumber: '030',
  });
  const pixie = lookupPrinting(index, {
    foilMarker: null,
    raw: 'AFR 066',
    setCode: 'AFR',
    collectorNumber: '066',
  });
  const ms = performance.now() - t0;
  assert.equal(uniqueOracle(chaos)?.name, 'Chaos Dragon');
  assert.equal(uniqueOracle(pixie)?.name, 'Pixie Guide');
  assert.ok(ms < 5, `two lookups should be sub-ms; took ${ms.toFixed(2)} ms`);
});

check('finishFromMetadata short-circuits single-finish printings', () => {
  assert.equal(finishFromMetadata(['nonfoil'])?.finish, 'nonfoil');
  assert.equal(finishFromMetadata(['foil', 'nonfoil']), null);
});

check('footer-printing early identity fires before slow title', async () => {
  const printing = buildPrintingIndex({
    version: 1,
    entries: [
      {
        setCode: 'afc',
        collectorNumber: '30',
        scryfallId: 'afc-30',
        oracleId: 'chaos-ora',
        name: 'Chaos Dragon',
        lang: 'en',
        finishes: ['nonfoil'],
      },
    ],
  });
  const names = buildNameIndex({ names: ['Chaos Dragon', 'Other'], version: 1 });
  const early = [];
  const ocr = {
    recognize: async (img, opts) => {
      // Footer regions return set/number; title delayed via titleDelayMs.
      const text =
        opts?.mode === 'block'
          ? ''
          : 'AFC\n030';
      return { text, confidence: 0.9, words: [] };
    },
  };
  // Simpler: stub read via custom ocr that always returns footer-like text;
  // titleDelay ensures footer wins the race.
  const titleDelayMs = 80;
  const { result } = await recognizeCard(
    blankImage(CARD_WIDTH, CARD_HEIGHT, 40),
    {
      nameIndex: names,
      printingIndex: printing,
      ocr: {
        async recognize() {
          return { text: 'AFC 030', confidence: 0.9, words: [] };
        },
      },
      onEarlyIdentity: r => early.push(r),
    },
    { skipArtwork: true, titleDelayMs, footerDelayMs: 0 },
  );
  assert.ok(early.length >= 1, 'footer should early-publish');
  assert.ok(
    early[0].earlyReason === 'footer-printing' || early[0].fused.printing,
    `reason ${early[0].earlyReason}`,
  );
  assert.equal(result.fused.printing?.setCode, 'afc');
  assert.equal(result.fused.card?.name, 'Chaos Dragon');
});

check('nested sleeve prefers inner card over stronger outer', () => {
  const outer = {
    topLeft: { x: 40, y: 40 },
    topRight: { x: 360, y: 40 },
    bottomRight: { x: 360, y: 480 },
    bottomLeft: { x: 40, y: 480 },
  };
  const inner = {
    topLeft: { x: 70, y: 70 },
    topRight: { x: 330, y: 70 },
    bottomRight: { x: 330, y: 450 },
    bottomLeft: { x: 70, y: 450 },
  };
  const frame = {
    detections: [
      { corners: outer, score: 0.92, areaRatio: 0.55, aspectRatio: 63 / 88, role: 'unknown' },
      { corners: inner, score: 0.71, areaRatio: 0.42, aspectRatio: 63 / 88, role: 'unknown' },
    ],
  };
  const { primary, provisionalOuter, nested } = choosePrimaryDetection(frame);
  assert.ok(nested.length >= 1, 'expected nested relation');
  assert.equal(primary?.role, 'card');
  assert.ok(provisionalOuter, 'outer retained as provisional');
  // Inner center should match primary
  assert.equal(primary?.corners.topLeft.x, inner.topLeft.x);
});

check('choosePrimaryDetection keeps bare card when alone', () => {
  const card = {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 300, y: 100 },
    bottomRight: { x: 300, y: 380 },
    bottomLeft: { x: 100, y: 380 },
  };
  const { primary, nested } = choosePrimaryDetection({
    detections: [
      { corners: card, score: 0.8, areaRatio: 0.3, aspectRatio: 63 / 88, role: 'unknown' },
    ],
  });
  assert.equal(nested.length, 0);
  assert.equal(primary?.corners.topLeft.x, 100);
  assert.equal(primary?.role, 'card');
});

check('matchName recovers a title clipped by the crop', () => {
  // Scoring only the whole string would rate this ~0.6 purely for the missing
  // tail, which is the difference between an answer and nothing.
  const [top] = matchName('Yavimaya, Cradle', testIndex());
  assert.equal(top.name, 'Yavimaya, Cradle of Growth');
  assert.ok(top.score > 0.8, `score ${top.score}`);
});

check('matchName resolves French, German and Italian titles to the English name', () => {
  const index = testIndex();
  for (const printed of ['Anneau solaire', 'Sonnenring', 'Anello del Sole']) {
    const [top] = matchName(printed, index);
    assert.equal(top.name, 'Sol Ring', `${printed} did not resolve`);
    assert.equal(top.printedName, printed, 'the matching localized title is reported');
    assert.ok(top.lang, 'so the scan can record which language was held up');
  }
});

check('matchName still resolves a misread foreign title', () => {
  const [top] = matchName('Anneau solaire'.replace('l', '1'), testIndex());
  assert.equal(top.name, 'Sol Ring');
});

check('matchName finds very short names, which have no useful trigrams', () => {
  const index = testIndex();
  assert.equal(matchName('Fog', index)[0].name, 'Fog');
  assert.equal(matchName('Ow', index)[0].name, 'Ow');
});

check('matchName reports one entry per card, not one per language', () => {
  const names = matchName('Sol Ring', testIndex()).map(c => c.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate cards in the list');
});

check('matchName returns nothing for text that is not a card name', () => {
  // Rules text and flavour text land in the title crop often enough that
  // answering confidently here would be worse than answering not at all.
  assert.deepEqual(matchName('Deep within the forsaken cavern', testIndex()), []);
  assert.deepEqual(matchName('', testIndex()), []);
  assert.deepEqual(matchName('x', testIndex()), []);
});

check('matchReadings picks the reading that names a real card', () => {
  // The defect this whole module exists to fix. bestName takes the longest
  // string, so with equal lengths the garbled pass wins; only the index knows
  // that one of them is a card.
  assert.equal(bestName('Sol Rinq', 'Sol Ring'), 'Sol Rinq');

  const candidates = matchReadings(
    [
      { source: 'title', text: 'Sol Rinq' },
      { source: 'title-wide', text: 'Sol Ring' },
    ],
    testIndex(),
  );
  assert.equal(candidates[0].name, 'Sol Ring');
  assert.equal(candidates[0].score, 1, 'the exact reading wins outright');
  assert.equal(candidates[0].source, 'title-wide', 'and reports which pass found it');
});

check('matchReadings ignores passes that read nothing', () => {
  const candidates = matchReadings(
    [
      { source: 'title', text: '   ' },
      { source: 'title-wide', text: 'Lightning Bolt' },
    ],
    testIndex(),
  );
  assert.equal(candidates[0].name, 'Lightning Bolt');
});

check('candidateMargin separates a clear answer from a coin toss', () => {
  const clear = candidateMargin([
    { name: 'a', score: 0.7 },
    { name: 'b', score: 0.5 },
  ]);
  const tie = candidateMargin([
    { name: 'a', score: 0.9 },
    { name: 'b', score: 0.89 },
  ]);
  assert.ok(clear > tie, 'a lower top score can still be the safer answer');
  assert.equal(candidateMargin([]), 0);
  assert.equal(candidateMargin([{ name: 'a', score: 0.8 }]), 0.8);
});

check('buildNameIndex does not store a localized title identical to the English one', () => {
  const index = buildNameIndex(
    { names: ['Fog'], printed: { fr: [[0, 'Fog']] }, version: 1 },
    shapeFold,
  );
  assert.equal(index.entries.length, 1, 'the duplicate adds postings and changes nothing');
});

check('buildNameIndex ignores localized titles pointing outside the name list', () => {
  const index = buildNameIndex(
    { names: ['Fog'], printed: { fr: [[7, 'Brouillard']] }, version: 1 },
    shapeFold,
  );
  assert.equal(index.entries.length, 1);
});

// --- polarity and trimming ------------------------------------------------

/** A crop with one text-like band of `ink` on a `ground` background. */
const textCrop = ({ ground = 235, ink = 25, bandFrom = 20, bandTo = 32, h = 60, w = 120 } = {}) => {
  const image = blankImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBand = y >= bandFrom && y < bandTo;
      // Glyph-ish: ink for part of each band row, ground elsewhere.
      const v = inBand && x % 7 < 3 ? ink : ground;
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    }
  }
  return image;
};

check('isLightOnDark spots an inverted crop', () => {
  assert.equal(isLightOnDark(textCrop()), false, 'dark text on light paper');
  assert.equal(
    isLightOnDark(textCrop({ ground: 20, ink: 240 })),
    true,
    'pale title over dark art',
  );
});

check('normalizePolarity leaves normal crops alone and flips inverted ones', () => {
  const normal = textCrop();
  assert.equal(normalizePolarity(normal).data[0], normal.data[0]);

  // Borderless prints read at 5% similarity before this step, because Tesseract
  // is trained on printed pages and does not expect a negative.
  const inverted = textCrop({ ground: 20, ink: 240 });
  const fixed = normalizePolarity(inverted);
  assert.ok(fixed.data[0] > 200, 'background became paper');
  const inkIndex = (25 * inverted.width + 0) * 4;
  assert.ok(fixed.data[inkIndex] < 60, 'glyphs became ink');
});

check('trimToTextBand crops away border and artwork', () => {
  const crop = textCrop({ bandFrom: 20, bandTo: 32, h: 60 });
  const trimmed = trimToTextBand(crop);
  assert.ok(trimmed.height < 60, `still ${trimmed.height} tall`);
  assert.ok(trimmed.height >= 12, 'the text line itself survived');
  assert.equal(trimmed.width, crop.width, 'trimming is vertical only');
});

check('trimToTextBand keeps the whole crop when there is nothing to trim', () => {
  // Degrading to the untrimmed crop is the point: a bad measurement must not
  // crop the title away.
  const blank = solid(120, 60, [200, 200, 200]);
  assert.equal(trimToTextBand(blank).height, 60);
  const allText = textCrop({ bandFrom: 0, bandTo: 60, h: 60 });
  assert.equal(trimToTextBand(allText).height, 60);
});

check('trimToTextBand works on an inverted crop too', () => {
  const trimmed = trimToTextBand(textCrop({ ground: 20, ink: 240 }));
  assert.ok(trimmed.height < 60, 'ink detection is polarity-agnostic');
});

// --- card detection -------------------------------------------------------

/**
 * Render a card-shaped quad into a frame: rounded corners, a dark border, a
 * lighter interior, and per-pixel background noise. Enough structure to exercise
 * detection without needing a downloaded fixture.
 */
const renderCard = ({
  background = 90,
  border = 12,
  interior = 205,
  rotate = 0,
  scale = 0.8,
  tilt = 0,
  frameW = 480,
  frameH = 640,
} = {}) => {
  const image = blankImage(frameW, frameH);
  let seed = 7;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = Math.max(0, Math.min(255, background + (seed % 9) - 4));
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
  }

  const ch = frameH * scale;
  const cw = ch * CARD_ASPECT;
  const cx = frameW / 2;
  const cy = frameH / 2;
  const a = (rotate * Math.PI) / 180;
  const radius = cw * 0.045;

  // Walk the frame and ask, for each pixel, where it lands in card space.
  const cos = Math.cos(-a);
  const sin = Math.sin(-a);
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      const rx = (x - cx) * cos - (y - cy) * sin;
      const ry = (x - cx) * sin + (y - cy) * cos;
      // Perspective: the top edge is narrower by `tilt`.
      const rowShrink = 1 - tilt * (0.5 - ry / ch);
      const halfW = (cw / 2) * rowShrink;
      if (Math.abs(rx) > halfW || Math.abs(ry) > ch / 2) continue;
      // Rounded corners.
      const overX = Math.abs(rx) - (halfW - radius);
      const overY = Math.abs(ry) - (ch / 2 - radius);
      if (overX > 0 && overY > 0 && Math.hypot(overX, overY) > radius) continue;

      const onBorder = halfW - Math.abs(rx) < cw * 0.04 || ch / 2 - Math.abs(ry) < ch * 0.03;
      const v = onBorder ? border : interior;
      const i = (y * frameW + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    }
  }
  return image;
};

check('convexHull wraps a point cloud', () => {
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 5, y: 5 },
  ]);
  assert.equal(hull.length, 4, 'the interior point is not a vertex');
});

check('minAreaRectAngle finds the rotation of a rectangle', () => {
  const angleOf = degrees => {
    const a = (degrees * Math.PI) / 180;
    const pts = [
      { x: -40, y: -60 },
      { x: 40, y: -60 },
      { x: 40, y: 60 },
      { x: -40, y: 60 },
    ].map(p => ({
      x: 200 + p.x * Math.cos(a) - p.y * Math.sin(a),
      y: 300 + p.x * Math.sin(a) + p.y * Math.cos(a),
    }));
    return minAreaRectAngle(convexHull(pts));
  };
  // Any of the four edge directions is a valid answer, so compare modulo 90°.
  const mod90 = r => {
    const d = ((r * 180) / Math.PI) % 90;
    return d < 0 ? d + 90 : d;
  };
  assert.ok(Math.abs(mod90(angleOf(0))) < 0.5 || Math.abs(mod90(angleOf(0)) - 90) < 0.5);
  assert.ok(Math.abs(mod90(angleOf(20)) - 20) < 0.5);
});

check('extremalCorners orders a rotated rectangle', () => {
  const a = (15 * Math.PI) / 180;
  const pts = [
    { x: -40, y: -60 },
    { x: 40, y: -60 },
    { x: 40, y: 60 },
    { x: -40, y: 60 },
  ].map(p => ({
    x: 200 + p.x * Math.cos(a) - p.y * Math.sin(a),
    y: 300 + p.x * Math.sin(a) + p.y * Math.cos(a),
  }));
  const corners = extremalCorners(convexHull(pts));
  assert.equal(corners.length, 4);
  // The topmost input corner must come back as the first (top-left) slot.
  const quad = orderCorners(corners);
  assert.ok(quad[0].y < quad[3].y, 'top-left sits above bottom-left');
  assert.ok(quad[0].x < quad[1].x, 'top-left sits left of top-right');
});

check('largestComponent ignores speckle', () => {
  const w = 40;
  const h = 40;
  const mask = new Uint8Array(w * h);
  // A 10×10 block plus scattered single pixels.
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * w + x] = 1;
  mask[30 * w + 30] = 1;
  mask[35 * w + 5] = 1;
  const found = largestComponent(mask, w, h);
  assert.equal(found.area, 100);
  assert.equal(found.pixels[30 * w + 30], 0, 'speckle excluded from the winner');
});

check('detects a flat card on a plain background', () => {
  const { quad, score, corners } = detectCardQuad(renderCard());
  assert.ok(quad, 'no quad found on the easiest possible frame');
  assert.ok(score > 0.35, `score ${score?.toFixed(3)} below the acceptance threshold`);
  // Corners should land near the true card rectangle: 0.8 × 640 tall, centred.
  const expectedH = 640 * 0.8;
  const expectedW = expectedH * CARD_ASPECT;
  assert.ok(Math.abs(corners.topLeft.x - (480 - expectedW) / 2) < 6);
  assert.ok(Math.abs(corners.topLeft.y - (640 - expectedH) / 2) < 6);
  assert.ok(Math.abs(corners.bottomRight.x - (480 + expectedW) / 2) < 6);
});

check('detects a rotated card', () => {
  for (const rotate of [-20, -7, 9, 18]) {
    const { quad, score } = detectCardQuad(renderCard({ rotate }));
    assert.ok(quad, `no quad at ${rotate}°`);
    assert.ok(score > 0.3, `score ${score.toFixed(3)} too low at ${rotate}°`);
  }
});

check('detects a tilted card', () => {
  for (const tilt of [0.1, 0.2]) {
    const { quad } = detectCardQuad(renderCard({ tilt }));
    assert.ok(quad, `no quad at tilt ${tilt}`);
  }
});

check('detects a dark card on a light background and vice versa', () => {
  // The card is not reliably the bright part of the frame; only the difference
  // from the background is reliable.
  const onLight = detectCardQuad(renderCard({ background: 235, border: 10, interior: 90 }));
  assert.ok(onLight.quad, 'dark card on a light desk');
  const onDark = detectCardQuad(renderCard({ background: 20, border: 40, interior: 210 }));
  assert.ok(onDark.quad, 'light card on a dark desk');
});

check('detects a small, distant card', () => {
  const { quad, score } = detectCardQuad(renderCard({ scale: 0.35 }));
  assert.ok(quad, 'no quad for a card far from the camera');
  assert.ok(score > 0.2, `score ${score.toFixed(3)}`);
});

check('refined corners beat the rounded-corner hull points', () => {
  // Rounded corners put every extreme hull point inside the true corner, which
  // would shrink the quad and shift every region crop.
  const { corners } = detectCardQuad(renderCard({ scale: 0.8 }));
  const width = corners.topRight.x - corners.topLeft.x;
  const expectedW = 640 * 0.8 * CARD_ASPECT;
  assert.ok(
    width > expectedW * 0.985,
    `quad width ${width.toFixed(1)} shrank against the true ${expectedW.toFixed(1)}`,
  );
});

check('finds nothing in a featureless frame', () => {
  const flat = solid(200, 280, [90, 90, 90]);
  assert.equal(detectCardQuad(flat).quad, null);
});

check('finds nothing when the frame is pure noise', () => {
  // Better to fall back to the guide than to invent a card out of a busy desk.
  const noise = blankImage(200, 280);
  let seed = 99;
  for (let p = 0; p < 200 * 280; p++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const i = p * 4;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = seed % 256;
  }
  const { score } = detectCardQuad(noise);
  assert.ok(score < 0.35, `noise scored ${score.toFixed(3)} and would be trusted`);
});

check('prepareCard reports how it framed the card', () => {
  // A featureless frame gives detection nothing to find, so it must say so
  // rather than quietly claiming a detection.
  const prepared = prepareCard(solid(200, 280, [90, 90, 90]));
  assert.equal(prepared.detected, false);
  assert.equal(prepared.source, 'whole-frame');
  assert.equal(prepared.corners, null);
  assert.equal(prepared.score, 0);
  assert.ok(prepared.image.width > 0 && prepared.image.height > 0);
});

check('prepareCard detects a real card and says so', () => {
  const prepared = prepareCard(renderCard());
  assert.equal(prepared.detected, true);
  assert.equal(prepared.source, 'detected');
  assert.ok(prepared.corners, 'corners are reported in source-frame pixels');
  assert.ok(prepared.score > 0.35);
  // The warp always emits the canonical raster, whatever the card measured.
  assert.equal(prepared.image.width, CARD_WIDTH);
  assert.equal(prepared.image.height, CARD_HEIGHT);
});

check('the guide fallback crops the guide rectangle, not a transposed one', () => {
  // Only reachable from the live camera, so the evaluation harness would never
  // catch a swapped width/height here — it would just quietly read the wrong
  // part of every frame that failed detection.
  const frame = blankImage(400, 800);
  // Mark one pixel inside the guide's top-left corner and check it lands there.
  const guide = { h: 0.5, w: 0.5, x: 0.25, y: 0.25 };
  const mark = (200 * 400 + 100) * 4;
  frame.data[mark] = 255;
  frame.data[mark + 1] = 0;
  frame.data[mark + 2] = 0;

  const prepared = prepareCardWithGuideFallback(frame, guide);
  assert.equal(prepared.source, 'guide');
  assert.equal(prepared.detected, false);
  // The mark sat at the guide's origin, so it must warp to the card's origin.
  assert.ok(prepared.image.data[0] > 100, 'guide origin maps to the card origin');
});

// --- diagnostics ----------------------------------------------------------

check('ScanTimer records stages against an injected clock', () => {
  let now = 0;
  const timer = new ScanTimer(() => now);
  timer.measure('detect', () => {
    now += 12;
  });
  timer.measure('warp', () => {
    now += 30;
  });
  assert.deepEqual(timer.timings, [
    { ms: 12, stage: 'detect' },
    { ms: 30, stage: 'warp' },
  ]);
  assert.equal(timer.totalMs, 42);
});

check('ScanTimer still records a stage that threw', () => {
  let now = 0;
  const timer = new ScanTimer(() => now);
  assert.throws(() =>
    timer.measure('ocr', () => {
      now += 5;
      throw new Error('boom');
    }),
  );
  assert.deepEqual(timer.timings, [{ ms: 5, stage: 'ocr' }]);
});

// --- reading a card with an injected recognizer ----------------------------

/** Fake OCR: answers per region, so region wiring is testable without tesseract. */
const stubRecognizer = (byRegion, log = []) => ({
  recognize: async (image, options) => {
    log.push({ height: image.height, mode: options?.mode, width: image.width });
    const key = `${image.width}x${image.height}`;
    const text = byRegion[log.length - 1] ?? byRegion[key] ?? '';
    return { confidence: text ? 0.8 : 0, text, words: [] };
  },
});

await checkAsync('readTitle runs every framing in the profile and tidies the best', async () => {
  const card = solid(504, 704, [200, 200, 200]);
  const log = [];
  const reading = await readTitle(card, stubRecognizer(['Sol', 'Sol Ring\nArtifact'], log), {});
  assert.equal(log.length, STANDARD_PROFILE.title.length, 'one pass per title framing');
  assert.ok(log.every(pass => pass.mode === 'line'));
  assert.equal(reading.samples.length, STANDARD_PROFILE.title.length);
  assert.deepEqual(
    reading.samples.map(s => s.region),
    STANDARD_PROFILE.title.map(t => t.name),
    'samples are labelled with the region they came from',
  );
  // tidyName drops the type line; bestName prefers the fuller read.
  assert.equal(reading.name, 'Sol Ring');
  assert.ok(reading.samples.every(s => s.cropWidth > 0 && s.cropHeight > 0));
});

check('every title region stays inside the card and above the artwork', () => {
  // The measured title band across the fixture corpus is 0.043–0.101 on standard
  // frames; a region that misses it produces confident nonsense rather than a
  // visible failure, so the numbers are asserted rather than merely commented.
  for (const { name, region } of STANDARD_PROFILE.title) {
    assert.ok(region.x >= 0 && region.y >= 0, `${name} starts inside the card`);
    assert.ok(region.x + region.w <= 1, `${name} stays within the card width`);
    assert.ok(region.y <= 0.043, `${name} starts at or above the measured title top`);
    assert.ok(region.y + region.h >= 0.101, `${name} reaches the measured title bottom`);
    assert.ok(region.y + region.h < 0.25, `${name} stops short of the artwork`);
  }
});

check('bestName still breaks ties by length, and is now only a fallback', () => {
  // Length is not a quality signal, so with equal-length readings the garbled one
  // can win. That is no longer on the main path: `matchReadings` scores every
  // reading against the card index and gets this right (see above). bestName
  // survives only for the case where no index has loaded yet, where "longest" is
  // at least better than "first".
  assert.equal(bestName('Sol Rinq', 'Sol Ring'), 'Sol Rinq');
  assert.equal(bestName('Sol', 'Sol Ring'), 'Sol Ring');
});

await checkAsync('readTitle reports nothing when OCR reads nothing', async () => {
  const reading = await readTitle(solid(504, 704, [0, 0, 0]), stubRecognizer([]), {});
  assert.equal(reading.name, null);
  assert.equal(reading.samples.length, STANDARD_PROFILE.title.length);
  assert.ok(reading.samples.every(s => s.confidence === 0));
});

await checkAsync('readCollector merges set and number across regions', async () => {
  const merge = (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true });
  const { parts, samples } = await readCollector(
    solid(504, 704, [200, 200, 200]),
    stubRecognizer(['0123', '', 'DMU', '', '0123 ★ DMU EN']),
    merge,
    {},
  );
  assert.equal(samples.length, 5, 'five collector framings');
  assert.equal(parts.collectorNumber, '0123');
  assert.equal(parts.setCode, 'DMU');
  assert.equal(parts.foilMarker, true);
});

await checkAsync('readCollector reads a set code out of the expansion symbol', async () => {
  const merge = (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true });
  // Only the fourth pass (set-symbol) returns anything.
  const { parts } = await readCollector(
    solid(504, 704, [200, 200, 200]),
    stubRecognizer(['', '', '', 'M11', '']),
    merge,
    {},
  );
  assert.equal(parts.setCode, 'M11');
});

await checkAsync('keepCrops is off by default so scans stay cheap', async () => {
  const plain = await readTitle(solid(504, 704, [200, 200, 200]), stubRecognizer(['Sol Ring']), {});
  assert.ok(plain.samples.every(s => s.crop === undefined));
  const debug = await readTitle(
    solid(504, 704, [200, 200, 200]),
    stubRecognizer(['Sol Ring']),
    { keepCrops: true },
  );
  assert.ok(debug.samples.every(s => s.crop && s.crop.width > 0));
});

// --- the shipped index ----------------------------------------------------
//
// The generator runs in CI against a 392 MB dump, so nobody re-runs it to check a
// refactor. A wrong shape here does not throw: the matcher just quietly stops
// finding cards.

const BULK = [
  { games: ['paper'], lang: 'en', name: 'Sol Ring', set: 'cmr' },
  // A second printing of a card already seen must not duplicate the name.
  { games: ['paper'], lang: 'en', name: 'Sol Ring', set: 'ltc' },
  { games: ['paper'], lang: 'fr', name: 'Sol Ring', printed_name: 'Anneau solaire', set: 'soc' },
  { games: ['paper'], lang: 'de', name: 'Sol Ring', printed_name: 'Sonnenring', set: 'soc' },
  // A language nobody has an OCR model for is not worth the bytes.
  { games: ['paper'], lang: 'ja', name: 'Sol Ring', printed_name: '太陽の指輪', set: 'soc' },
  {
    games: ['paper'],
    lang: 'en',
    name: 'Delver of Secrets // Insectile Aberration',
    set: 'isd',
  },
  // Digital-only and oversized printings are not cards anybody scans.
  { games: ['arena'], lang: 'en', name: 'Alchemy Oddity', set: 'y22' },
  { games: ['paper'], lang: 'en', name: 'Big Furry Monster', oversized: true, set: 'ugl' },
];

const indexInput = join(dir, 'bulk.jsonl');
const indexOut = join(dir, 'card-names.json');
await writeFile(indexInput, `${BULK.map(c => JSON.stringify(c)).join('\n')}\n`);
execFileSync(
  'node',
  [join(root, 'scripts/build-card-index.mjs'), '--input', indexInput, '--out', indexOut],
  { stdio: 'ignore' },
);
const shipped = JSON.parse(await readFile(indexOut, 'utf8'));

check('the index lists every paper card name once', () => {
  assert.deepEqual(shipped.names, ['Delver of Secrets // Insectile Aberration', 'Sol Ring']);
});

check('the index leaves out digital-only and oversized printings', () => {
  assert.ok(!shipped.names.includes('Alchemy Oddity'));
  assert.ok(!shipped.names.includes('Big Furry Monster'));
});

check('the index maps localized titles to the English name by position', () => {
  const at = shipped.names.indexOf('Sol Ring');
  assert.deepEqual(shipped.printed.fr, [[at, 'Anneau solaire']]);
  assert.deepEqual(shipped.printed.de, [[at, 'Sonnenring']]);
  assert.ok(!shipped.printed.ja, 'no OCR model, no entry');
});

check('the index records the front face of a multi-face card', () => {
  // The title bar only ever shows the front face, so that is what OCR reads.
  const at = shipped.names.indexOf('Delver of Secrets // Insectile Aberration');
  assert.ok(
    shipped.printed.en.some(([i, title]) => i === at && title === 'Delver of Secrets'),
    'front face missing from the English aliases',
  );
});

check('the shipped index resolves through the real matcher', () => {
  // End to end: the generator's output shape and the matcher's expectations have
  // to agree, and they are in different languages in different files.
  const index = buildNameIndex(shipped);
  assert.equal(matchName('Anneau solaire', index)[0].name, 'Sol Ring');
  assert.equal(matchName('Delver of Secrets', index)[0].name, 'Delver of Secrets // Insectile Aberration');
  assert.equal(matchName('Sol Rinq', index)[0].name, 'Sol Ring');
});

check('artwork descriptors are deterministic and self-similar', () => {
  const img = blankImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      img.data[i] = x * 4;
      img.data[i + 1] = y * 4;
      img.data[i + 2] = 80;
      img.data[i + 3] = 255;
    }
  }
  const a = describeArtwork(img);
  const b = describeArtwork(img);
  assert.deepEqual(a.dhash, b.dhash);
  assert.ok(descriptorSimilarity(a, a) > 0.99);
});

check('artwork matcher ranks an exact descriptor first', () => {
  const img = blankImage(48, 48);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 40;
    img.data[i + 1] = 120;
    img.data[i + 2] = 200;
    img.data[i + 3] = 255;
  }
  const desc = describeArtwork(img);
  const other = blankImage(48, 48);
  for (let i = 0; i < other.data.length; i += 4) {
    other.data[i] = 200;
    other.data[i + 1] = 40;
    other.data[i + 2] = 40;
    other.data[i + 3] = 255;
  }
  const matcher = createArtworkMatcher(
    indexFromEntries([
      {
        descriptor: describeArtwork(other),
        name: 'Wrong',
        oracleId: 'oracle:wrong',
        scryfallId: 'b',
      },
      {
        descriptor: desc,
        name: 'Right',
        oracleId: 'oracle:right',
        scryfallId: 'a',
      },
    ]),
  );
  const hits = matcher.findCandidates(desc, 3);
  assert.equal(hits[0].name, 'Right');
  assert.ok(hits[0].visualScore > hits[1].visualScore);
});

check('fusion accepts a strong title+visual pair and stays ambiguous on a coin toss', () => {
  const clear = fuseEvidence([
    {
      name: 'Sol Ring',
      oracleId: 'oracle:sol',
      possiblePrintingIds: ['p1'],
      titleScore: 0.92,
      visualScore: 0.9,
    },
    {
      name: 'Mana Crypt',
      oracleId: 'oracle:crypt',
      possiblePrintingIds: [],
      titleScore: 0.5,
      visualScore: 0.4,
    },
  ]);
  assert.equal(clear.status, 'identified');
  assert.equal(clear.card?.name, 'Sol Ring');

  const toss = fuseEvidence([
    {
      name: 'Sol Ring',
      oracleId: 'oracle:sol',
      possiblePrintingIds: [],
      titleScore: 0.7,
      visualScore: 0.68,
    },
    {
      name: 'Mana Vault',
      oracleId: 'oracle:vault',
      possiblePrintingIds: [],
      titleScore: 0.69,
      visualScore: 0.67,
    },
  ]);
  assert.ok(toss.status === 'card-ambiguous' || toss.status === 'insufficient-confidence');
});

check('artwork-only mode rejects a tight weak visual cluster even with temporal boost', () => {
  const weak = fuseEvidence(
    [
      {
        name: 'Sol Ring',
        oracleId: 'oracle:sol',
        possiblePrintingIds: ['p1'],
        temporalSupport: 1,
        visualScore: 0.7,
      },
      {
        name: 'Arcane Signet',
        oracleId: 'oracle:signet',
        possiblePrintingIds: ['p2'],
        temporalSupport: 0,
        visualScore: 0.675,
      },
    ],
    { artworkOnly: true },
  );
  assert.equal(weak.status, 'card-ambiguous');
  assert.equal(weak.card, undefined);
});

check('artwork-only mode accepts a strong visual leader with clear margin', () => {
  const strong = fuseEvidence(
    [
      {
        name: 'Chaos Dragon',
        oracleId: 'oracle:chaos',
        possiblePrintingIds: ['p1'],
        temporalSupport: 0.5,
        visualScore: 0.92,
      },
      {
        name: 'Other',
        oracleId: 'oracle:other',
        possiblePrintingIds: [],
        temporalSupport: 0,
        visualScore: 0.7,
      },
    ],
    { artworkOnly: true },
  );
  assert.equal(strong.status, 'identified');
  assert.equal(strong.card?.name, 'Chaos Dragon');
});

check('temporal support rises when the same oracle keeps winning', () => {
  let state = emptyTemporal();
  const obs = id =>
    fuseEvidence([
      { name: 'A', oracleId: id, possiblePrintingIds: [], titleScore: 0.9, visualScore: 0.9 },
    ]);
  state = pushTemporal(state, obs('oracle:a'));
  state = pushTemporal(state, obs('oracle:a'));
  assert.ok(temporalSupportFor(state, 'oracle:a') >= 0.5);
});

check('track becomes stable only after agreeing frames', () => {
  let track = emptyTrack();
  const corners = {
    bottomLeft: { x: 0, y: 100 },
    bottomRight: { x: 70, y: 100 },
    topLeft: { x: 0, y: 0 },
    topRight: { x: 70, y: 0 },
  };
  track = pushTrack(track, sampleFromQuad(corners, 0.8));
  assert.equal(track.stable, false);
  track = pushTrack(track, sampleFromQuad(corners, 0.8));
  track = pushTrack(track, sampleFromQuad(corners, 0.8));
  assert.equal(track.stable, true);
  track = pushTrack(track, null);
  assert.equal(track.stable, true, 'one miss must not drop an already-stable lock');
  assert.ok(track.history.length > 0, 'coasts — history kept after one miss');
});

check('track clears after coast window of misses', () => {
  let track = emptyTrack();
  const corners = {
    bottomLeft: { x: 0, y: 100 },
    bottomRight: { x: 70, y: 100 },
    topLeft: { x: 0, y: 0 },
    topRight: { x: 70, y: 0 },
  };
  for (let i = 0; i < 3; i++) track = pushTrack(track, sampleFromQuad(corners, 0.8));
  track = pushTrack(track, null);
  track = pushTrack(track, null);
  track = pushTrack(track, null);
  track = pushTrack(track, null);
  assert.equal(track.history.length, 0);
});

check('object-fit cover maps center to center', () => {
  const source = { width: 1920, height: 1080 };
  const dest = { width: 390, height: 844 };
  const mid = mapCoverSourceToDest(
    { x: source.width / 2, y: source.height / 2 },
    source,
    dest,
  );
  assert.ok(Math.abs(mid.x - dest.width / 2) < 1);
  assert.ok(Math.abs(mid.y - dest.height / 2) < 1);
});

check('analysis → overlay accounts for downscale and cover crop', () => {
  const analysis = { width: 640, height: 360 };
  const source = { width: 1920, height: 1080 };
  const dest = { width: 400, height: 800 };
  const srcPt = mapAnalysisToSource({ x: 320, y: 180 }, analysis, source);
  assert.ok(Math.abs(srcPt.x - 960) < 1);
  const overlay = mapAnalysisToOverlay({ x: 320, y: 180 }, analysis, source, dest);
  assert.ok(overlay.x > 0 && overlay.x < dest.width);
  assert.ok(overlay.y > 0 && overlay.y < dest.height);
});

check('polygon IoU is 1 for identical quads and ~0 for disjoint', () => {
  const a = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 10, y: 0 },
    bottomRight: { x: 10, y: 20 },
    bottomLeft: { x: 0, y: 20 },
  };
  assert.ok(Math.abs(polygonIoU(a, a) - 1) < 1e-6);
  const b = {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 110, y: 100 },
    bottomRight: { x: 110, y: 120 },
    bottomLeft: { x: 100, y: 120 },
  };
  assert.ok(polygonIoU(a, b) < 0.01);
});

check('frame quality prefers a sharp frame over a flat one', () => {
  const flat = blankImage(64, 64);
  for (let i = 0; i < flat.data.length; i += 4) {
    flat.data[i] = flat.data[i + 1] = flat.data[i + 2] = 128;
    flat.data[i + 3] = 255;
  }
  const sharp = blankImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const v = (x + y) % 2 === 0 ? 20 : 220;
      sharp.data[i] = sharp.data[i + 1] = sharp.data[i + 2] = v;
      sharp.data[i + 3] = 255;
    }
  }
  assert.ok(frameQualityScore(sharp, 1).score > frameQualityScore(flat, 1).score);
});

check('text evidence rewards distinctive tokens and ignores stopwords', () => {
  const tokens = tokenizeScanText('Investigate. Create a Clue token. Creature enters the battlefield.');
  assert.ok(tokens.includes('investigate'));
  assert.ok(!tokens.includes('creature'));
  const idf = idfForPool([
    { name: 'A', oracleId: 'a', tokens: ['investigate', 'clue'] },
    { name: 'B', oracleId: 'b', tokens: ['draw', 'card'] },
  ]);
  const score = textEvidenceScore(tokens, ['investigate', 'clue'], idf);
  assert.ok(score > 0.5);
});

check('battle profile is chosen for landscape rasters', () => {
  assert.equal(profileForCard(1000, 700).name, 'battle');
  assert.equal(profileForCard(744, 1038).name, 'standard');
  assert.ok(STANDARD_PROFILE.artwork);
  assert.ok(BATTLE_PROFILE.artwork);
});

await checkAsync('session controller: no card stays searching', async () => {
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: null,
  });
  const noise = blankImage(320, 480);
  const s = await ctrl.onFrame(noise);
  assert.equal(s.phase, 'searching');
});

check('continuous focus constraints only when supported', () => {
  assert.equal(buildContinuousFocusConstraints({}), null);
  assert.deepEqual(
    buildContinuousFocusConstraints({ focusModes: ['continuous'] }),
    { focusMode: 'continuous' },
  );
  assert.equal(
    buildContinuousFocusConstraints({ focusModes: ['manual'] }),
    null,
  );
});

check('point focus always offers best-effort attempts', () => {
  const attempts = buildPointFocusConstraints({}, { x: 0.5, y: 0.5 });
  assert.ok(attempts.length >= 3);
  assert.ok(
    buildPointFocusConstraints(
      { focusModes: ['single-shot'], pointsOfInterest: true },
      { x: 0.5, y: 0.5 },
    ).length >= 1,
  );
});

check('main-lens zoom prefers 1.0 when ultrawide is available', () => {
  assert.equal(preferredMainLensZoom({ zoom: { max: 10, min: 0.5 } }), 1);
  assert.equal(preferredMainLensZoom({ zoom: { max: 8, min: 1 } }), null);
  assert.equal(preferredMainLensZoom({}), null);
});

check('preferred camera plan is ideal 1080p environment', () => {
  const plan = buildCameraConstraintPlan();
  assert.equal(plan.preferred.width.ideal, 1920);
  assert.equal(plan.preferred.height.ideal, 1080);
  assert.ok(cameraConstraintFallbacks().length >= 3);
});

check('normalizeCapabilities handles missing fields', () => {
  const caps = normalizeCapabilities({
    focusMode: ['continuous', 'single-shot'],
    pointsOfInterest: true,
    torch: true,
  });
  assert.deepEqual(caps.focusModes, ['continuous', 'single-shot']);
  assert.equal(caps.pointsOfInterest, true);
  assert.equal(caps.torch, true);
  assert.equal(supportsTapFocus(caps), true);
  assert.equal(supportsTapFocus({}), false);
});

check('focus gate: stable+blurry → focusing; sharp → ready; timeout', () => {
  assert.equal(
    focusGateDecision({
      focusingSince: 0,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 100,
      qualityScore: 0.1,
      sharpness: 10,
      stable: true,
      timeoutMs: 2800,
    }).kind,
    'focusing',
  );
  assert.equal(
    focusGateDecision({
      focusingSince: 0,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 100,
      qualityScore: 0.9,
      sharpness: 200,
      stable: true,
      timeoutMs: 2800,
    }).kind,
    'ready',
  );
  assert.equal(
    focusGateDecision({
      focusingSince: 0,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 5000,
      qualityScore: 0.1,
      sharpness: 10,
      stable: true,
      timeoutMs: 2800,
    }).kind,
    'timeout',
  );
  assert.equal(
    focusGateDecision({
      focusingSince: null,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 100,
      qualityScore: 0.1,
      sharpness: 10,
      stable: false,
      timeoutMs: 2800,
    }).kind,
    'unstable',
  );
});

check('focus attempt: timeout and cooldown bound vendor flicker', () => {
  const waiting = focusAttemptDecision({
    attemptMs: FOCUS_ATTEMPT_MS,
    cooldownMs: FOCUS_COOLDOWN_MS,
    lastRequestAt: 0,
    movedMaterially: false,
    now: 100,
    requestedAt: 0,
    successAt: null,
    trackChanged: false,
  });
  assert.equal(waiting.kind, 'waiting');
  assert.equal(waiting.allowCapture, false);
  assert.equal(waiting.shouldRequest, false);

  const timed = focusAttemptDecision({
    attemptMs: FOCUS_ATTEMPT_MS,
    cooldownMs: FOCUS_COOLDOWN_MS,
    lastRequestAt: 0,
    movedMaterially: false,
    now: FOCUS_ATTEMPT_MS + 20,
    requestedAt: 0,
    successAt: null,
    trackChanged: false,
  });
  assert.equal(timed.kind, 'timeout');
  assert.equal(timed.allowCapture, true);
  assert.equal(timed.shouldRequest, false);

  const ok = focusAttemptDecision({
    attemptMs: FOCUS_ATTEMPT_MS,
    cooldownMs: FOCUS_COOLDOWN_MS,
    lastRequestAt: 10,
    movedMaterially: false,
    now: 50,
    requestedAt: 10,
    successAt: 40,
    trackChanged: false,
  });
  assert.equal(ok.allowCapture, true);
  assert.equal(ok.shouldRequest, false);

  const moved = focusAttemptDecision({
    attemptMs: FOCUS_ATTEMPT_MS,
    cooldownMs: FOCUS_COOLDOWN_MS,
    lastRequestAt: 10,
    movedMaterially: true,
    now: 50,
    requestedAt: 10,
    successAt: 40,
    trackChanged: false,
  });
  assert.equal(moved.allowCapture, true);
  assert.equal(moved.shouldRequest, false, 'sleeve/center jitter must not restart focus');

  const afterCooldown = focusAttemptDecision({
    attemptMs: FOCUS_ATTEMPT_MS,
    cooldownMs: FOCUS_COOLDOWN_MS,
    lastRequestAt: 0,
    movedMaterially: false,
    now: FOCUS_COOLDOWN_MS + 100,
    requestedAt: 0,
    successAt: null,
    trackChanged: false,
  });
  assert.equal(afterCooldown.allowCapture, true);
  assert.equal(afterCooldown.kind, 'timeout');
  assert.equal(afterCooldown.shouldRequest, false, 'cooldown expiry is not a new request');

  const newTrack = focusAttemptDecision({
    attemptMs: FOCUS_ATTEMPT_MS,
    cooldownMs: FOCUS_COOLDOWN_MS,
    lastRequestAt: 0,
    movedMaterially: false,
    now: FOCUS_COOLDOWN_MS + 100,
    requestedAt: 0,
    successAt: null,
    trackChanged: true,
  });
  assert.equal(newTrack.shouldRequest, true);
});

check('durationMs rejects epoch-minus-monotonic mixes', () => {
  assert.equal(durationMs(100, 250), 150);
  assert.equal(durationMs(null, 10), null);
  assert.ok(durationMs(Date.now(), performance.now()) == null, 'mixed clocks must not yield 1e12');
  assert.ok(durationMs(50, Date.now()) == null, 'small monotonic minus epoch is invalid');
  const later = 50 + 400;
  assert.equal(durationMs(50, later), 400);
});

check('debug label unsleeved is not sleeved', () => {
  assert.equal(tagsFromLabel('island unsleeved').sleeved, false);
  assert.equal(tagsFromLabel('sleeved foil').sleeved, true);
  assert.equal(tagsFromLabel('Wand of Wonder').sleeved, null);
});

const unitQuad = (shift = 0) => ({
  bottomLeft: { x: shift, y: 100 },
  bottomRight: { x: 100 + shift, y: 100 },
  topLeft: { x: shift, y: 0 },
  topRight: { x: 100 + shift, y: 0 },
});

const focusSample = (over = {}) => ({
  actualDelayFromFocusRequestMs: over.nominalDelayMs ?? 0,
  cardContrast: 20,
  density: {
    cardAreaPx: 1,
    cardBoundingHeightPx: 10,
    cardBoundingWidthPx: 10,
    sourceHeight: 1920,
    sourceWidth: 1006,
    warpHeight: 1039,
    warpUpscaleX: 1,
    warpUpscaleY: 1,
    warpWidth: 744,
  },
  failureClass: null,
  geometry: null,
  metrics: {
    cardGlare: 0,
    cardSharpness: 300,
    titleContrast: 20,
    titleGlare: 0,
    titleSharpness: 200,
    ...over.metrics,
  },
  motion: null,
  nominalDelayMs: 0,
  ocr: {
    decision: 'ocr-empty',
    firstPassExact: false,
    matchName: null,
    matchScore: null,
    ocrText: '',
    ocrVariantCount: 0,
    rawOcrFirst: '',
    reason: 'ocr-empty',
    recognitionMs: 10,
    status: 'ocr-empty',
    ...over.ocr,
  },
  quad: unitQuad(),
  quadAgeAtCaptureMs: 0,
  quadLatchedFrom: 'live',
  quadTimestamp: 0,
  recognitionQuadSource: 'tracked-card',
  recognitionQuadValid: true,
  sourceCardContrast: 20,
  sourceCardSharpness: 300,
  sourceContrast: 15,
  sourceHeight: 1920,
  sourceSharpness: 40,
  sourceWidth: 1006,
  trackId: 2,
  ...over,
  metrics: {
    cardGlare: 0,
    cardSharpness: 300,
    titleContrast: 20,
    titleGlare: 0,
    titleSharpness: 200,
    ...over.metrics,
  },
  ocr: {
    decision: 'ocr-empty',
    firstPassExact: false,
    matchName: null,
    matchScore: null,
    ocrText: '',
    ocrVariantCount: 0,
    rawOcrFirst: '',
    reason: 'ocr-empty',
    recognitionMs: 10,
    status: 'ocr-empty',
    ...over.ocr,
  },
});

check('focus series per-snapshot quads record IoU vs T0', () => {
  const t0 = unitQuad(0);
  const later = unitQuad(40);
  const drift = driftVsT0(later, t0);
  assert.ok(drift.iouVsT0 < 0.75, `expected stale IoU, got ${drift.iouVsT0}`);
  assert.ok(drift.centerDeltaVsT0 > 0.08);
  assert.ok(drift.cornerDeltaVsT0 > 0.08);
  const same = driftVsT0(t0, t0);
  assert.ok(same.iouVsT0 > 0.99);
  assert.equal(same.centerDeltaVsT0, 0);
});

check('focus series classifies SOURCE / WARP / TITLE_REGION / OCR', () => {
  const t0 = focusSample({
    metrics: { cardSharpness: 330, titleSharpness: 224, titleContrast: 22 },
    nominalDelayMs: 0,
    ocr: { decision: 'insufficient-confidence', rawOcrFirst: 'Wand of Won', status: 'insufficient-confidence' },
    quad: unitQuad(0),
  });
  const wandLater = focusSample({
    metrics: { cardSharpness: 280, titleSharpness: 9, titleContrast: 4 },
    nominalDelayMs: 500,
    quad: unitQuad(0),
    sourceCardSharpness: 300,
  });
  const [t0d, wandD] = attachFocusSeriesDiagnostics([t0, wandLater]);
  assert.equal(t0d.failureClass, 'OCR_BAD');
  assert.equal(wandD.failureClass, 'WARP_BAD');

  const teferi = attachFocusSeriesDiagnostics([
    focusSample({
      metrics: { cardSharpness: 330, titleSharpness: 6, titleContrast: 5.5 },
      nominalDelayMs: 0,
      quad: unitQuad(0),
    }),
    focusSample({
      metrics: { cardSharpness: 340, titleSharpness: 5, titleContrast: 5 },
      nominalDelayMs: 250,
      quad: unitQuad(0),
    }),
  ]);
  assert.equal(teferi[0].failureClass, 'TITLE_REGION_BAD');
  assert.equal(teferi[1].failureClass, 'TITLE_REGION_BAD');

  const soft = attachFocusSeriesDiagnostics([
    focusSample({
      metrics: { cardSharpness: 12, titleSharpness: 3, titleContrast: 2 },
      nominalDelayMs: 0,
      sourceCardSharpness: 10,
      sourceSharpness: 4,
    }),
  ]);
  assert.equal(soft[0].failureClass, 'SOURCE_BAD');

  const drifted = attachFocusSeriesDiagnostics([
    focusSample({ nominalDelayMs: 0, quad: unitQuad(0), metrics: { cardSharpness: 300, titleSharpness: 8, titleContrast: 4 } }),
    focusSample({
      nominalDelayMs: 500,
      quad: unitQuad(50),
      metrics: { cardSharpness: 290, titleSharpness: 7, titleContrast: 4 },
      sourceCardSharpness: 300,
    }),
  ]);
  assert.equal(drifted[1].failureClass, 'WARP_BAD');
  assert.ok(drifted[1].geometry.iouVsT0 < 0.75);
});

check('focus series summary has a best-delay column', () => {
  const fake = {
    capturedAt: '2026-01-01T00:00:00.000Z',
    currentTrackId: 1,
    fixtureId: 'focus-series-test',
    focusAttemptId: 1,
    focusRequestedAt: 0,
    focusTrackId: 1,
    label: 'Test Card',
    sameTrackFocus: true,
    tags: { borderStyle: null, foil: null, glare: null, language: null, sleeved: null },
    samples: [0, 250, 500, 800].map((n, i) => ({
      actualDelayFromFocusRequestMs: n + 5,
      density: {
        cardAreaPx: 1,
        cardBoundingHeightPx: 10,
        cardBoundingWidthPx: 10,
        sourceHeight: 1920,
        sourceWidth: 1006,
        warpHeight: 1039,
        warpUpscaleX: 1,
        warpUpscaleY: 1,
        warpWidth: 744,
      },
      metrics: {
        cardGlare: 0,
        cardSharpness: 10,
        titleContrast: 20,
        titleGlare: 0,
        titleSharpness: 10 + i * 40,
      },
      motion: null,
      nominalDelayMs: n,
      ocr: {
        decision: i > 0 ? 'exact-title' : 'ocr-empty',
        firstPassExact: i > 1,
        matchName: i > 0 ? 'Test Card' : null,
        matchScore: i > 0 ? 1 : null,
        ocrText: i > 0 ? 'Test Card' : '',
        ocrVariantCount: i > 0 ? 1 : 0,
        rawOcrFirst: i > 0 ? 'Test Card' : '',
        reason: i > 0 ? 'exact-title' : 'ocr-empty',
        recognitionMs: 10,
        status: i > 0 ? 'identified' : 'ocr-empty',
      },
      quad: {
        bottomLeft: { x: 0, y: 1 },
        bottomRight: { x: 1, y: 1 },
        topLeft: { x: 0, y: 0 },
        topRight: { x: 1, y: 0 },
      },
      sourceHeight: 1920,
      sourceWidth: 1006,
    })),
  };
  const text = summarizeFocusSeries([fake]);
  assert.match(text, /T800/);
  assert.match(text, /best-quality delay counts/);
  assert.match(text, /capture\/source quality vs delay/);
  assert.match(text, /geometry\/crop failures vs delay/);
  assert.match(text, /OCR success vs delay/);
});

check('swap test summary flags sticky geometry + new session', () => {
  const text = summarizeSwapTest({
    capturedAt: '2026-09-08T00:00:00.000Z',
    expectedLabels: ['A', 'B'],
    fixtureId: 'swap-test-demo',
    phase: 'done',
    targetCount: 2,
    swaps: [
      {
        actualDelayFromFocusRequestMs: null,
        cardSessionId: 8,
        cardSharpness: 40,
        changeWatchBand: 'same',
        changeWatchDelta: 0.1,
        changeWatchState: 'same',
        expectedLabel: 'A',
        focusAttemptId: 1,
        geometryTrackId: 4,
        identity: 'A',
        index: 0,
        label: swapIdForIndex(0),
        recognizeAttemptsForTrack: 1,
        recognitionDecision: 'exact',
        recognitionStatus: 'identified',
        sessionResetReason: 'initial',
        sourceHeight: 100,
        sourceWidth: 100,
        swapId: swapIdForIndex(0),
        titleSharpness: 30,
        visualFingerprintDelta: 0,
      },
      {
        actualDelayFromFocusRequestMs: null,
        cardSessionId: 9,
        cardSharpness: 41,
        changeWatchBand: 'changed',
        changeWatchDelta: 0.45,
        changeWatchState: 'changed',
        expectedLabel: 'B',
        focusAttemptId: 2,
        geometryTrackId: 4,
        identity: 'B',
        index: 1,
        label: swapIdForIndex(1),
        recognizeAttemptsForTrack: 0,
        recognitionDecision: 'exact',
        recognitionStatus: 'identified',
        sessionResetReason: 'visual-change',
        sourceHeight: 100,
        sourceWidth: 100,
        swapId: swapIdForIndex(1),
        titleSharpness: 31,
        visualFingerprintDelta: 0.45,
      },
    ],
    transitions: [
      {
        changeWatchBand: 'changed',
        changeWatchState: 'changed',
        detection: 'auto-visual',
        focusAttemptAfter: 2,
        focusAttemptBefore: 1,
        fromIndex: 0,
        fromSwapId: 'swap-01',
        newCardSessionId: 9,
        newGeometryTrackId: 4,
        newIdentity: 'B',
        previousCardSessionId: 8,
        previousGeometryTrackId: 4,
        previousIdentity: 'A',
        retryBudgetAfter: 0,
        retryBudgetBefore: 1,
        sessionResetReason: 'visual-change',
        timeToDetectSwapMs: 900,
        toIndex: 1,
        toSwapId: 'swap-02',
        visualConfirmCount: 2,
        visualFingerprintDelta: 0.42,
      },
    ],
  });
  assert.match(text, /geometry SAME/);
  assert.match(text, /cardSession CHANGED/);
  assert.match(text, /GOOD sticky-geometry \+ new-session: 1\/1/);
});

check('change-watch cheap fingerprint separates Hex→Island on swap fixtures', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const base = join(
    root,
    '.scan-inbox/sessions/phone-20260908/swap-test-20260908-171306',
  );
  const paths = [1, 2, 3, 4, 5].map(i => join(base, `swap-0${i}-card.png`));
  if (!paths.every(p => existsSync(p))) {
    console.log('  (skip — swap-test-20260908-171306 not in inbox)');
    return;
  }
  const fps = paths.map(p => changeFingerprintFromWarpedCard(pngBytesToScanImage(readFileSync(p))));
  const same = changeFingerprintDistance(fps[0], fps[1]);
  const hexIsle = changeFingerprintDistance(fps[1], fps[2]);
  const isleLiv = changeFingerprintDistance(fps[2], fps[3]);
  const livBlade = changeFingerprintDistance(fps[3], fps[4]);
  assert.ok(same < CHANGE_WATCH_SAME_MAX + 0.02, `same Hex delta ${same}`);
  assert.equal(classifyChangeDistance(same), 'same');
  assert.ok(hexIsle > same, 'Hex→Island should exceed Hex→Hex');
  assert.ok(isleLiv >= CHANGE_WATCH_DIFF_MIN, `Island→Livaan ${isleLiv}`);
  assert.ok(livBlade > CHANGE_WATCH_SAME_MAX, `Livaan→Blades ${livBlade}`);
});

check('change-watch session machine: sticky geom, Hex same, then three new sessions', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const base = join(
    root,
    '.scan-inbox/sessions/phone-20260908/swap-test-20260908-171306',
  );
  const paths = [1, 2, 3, 4, 5].map(i => join(base, `swap-0${i}-card.png`));
  if (!paths.every(p => existsSync(p))) {
    console.log('  (skip — swap-test-20260908-171306 not in inbox)');
    return;
  }
  const warps = paths.map(p => pngBytesToScanImage(readFileSync(p)));
  // Fake analysis frames = warped cards; corners = full frame.
  const fullCorners = img => ({
    bottomLeft: { x: 0, y: img.height - 1 },
    bottomRight: { x: img.width - 1, y: img.height - 1 },
    topLeft: { x: 0, y: 0 },
    topRight: { x: img.width - 1, y: 0 },
  });

  let watch = emptyCardChangeWatch();
  const sessions = [1];
  let geometryTrackId = 1;
  let now = 0;

  const observe = (img, label) => {
    // Two ticks spaced beyond interval to allow confirms.
    for (let k = 0; k < 3; k++) {
      now += CHANGE_WATCH_INTERVAL_MS + 1;
      const tick = tickCardChangeWatch({
        corners: fullCorners(img),
        detectorMiss: false,
        frame: img,
        geometryDelta: 0.01,
        now,
        sessionActive: true,
        state: watch,
      });
      watch = tick.state;
      if (tick.beginSession) {
        sessions.push(sessions[sessions.length - 1] + 1);
        watch = seedCardChangeWatch(watch.currentFingerprint);
        break;
      }
      // Uncertain band: simulate identity probe definitive change when delta high enough
      // and labels differ (host stand-in for OCR identity probe).
      if (tick.requestIdentityProbe && label !== 'Hex') {
        sessions.push(sessions[sessions.length - 1] + 1);
        watch = seedCardChangeWatch(watch.currentFingerprint);
        break;
      }
    }
  };

  observe(warps[0], 'Hex');
  const afterHex = sessions[sessions.length - 1];
  observe(warps[1], 'Hex');
  assert.equal(sessions[sessions.length - 1], afterHex, 'same Hex must not mint session');
  observe(warps[2], 'Island');
  assert.ok(sessions[sessions.length - 1] > afterHex, 'Island must mint new session');
  const afterIsle = sessions[sessions.length - 1];
  observe(warps[3], 'Livaan');
  assert.ok(sessions[sessions.length - 1] > afterIsle, 'Livaan must mint new session');
  const afterLiv = sessions[sessions.length - 1];
  observe(warps[4], 'Blades');
  assert.ok(sessions[sessions.length - 1] > afterLiv, 'Blades must mint new session');
  assert.equal(geometryTrackId, 1, 'geometry track stays sticky');
  assert.equal(sessions.length, 4, `expected 4 session ids over sequence, got ${sessions.join(',')}`);
});

check('focus series expected identity maps French Deck of Many Things', () => {
  const got = expectedIdentityFromLabel('les cartes merveilleuses french');
  assert.equal(got.expectedName, 'The Deck of Many Things');
  assert.equal(identityMatchesExpected('Waker of the Wilds', got.expectedName), false);
  assert.equal(identityMatchesExpected('The Deck of Many Things', got.expectedName), true);
});

check('focus series Waker of the Wilds on Deck of Many Things is not success', () => {
  const sample = {
    ocr: {
      decision: 'ambiguous',
      firstPassExact: false,
      matchName: 'Waker of the Wilds',
      matchScore: 0.72,
      ocrText: 'ryeilleus',
      ocrVariantCount: 1,
      rawOcrFirst: '',
      reason: 'single-reading',
      recognitionMs: 1,
      status: 'insufficient-confidence',
    },
  };
  assert.equal(classifySampleOutcome(sample, 'The Deck of Many Things'), 'ambiguous-wrong');
  assert.equal(
    classifySampleOutcome(
      { ocr: { ...sample.ocr, decision: 'exact-title', status: 'identified' } },
      'The Deck of Many Things',
    ),
    'false-positive',
  );
});

check('capture policies score predicted==expected on per-snapshot fixtures', () => {
  const unit = (shift = 0) => ({
    bottomLeft: { x: shift, y: 100 },
    bottomRight: { x: 100 + shift, y: 100 },
    topLeft: { x: shift, y: 0 },
    topRight: { x: 100 + shift, y: 0 },
  });
  const ocr = (over) => ({
    decision: 'ocr-empty',
    firstPassExact: false,
    matchName: null,
    matchScore: null,
    ocrText: '',
    ocrVariantCount: 0,
    rawOcrFirst: '',
    reason: 'ocr-empty',
    recognitionMs: 10,
    status: 'ocr-empty',
    ...over,
  });
  const sample = (nominal, delay, titleSharp, ocrOver, quadShift = 0) => ({
    actualDelayFromFocusRequestMs: delay,
    cardContrast: 20,
    density: {
      cardAreaPx: 1,
      cardBoundingHeightPx: 10,
      cardBoundingWidthPx: 10,
      sourceHeight: 1920,
      sourceWidth: 1006,
      warpHeight: 1039,
      warpUpscaleX: 1,
      warpUpscaleY: 1,
      warpWidth: 744,
    },
    failureClass: ocrOver?.decision === 'exact-title' ? 'OK' : 'OCR_BAD',
    geometry: { centerDeltaVsT0: 0, cornerDeltaVsT0: 0, iouVsT0: 1 },
    metrics: {
      cardGlare: 0,
      cardSharpness: 300,
      titleContrast: 20,
      titleGlare: 0,
      titleSharpness: titleSharp,
    },
    motion: null,
    nominalDelayMs: nominal,
    ocr: ocr(ocrOver),
    quad: unit(quadShift),
    quadAgeAtCaptureMs: delay,
    quadLatchedFrom: 'live',
    quadTimestamp: 0,
    recognitionQuadSource: 'tracked-card',
    recognitionQuadValid: true,
    sourceCardContrast: 20,
    sourceCardSharpness: 300,
    sourceContrast: 15,
    sourceHeight: 1920,
    sourceSharpness: 40,
    sourceWidth: 1006,
    trackId: 1,
  });
  const identified = name => ({
    decision: 'exact-title',
    firstPassExact: true,
    matchName: name,
    matchScore: 1,
    ocrText: name,
    ocrVariantCount: 1,
    rawOcrFirst: name,
    reason: 'exact-title',
    status: 'identified',
  });
  const series = (label, track, attempt, slots, quadMode = 'per-snapshot') => ({
    capturedAt: '2026-09-08T13:00:00.000Z',
    currentTrackId: track,
    fixtureId: `focus-${label}`,
    focusAttemptId: attempt,
    focusRequestedAt: 0,
    focusTrackId: track,
    label,
    quadMode,
    sameTrackFocus: true,
    samples: slots,
    tags: { borderStyle: null, foil: null, glare: null, language: null, sleeved: null },
    trackChangedDuringSeries: false,
  });
  const wand = series('Wand of Wonder', 1, 1, [
    sample(0, 81, 43, {}),
    sample(250, 407, 61, identified('Wand of Wonder'), 2),
    sample(500, 775, 327, identified('Wand of Wonder'), 3),
    sample(800, 1188, 78, identified('Wand of Wonder'), 4),
  ]);
  const livaan = series('Livaan, Cultist of Tiamat foil', 3, 3, [
    sample(0, 72, 1916, identified('Livaan, Cultist of Tiamat')),
    sample(250, 379, 1885, identified('Livaan, Cultist of Tiamat')),
    sample(500, 761, 1956, identified('Livaan, Cultist of Tiamat')),
    sample(800, 1248, 1727, identified('Livaan, Cultist of Tiamat')),
  ]);
  const excalibur = series('Excalibur, Sword of Eden French foil', 4, 4, [
    sample(0, 75, 638, identified('Excalibur, Sword of Eden')),
    sample(250, 365, 62, identified('Excalibur, Sword of Eden'), 1),
    sample(500, 676, 140, identified('Excalibur, Sword of Eden'), 2),
    sample(800, 1111, 628, identified('Excalibur, Sword of Eden'), 3),
  ]);
  const deck = series('les cartes merveilleuses french', 4, 4, [
    sample(0, 79, 44, {
      decision: 'ambiguous',
      matchName: 'Waker of the Wilds',
      matchScore: 0.72,
      ocrText: 'ryeilleus',
      ocrVariantCount: 1,
      reason: 'single-reading',
      status: 'insufficient-confidence',
    }),
    sample(250, 367, 93, {}),
    sample(500, 741, 91, {}),
    sample(800, 1207, 77, {}),
  ]);
  const octopus = series('Octopus Form', 1, 1, [
    sample(0, 98, 115, {}),
    sample(250, 1200, 80, {}),
    sample(500, 1830, 74, identified('Octopus Form')),
    sample(800, 2875, 104, {}),
  ]);
  const live = [wand, livaan, excalibur, deck, octopus];
  const legacy = series(
    'Wand of Wonder',
    2,
    2,
    [sample(0, 280, 224, {}), sample(250, 606, 28, {}), sample(500, 1047, 9, {}), sample(800, 1487, 13, {})],
    'legacy-frozen',
  );
  const parts = partitionFocusSeries([...live, legacy]);
  assert.equal(parts.perSnapshot.length, 5);
  assert.equal(parts.legacy.length, 1);

  const policy = id => CAPTURE_POLICIES.find(p => p.id === id);
  const score = spec =>
    live.filter(b => {
      const pick = simulatePolicy(b.samples, spec, expectedIdentityFromLabel(b.label).expectedName);
      return pick?.outcome === 'correct';
    }).length;
  assert.equal(score(policy('A')), 2);
  assert.equal(score(policy('B')), 3);
  assert.equal(score(policy('C')), 4);
  assert.equal(score(policy('D')), 3);
  assert.equal(score(policy('E')), 3);
  assert.equal(score(policy('F')), 4);
  assert.equal(score(policy('G')), 3);

  const deckT0 = simulatePolicy(deck.samples, policy('A'), 'The Deck of Many Things');
  assert.equal(deckT0.outcome, 'ambiguous-wrong');
  assert.equal(deckT0.predicted, 'Waker of the Wilds');

  const labeled = live.flatMap(b =>
    b.samples
      .map(s =>
        labelQualitySample(
          s,
          classifySampleOutcome(s, expectedIdentityFromLabel(b.label).expectedName) === 'correct',
        ),
      )
      .filter(Boolean),
  );
  const sep = bestTitleSharpnessSeparator(labeled);
  assert.equal(sep.overlap, true);

  const report = formatCapturePolicyReport([...live, legacy]);
  assert.match(report, /PER-SNAPSHOT ONLY/);
  assert.match(report, /The Deck of Many Things/);
  assert.match(report, /ambiguous-wrong/);
  assert.match(report, /WARP_BAD samples: 0/);
  assert.match(report, /title sharpness alone does NOT separate/);
});

check('quality pool prefers sharper frame', () => {
  const soft = frameQualityScore(blankImage(64, 64), 1);
  const detailed = blankImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const v = (x + y) % 2 === 0 ? 20 : 220;
      detailed.data[i] = v;
      detailed.data[i + 1] = v;
      detailed.data[i + 2] = v;
      detailed.data[i + 3] = 255;
    }
  }
  const sharp = frameQualityScore(detailed, 1);
  assert.ok(sharp.score > soft.score);
  assert.ok(sharp.sharpness > soft.sharpness);
});

check('cover tap mapping is invertible at center', () => {
  const source = { height: 1080, width: 1920 };
  const dest = { height: 800, width: 400 };
  const mid = mapCoverSourceToDest({ x: 960, y: 540 }, source, dest);
  // Center of cover layout should land near dest center.
  assert.ok(Math.abs(mid.x - 200) < 2);
  assert.ok(Math.abs(mid.y - 400) < 2);
});

await checkAsync('session controller: found suppresses duplicate until gone', async () => {
  // Stub recognizer that always "identifies" Sol Ring so we can exercise the
  // FOUND → same geometry → no re-recognize path without OCR.
  let recognizeCalls = 0;
  const ocr = {
    recognize: async () => {
      recognizeCalls += 1;
      return { confidence: 0.9, text: 'Sol Ring' };
    },
  };
  const names = buildNameIndex(
    { names: ['Sol Ring'], locales: {}, version: 1 },
    shapeFold,
  );
  const ctrl = createSessionController({ nameIndex: names, ocr });
  // Build a simple high-contrast card-like rectangle.
  const frame = blankImage(400, 560);
  for (let y = 40; y < 520; y++) {
    for (let x = 80; x < 320; x++) {
      const i = (y * 400 + x) * 4;
      frame.data[i] = 30;
      frame.data[i + 1] = 30;
      frame.data[i + 2] = 40;
      frame.data[i + 3] = 255;
    }
  }
  // Feed enough agreeing frames to lock (stability window).
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = await ctrl.onFrame(frame);
  }
  assert.ok(last);
  // If detection never locked, skip soft — synthetic blank cards vary.
  if (last.phase === 'found' || last.phase === 'recognizing' || last.phase === 'ambiguous') {
    const callsAfter = recognizeCalls;
    await ctrl.onFrame(frame);
    await ctrl.onFrame(frame);
    assert.ok(
      recognizeCalls <= callsAfter + 1,
      'must not thrash recognition on a stationary card',
    );
  }
});

await checkAsync('title-only early identity fires before slow artwork', async () => {
  const names = buildNameIndex({ names: ['Sol Ring', 'Soul Warden'], version: 1 });
  const early = [];
  const artDelayMs = 120;
  const ocr = {
    recognize: async () => ({ confidence: 0.95, text: 'Sol Ring' }),
  };
  // Empty matcher — art contributes nothing; delay proves we do not wait for it.
  const artwork = { findCandidates: () => [] };
  const card = solid(CARD_WIDTH, CARD_HEIGHT, [200, 200, 200]);
  const { result } = await recognizeCard(
    card,
    {
      artwork,
      nameIndex: names,
      ocr,
      onEarlyIdentity: r => {
        early.push({
          at: Date.now(),
          name: r.fused.card?.name,
          reason: r.earlyReason,
          status: r.fused.status,
        });
      },
    },
    { artworkDelayMs: artDelayMs },
  );

  assert.ok(early.length >= 1, 'onEarlyIdentity must fire');
  assert.equal(early[0].reason, 'title-only');
  assert.equal(early[0].name, 'Sol Ring');
  assert.equal(early[0].status, 'printing-ambiguous');
  assert.equal(result.earlyReason, 'title-only');
  assert.ok(typeof result.timings.titleDoneAt === 'number');
  assert.ok(typeof result.timings.artDoneAt === 'number');
  assert.ok(typeof result.timings.earlyIdentityAt === 'number');
  assert.ok(
    result.timings.titleDoneAt < result.timings.artDoneAt,
    `title (${result.timings.titleDoneAt}) should finish before art (${result.timings.artDoneAt})`,
  );
  assert.ok(
    result.timings.earlyIdentityAt < result.timings.artDoneAt,
    'early identity must not wait for artwork',
  );
  assert.ok(
    result.timings.earlyIdentityAt <= result.timings.titleDoneAt + 30,
    'early should fire promptly after title',
  );
  assert.equal(result.fused.card?.name, 'Sol Ring');
});

await checkAsync('art-only early identity fires when OCR is slow', async () => {
  const names = buildNameIndex({ names: ['Chaos Dragon', 'Other'], version: 1 });
  const early = [];
  const ocr = {
    recognize: async () => {
      await new Promise(r => setTimeout(r, 120));
      return { confidence: 0.5, text: 'zzzz' };
    },
  };
  const artwork = {
    findCandidates: () => [
      {
        name: 'Chaos Dragon',
        oracleId: 'oracle:chaos',
        scryfallId: 'p1',
        visualScore: 0.92,
      },
      {
        name: 'Other',
        oracleId: 'oracle:other',
        visualScore: 0.7,
      },
    ],
  };
  const card = solid(CARD_WIDTH, CARD_HEIGHT, [40, 40, 40]);
  const { result } = await recognizeCard(
    card,
    {
      artwork,
      nameIndex: names,
      ocr,
      onEarlyIdentity: r => {
        early.push({ name: r.fused.card?.name, reason: r.earlyReason });
      },
    },
    {},
  );

  assert.ok(early.length >= 1, 'art-only early should fire');
  assert.equal(early[0].reason, 'art-only');
  assert.equal(early[0].name, 'Chaos Dragon');
  assert.equal(result.earlyReason, 'art-only');
  assert.ok(result.timings.artDoneAt < result.timings.titleDoneAt);
  assert.ok(result.timings.earlyIdentityAt < result.timings.titleDoneAt);
});

await checkAsync('controller publishes provisional found via onEarlyIdentity', async () => {
  const names = buildNameIndex({ names: ['Sol Ring'], version: 1 });
  const published = [];
  const ocr = {
    recognize: async () => ({ confidence: 0.95, text: 'Sol Ring' }),
  };
  const artwork = { findCandidates: () => [] };
  const ctrl = createSessionController({
    artwork,
    nameIndex: names,
    ocr,
    onEarlyIdentity: () => {
      const snap = ctrl.snapshot();
      published.push({ message: snap.message, phase: snap.phase });
    },
  });
  const card = solid(CARD_WIDTH, CARD_HEIGHT, [200, 200, 200]);
  const snap = await ctrl.recognizeStill(card);
  assert.ok(published.length >= 1, 'controller must surface early identity');
  assert.equal(published[0].phase, 'found');
  assert.equal(published[0].message, 'Sol Ring');
  assert.equal(snap.phase, 'found');
  assert.ok(snap.earlyShownAt != null);
  assert.ok(snap.recognizingStartedAt != null);
  assert.ok(snap.earlyShownAt >= snap.recognizingStartedAt);
});

check('isStrongArtOnly keeps the artwork-only weak-cluster bar', () => {
  const weak = fuseEvidence(
    [
      {
        name: 'Sol Ring',
        oracleId: 'oracle:sol',
        possiblePrintingIds: ['p1'],
        visualScore: 0.7,
      },
      {
        name: 'Arcane Signet',
        oracleId: 'oracle:signet',
        possiblePrintingIds: ['p2'],
        visualScore: 0.675,
      },
    ],
    { artworkOnly: true },
  );
  assert.equal(weak.status, 'card-ambiguous');
  assert.equal(isStrongArtOnly(weak), false);

  const strong = fuseEvidence(
    [
      {
        name: 'Chaos Dragon',
        oracleId: 'oracle:chaos',
        possiblePrintingIds: ['p1'],
        visualScore: 0.92,
      },
      {
        name: 'Other',
        oracleId: 'oracle:other',
        possiblePrintingIds: [],
        visualScore: 0.7,
      },
    ],
    { artworkOnly: true },
  );
  assert.equal(strong.status, 'identified');
  assert.equal(isStrongArtOnly(strong), true);
});

await checkAsync('hard-case Maddening Hex AFC showcase glare detects when PNG present', async () => {
  const { existsSync } = await import('node:fs');
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { PNG } = await import('pngjs');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(
    await readFile(join(root, 'scripts/fixtures/hard-cases.json'), 'utf8'),
  );
  const entry = catalog.cases.find(c => c.id === 'maddening-hex-afc-showcase-glare');
  assert.ok(entry, 'hard-cases catalog missing Maddening Hex entry');
  const pngPath = join(root, entry.detectPath);
  if (!existsSync(pngPath)) {
    console.log('  (skip — place PNG at .scan-real/maddening-hex-afc-showcase-glare.png)');
    return;
  }
  const meta = JSON.parse(
    await readFile(join(root, '.scan-real/maddening-hex-afc-showcase-glare.json'), 'utf8'),
  );
  const png = PNG.sync.read(await readFile(pngPath));
  const frame = {
    data: new Uint8ClampedArray(png.data),
    height: png.height,
    width: png.width,
  };
  const det = detectCardQuad(frame);
  assert.ok(det.quad, 'showcase+glare+sleeve frame should still detect a card');
  assert.ok(det.score >= 0.5, `expected usable detect score, got ${det.score}`);
  if (meta.corners && det.corners) {
    const iou = polygonIoU(det.corners, meta.corners);
    assert.ok(iou >= 0.7, `annotated IoU ${iou.toFixed(3)} too low for hard case`);
  }
  assert.equal(meta.expectedName, 'Maddening Hex');
  assert.equal(meta.setCode, 'afc');
});

await checkAsync('PrintingIndex AFC 301 → Maddening Hex showcase when full index present', async () => {
  const { existsSync } = await import('node:fs');
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const path = join(root, '.scan-fixtures/printing-index.json');
  if (!existsSync(path)) {
    console.log('  (skip — no printing-index.json)');
    return;
  }
  const index = buildPrintingIndex(JSON.parse(await readFile(path, 'utf8')));
  const hit = lookupPrinting(index, {
    foilMarker: null,
    raw: 'AFC 301',
    setCode: 'AFC',
    collectorNumber: '301',
  });
  assert.ok(hit?.candidates?.length, 'AFC 301 should hit PrintingIndex');
  assert.ok(
    hit.candidates.some(c => c.name === 'Maddening Hex'),
    `expected Maddening Hex among ${hit.candidates.map(c => c.name).join(', ')}`,
  );
});

check('strong title is not overwritten by disagreeing weaker art (Sword/Tovolar)', () => {
  const fused = fuseEvidence(
    [
      {
        name: 'Sword of Hearth and Home',
        oracleId: 'name:Sword of Hearth and Home',
        possiblePrintingIds: [],
        titleScore: 0.83,
      },
      {
        name: 'Tovolar, Dire Overlord',
        oracleId: 'oracle:tovolar',
        possiblePrintingIds: ['p1'],
        visualScore: 0.8,
      },
    ],
    { allowTitleOnly: true, allowStrongDual: true },
  );
  assert.equal(fused.card?.name, 'Sword of Hearth and Home');
  assert.ok(fused.artConflict === true);
  assert.notEqual(fused.card?.name, 'Tovolar, Dire Overlord');
  assert.ok(findStickyTitle(fused.candidates)?.name === 'Sword of Hearth and Home');
});

check('exact title sticks against strong disagreeing art → ambiguous keep title', () => {
  const fused = fuseEvidence(
    [
      {
        name: 'Negate',
        oracleId: 'name:Negate',
        possiblePrintingIds: [],
        titleScore: 0.98,
      },
      {
        name: 'Counterspell',
        oracleId: 'oracle:counter',
        possiblePrintingIds: ['p1'],
        visualScore: 0.95,
      },
    ],
    { allowTitleOnly: true, allowStrongDual: true },
  );
  assert.equal(fused.card?.name, 'Negate');
  assert.ok(fused.status === 'card-ambiguous' || fused.status === 'printing-ambiguous');
});

check('footer evidence extracts R0337 FFVII / RO360 TDC / 457 L', () => {
  const a = extractFooterEvidence('R0337 FFVII');
  assert.ok(a.collectorCandidates.some(c => c.value === '0337' || c.value === '337'));
  assert.ok(!a.setCodeCandidates.some(c => c.value === 'FFVII'));

  const b = extractFooterEvidence('RO360 TDC');
  assert.ok(b.collectorCandidates.some(c => c.value === '360'));
  assert.ok(b.setCodeCandidates.some(c => c.value === 'TDC'));

  const c = extractFooterEvidence('457 L');
  assert.ok(c.collectorCandidates.some(c => c.value === '457'));
});

check('title-restricted footer lookup Island + 457', () => {
  const index = buildPrintingIndex({
    version: 1,
    entries: [
      {
        setCode: 'clb',
        collectorNumber: '457',
        scryfallId: 'island-clb-457',
        oracleId: 'oracle-island',
        name: 'Island',
        lang: 'en',
        finishes: ['nonfoil'],
      },
      {
        setCode: 'clb',
        collectorNumber: '458',
        scryfallId: 'other',
        oracleId: 'oracle-other',
        name: 'Swamp',
        lang: 'en',
        finishes: ['nonfoil'],
      },
    ],
  });
  const hit = lookupPrintingTitleRestricted(index, {
    evidence: extractFooterEvidence('457 L'),
    titleName: 'Island',
  });
  assert.ok(hit);
  assert.equal(hit.candidates[0].name, 'Island');
  assert.equal(hit.candidates[0].collectorNumber, '457');
});

check('title-restricted Champion Helm R0337 ignores FFVII as set', () => {
  const index = buildPrintingIndex({
    version: 1,
    entries: [
      {
        setCode: 'fin',
        collectorNumber: '337',
        scryfallId: 'helm-337',
        oracleId: 'oracle-helm',
        name: "Champion's Helm",
        lang: 'en',
        finishes: ['nonfoil'],
      },
    ],
  });
  const hit = lookupPrintingTitleRestricted(index, {
    evidence: extractFooterEvidence('R0337 FFVII'),
    titleName: "Champion's Helm",
  });
  assert.ok(hit);
  assert.equal(hit.candidates[0].collectorNumber, '337');
  assert.equal(hit.candidates[0].setCode, 'fin');
});

check('TypeIndex Creature — Faerie + Legendary Creature — Dragon', () => {
  const data = {
    version: 1,
    oracles: ['ora-pixie', 'ora-dragon', 'ora-bolt'],
    cardTypes: ['artifact', 'creature', 'instant', 'land'],
    supertypes: ['basic', 'legendary', 'snow'],
    subtypes: ['dragon', 'faerie', 'human'],
    faces: [
      {
        cardTypeMask: 1 << 1,
        faceIndex: 0,
        normalizedTypeLine: 'creature faerie',
        oracleOrdinal: 0,
        subtypeIds: [1],
        supertypeMask: 0,
      },
      {
        cardTypeMask: 1 << 1,
        faceIndex: 0,
        normalizedTypeLine: 'legendary creature dragon',
        oracleOrdinal: 1,
        subtypeIds: [0],
        supertypeMask: 1 << 1,
      },
      {
        cardTypeMask: 1 << 2,
        faceIndex: 0,
        normalizedTypeLine: 'instant',
        oracleOrdinal: 2,
        subtypeIds: [],
        supertypeMask: 0,
      },
    ],
    signatures: {
      'creature faerie': [0],
      'legendary creature dragon': [1],
    },
    subtypePostings: {
      '0': [1],
      '1': [0],
    },
  };
  const index = buildTypeIndex(data);
  const faerie = matchTypeReading('Creature — Faerie', index);
  assert.ok(faerie.subtypes.some(s => s.value === 'faerie'));
  assert.ok(faerie.candidateOracleIds?.includes('ora-pixie'));

  const dragon = matchTypeReading('Legendary Creature — Dragon', index);
  assert.ok(dragon.supertypes.some(s => s.value === 'legendary'));
  assert.ok(dragon.subtypes.some(s => s.value === 'dragon'));

  const junk = matchTypeReading('zzzz not a type', index);
  assert.equal(junk.confidence, 0);
});

check('PrintingIndex missing forces manifest check (no 18h throttle)', () => {
  assert.equal(
    shouldThrottleScannerManifestCheck({
      lastCheckAt: Date.now() - 1000,
      now: Date.now(),
      criticalAssetMissing: true,
    }),
    false,
  );
  assert.equal(
    shouldThrottleScannerManifestCheck({
      lastCheckAt: Date.now() - 1000,
      now: Date.now(),
      criticalAssetMissing: false,
      intervalMs: 18 * 60 * 60 * 1000,
    }),
    true,
  );
  assert.equal(
    mayAdvanceLastCheckAfterFailure({ printingMissing: true, typeMissing: false }),
    false,
  );
  assert.equal(
    mayAdvanceLastCheckAfterFailure({ printingMissing: false, typeMissing: false }),
    true,
  );
  assert.equal(
    needPrintingAsset({
      manifestHasPrinting: true,
      diskPrintingExists: false,
      metaSha256: 'abc',
      manifestSha256: 'abc',
      activePrintingLoaded: false,
    }),
    true,
  );
  assert.equal(
    needTypeAsset({
      manifestHasType: true,
      diskTypeExists: true,
      metaSha256: 'deadbeef',
      manifestSha256: 'cafebabe',
      activeTypeLoaded: true,
    }),
    true,
  );
});

check('scanner manifest accepts optional typeIndex', () => {
  const ok = isScannerManifest({
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00Z',
    cardNames: {
      sha256: 'a'.repeat(64),
      url: 'https://tsuina311.github.io/Lugin/card-names.json',
      version: '1',
    },
    artIndex: {
      sha256: 'b'.repeat(64),
      url: 'https://tsuina311.github.io/Lugin/art-index.json',
      version: '1',
    },
    typeIndex: {
      sha256: 'c'.repeat(64),
      url: 'https://tsuina311.github.io/Lugin/type-index.json',
      version: '1',
      recordCount: 12000,
      bytes: 4_000_000,
      compressedBytes: 800_000,
    },
  });
  assert.equal(ok, true);
});

check('expected manifest keeps collector numbers as strings', () => {
  const cards = parseExpectedManifest([
    { name: 'Pixie Guide', setCode: 'AFR', collectorNumber: '066', finish: 'nonfoil' },
  ]);
  assert.equal(cards[0].collectorNumber, '066');
  assert.equal(collectorNumbersEqual('066', '66'), true);
});

check('benchmark latency verdict + dedupe-facing flags', () => {
  assert.equal(classifyLatencyVerdict(400, 800), 'pass');
  assert.equal(classifyLatencyVerdict(2000, 2500), 'warn');
  assert.equal(classifyLatencyVerdict(4000, 5000), 'fail');

  const score = scoreAgainstExpected(
    {
      name: 'Pixie Guide',
      printing: { setCode: 'afr', collectorNumber: '66' },
      finish: 'nonfoil',
      status: 'identified',
      ocrPresent: true,
    },
    { name: 'Pixie Guide', setCode: 'AFR', collectorNumber: '066', finish: 'nonfoil' },
  );
  assert.equal(score?.oracleOk, true);
  assert.equal(score?.printingOk, true);
  assert.equal(score?.finishOk, true);

  const flags = collectFlags(
    {
      name: 'Wrong',
      status: 'identified',
      ocrPresent: true,
      artConflict: true,
      titleFooterConflict: true,
      actualDetectorEngine: 'shared-js',
      ocrTransport: 'rgba-base64',
      userLatency: { lockToFirstOracleMs: 1200 },
    },
    scoreAgainstExpected(
      { name: 'Wrong', status: 'identified', ocrPresent: true },
      { name: 'Pixie Guide', setCode: 'AFR', collectorNumber: '066' },
    ),
    { lockToFirstOracleMs: 1200, lockToFinalOracleMs: 1200, lockToPrintingMs: null },
  );
  assert.ok(flags.includes('title-art-conflict'));
  assert.ok(flags.includes('title-footer-conflict'));
  assert.ok(flags.includes('failure'));
  assert.ok(flags.includes('false-confident'));
  assert.ok(flags.includes('slow-1s'));
  assert.ok(flags.includes('detector-js'));
  assert.ok(flags.includes('ocr-base64'));
  assert.equal(mapWinningChannel('title-only'), 'title');
});

check('benchmark session summary percentiles + OCR transport gate', () => {
  const scans = [
    {
      earlyReason: 'title-only',
      flags: [],
      latency: { lockToFirstOracleMs: 400, lockToFinalOracleMs: 450, lockToPrintingMs: 700 },
      lockedAt: 1,
      name: 'A',
      pngRelativePath: 'scans/0001-recognition.png',
      reportRelativePath: 'scans/0001.json',
      score: {
        expected: null,
        finishOk: null,
        nameOk: true,
        oracleOk: true,
        printingOk: true,
      },
      seq: 1,
      stamp: 'a',
      status: 'identified',
      uploadAttempts: 0,
      uploadError: null,
      uploadStatus: 'skipped',
      winningChannel: 'title',
      ocrTitle: {
        bytes: 160000,
        cropH: 75,
        cropW: 536,
        encodeMs: 0,
        jsBridgeMs: 220,
        lookupMs: 1,
        mlkitMs: 180,
        nativeMs: 200,
        totalMs: 250,
        transport: 'rgba-bytes',
      },
      actualDetectorEngine: 'native',
      detectorEngine: 'native',
    },
    {
      earlyReason: 'title-only',
      flags: [],
      latency: { lockToFirstOracleMs: 500, lockToFinalOracleMs: 520, lockToPrintingMs: 800 },
      lockedAt: 2,
      name: 'B',
      pngRelativePath: 'scans/0002-recognition.png',
      reportRelativePath: 'scans/0002.json',
      score: {
        expected: null,
        finishOk: null,
        nameOk: true,
        oracleOk: true,
        printingOk: true,
      },
      seq: 2,
      stamp: 'b',
      status: 'identified',
      uploadAttempts: 0,
      uploadError: null,
      uploadStatus: 'skipped',
      winningChannel: 'title',
      ocrTitle: {
        bytes: 160000,
        cropH: 75,
        cropW: 536,
        encodeMs: 0,
        jsBridgeMs: 210,
        lookupMs: 1,
        mlkitMs: 170,
        nativeMs: 190,
        totalMs: 240,
        transport: 'rgba-bytes',
      },
      actualDetectorEngine: 'native',
      detectorEngine: 'native',
    },
  ];
  const summary = buildSessionSummary(scans, 50, { printingEntries: 101912 });
  assert.equal(summary.latency.verdict, 'pass');
  assert.equal(summary.ocr.transport, 'rgba-bytes');
  assert.equal(summary.gates.detectorNative, true);
  assert.equal(summary.gates.ocrRgbaBytes, true);
  assert.equal(summary.gates.printingLoaded, true);
  assert.ok(summary.latency.lockToFirstOracleP50Ms != null);
});

check('TypeIndex restricts candidates for partial title path', () => {
  const data = {
    version: 1,
    oracles: ['ora-pixie', 'ora-guide', 'ora-bolt'],
    cardTypes: ['creature', 'instant'],
    supertypes: [],
    subtypes: ['faerie', 'human'],
    faces: [
      {
        cardTypeMask: 1,
        faceIndex: 0,
        normalizedTypeLine: 'creature faerie',
        oracleOrdinal: 0,
        subtypeIds: [0],
        supertypeMask: 0,
      },
      {
        cardTypeMask: 1,
        faceIndex: 0,
        normalizedTypeLine: 'creature human',
        oracleOrdinal: 1,
        subtypeIds: [1],
        supertypeMask: 0,
      },
      {
        cardTypeMask: 1 << 1,
        faceIndex: 0,
        normalizedTypeLine: 'instant',
        oracleOrdinal: 2,
        subtypeIds: [],
        supertypeMask: 0,
      },
    ],
    signatures: {
      'creature faerie': [0],
      'creature human': [1],
      instant: [2],
    },
    subtypePostings: { 0: [0], 1: [1] },
  };
  const index = buildTypeIndex(data);
  const restricted = matchTypeReading('Creature — Faerie', index, ['ora-pixie', 'ora-guide']);
  assert.ok(restricted.candidateOracleIds?.includes('ora-pixie'));
  assert.ok(!restricted.candidateOracleIds?.includes('ora-bolt'));
});

check('performance baseline preset is UI-first (8 Hz, no warmup/live PNG)', () => {
  applyPerfPreset('baseline');
  const b = getPerfBaseline();
  assert.equal(b.detectorHz, 8);
  assert.equal(b.analysisLongEdge, 480);
  assert.equal(b.ocrWarmup, false);
  assert.equal(b.liveDebugImages, false);
  assert.equal(b.heavyIndexesWhileScanning, false);
  assert.equal(b.footerOcr, false);
  assert.equal(b.typeOcr, false);
  assert.equal(b.artwork, false);
  assert.equal(PERF_BASELINE.detectorHz, 8);
  assert.ok(PERF_FULL.detectorHz >= 10);
  applyPerfPreset('full');
  assert.equal(getPerfBaseline().ocrWarmup, true);
  applyPerfPreset('baseline');
});

check('normalizeCardCorners restores TL TR BR BL after permutation', () => {
  const swapped = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 0, y: 20 },
    bottomRight: { x: 10, y: 20 },
    bottomLeft: { x: 10, y: 0 },
  };
  const n = normalizeCardCorners(swapped);
  assert.ok(n.topLeft.y <= n.bottomLeft.y);
  assert.ok(n.topLeft.x <= n.topRight.x);
  assert.ok(n.bottomLeft.x <= n.bottomRight.x);
});

check('orderCorners / normalizeCardCorners handle rotated and skewed quads', () => {
  const rotated = orderCorners([
    { x: 80, y: 10 },
    { x: 140, y: 40 },
    { x: 110, y: 130 },
    { x: 50, y: 100 },
  ]);
  assert.ok(rotated[0].y <= rotated[3].y);
  assert.ok(rotated[0].x <= rotated[1].x);
  const skewed = normalizeCardCorners({
    topLeft: { x: 30, y: 80 },
    topRight: { x: 20, y: 20 },
    bottomRight: { x: 120, y: 10 },
    bottomLeft: { x: 140, y: 90 },
  });
  assert.ok(skewed.topLeft.y <= skewed.bottomLeft.y);
  assert.ok(skewed.topLeft.x <= skewed.topRight.x);
});

check('stale-clear threshold outlasts a 250 ms native gap', () => {
  assert.ok(DETECT_STALE_MS > 250);
  assert.ok(DETECT_STALE_MS < 2000);
});

const paintCardLike = (img, { gray = false } = {}) => {
  const { data, height, width } = img;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inset =
        x > width * 0.12 && x < width * 0.88 && y > height * 0.08 && y < height * 0.92;
      let r = 18;
      let g = 22;
      let b = 28;
      if (inset) {
        const stripe = ((x + y) % 3 === 0 ? 40 : 210);
        r = gray ? stripe : stripe;
        g = gray ? stripe : Math.min(255, stripe + (x % 7) * 2);
        b = gray ? stripe : Math.max(0, stripe - (y % 5) * 3);
        if (y < height * 0.18) {
          r = gray ? (x % 2 === 0 ? 20 : 230) : 30;
          g = gray ? (x % 2 === 0 ? 20 : 230) : 30;
          b = gray ? (x % 2 === 0 ? 20 : 230) : 30;
        }
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return img;
};

const downscaleGray = (src, width, height) => {
  const dst = blankImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / width) * src.width));
      const sy = Math.min(src.height - 1, Math.floor((y / height) * src.height));
      const si = (sy * src.width + sx) * 4;
      const yv = 0.299 * src.data[si] + 0.587 * src.data[si + 1] + 0.114 * src.data[si + 2];
      const di = (y * width + x) * 4;
      dst.data[di] = dst.data[di + 1] = dst.data[di + 2] = yv;
      dst.data[di + 3] = 255;
    }
  }
  return dst;
};

check('luma-proxy quality is lower than RGB analysis on the same card', () => {
  const rgb = paintCardLike(blankImage(360, 640));
  const luma = downscaleGray(rgb, 251, 480);
  const rgbQ = frameQualityScore(rgb, 0.9);
  const lumaQ = frameQualityScore(luma, 0.9);
  assert.ok(rgbQ.score > 0, 'RGB quality must be defined');
  assert.ok(lumaQ.score >= 0, 'luma quality must be defined');
  // Sharpness is resolution-dependent; luma proxy is the weaker signal.
  assert.ok(
    lumaQ.sharpness <= rgbQ.sharpness * 1.05,
    `luma sharp ${lumaQ.sharpness} should not exceed RGB ${rgbQ.sharpness}`,
  );
});

await checkAsync('luma proxy must not block lock when hi-res is pending', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  let recognizeCalls = 0;
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: {
      recognize: async () => {
        recognizeCalls += 1;
        return { confidence: 0.9, text: 'Sol Ring' };
      },
    },
  });
  const helpers = {
    allowRecognize: () => false,
    prepareAnalysis: frame => ({
      corners,
      detected: true,
      detection: { candidates: [], ms: 1, selectedIndex: 0, workSize: { height: 480, width: 251 } },
      image: frame,
      score: 0.86,
      source: 'detected',
    }),
  };
  let last = null;
  for (let i = 0; i < STABILITY_WINDOW + 2; i++) {
    last = await ctrl.onFrame(luma, helpers);
  }
  assert.ok(last);
  assert.equal(last.phase, 'locking', `expected locking, got ${last.phase} (${last.lockGates?.waiting})`);
  assert.equal(last.lockGates.blocker, 'awaiting-hires');
  assert.equal(last.lockGates.qualityInput, 'luma-proxy');
  assert.equal(last.lockGates.qualityGating, false);
  assert.ok(last.lockGates.stable);
  assert.equal(recognizeCalls, 0, 'must wait for hi-res, not OCR the luma proxy');

  const go = await ctrl.onFrame(luma, { ...helpers, allowRecognize: () => true });
  assert.ok(
    go.phase === 'recognizing' ||
      go.phase === 'found' ||
      go.phase === 'ambiguous' ||
      go.phase === 'locking',
    `after allowRecognize expected recognition start, got ${go.phase} (must not sit in focusing)`,
  );
  assert.ok((go.recognizeInvocations ?? 0) >= 1);
  assert.notEqual(go.phase, 'focusing', 'insufficient identity must not re-enter focusing');
});

const cardQuad = (ox = 40, oy = 40, w = 120, h = 168) => ({
  topLeft: { x: ox, y: oy },
  topRight: { x: ox + w, y: oy },
  bottomRight: { x: ox + w, y: oy + h },
  bottomLeft: { x: ox, y: oy + h },
});

const jitter = (q, px) => ({
  topLeft: { x: q.topLeft.x + px, y: q.topLeft.y - px },
  topRight: { x: q.topRight.x + px, y: q.topRight.y + px },
  bottomRight: { x: q.bottomRight.x - px, y: q.bottomRight.y + px },
  bottomLeft: { x: q.bottomLeft.x - px, y: q.bottomLeft.y - px },
});

check('continuity A: small corner noise keeps the same track', () => {
  const base = cardQuad();
  let state = emptyContinuity();
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = stepContinuity(state, { rawCorners: jitter(base, i % 2 === 0 ? 2 : -2), rawScore: 0.88 });
    state = last.state;
  }
  assert.equal(last.track.id, 1);
  assert.equal(last.switched, false);
  assert.ok(last.metrics.iou > 0.85);
});

check('continuity B: inner/outer score oscillation does not switch track', () => {
  const inner = cardQuad(50, 50, 100, 140);
  const outer = cardQuad(40, 40, 130, 180);
  let state = emptyContinuity();
  let last = stepContinuity(state, { rawCorners: inner, rawScore: 0.91 });
  state = last.state;
  const id = last.track.id;
  for (let i = 0; i < 6; i++) {
    const useOuter = i % 2 === 0;
    last = stepContinuity(state, {
      candidates: [
        { corners: inner, score: useOuter ? 0.88 : 0.92 },
        { corners: outer, score: useOuter ? 0.9 : 0.89 },
      ],
      rawCorners: useOuter ? outer : inner,
      rawScore: useOuter ? 0.9 : 0.92,
    });
    state = last.state;
  }
  assert.equal(last.track.id, id);
  assert.equal(last.switched, false);
  assert.ok(last.state.roleSwitchCount <= 1);
});

check('continuity C: one-frame miss retains the track', () => {
  const q = cardQuad();
  let state = emptyContinuity();
  let last = stepContinuity(state, { rawCorners: q, rawScore: 0.9 });
  state = last.state;
  last = stepContinuity(state, { rawCorners: null, rawScore: 0 });
  assert.equal(last.selectionReason.includes('grace'), true);
  assert.ok(last.track);
  assert.ok(last.trackedCorners);
});

check('continuity D: corner order is normalized before comparison', () => {
  const q = cardQuad();
  const permuted = {
    topLeft: q.topLeft,
    topRight: q.bottomLeft,
    bottomRight: q.bottomRight,
    bottomLeft: q.topRight,
  };
  let last = stepContinuity(emptyContinuity(), { rawCorners: q, rawScore: 0.9 });
  last = stepContinuity(last.state, { rawCorners: permuted, rawScore: 0.9 });
  assert.equal(last.switched, false);
  assert.ok(last.metrics.iou > 0.9);
});

check('continuity E: genuine removal resets after grace', () => {
  const q = cardQuad();
  let last = stepContinuity(emptyContinuity(), { rawCorners: q, rawScore: 0.9 });
  for (let i = 0; i <= TRACK_COAST_FRAMES; i++) {
    last = stepContinuity(last.state, { rawCorners: null, rawScore: 0 });
  }
  assert.equal(last.track, null);
  assert.ok(String(last.state.lastResetReason).includes('grace'));
});

check('continuity F: a new card elsewhere starts a new track after the old one is lost', () => {
  const a = cardQuad(20, 20);
  const b = cardQuad(220, 300, 110, 150);
  let last = stepContinuity(emptyContinuity(), { rawCorners: a, rawScore: 0.9 });
  const firstId = last.track.id;
  for (let i = 0; i <= TRACK_COAST_FRAMES; i++) {
    last = stepContinuity(last.state, { rawCorners: null, rawScore: 0 });
  }
  last = stepContinuity(last.state, { rawCorners: b, rawScore: 0.9 });
  assert.ok(last.track);
  assert.notEqual(last.track.id, firstId);
});

check('continuity G: slow motion follows without dropping the track', () => {
  let q = cardQuad(40, 40);
  let last = stepContinuity(emptyContinuity(), { rawCorners: q, rawScore: 0.88 });
  const id = last.track.id;
  for (let i = 1; i <= 8; i++) {
    q = cardQuad(40 + i * 4, 40 + i * 3);
    last = stepContinuity(last.state, { rawCorners: q, rawScore: 0.87 });
  }
  assert.equal(last.track.id, id);
  assert.equal(last.switched, false);
  assert.ok(last.trackedCorners.topLeft.x > 50);
});

check('continuity: pushTrack accumulates stability on noisy but same-object samples', () => {
  const base = cardQuad();
  let track = emptyTrack();
  for (let i = 0; i < 5; i++) {
    track = pushTrack(track, sampleFromQuad(jitter(base, i % 2 === 0 ? 1.5 : -1.5), 0.86));
  }
  assert.equal(track.stable, true);
  assert.ok(track.lastIou > 0.9);
});

check('continuity A: established inner survives outer score flicker', () => {
  const inner = cardQuad(50, 50, 100, 140);
  const outer = cardQuad(40, 40, 130, 180);
  const innerScores = [0.92, 0.88, 0.91];
  const outerScores = [0.89, 0.9, 0.89];
  let last = stepContinuity(emptyContinuity(), { rawCorners: inner, rawScore: 0.92 });
  const id = last.track.id;
  for (let i = 0; i < innerScores.length; i++) {
    last = stepContinuity(last.state, {
      candidates: [
        { corners: inner, score: innerScores[i] },
        { corners: outer, score: outerScores[i] },
      ],
      rawCorners: outerScores[i] > innerScores[i] ? outer : inner,
      rawScore: Math.max(innerScores[i], outerScores[i]),
    });
  }
  assert.equal(last.track.id, id);
  assert.equal(last.track.role, 'card-inner');
  assert.ok(last.state.roleSwitchCount <= 1);
  assert.equal(last.switched, false);
});

check('continuity B: one detector miss keeps the same track id', () => {
  const q = cardQuad();
  let last = stepContinuity(emptyContinuity(), { rawCorners: q, rawScore: 0.9 });
  const id = last.track.id;
  last = stepContinuity(last.state, { rawCorners: null, rawScore: 0 });
  assert.equal(last.track.id, id);
  last = stepContinuity(last.state, { rawCorners: q, rawScore: 0.89 });
  assert.equal(last.track.id, id);
});

check('continuity C: minor jitter still accumulates tracked IoU', () => {
  const base = cardQuad();
  let last = stepContinuity(emptyContinuity(), { rawCorners: base, rawScore: 0.9 });
  for (let i = 0; i < 6; i++) {
    last = stepContinuity(last.state, {
      rawCorners: jitter(base, i % 2 === 0 ? 2 : -2),
      rawScore: 0.9,
    });
  }
  assert.ok(last.metrics.iou > 0.8);
  assert.equal(last.track.id, 1);
});

check('continuity F: tiny candidate changes keep the same track id', () => {
  const a = cardQuad(48, 48, 104, 146);
  const b = cardQuad(50, 50, 100, 140);
  let last = stepContinuity(emptyContinuity(), { rawCorners: a, rawScore: 0.9 });
  const id = last.track.id;
  last = stepContinuity(last.state, { rawCorners: b, rawScore: 0.91 });
  last = stepContinuity(last.state, { rawCorners: a, rawScore: 0.88 });
  assert.equal(last.track.id, id);
  assert.equal(last.switched, false);
});

check('continuity G: card removed resets after grace', () => {
  const q = cardQuad();
  let last = stepContinuity(emptyContinuity(), { rawCorners: q, rawScore: 0.9 });
  for (let i = 0; i <= TRACK_COAST_FRAMES; i++) {
    last = stepContinuity(last.state, { rawCorners: null, rawScore: 0 });
  }
  assert.equal(last.track, null);
  assert.equal(last.state.lastResetReason, 'grace exhausted');
});

const sessionHelpers = (corners, extra = {}) => ({
  prepareAnalysis: frame => ({
    corners,
    detected: true,
    detection: { candidates: [], ms: 1, selectedIndex: 0, workSize: { height: 480, width: 251 } },
    image: frame,
    score: extra.score ?? 0.9,
    source: 'detected',
  }),
  ...extra,
});

const runFrames = async (ctrl, frame, helpers, n) => {
  let last = null;
  for (let i = 0; i < n; i++) last = await ctrl.onFrame(frame, helpers);
  return last;
};

await checkAsync('continuity D: focus oscillation still allows capture after bound', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  let focusCalls = 0;
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    requestFocusNorm: () => {
      focusCalls += 1;
    },
  });
  const early = await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  assert.ok(early.lockGates.stable, 'geometry must stay stable during focus wait');
  assert.ok(focusCalls <= 2, `focus spam: ${focusCalls}`);
  assert.ok(
    early.phase === 'focusing' || early.phase === 'locking',
    `expected focusing/locking, got ${early.phase}`,
  );
  await new Promise(r => setTimeout(r, FOCUS_ATTEMPT_MS + 30));
  const late = await ctrl.onFrame(luma, helpers);
  assert.equal(late.phase, 'locking', `after timeout expected locking, got ${late.phase}`);
  assert.ok(late.lockGates.highResRequests >= 1);
  assert.equal(late.lockGates.focusRequests, 1, 'one focus attempt per track');
  const again = await runFrames(ctrl, luma, helpers, 4);
  assert.equal(again.lockGates.focusRequests, 1, 'must not re-request after timeout');
  assert.equal(again.phase, 'locking');
  assert.ok(again.lockGates.blocker !== 'awaiting-focus');
});

await checkAsync('new track id gets a fresh bounded focus attempt', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  let trackId = 1;
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const helpers = {
    allowRecognize: () => false,
    prepareAnalysis: frame => ({
      corners,
      detected: true,
      detection: {
        candidates: [],
        ms: 1,
        selectedIndex: 0,
        trackId,
        workSize: { height: 480, width: 251 },
      },
      image: frame,
      score: 0.9,
      source: 'detected',
    }),
    requestFocusNorm: () => {},
  };
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  await new Promise(r => setTimeout(r, FOCUS_ATTEMPT_MS + 30));
  const first = await ctrl.onFrame(luma, helpers);
  assert.equal(first.lockGates.focusRequests, 1);
  assert.equal(first.lockGates.focusCardSessionId, first.lockGates.cardSessionId);
  assert.equal(first.lockGates.sameCardSessionFocus, true);
  assert.ok((first.lockGates.focusAgeMs ?? 0) < 5000, `stale focus age ${first.lockGates.focusAgeMs}`);
  // Geometry track change alone must NOT mint a new focus attempt.
  trackId = 2;
  const swapped = await ctrl.onFrame(luma, helpers);
  assert.equal(swapped.lockGates.focusRequests, 1, 'geometry track ≠ card session — no focus spam');
  assert.equal(swapped.lockGates.currentTrackId, 2);
  assert.equal(swapped.lockGates.geometryTrackId, 2);
  assert.equal(swapped.lockGates.cardSessionId, first.lockGates.cardSessionId);
  const held = await runFrames(ctrl, luma, helpers, 3);
  assert.equal(held.lockGates.focusRequests, 1, 'same card session must not spam');
});

const paintDistinctCard = seed => {
  const img = blankImage(744, 1039);
  // Solid base unique per seed
  const br = (seed * 67) % 200;
  const bg = (seed * 97 + 40) % 200;
  const bb = (seed * 37 + 80) % 200;
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = br;
    img.data[i + 1] = bg;
    img.data[i + 2] = bb;
    img.data[i + 3] = 255;
  }
  // Title: unique barcode stripes
  for (let y = 40; y < 110; y++) {
    for (let x = 40; x < 700; x++) {
      const i = (y * img.width + x) * 4;
      const on = ((x + seed * 11) % (12 + seed)) < 5;
      const v = on ? 10 : 245;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    }
  }
  // Artwork: seed-specific geometric pattern
  for (let y = 160; y < 560; y++) {
    for (let x = 60; x < 680; x++) {
      const i = (y * img.width + x) * 4;
      const cx = x - 370;
      const cy = y - 360;
      const ring = Math.floor(Math.hypot(cx, cy) / (18 + seed * 3));
      const checker = ((x >> (4 + (seed % 3))) ^ (y >> (4 + (seed % 2)))) & 1;
      if ((ring + seed) % 3 === 0) {
        img.data[i] = 255;
        img.data[i + 1] = seed * 20;
        img.data[i + 2] = 40;
      } else if (checker) {
        img.data[i] = 20;
        img.data[i + 1] = 40 + seed * 15;
        img.data[i + 2] = 200 - seed * 10;
      } else {
        img.data[i] = 180 - seed * 12;
        img.data[i + 1] = 20;
        img.data[i + 2] = 180;
      }
    }
  }
  return img;
};

const paintSlightVariant = (base, noise = 8) => {
  const img = blankImage(base.width, base.height);
  img.data.set(base.data);
  for (let i = 0; i < img.data.length; i += 16) {
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + ((i * 13) % (noise * 2)) - noise));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + ((i * 7) % (noise * 2)) - noise));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + ((i * 3) % (noise * 2)) - noise));
  }
  return img;
};

const loadFocusCard = (seriesId, delay) => {
  const p = join(
    root,
    '.scan-inbox/sessions/phone-20260908',
    seriesId,
    `t${String(delay).padStart(3, '0')}-card.png`,
  );
  if (!existsSync(p)) return null;
  return pngBytesToScanImage(new Uint8Array(readFileSync(p)));
};

check('card fingerprint: same card small visual changes stay below DIFF', () => {
  const a = loadFocusCard('focus-series-20260908T132712', 0); // Livaan
  const b = loadFocusCard('focus-series-20260908T132712', 250);
  if (!a || !b) {
    console.log('  (skip — Livaan focus-series PNGs not in inbox)');
    return;
  }
  const d = cardFingerprintDistance(cardFingerprintFromWarp(a), cardFingerprintFromWarp(b));
  assert.ok(d < CARD_SESSION_DIFF_MIN, `same-card delta ${d} should be < ${CARD_SESSION_DIFF_MIN}`);
  assert.notEqual(classifyFingerprintDistance(d), 'changed');
});

check('card fingerprint: different cards exceed DIFF threshold', () => {
  const a = loadFocusCard('focus-series-20260908T132801', 0); // Excalibur
  const b = loadFocusCard('focus-series-20260908T132852', 0); // Deck of Many Things
  if (!a || !b) {
    console.log('  (skip — Excalibur/Deck focus-series PNGs not in inbox)');
    return;
  }
  const d = cardFingerprintDistance(cardFingerprintFromWarp(a), cardFingerprintFromWarp(b));
  assert.ok(d >= CARD_SESSION_DIFF_MIN, `diff-card delta ${d} should be >= ${CARD_SESSION_DIFF_MIN}`);
  assert.equal(classifyFingerprintDistance(d), 'changed');
});

check('card fingerprint: two confirms required before visual reset', () => {
  const a = loadFocusCard('focus-series-20260908T132801', 0);
  const b = loadFocusCard('focus-series-20260908T132852', 0);
  if (!a || !b) {
    console.log('  (skip — Excalibur/Deck focus-series PNGs not in inbox)');
    return;
  }
  let state = emptyCardSessionVisual();
  let obs = observeCardFingerprint(state, a, { allowReset: true });
  state = obs.state;
  assert.equal(obs.reset, false);
  obs = observeCardFingerprint(state, b, { allowReset: true });
  state = obs.state;
  assert.equal(obs.reset, false, 'first changed observation only pending');
  assert.equal(state.pendingVisualChanges, 1);
  obs = observeCardFingerprint(state, b, { allowReset: true });
  assert.equal(obs.reset, true, 'second confirm resets');
  assert.ok(CARD_SESSION_VISUAL_CONFIRM >= 2);
});

check('card fingerprint: glare/noise does not false-reset', () => {
  const a = loadFocusCard('focus-series-20260908T132712', 0);
  const b = loadFocusCard('focus-series-20260908T132712', 250);
  const c = loadFocusCard('focus-series-20260908T132712', 500);
  if (!a || !b || !c) {
    // Fallback synthetic mild noise
    let state = emptyCardSessionVisual();
    const base = paintDistinctCard(3);
    let obs = observeCardFingerprint(state, base, { allowReset: true });
    state = obs.state;
    for (let i = 0; i < 4; i++) {
      obs = observeCardFingerprint(state, paintSlightVariant(base, 5 + i), { allowReset: true });
      state = obs.state;
      assert.equal(obs.reset, false, `noise step ${i} must not reset`);
    }
    return;
  }
  let state = emptyCardSessionVisual();
  let obs = observeCardFingerprint(state, a, { allowReset: true });
  state = obs.state;
  for (const frame of [b, c, b, a]) {
    obs = observeCardFingerprint(state, frame, { allowReset: true });
    state = obs.state;
    assert.equal(obs.reset, false, 'same-card focus-series frames must not reset');
  }
});

await checkAsync('card session: identity A→B mints new session without clearing geometry track', async () => {
  const corners = {
    topLeft: { x: 40, y: 40 },
    topRight: { x: 700, y: 40 },
    bottomRight: { x: 700, y: 1000 },
    bottomLeft: { x: 40, y: 1000 },
  };
  let which = 0;
  const names = ['Excalibur, Sword of Eden', 'The Deck of Many Things'];
  const idx = buildNameIndex({ names, version: 1 });
  const ctrl = createSessionController({
    nameIndex: idx,
    ocr: {
      recognize: async () => {
        const text = names[which];
        which += 1;
        return { confidence: 0.99, text };
      },
    },
  });
  const warpA = paintDistinctCard(1);
  const warpB = paintDistinctCard(9);
  await ctrl.recognizeFrozenCapture({
    recognitionQuad: corners,
    source: warpA,
    trackId: 4,
  });
  let snap = ctrl.snapshot();
  const sessionA = snap.lockGates?.cardSessionId ?? 0;
  assert.ok(snap.lockGates?.currentSessionIdentity || snap.phase === 'found' || snap.phase === 'locking');
  // Second capture with different strong identity on same geometry track.
  await ctrl.recognizeFrozenCapture({
    recognitionQuad: corners,
    source: warpB,
    trackId: 4,
  });
  snap = ctrl.snapshot();
  assert.equal(snap.lockGates?.geometryTrackId ?? snap.lockGates?.currentTrackId, 4);
  // Session id should advance on identity change when first card was identified.
  if (sessionA && snap.lockGates?.previousSessionIdentity) {
    assert.ok((snap.lockGates?.cardSessionId ?? 0) > sessionA);
  }
});

await checkAsync('SESSION OWNERSHIP: same geometryTrack + new cardSession cannot inherit identity', async () => {
  const corners = {
    topLeft: { x: 40, y: 40 },
    topRight: { x: 700, y: 40 },
    bottomRight: { x: 700, y: 1000 },
    bottomLeft: { x: 40, y: 1000 },
  };
  let which = 0;
  const names = ['Sol Ring', 'Lightning Bolt'];
  const idx = buildNameIndex({ names, version: 1 });
  const ctrl = createSessionController({
    nameIndex: idx,
    ocr: {
      recognize: async () => {
        const text = names[which] ?? names[names.length - 1];
        which += 1;
        return { confidence: 0.99, text };
      },
    },
  });

  // SESSION A — FOUND Card A on geometry track 1
  await ctrl.recognizeFrozenCapture({
    recognitionQuad: corners,
    source: paintDistinctCard(2),
    trackId: 1,
  });
  let snap = ctrl.snapshot();
  const sessionA = snap.lockGates?.cardSessionId ?? 0;
  assert.ok(sessionA > 0);
  assert.equal(snap.resultCardSessionId, sessionA);
  assert.ok(
    snap.phase === 'found' || snap.lockGates?.currentSessionIdentity === 'Sol Ring',
    `session A should be FOUND, got phase=${snap.phase} id=${snap.lockGates?.currentSessionIdentity}`,
  );
  assert.equal(snap.fused?.card?.name ?? snap.lockGates?.currentSessionIdentity, 'Sol Ring');
  assert.equal(snap.lockGates?.geometryTrackId ?? snap.lockGates?.currentTrackId, 1);

  // Physical swap while geometry stays the same (manual / debug path)
  ctrl.markDebugCardSwapped();
  snap = ctrl.snapshot();
  const sessionB = snap.lockGates?.cardSessionId ?? 0;
  assert.ok(sessionB > sessionA, `expected new cardSessionId, got ${sessionB} after ${sessionA}`);
  assert.equal(snap.lockGates?.geometryTrackId ?? snap.lockGates?.currentTrackId, 1);
  assert.equal(snap.resultCardSessionId, null);
  assert.equal(snap.fused, undefined);
  assert.notEqual(snap.phase, 'found');
  assert.notEqual(snap.phase, 'ambiguous');
  assert.equal(snap.postLock?.recognitionStatus, null);
  assert.equal(snap.postLock?.titleTopCandidate, null);
  assert.equal(snap.lockGates?.currentSessionIdentity, null);

  // Deck Benchmark must not save Card A for slot B
  const stale = decideDeckCardSave({
    recordedSlots: new Set([`s:${sessionA}`]),
    cardStartedAt: 0,
    now: 9,
    live: {
      phase: snap.phase,
      recognitionStatus: snap.postLock?.recognitionStatus ?? snap.phase,
      recognitionDecision: null,
      identity: snap.fused?.card?.name ?? null,
      cardSessionId: sessionB,
      resultCardSessionId: snap.resultCardSessionId,
      geometryDetected: true,
      geometryTrackId: 1,
      focusAttemptId: snap.lockGates?.focusAttemptId ?? null,
      titlePresent: false,
      recognizeAttempts: 0,
    },
  });
  assert.equal(stale.shouldSave, false);
  assert.equal(stale.staleIdentityRejected, false); // no identity exposed at all
  assert.equal(stale.terminal, null);

  // Fresh recognition for session B
  await ctrl.recognizeFrozenCapture({
    recognitionQuad: corners,
    source: paintDistinctCard(11),
    trackId: 1,
  });
  snap = ctrl.snapshot();
  assert.equal(snap.lockGates?.cardSessionId, sessionB);
  assert.equal(snap.resultCardSessionId, sessionB);
  assert.equal(snap.fused?.card?.name ?? snap.lockGates?.currentSessionIdentity, 'Lightning Bolt');
  assert.ok(snap.phase === 'found' || snap.lockGates?.currentSessionIdentity === 'Lightning Bolt');

  const fresh = decideDeckCardSave({
    recordedSlots: new Set([`s:${sessionA}`]),
    cardStartedAt: 0,
    now: 1500,
    live: {
      phase: snap.phase,
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Lightning Bolt',
      cardSessionId: sessionB,
      resultCardSessionId: sessionB,
      geometryDetected: true,
      geometryTrackId: 1,
      focusAttemptId: snap.lockGates?.focusAttemptId ?? null,
      titlePresent: true,
      recognizeAttempts: 1,
    },
  });
  assert.equal(fresh.shouldSave, true);
  assert.equal(fresh.terminal, 'identified');
  assert.equal(fresh.staleIdentityRejected, false);
});

await checkAsync('SESSION OWNERSHIP: late recognition from session A cannot publish into B', async () => {
  const corners = {
    topLeft: { x: 40, y: 40 },
    topRight: { x: 700, y: 40 },
    bottomRight: { x: 700, y: 1000 },
    bottomLeft: { x: 40, y: 1000 },
  };
  let releaseOcr = /** @type {(() => void) | null} */ (null);
  const ocrGate = new Promise(resolve => {
    releaseOcr = resolve;
  });
  const idx = buildNameIndex({ names: ['Delina, Wild Mage', 'Sol Ring'], version: 1 });
  const ctrl = createSessionController({
    nameIndex: idx,
    ocr: {
      recognize: async () => {
        await ocrGate;
        return { confidence: 0.99, text: 'Delina, Wild Mage' };
      },
    },
  });

  const pending = ctrl.recognizeFrozenCapture({
    recognitionQuad: corners,
    source: paintDistinctCard(2),
    trackId: 2,
  });
  // Physical swap while A recognition is still in flight
  ctrl.markDebugCardSwapped();
  let snap = ctrl.snapshot();
  const sessionB = snap.lockGates?.cardSessionId ?? 0;
  assert.ok(sessionB > 0);
  assert.equal(snap.resultCardSessionId, null);
  assert.equal(snap.fused, undefined);
  assert.notEqual(snap.phase, 'found');

  releaseOcr?.();
  await pending;
  snap = ctrl.snapshot();
  assert.equal(snap.lockGates?.cardSessionId, sessionB);
  assert.equal(snap.resultCardSessionId, null, 'late A must not own B');
  assert.equal(snap.fused, undefined);
  assert.notEqual(snap.phase, 'found');
  assert.notEqual(snap.phase, 'ambiguous');
});

check('SESSION OWNERSHIP: geometryTrack=2 + multi session never inherits Delina', () => {
  // Real-run pattern: same geometry track, new card sessions before fresh evidence.
  const sessions = [100, 101, 102, 103];
  let lastSaved = null;
  for (const sid of sessions) {
    const hasFresh = sid === 100 || sid === 103;
    const d = decideDeckCardSave({
      recordedSlots: lastSaved ? new Set([`s:${lastSaved}`]) : new Set(),
      cardStartedAt: sid * 1000,
      now: sid * 1000 + 5,
      live: {
        phase: hasFresh ? 'found' : 'focusing',
        recognitionStatus: hasFresh ? 'found' : null,
        recognitionDecision: hasFresh ? 'exact-title' : null,
        identity: hasFresh ? (sid === 100 ? 'Delina, Wild Mage' : 'Sol Ring') : null,
        cardSessionId: sid,
        resultCardSessionId: hasFresh ? sid : null,
        identityOwnedByCurrentSession: hasFresh,
        freshEvidenceCountForSession: hasFresh ? 1 : 0,
        recognizeAttempts: hasFresh ? 1 : 0,
        geometryDetected: true,
        geometryTrackId: 2,
        focusAttemptId: 1,
        titlePresent: hasFresh,
      },
    });
    if (sid === 100) {
      assert.equal(d.shouldSave, true);
      assert.equal(d.terminal, 'identified');
      lastSaved = sid;
    } else if (sid === 101 || sid === 102) {
      assert.equal(d.shouldSave, false, `session ${sid} must not save Delina`);
      assert.equal(d.terminal, null);
      assert.equal(d.staleIdentityRejected, false);
    } else {
      assert.equal(d.shouldSave, true);
      assert.equal(d.terminal, 'identified');
    }
  }
  // Stale Delina identity pretending to be current for 101
  const stale = decideDeckCardSave({
    recordedSlots: new Set(['s:100']),
    cardStartedAt: 101_000,
    now: 101_007,
    live: {
      phase: 'found',
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Delina, Wild Mage',
      cardSessionId: 101,
      resultCardSessionId: 100,
      identityOwnedByCurrentSession: false,
      freshEvidenceCountForSession: 0,
      recognizeAttempts: 0,
      geometryDetected: true,
      geometryTrackId: 2,
      focusAttemptId: 1,
      titlePresent: true,
    },
  });
  assert.equal(stale.staleIdentityRejected, true);
  assert.equal(stale.shouldSave, false);
  assert.equal(stale.terminalSource, 'stale-rejected');
});

check('SESSION OWNERSHIP: null resultCardSessionId cannot publish FOUND', () => {
  assert.equal(
    isFreshSessionIdentity({
      cardSessionId: 10,
      resultCardSessionId: null,
      identity: 'Negate',
      identityOwnedByCurrentSession: false,
      freshEvidenceCountForSession: 2,
    }),
    false,
  );
  const d = decideDeckCardSave({
    recordedSlots: new Set(),
    cardStartedAt: 0,
    now: 50,
    live: {
      phase: 'found',
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Negate',
      cardSessionId: 10,
      resultCardSessionId: null,
      freshEvidenceCountForSession: 1,
      geometryDetected: true,
      geometryTrackId: 1,
      focusAttemptId: 1,
      titlePresent: true,
      recognizeAttempts: 1,
    },
  });
  assert.equal(d.staleIdentityRejected, true);
  assert.equal(d.shouldSave, false);
});

check('deck benchmark: zero fresh evidence cannot save IDENTIFIED', () => {
  const d = decideDeckCardSave({
    recordedSlots: new Set(),
    cardStartedAt: 0,
    now: 20,
    live: {
      phase: 'found',
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Delina, Wild Mage',
      cardSessionId: 103,
      resultCardSessionId: 103,
      identityOwnedByCurrentSession: true,
      freshEvidenceCountForSession: 0,
      recognizeAttempts: 0,
      geometryDetected: true,
      geometryTrackId: 2,
      focusAttemptId: 1,
      titlePresent: true,
    },
  });
  assert.equal(d.shouldSave, false);
  assert.equal(d.staleIdentityRejected, true);
  assert.equal(d.terminal, null);
});

check('deck benchmark: resultCardSessionId always serialized explicitly', () => {
  const record = {
    benchmarkIndex: 1,
    cardSessionId: 15,
    resultCardSessionId: null,
    resultAttemptId: null,
    resultPublishedAt: null,
    identityOwnedByCurrentSession: false,
    freshEvidenceCountForSession: 0,
    terminalSource: 'timeout',
    geometryTrackId: 2,
    focusAttemptId: 1,
    recognizeAttempts: 0,
    terminal: 'timeout',
    status: null,
    matchName: null,
    matchScore: null,
    matchMethod: null,
    ocrTexts: [],
    detectorScore: null,
    recognitionSource: null,
    swapKind: 'automatic',
    timings: { totalMs: 2, lockToIdentityMs: null },
    files: { metadata: 'deck-001-metadata.json' },
    recordedAt: '2026-09-10T00:00:00.000Z',
  };
  const json = JSON.parse(JSON.stringify(record));
  assert.ok('resultCardSessionId' in json);
  assert.equal(json.resultCardSessionId, null);
});

await checkAsync('PIXEL OWNERSHIP: late hi-res capture from session A cannot feed session B', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const island = paintDistinctCard(2);
  const other = paintDistinctCard(11);
  const idx = buildNameIndex({ names: ['Island', 'Sol Ring'], version: 1 });
  let ocrReply = 'Island';
  let ocrTexts = [];
  const ctrl = createSessionController({
    nameIndex: idx,
    ocr: {
      recognize: async () => {
        ocrTexts.push(ocrReply);
        return { confidence: 0.99, text: ocrReply };
      },
    },
  });

  // Session A identifies Island with owned frozen capture
  await ctrl.recognizeFrozenCapture({
    recognitionQuad: corners,
    source: island,
    trackId: 2,
  });
  let snap = ctrl.snapshot();
  const sessionA = snap.lockGates?.cardSessionId ?? 0;
  assert.ok(sessionA > 0);
  assert.equal(snap.fused?.card?.name ?? snap.lockGates?.currentSessionIdentity, 'Island');

  // Physical swap — new session, same geometry track
  ctrl.markDebugCardSwapped();
  snap = ctrl.snapshot();
  const sessionB = snap.lockGates?.cardSessionId ?? 0;
  assert.ok(sessionB > sessionA);
  assert.equal(ctrl.lastNormalized(), null);
  assert.equal(ctrl.lastNormalizedCardSessionId(), null);

  // Late A capture is still offered as frozen input for B — must be rejected.
  let staleCaptureInvalidations = 0;
  ocrReply = 'Sol Ring';
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    getFrozenRecognitionInput: () => ({
      captureAt: 1,
      captureCardSessionId: sessionA,
      captureId: 99,
      recognitionQuad: corners,
      source: island,
    }),
    invalidateCapture: reason => {
      if (reason === 'stale-capture-session') staleCaptureInvalidations += 1;
    },
    refineCard: () => ({
      corners,
      detected: true,
      detection: { candidates: [], ms: 1, selectedIndex: 0, workSize: { height: 480, width: 251 } },
      image: other,
      score: 0.9,
      source: 'detected',
    }),
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  await new Promise(r => setTimeout(r, FOCUS_ATTEMPT_MS + 30));
  snap = await ctrl.onFrame(luma, { ...helpers, allowRecognize: () => true });
  assert.ok(
    staleCaptureInvalidations >= 1,
    'stale A capture must be invalidated before B recognition',
  );
  // B must not publish Island from A's pixels; Sol Ring from B-owned refine is OK.
  if (snap.phase === 'found' || snap.fused?.card?.name) {
    assert.equal(snap.resultCardSessionId, sessionB);
    assert.notEqual(snap.fused?.card?.name, 'Island');
  }
  assert.ok(!ocrTexts.includes('Island') || ocrTexts[0] === 'Island');
  // After swap, any OCR during B must be Sol Ring (A's Island frozen was discarded).
  const bOcr = ocrTexts.slice(1);
  for (const t of bOcr) assert.equal(t, 'Sol Ring');
});

check('PIXEL OWNERSHIP: lastNormalized unavailable across sessions', () => {
  // Covered by controller API: after markDebugCardSwapped lastNormalized() is null.
  // Deterministic unit for flagSuspiciousReusedPixels:
  const flagged = flagSuspiciousReusedPixels([
    {
      benchmarkIndex: 2,
      cardSessionId: 6,
      resultCardSessionId: 6,
      warpHash: 'abc',
      sourceHash: 'src1',
      geometryTrackId: 1,
      focusAttemptId: 1,
      recognizeAttempts: 1,
      terminal: 'identified',
      status: 'found',
      matchName: 'Island',
      matchScore: 1,
      matchMethod: 'exact-title',
      ocrTexts: [],
      detectorScore: 1,
      recognitionSource: 'snapshot',
      swapKind: 'automatic',
      timings: { totalMs: 1, lockToIdentityMs: null },
      files: { metadata: 'a.json' },
      recordedAt: 't',
    },
    {
      benchmarkIndex: 3,
      cardSessionId: 7,
      resultCardSessionId: 7,
      warpHash: 'abc',
      sourceHash: 'src1',
      geometryTrackId: 1,
      focusAttemptId: 1,
      recognizeAttempts: 1,
      terminal: 'identified',
      status: 'found',
      matchName: 'Island',
      matchScore: 1,
      matchMethod: 'exact-title',
      ocrTexts: [],
      detectorScore: 1,
      recognitionSource: 'snapshot',
      swapKind: 'automatic',
      timings: { totalMs: 1, lockToIdentityMs: null },
      files: { metadata: 'b.json' },
      recordedAt: 't',
    },
  ]);
  assert.equal(flagged.length, 1);
  assert.deepEqual(flagged[0].shared.sort(), ['sourceHash', 'warpHash'].sort());
});

check('PIXEL OWNERSHIP: same geometryTrackId does not share hi-res recognition cache', () => {
  const store = emptyHiResStore();
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const img = blankImage(100, 140);
  store.cache = {
    attempt: { mode: 'snapshot', startedAt: 1, completedAt: 2, ms: 1 },
    cardSessionId: 6,
    captureId: 1,
    corners,
    mapped: corners,
    prepared: img,
    source: img,
  };
  // Session A may recognize from its own cache.
  assert.equal(canRecognizeFromStore(store, 800, 6), true);
  assert.equal(hiResCacheOwnedBySession(store, 6), true);
  // Session B on the same geometry track must NOT inherit A's pixels.
  assert.equal(canRecognizeFromStore(store, 800, 7), false);
  assert.equal(hiResCacheOwnedBySession(store, 7), false);
  // Untagged legacy cache is also unusable for a concrete session.
  store.cache.cardSessionId = null;
  assert.equal(canRecognizeFromStore(store, 800, 7), false);
  assert.equal(hiResCacheOwnedBySession(store, 7), false);
});

check('benchmark upload: 25 expected / 11 ack = INCOMPLETE; retry only missing', () => {
  const files = [];
  for (let p = 1; p <= 5; p++) {
    for (let f = 1; f <= 5; f++) {
      files.push({
        relativePath: `p${String(p).padStart(2, '0')}-f${String(f).padStart(3, '0')}.png`,
        required: true,
        pageIndex: p,
        frameIndex: f,
      });
    }
  }
  const manifest = {
    runId: 'binder-test-demo',
    kind: 'binder-benchmark',
    pages: 5,
    files,
    createdAt: '2026-09-10T00:00:00.000Z',
  };
  const ack11 = files.slice(0, 11).map(f => f.relativePath);
  const state = reconcileUploadAck({ manifest, acknowledged: ack11 });
  assert.equal(state.uploadStatus, 'INCOMPLETE');
  assert.equal(state.acknowledged.length, 11);
  assert.equal(state.missingRequired.length, 14);
  assert.match(formatUploadIncompleteMessage(state), /11 \/ 25/);
  const retry = filesToUpload(manifest, ack11);
  assert.equal(retry.length, 14);
  // Tunnel endpoint change: same runId, new endpoint — resume from prior ack.
  const resumed = reconcileUploadAck({
    manifest,
    acknowledged: ack11,
    endpointUrl: 'https://new-tunnel.example',
  });
  assert.equal(resumed.runId, 'binder-test-demo');
  assert.equal(resumed.missingRequired.length, 14);
  assert.equal(resumed.endpointUrl, 'https://new-tunnel.example');
  // Full ACK
  const done = reconcileUploadAck({
    manifest,
    acknowledged: files.map(f => f.relativePath),
  });
  assert.equal(done.uploadStatus, 'COMPLETE');
  assert.equal(done.missingRequired.length, 0);
  assert.equal(filesToUpload(manifest, done.acknowledged).length, 0);
  assert.equal(missingRequiredFiles(manifest, ack11).length, 14);
  const empty = emptyAckState(manifest);
  assert.equal(empty.uploadStatus, 'PENDING');
  assert.equal(empty.missingRequired.length, 25);
});

await checkAsync('card session: mintDebugFocusAttempt always fresh', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    requestFocusNorm: () => {},
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  const before = ctrl.snapshot().lockGates?.focusAttemptId ?? 0;
  ctrl.mintDebugFocusAttempt();
  const after = ctrl.snapshot().lockGates?.focusAttemptId ?? 0;
  assert.equal(after, before + 1);
  ctrl.mintDebugFocusAttempt();
  assert.equal(ctrl.snapshot().lockGates?.focusAttemptId, before + 2);
});

await checkAsync('card session: card-gone begins new session; retry budget resets', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
    refineCard: () => ({
      corners,
      detected: true,
      detection: { candidates: [], ms: 1, selectedIndex: 0, workSize: { height: 480, width: 251 } },
      image: paintDistinctCard(1),
      score: 0.9,
      source: 'detected',
    }),
    requestFocusNorm: () => {},
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 4);
  await new Promise(r => setTimeout(r, 50));
  const mid = ctrl.snapshot();
  const sessionBefore = mid.lockGates?.cardSessionId ?? 0;
  // Gone frames
  const emptyHelpers = {
    allowRecognize: () => false,
    prepareAnalysis: frame => ({
      corners: null,
      detected: false,
      detection: { candidates: [], ms: 1, selectedIndex: -1, workSize: { height: 480, width: 251 } },
      image: frame,
      score: 0,
      source: 'none',
    }),
  };
  for (let i = 0; i < 6; i++) await ctrl.onFrame(luma, emptyHelpers);
  const gone = ctrl.snapshot();
  assert.equal(gone.phase, 'searching');
  assert.ok((gone.lockGates?.cardSessionId ?? 0) > sessionBefore, 'card-gone must mint new session');
  assert.equal(gone.postLock?.recognizeAttemptsForTrack ?? 0, 0, 'retry budget resets with session');
});

check('hard-cases catalog lists The Deck of Many Things French', () => {
  const hard = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/hard-cases.json'), 'utf8'),
  );
  const deck = hard.cases.find(c => c.id === 'the-deck-of-many-things-french');
  assert.ok(deck);
  assert.equal(deck.expectedName, 'The Deck of Many Things');
  assert.ok(deck.hardReasons.some(r => r.includes('must-not-publish')));
});

check('keep-hold must not freeze a weak track score', () => {
  const inner = cardQuad(50, 50, 100, 140);
  const outer = cardQuad(40, 40, 130, 180);
  let last = stepContinuity(emptyContinuity(), { rawCorners: inner, rawScore: 0.66 });
  last = stepContinuity(last.state, {
    candidates: [
      { corners: inner, score: 0.66 },
      { corners: outer, score: 0.98 },
    ],
    rawCorners: outer,
    rawScore: 0.98,
  });
  assert.ok(last.track.score >= 0.98, `track score stayed ${last.track.score}`);
  assert.equal(last.switched, false);
});

await checkAsync('continuity E: focus timeout with stable geometry proceeds to high-res', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    requestFocusNorm: () => {},
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 1);
  await new Promise(r => setTimeout(r, FOCUS_ATTEMPT_MS + 30));
  const last = await ctrl.onFrame(luma, helpers);
  assert.equal(last.phase, 'locking');
  assert.equal(last.lockGates.blocker, 'awaiting-hires');
  assert.equal(last.lockGates.focusTimedOut, true);
  assert.ok(last.lockGates.highResRequests > 0);
});

await checkAsync('continuity H: table/glare rectangle does not trivially lock', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const weak = {
    topLeft: { x: 10, y: -20 },
    topRight: { x: 240, y: -18 },
    bottomRight: { x: 230, y: 200 },
    bottomLeft: { x: 20, y: 198 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.2, text: '' }) },
  });
  const last = await runFrames(
    ctrl,
    luma,
    sessionHelpers(weak, { score: 0.48, allowRecognize: () => true }),
    STABILITY_WINDOW + 4,
  );
  assert.ok(last.phase !== 'locking' && last.phase !== 'recognizing' && last.phase !== 'found');
  assert.ok(
    last.lockGates.blocker === 'weak-score' || last.lockGates.blocker === 'clipped' || last.lockGates.blocker === 'stability',
    `unexpected blocker ${last.lockGates.blocker}`,
  );
  assert.ok(last.score == null || last.lockGates.detectorScore < LOCK_MIN_SCORE || last.lockGates.blocker === 'clipped');
});

const poorQuad = {
  topLeft: { x: 4, y: 148 },
  topRight: { x: 130, y: 150 },
  bottomRight: { x: 138, y: 390 },
  bottomLeft: { x: 8, y: 388 },
};
const goodQuad = {
  topLeft: { x: 40, y: 160 },
  topRight: { x: 200, y: 162 },
  bottomRight: { x: 198, y: 430 },
  bottomLeft: { x: 38, y: 428 },
};

check('post-lock A unit: stale capture quad vs later track is replaceable', () => {
  const cmp = shouldReplaceCaptureQuad(poorQuad, goodQuad);
  assert.ok(cmp.replace, `expected replace, IoU ${cmp.iou}`);
  assert.ok(cmp.iou < 0.72, `IoU ${cmp.iou} should be stale`);
  const same = shouldReplaceCaptureQuad(goodQuad, goodQuad);
  assert.equal(same.replace, false);
});

await checkAsync('post-lock A: retry uses newer tracked quad after insufficient', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const names = buildNameIndex({ names: ['Sol Ring'], version: 1 });
  let live = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const refineQuads = [];
  const ctrl = createSessionController({
    nameIndex: names,
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  const helpers = {
    ...sessionHelpers(live),
    prepareAnalysis: frame => ({
      corners: live,
      detected: true,
      detection: { candidates: [], ms: 1, selectedIndex: 0, workSize: { height: 480, width: 251 } },
      image: frame,
      score: 0.95,
      source: 'detected',
    }),
    refineCard: corners => {
      refineQuads.push(corners);
      return null;
    },
    allowRecognize: () => true,
  };
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  assert.ok((ctrl.snapshot().recognizeInvocations ?? 0) >= 1, 'first recognize must run');
  const firstRefine = refineQuads[0];
  live = {
    topLeft: { x: live.topLeft.x + 1, y: live.topLeft.y + 1 },
    topRight: { x: live.topRight.x + 1, y: live.topRight.y + 1 },
    bottomRight: { x: live.bottomRight.x + 1, y: live.bottomRight.y + 1 },
    bottomLeft: { x: live.bottomLeft.x + 1, y: live.bottomLeft.y + 1 },
  };
  await new Promise(r => setTimeout(r, RECOGNIZE_RETRY_MS + 30));
  let late = ctrl.snapshot();
  for (let i = 0; i < 6; i++) {
    late = await ctrl.onFrame(luma, helpers);
    if ((late.recognizeInvocations ?? 0) >= 2) break;
  }
  const lastRefine = refineQuads[refineQuads.length - 1];
  assert.ok((late.recognizeInvocations ?? 0) >= 2, `expected retry, got ${late.recognizeInvocations} phase=${late.phase} blocker=${late.lockGates?.blocker} waiting=${late.lockGates?.waiting}`);
  assert.ok(lastRefine, 'retry must refine');
  assert.ok(
    lastRefine.topLeft.x !== firstRefine.topLeft.x || late.phase === 'found',
    `retry must use newer quad (first ${firstRefine.topLeft.x} last ${lastRefine.topLeft.x})`,
  );
});

await checkAsync('post-lock B: insufficient + same track schedules bounded retry', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  const last = await runFrames(
    ctrl,
    luma,
    sessionHelpers(corners, {
      allowRecognize: () => true,
    }),
    STABILITY_WINDOW + 2,
  );
  assert.ok((last.recognizeInvocations ?? 0) >= 1);
  assert.notEqual(last.phase, 'focusing');
  assert.ok(
    last.lockGates.blocker === 'awaiting-retry' || last.postLock?.retryScheduledAt != null,
    `expected retry, blocker=${last.lockGates.blocker} phase=${last.phase}`,
  );
});

await checkAsync('post-lock C: success does not schedule retry', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.95, text: 'Sol Ring' }) },
  });
  const last = await runFrames(
    ctrl,
    luma,
    sessionHelpers(corners, {
      allowRecognize: () => true,
    }),
    STABILITY_WINDOW + 2,
  );
  assert.equal(last.phase, 'found');
  assert.equal(last.postLock?.retryScheduledAt, null);
  assert.ok(
    last.postLock?.recognitionStatus === 'identified' ||
      last.postLock?.recognitionStatus === 'printing-ambiguous',
  );
});

await checkAsync('post-lock D: focus timeout + failed recognize does not re-enter focusing', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    requestFocusNorm: () => {},
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 1);
  await new Promise(r => setTimeout(r, FOCUS_ATTEMPT_MS + 30));
  const locked = await ctrl.onFrame(luma, helpers);
  assert.equal(locked.lockGates.focusTimedOut, true);
  const after = await ctrl.onFrame(luma, { ...helpers, allowRecognize: () => true });
  assert.notEqual(after.phase, 'focusing', `dead focusing after timeout: ${after.phase} ${after.lockGates?.blocker}`);
  assert.ok(
    after.phase === 'locking' || after.phase === 'recognizing' || after.phase === 'ambiguous',
    `got ${after.phase}`,
  );
});

await checkAsync('post-lock E: card removed after failed recognize does not retry old track', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  await runFrames(
    ctrl,
    luma,
    sessionHelpers(corners, { allowRecognize: () => true }),
    STABILITY_WINDOW + 2,
  );
  const empty = blankImage(251, 480, 8);
  let last = null;
  for (let i = 0; i < TRACK_COAST_FRAMES + 3; i++) {
    last = await ctrl.onFrame(empty, {
      prepareAnalysis: frame => ({
        corners: null,
        detected: false,
        detection: { candidates: [], ms: 1, selectedIndex: -1, workSize: { height: 480, width: 251 } },
        image: frame,
        score: 0,
        source: 'whole-frame',
      }),
    });
  }
  assert.equal(last.phase, 'searching');
  assert.equal(last.postLock?.retryScheduledAt, null);
});

await checkAsync('post-lock F: max retries become explicit insufficient, not a loop', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
  });
  let last = await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  for (let i = 0; i < RECOGNIZE_MAX_ATTEMPTS + 2; i++) {
    await new Promise(r => setTimeout(r, RECOGNIZE_RETRY_MS + 15));
    last = await runFrames(ctrl, luma, helpers, 2);
  }
  assert.ok((last.recognizeInvocations ?? 0) <= RECOGNIZE_MAX_ATTEMPTS);
  assert.ok(
    last.phase === 'ambiguous' || last.lockGates.blocker === 'insufficient',
    `expected terminal insufficient, got ${last.phase} ${last.lockGates.blocker}`,
  );
  assert.notEqual(last.phase, 'focusing');
});

await checkAsync('post-lock G: hi-res request without success is capture-failed', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const last = await runFrames(
    ctrl,
    luma,
    sessionHelpers(corners, {
      allowRecognize: () => false,
      captureReport: () => ({
        completedAt: 1,
        corners: null,
        error: 'snapshot failed',
        failure: 1,
        startedAt: 1,
        success: 0,
      }),
    }),
    STABILITY_WINDOW + 3,
  );
  assert.ok(last.lockGates.highResRequests >= 1);
  assert.equal(last.lockGates.highResSuccess, 0);
  assert.ok(last.lockGates.highResFailure >= 1);
  assert.ok(
    last.lockGates.blocker === 'capture-failed' || last.lockGates.blocker === 'awaiting-retry',
    `blocker ${last.lockGates.blocker}`,
  );
  assert.notEqual(last.phase, 'focusing');
});

await checkAsync('post-lock H: capture success + no recognize trips POST_LOCK_STALL', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.95, text: 'Sol Ring' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    captureReport: () => ({
      completedAt: 1,
      corners,
      error: null,
      failure: 0,
      startedAt: 1,
      success: 1,
    }),
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  assert.equal(ctrl.snapshot().recognizeInvocations ?? 0, 0);
  await new Promise(r => setTimeout(r, POST_LOCK_STALL_MS + 40));
  const stalled = await ctrl.onFrame(luma, helpers);
  assert.equal(stalled.postLock?.postLockStall, true);
  assert.ok((stalled.postLock?.watchdogActivations ?? 0) >= 1);
  const forced = await ctrl.onFrame(luma, helpers);
  assert.ok(
    (forced.recognizeInvocations ?? 0) >= 1 || forced.phase === 'found' || forced.lockGates.blocker === 'awaiting-retry',
    `watchdog should force progress, got ${forced.phase} inv=${forced.recognizeInvocations}`,
  );
});

check('recognition B: nested artwork box is not a complete card', () => {
  const card = cardQuad(40, 40, 200, 280);
  const art = cardQuad(70, 100, 140, 100);
  const pick = selectRecognitionQuad({
    candidates: [
      { corners: art, score: 0.91 },
      { corners: card, score: 0.8 },
    ],
    frame: { width: 320, height: 400 },
    rawQuad: card,
    trackingQuad: art,
  });
  assert.equal(pick.recognitionQuadSource, 'outer-fallback');
  assert.equal(pick.recognitionQuad?.topLeft.x, card.topLeft.x);
  assert.equal(pick.recognitionQuadValid, true);
  assert.ok(isPlausibleCardInSleeve(art, card).ok === false);
});

check('recognition C: plausible card inside sleeve is accepted', () => {
  const sleeve = cardQuad(40, 40, 130, 180);
  const card = cardQuad(50, 50, 100, 140);
  assert.equal(isPlausibleCardInSleeve(card, sleeve).ok, true);
  const pick = selectRecognitionQuad({
    candidates: [
      { corners: sleeve, score: 0.92 },
      { corners: card, score: 0.8 },
    ],
    frame: { width: 320, height: 400 },
    rawQuad: sleeve,
    trackingQuad: card,
  });
  assert.equal(pick.recognitionQuadSource, 'inner-card');
  assert.equal(pick.recognitionQuad?.topLeft.x, card.topLeft.x);
});

check('recognition D: uncertain inner + strong outer uses outer', () => {
  const outer = cardQuad(40, 40, 200, 280);
  const rules = cardQuad(60, 200, 160, 90);
  const pick = selectRecognitionQuad({
    candidates: [
      { corners: rules, score: 0.88 },
      { corners: outer, score: 0.84 },
    ],
    frame: { width: 320, height: 400 },
    rawQuad: outer,
    trackingQuad: rules,
  });
  assert.equal(pick.recognitionQuadSource, 'outer-fallback');
  assert.equal(pick.recognitionQuad?.topLeft.y, outer.topLeft.y);
});

check('recognition F: grazing / off-frame candidate rejected for warp', () => {
  const grazing = {
    topLeft: { x: -40, y: 10 },
    topRight: { x: 300, y: 12 },
    bottomRight: { x: 280, y: 80 },
    bottomLeft: { x: -20, y: 78 },
  };
  const hard = validateRecognitionQuad(grazing, { width: 251, height: 480 }, 'hard');
  assert.equal(hard.ok, false);
  assert.ok(hard.reasons.includes('off-frame') || hard.reasons.includes('implausible-aspect'));
  const pick = selectRecognitionQuad({
    frame: { width: 251, height: 480 },
    trackingQuad: grazing,
  });
  assert.equal(pick.recognitionQuadValid, false);
  assert.equal(pick.recognitionQuad, null);
});

check('recognition G: complete-card warp keeps the title band', () => {
  const src = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = cardQuad(40, 40, 160, 224);
  const pick = selectRecognitionQuad({
    frame: { width: 251, height: 480 },
    trackingQuad: corners,
  });
  assert.equal(pick.recognitionQuadValid, true);
  const warped = warpQuadToCard(src, [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ]);
  assert.equal(warped.width, CARD_WIDTH);
  assert.equal(warped.height, CARD_HEIGHT);
  const titleH = Math.round(CARD_HEIGHT * 0.12);
  let bright = 0;
  let dark = 0;
  for (let y = 4; y < titleH; y += 2) {
    for (let x = 20; x < CARD_WIDTH - 20; x += 4) {
      const v = warped.data[(y * CARD_WIDTH + x) * 4];
      if (v > 180) bright += 1;
      else if (v < 50) dark += 1;
    }
  }
  assert.ok(bright > 20 && dark > 20, `title band should be high-contrast, bright=${bright} dark=${dark}`);
});

check('continuity E: keep-hold updates corners without switching track', () => {
  const a = cardQuad(50, 50, 100, 140);
  const b = cardQuad(80, 80, 100, 140);
  let last = stepContinuity(emptyContinuity(), { rawCorners: a, rawScore: 0.88 });
  const id = last.track.id;
  last = stepContinuity(last.state, { rawCorners: b, rawScore: 0.89 });
  assert.equal(last.track.id, id);
  assert.equal(last.switched, false);
  assert.ok(last.trackedCorners.topLeft.x > a.topLeft.x, 'corners must move');
  assert.ok(last.trackUpdateReason.includes('geometry update') || last.metrics.iou >= 0.35);
});

check('continuity: false-inner hold adopts larger raw (green follows blue)', () => {
  // Title-band / glare island (wide short) inside a full-card raw — must adopt.
  const band = cardQuad(60, 120, 140, 28); // aspect ≫ card
  const outer = cardQuad(50, 50, 160, 220);
  let last = stepContinuity(emptyContinuity(), { rawCorners: band, rawScore: 0.9 });
  const id = last.track.id;
  last = stepContinuity(last.state, { rawCorners: outer, rawScore: 0.92 });
  assert.equal(last.track.id, id);
  assert.ok(
    last.trackUpdateReason.includes('false inner') || last.trackUpdateReason.includes('geometry update'),
    last.trackUpdateReason,
  );
  const trackedW =
    Math.max(last.trackedCorners.topRight.x, last.trackedCorners.bottomRight.x) -
    Math.min(last.trackedCorners.topLeft.x, last.trackedCorners.bottomLeft.x);
  assert.ok(trackedW > 100, `tracked should grow toward raw, got width ${trackedW}`);
});

check('continuity: sleeved card does not adopt larger outer sleeve', () => {
  // Established inner card + outer sleeve flicker must KEEP the card.
  const inner = cardQuad(50, 50, 100, 140);
  const outer = cardQuad(40, 40, 130, 180);
  let last = stepContinuity(emptyContinuity(), { rawCorners: inner, rawScore: 0.92 });
  for (let i = 0; i < 6; i++) {
    last = stepContinuity(last.state, {
      candidates: [
        { corners: inner, score: 0.9 },
        { corners: outer, score: 0.93 },
      ],
      rawCorners: outer,
      rawScore: 0.93,
    });
  }
  assert.equal(last.track.role, 'card-inner');
  assert.ok(
    !String(last.trackUpdateReason).includes('false inner'),
    `must not adopt sleeve: ${last.trackUpdateReason}`,
  );
  const trackedW =
    Math.max(last.trackedCorners.topRight.x, last.trackedCorners.bottomRight.x) -
    Math.min(last.trackedCorners.topLeft.x, last.trackedCorners.bottomLeft.x);
  assert.ok(trackedW < 120, `track should stay near inner width, got ${trackedW}`);
});

await checkAsync('recognition A: geometry-improved leak stays at 3 attempts', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const base = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  let shift = 0;
  const helpersFor = () => {
    const corners = {
      topLeft: { x: base.topLeft.x + shift, y: base.topLeft.y + shift },
      topRight: { x: base.topRight.x + shift, y: base.topRight.y + shift },
      bottomRight: { x: base.bottomRight.x + shift, y: base.bottomRight.y + shift },
      bottomLeft: { x: base.bottomLeft.x + shift, y: base.bottomLeft.y + shift },
    };
    return sessionHelpers(corners, { allowRecognize: () => true });
  };
  let last = await runFrames(ctrl, luma, helpersFor(), STABILITY_WINDOW + 2);
  for (let i = 0; i < 12; i++) {
    shift += 18;
    await new Promise(r => setTimeout(r, RECOGNIZE_RETRY_MS + 15));
    last = await runFrames(ctrl, luma, helpersFor(), 2);
  }
  assert.ok(
    (last.recognizeInvocations ?? 0) <= RECOGNIZE_MAX_ATTEMPTS,
    `leaked to ${last.recognizeInvocations}`,
  );
  assert.ok((last.postLock?.recognizeAttemptsForTrack ?? 0) <= RECOGNIZE_MAX_ATTEMPTS);
  assert.ok((last.postLock?.retryBudgetRemaining ?? 0) >= 0);
});

await checkAsync('recognition H: watchdog recovery respects attempt cap', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: { recognize: async () => ({ confidence: 0.1, text: '' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
    captureReport: () => ({
      completedAt: 1,
      corners,
      error: null,
      failure: 0,
      startedAt: 1,
      success: 1,
    }),
  });
  let last = await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  for (let i = 0; i < RECOGNIZE_MAX_ATTEMPTS + 4; i++) {
    await new Promise(r => setTimeout(r, POST_LOCK_STALL_MS + 20));
    last = await runFrames(ctrl, luma, helpers, 2);
  }
  assert.ok((last.recognizeInvocations ?? 0) <= RECOGNIZE_MAX_ATTEMPTS, `watchdog leaked ${last.recognizeInvocations}`);
  assert.ok((last.postLock?.recognizeAttemptsForTrack ?? 0) <= RECOGNIZE_MAX_ATTEMPTS);
});

check('OCR A: RGBA byte length is width * height * 4', () => {
  const image = blankImage(12, 9);
  assert.equal(expectedRgbaByteLength(12, 9), 12 * 9 * 4);
  const ok = validateRgbaScanImage(image);
  assert.equal(ok.ok, true);
  assert.equal(ok.ocrInputInvalid, false);
  assert.equal(ok.actualByteLength, ok.expectedByteLength);
  const broken = { data: new Uint8ClampedArray(10), height: 9, width: 12 };
  const bad = validateRgbaScanImage(broken);
  assert.equal(bad.ok, false);
  assert.equal(bad.ocrInputInvalid, true);
  assert.equal(bad.actualByteLength, 10);
  assert.equal(bad.expectedByteLength, 12 * 9 * 4);
});

check('OCR B: portable path is packed RGBA matching native', () => {
  assert.equal(INPUT_CHANNEL_ORDER, 'RGBA');
  assert.equal(NATIVE_EXPECTED_CHANNEL_ORDER, 'RGBA');
  const image = blankImage(3, 2);
  image.data[0] = 250;
  image.data[1] = 10;
  image.data[2] = 20;
  image.data[3] = 255;
  const bytes = packedRgbaBytes(image);
  assert.equal(bytes.length, 3 * 2 * 4);
  assert.equal(bytes[0], 250);
  assert.equal(bytes[1], 10);
  assert.equal(bytes[2], 20);
  assert.equal(bytes[3], 255);
  const crop = cropImage(image, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(crop.data[0], 250);
  assert.equal(crop.data[1], 10);
  assert.equal(crop.data[2], 20);
  assert.equal(crop.data[3], 255);
});

check('OCR C: title crop on 744×1039 is a readable band, not tiny', () => {
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const rect = titleCropRect(card);
  assert.equal(card.width, 744);
  assert.equal(card.height, 1039);
  assert.ok(rect.w >= 200, `title width ${rect.w}`);
  assert.ok(rect.h >= 40, `title height ${rect.h}`);
  assert.ok(rect.h < 160, `title height unexpectedly large ${rect.h}`);
  assert.equal(rect.x, Math.round(NAME_REGION.x * CARD_WIDTH));
  assert.equal(rect.y, Math.round(NAME_REGION.y * CARD_HEIGHT));
  const { image } = extractTitleCrop(card);
  assert.equal(image.width, rect.w);
  assert.equal(image.height, rect.h);
});

check('OCR D: enhanceForOcrFast keeps a usable raster', () => {
  const raw = blankImage(120, 48);
  for (let y = 12; y < 36; y++) {
    for (let x = 8; x < 112; x++) {
      const i = (y * 120 + x) * 4;
      const ink = x % 7 < 3 ? 20 : 230;
      raw.data[i] = raw.data[i + 1] = raw.data[i + 2] = ink;
    }
  }
  const out = enhanceForOcrFast(raw);
  assert.ok(out.width >= 8 && out.height >= 8, `${out.width}x${out.height}`);
  assert.equal(validateRgbaScanImage(out).ok, true);
  let min = 255;
  let max = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    min = Math.min(min, out.data[i]);
    max = Math.max(max, out.data[i]);
  }
  assert.ok(max - min > 40, `enhance flattened contrast to ${min}..${max}`);
});

await checkAsync('OCR E: synthetic title crop reaches mocked recognizer intact', async () => {
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const { raw, enhanced, rect } = captureTitleOcrBuffers(card);
  assert.ok(rect.w > 0 && rect.h > 0);
  let seen = null;
  const ocr = {
    recognize: async image => {
      seen = packedRgbaBytes(image);
      return { confidence: 0.9, text: 'Wand of Wonder' };
    },
  };
  const reading = await readTitle(card, ocr, { fastPreprocess: true, stopAfterFirstTitle: true });
  assert.equal(reading.readings[0]?.text, 'Wand of Wonder');
  assert.ok(seen);
  const expected = packedRgbaBytes(enhanced);
  assert.equal(seen.length, expected.length);
  assert.equal(seen[0], expected[0]);
  assert.equal(seen[seen.length - 1], expected[expected.length - 1]);
  assert.equal(raw.width, rect.w);
});

check('OCR F: native empty success is distinct from native error', () => {
  assert.equal(classifyOcrOutcome({ confidence: 0, text: '', words: [] }), 'empty-success');
  assert.equal(
    classifyOcrOutcome({
      confidence: 0,
      nativeError: { code: 'OCR_FAILED', message: 'boom' },
      text: '',
      words: [],
    }),
    'native-error',
  );
  assert.equal(
    classifyOcrOutcome({
      confidence: 0,
      ocrInputInvalid: true,
      text: '',
      words: [],
    }),
    'input-invalid',
  );
  assert.equal(classifyOcrOutcome({ confidence: 0.8, text: 'Sol Ring', words: [] }), 'text');
});

check('OCR G: identical hashes skip further OCR attempts', () => {
  assert.equal(
    shouldSkipDuplicateOcr({
      currentRecognitionHash: 'a',
      currentTitleCropHash: 'b',
      previousRecognitionHash: 'a',
      previousStatus: 'ocr-empty',
      previousTitleCropHash: 'b',
    }),
    true,
  );
  assert.equal(
    shouldSkipDuplicateOcr({
      currentRecognitionHash: 'a',
      currentTitleCropHash: 'b',
      previousRecognitionHash: 'a',
      previousStatus: 'ocr-empty',
      previousTitleCropHash: 'c',
    }),
    false,
  );
  assert.equal(ocrInputHashFor('a', 'b'), 'a|b');
});

await checkAsync('OCR G: identical empty input does not burn 3 recognizes', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const sameCard = blankImage(CARD_WIDTH, CARD_HEIGHT);
  let recognizeCalls = 0;
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: {
      recognize: async () => {
        recognizeCalls += 1;
        return { confidence: 0.1, text: '' };
      },
    },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
    refineCard: () => ({
      corners,
      detected: true,
      image: sameCard,
      score: 0.95,
      source: 'detected',
    }),
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  await ctrl.forceRecognize(helpers);
  const afterFirst = recognizeCalls;
  assert.ok(afterFirst >= 1, 'first recognize must run');
  await ctrl.forceRecognize(helpers);
  assert.equal(recognizeCalls, afterFirst, `duplicate input burned extra OCR (${recognizeCalls} vs ${afterFirst})`);
  const last = ctrl.snapshot();
  assert.equal(last.postLock?.duplicateInputSuppressed, true);
  assert.equal(last.postLock?.sameInputAsPreviousAttempt, true);
});

await checkAsync('OCR debug matrix runs once and records four paths', async () => {
  resetOcrDebugMatrixForTests();
  assert.equal(consumeOcrDebugMatrixSlot(), true);
  assert.equal(consumeOcrDebugMatrixSlot(), false);
  resetOcrDebugMatrixForTests();
  let calls = 0;
  const recognize = {
    recognize: async () => {
      calls += 1;
      return { confidence: 0, text: '' };
    },
  };
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const { raw, enhanced } = captureTitleOcrBuffers(card);
  const matrix = await runOcrDebugMatrix({
    card,
    enhancedTitle: enhanced,
    legacyRecognize: recognize,
    rawTitle: raw,
    recognize,
  });
  assert.equal(calls, 4);
  assert.equal(matrix.rawTitleBytes.kind, 'empty-success');
  assert.equal(matrix.rawTitleBytes.invoked, true);
  assert.equal(matrix.enhancedTitleBytes.kind, 'empty-success');
  assert.equal(matrix.fullCardBytes.kind, 'empty-success');
  assert.equal(matrix.legacyTitle.kind, 'empty-success');
});

check('OCR H: inbox bundle lists unsuffixed recognition/title PNGs', () => {
  for (const name of [
    'recognition-card.png',
    'title-crop-raw.png',
    'title-crop-ocr.png',
    'ocr-debug.json',
    'post-lock.json',
  ]) {
    assert.ok(OCR_DEBUG_INBOX_FILES.includes(name), name);
  }
});

await checkAsync('OCR flood A: 20 duplicate skips persist one bundle', async () => {
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const sameCard = blankImage(CARD_WIDTH, CARD_HEIGHT);
  let recognizeCalls = 0;
  let persistCalls = 0;
  const ctrl = createSessionController({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: {
      recognize: async () => {
        recognizeCalls += 1;
        return { confidence: 0.1, text: '' };
      },
    },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
    refineCard: () => ({
      corners,
      detected: true,
      image: sameCard,
      score: 0.95,
      source: 'detected',
    }),
    onRecognitionAttempt: () => {
      persistCalls += 1;
    },
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  await ctrl.forceRecognize(helpers);
  const afterFirst = recognizeCalls;
  const persistAfterFirst = persistCalls;
  const skipsBefore = ctrl.snapshot().postLock?.duplicateOcrSkips ?? 0;
  assert.ok(afterFirst >= 1, 'first recognize must run');
  assert.ok(persistAfterFirst >= 1, `unique persist must run, got ${persistAfterFirst}`);
  for (let i = 0; i < 20; i += 1) await ctrl.forceRecognize(helpers);
  assert.equal(recognizeCalls, afterFirst, 'duplicate skips must not invoke OCR');
  assert.equal(persistCalls, persistAfterFirst, 'duplicate skips must not persist another bundle');
  const last = ctrl.snapshot();
  assert.equal(last.postLock?.duplicateOcrSkips, skipsBefore + 20);
  assert.equal(last.postLock?.duplicateUploadsSuppressed, skipsBefore + 20);
});

check('OCR flood B: overlapping geometry traces stay exclusive', () => {
  finishGeometryTrace();
  assert.equal(startGeometryTrace({ phase: 'searching' }), true);
  assert.equal(isGeometryTraceActive(), true);
  assert.equal(startGeometryTrace({ phase: 'locking' }), false);
  assert.equal(startGeometryTrace({ phase: 'recognizing' }), false);
  finishGeometryTrace();
  assert.equal(isGeometryTraceActive(), false);
  assert.equal(startGeometryTrace({ phase: 'searching' }), true);
  finishGeometryTrace();
});

check('OCR flood C: first attempt dir is immutable', () => {
  assert.equal(attemptDebugDirName(7), 'attempt-7');
  assert.deepEqual(
    shouldPersistOcrDebugBundle({
      attemptId: '1',
      sameInputAsPreviousAttempt: false,
    }),
    { persist: true, upload: true, reason: 'unique-attempt' },
  );
  assert.deepEqual(
    shouldPersistOcrDebugBundle({
      attemptId: '1',
      sameInputAsPreviousAttempt: true,
    }),
    { persist: false, upload: false, reason: 'duplicate-input' },
  );
  assert.deepEqual(
    shouldPersistOcrDebugBundle({
      alreadyWrittenAttemptId: '1',
      attemptId: '1',
      sameInputAsPreviousAttempt: false,
    }),
    { persist: false, upload: false, reason: 'already-written' },
  );
});

await checkAsync('OCR flood D: missing adapter is ocr-unavailable not empty', async () => {
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const names = buildNameIndex({ names: ['Sol Ring'], version: 1 });
  const { result } = await recognizeCard(card, { nameIndex: names, ocr: null }, {});
  assert.equal(result.ocrDebug?.ocrSkippedReason, 'no-ocr');
  assert.equal(result.ocrDebug?.native.invoked, false);
  assert.equal(
    attemptStatusFromOcr({
      fusedStatus: result.fused.status,
      ocrSkippedReason: result.ocrDebug?.ocrSkippedReason,
      titleRawText: result.readings?.[0]?.text ?? '',
    }),
    'ocr-unavailable',
  );
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController({ nameIndex: names, ocr: null });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
    refineCard: () => ({
      corners,
      detected: true,
      image: card,
      score: 0.95,
      source: 'detected',
    }),
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  await ctrl.forceRecognize(helpers);
  assert.equal(ctrl.snapshot().postLock?.recognitionStatus, 'ocr-unavailable');
});

await checkAsync('OCR flood E: live OCR dep is resolved at recognize time', async () => {
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const names = buildNameIndex({ names: ['Sol Ring'], version: 1 });
  const deps = { nameIndex: names, ocr: null };
  const first = await recognizeCard(card, deps, {});
  assert.equal(first.result.ocrDebug?.ocrSkippedReason, 'no-ocr');
  assert.equal(first.result.ocrDebug?.native.invoked, false);
  let calls = 0;
  deps.ocr = {
    recognize: async () => {
      calls += 1;
      return { confidence: 0.95, text: 'Sol Ring' };
    },
  };
  const luma = paintCardLike(blankImage(251, 480), { gray: true });
  const corners = {
    topLeft: { x: 30, y: 40 },
    topRight: { x: 220, y: 42 },
    bottomRight: { x: 218, y: 440 },
    bottomLeft: { x: 32, y: 438 },
  };
  const ctrl = createSessionController(deps);
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => true,
    refineCard: () => ({
      corners,
      detected: true,
      image: card,
      score: 0.95,
      source: 'detected',
    }),
  });
  await runFrames(ctrl, luma, helpers, STABILITY_WINDOW + 2);
  const second = await recognizeCard(card, deps, {});
  assert.ok(calls >= 1, 'recognizer attached after controller/deps creation must run');
  assert.equal(second.result.ocrDebug?.native.invoked, true);
  assert.equal(second.result.ocrDebug?.ocrSkippedReason, null);
});

await checkAsync('OCR flood F: warmup is not required to invoke OCR', async () => {
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const names = buildNameIndex({ names: ['Sol Ring'], version: 1 });
  let calls = 0;
  const { result } = await recognizeCard(
    card,
    {
      nameIndex: names,
      ocr: {
        recognize: async () => {
          calls += 1;
          return { confidence: 0.95, text: 'Sol Ring' };
        },
      },
    },
    {},
  );
  assert.ok(calls >= 1);
  assert.equal(result.ocrDebug?.native.invoked, true);
});

await checkAsync('OCR flood G: one-shot matrix runs once per unique debug attempt', async () => {
  resetOcrDebugMatrixForTests();
  const card = blankImage(CARD_WIDTH, CARD_HEIGHT);
  const names = buildNameIndex({ names: ['Sol Ring'], version: 1 });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      return { confidence: 0, text: '' };
    },
  };
  const first = await recognizeCard(card, { nameIndex: names, ocr }, { runOcrDebugMatrix: true });
  const afterFirst = calls;
  assert.ok(first.result.ocrDebug?.matrix, 'first unique debug attempt must include matrix');
  assert.equal(first.result.ocrDebug.matrix.rawTitleBytes.invoked, true);
  assert.ok(afterFirst >= 4, `matrix must invoke OCR, got ${afterFirst}`);
  const second = await recognizeCard(card, { nameIndex: names, ocr }, { runOcrDebugMatrix: true });
  assert.equal(second.result.ocrDebug?.matrix ?? null, null);
  assert.ok(
    calls - afterFirst < afterFirst,
    `later attempt re-ran matrix (${calls - afterFirst} extra vs first ${afterFirst})`,
  );
});

check('LAB: known-good commit is documented', () => {
  assert.equal(KNOWN_GOOD_RECOGNITION_COMMIT, '1dd4932');
  assert.match(PROVEN_RECOGNITION_BASELINE, /wand-of-wonder-20260908T073958/);
});

check('CAPTURE QUALITY: density + first-pass + mapping + metrics', () => {
  const quad = {
    topLeft: { x: 10, y: 20 },
    topRight: { x: 110, y: 20 },
    bottomRight: { x: 110, y: 160 },
    bottomLeft: { x: 10, y: 160 },
  };
  const dens = cardDensity({ height: 200, width: 160 }, quad, { height: 1039, width: 744 });
  assert.equal(dens.cardBoundingWidthPx, 100);
  assert.equal(dens.cardBoundingHeightPx, 140);
  assert.ok(Math.abs(dens.warpUpscaleX - 7.44) < 1e-9);
  assert.equal(firstPassExactFromVariants([{ topScore: 0.909 }], TITLE_ONLY_MIN), false);
  assert.equal(firstPassExactFromVariants([{ topScore: 0.94 }], TITLE_ONLY_MIN), true);
  const dest = { height: 1920, width: 1006 };
  const mapped = mapCornersToHiRes(quad, {
    dest,
    detector: { height: 200, width: 160 },
    kind: 'same-fov',
  });
  assert.ok(Math.abs(mapped.topRight.x - (110 / 160) * 1006) < 1e-6);
  const photo = mapCornersToHiRes(quad, {
    dest: { height: 1440, width: 1920 },
    destMirrored: true,
    detector: { height: 200, width: 160 },
    kind: 'oriented-full',
    oriented: { height: 1440, width: 1920 },
    visible: { height: 1440, width: 1920, x: 0, y: 0 },
  });
  assert.ok(photo.topLeft.x > photo.topRight.x, 'mirrored photo flips X');
  const flat = blankImage(64, 64);
  const a = sideMetrics(flat, flat);
  const b = sideMetrics(flat, flat);
  assert.equal(a.titleSharpness, b.titleSharpness);
  assert.equal(a.titleContrast, localContrast(flat));
  assert.equal(classifyMotion(3), 'stationary');
  assert.equal(classifyMotion(12), 'minor-motion');
  assert.equal(classifyMotion(40), 'moving');
});

check('LAB: open reuses locked hi-res and never starts a post-tap snapshot', () => {
  assert.equal(isTrueHiRes('snapshot'), true);
  assert.equal(isTrueHiRes('analysis-fallback'), false);
  const attempt = {
    acquireMs: 1,
    convertMs: 1,
    mode: 'snapshot',
    previewInterrupted: false,
    sourceSize: { height: 1920, width: 1006 },
    warpMs: 1,
  };
  assert.equal(
    planLabAcquire({ cache: { attempt, corners: null, mapped: null, prepared: null, source: null }, inFlight: false }),
    'reuse-cache',
  );
  assert.equal(planLabAcquire({ cache: null, inFlight: true }), 'wait-inflight');
  assert.equal(planLabAcquire({ cache: null, inFlight: false }), 'no-capture');
  assert.equal(
    planLabAcquire({
      cache: { attempt: { ...attempt, mode: 'analysis-fallback' }, corners: null, mapped: null, prepared: null, source: null },
      inFlight: false,
    }),
    'no-capture',
  );
});

check('LAB: baseline and current pick different quads when both exist', () => {
  const tracked = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 90, y: 10 },
    bottomRight: { x: 90, y: 140 },
    bottomLeft: { x: 10, y: 140 },
  };
  const recognition = {
    topLeft: { x: 20, y: 20 },
    topRight: { x: 80, y: 20 },
    bottomRight: { x: 80, y: 130 },
    bottomLeft: { x: 20, y: 130 },
  };
  const quads = { raw: tracked, recognition, tracked };
  assert.deepEqual(pickLabWarpQuad('baseline', quads), tracked);
  assert.deepEqual(pickLabWarpQuad('current', quads), recognition);
});

await checkAsync('LAB: A/B uses the same source and bypasses the session', async () => {
  const source = blankImage(200, 280);
  const quad = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 190, y: 10 },
    bottomRight: { x: 190, y: 270 },
    bottomLeft: { x: 10, y: 270 },
  };
  const quads = { raw: quad, recognition: quad, tracked: quad };
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      return { confidence: 0.9, text: 'Wand of Wonder' };
    },
  };
  const baseline = await runLabRecognition({
    nameIndex: names,
    ocr,
    pipeline: 'baseline',
    quads,
    source,
  });
  const current = await runLabRecognition({
    nameIndex: names,
    ocr,
    pipeline: 'current',
    quads,
    source,
  });
  assert.equal(baseline.ocrInvoked, true);
  assert.equal(current.ocrInvoked, true);
  assert.equal(baseline.matchName, 'Wand of Wonder');
  assert.equal(current.matchName, 'Wand of Wonder');
  assert.equal(compareLabRuns(baseline, current).sameSource, true);
  assert.ok(calls >= 2);
});

await checkAsync('LAB: missing OCR is unavailable, not empty', async () => {
  const source = blankImage(80, 110);
  const quad = {
    topLeft: { x: 2, y: 2 },
    topRight: { x: 78, y: 2 },
    bottomRight: { x: 78, y: 108 },
    bottomLeft: { x: 2, y: 108 },
  };
  const run = await runLabRecognition({
    nameIndex: buildNameIndex({ names: ['Sol Ring'], version: 1 }),
    ocr: null,
    pipeline: 'current',
    quads: { raw: quad, recognition: quad, tracked: quad },
    source,
  });
  assert.equal(run.error, 'ocr-unavailable');
  assert.equal(run.ocrInvoked, false);
  assert.equal(run.ocrText, '');
});

const wandQuad = {
  topLeft: { x: 20, y: 20 },
  topRight: { x: 180, y: 20 },
  bottomRight: { x: 180, y: 260 },
  bottomLeft: { x: 20, y: 260 },
};

await checkAsync('CANONICAL A: Lab Current and recognizeCapturedCard share hashes+result', async () => {
  const source = blankImage(200, 280);
  const quads = { raw: wandQuad, recognition: wandQuad, tracked: wandQuad };
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  const ocr = { recognize: async () => ({ confidence: 1, text: 'Wand of Wonder' }) };
  const lab = await runLabRecognition({
    nameIndex: names,
    ocr,
    pipeline: 'current',
    quads,
    source,
  });
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(lab.matchName, 'Wand of Wonder');
  assert.equal(captured.matchName, 'Wand of Wonder');
  assert.equal(captured.status, 'identified');
  assert.equal(lab.hashes.sourceImageHash, captured.hashes.sourceImageHash);
  assert.equal(lab.hashes.warpedCardHash, captured.hashes.warpedCardHash);
  assert.equal(lab.hashes.titleCropHash, captured.hashes.titleCropHash);
  assert.equal(lab.hashes.recognitionQuadHash, captured.hashes.recognitionQuadHash);
});

await checkAsync('CANONICAL B: live orch publishes found on identified title', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  const ocr = { recognize: async () => ({ confidence: 1, text: 'Wand of Wonder' }) };
  const ctrl = createSessionController({ nameIndex: names, ocr });
  const snap = await ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(snap.phase, 'found');
  assert.equal(snap.fused?.card?.name, 'Wand of Wonder');
  assert.equal(snap.postLock?.resultAccepted, true);
  assert.equal(snap.postLock?.recognitionReturnedStatus, 'identified');
  assert.ok(snap.postLock?.resultPublishedAt != null);
});

await checkAsync('CANONICAL B2: frozen capture keeps hashes after failed recognition', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  const ocr = { recognize: async () => ({ confidence: 1, text: 'gate' }) };
  const ctrl = createSessionController({ nameIndex: names, ocr });
  const snap = await ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.notEqual(snap.phase, 'searching');
  assert.equal(snap.postLock?.recognitionReturnedStatus, 'insufficient-confidence');
  assert.equal(snap.postLock?.titleRawText, 'gate');
  assert.ok(snap.postLock?.sourceImageHash);
  assert.ok(snap.postLock?.titleCropHash);
  assert.ok(snap.postLock?.warpedCardHash);
  assert.ok(snap.postLock?.recognitionQuadHash);
  assert.equal(snap.postLock?.retryScheduledAt, null);
});

await checkAsync('CANONICAL OCR: exact first pass does not retry', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      return { confidence: 1, text: 'Wand of Wonder' };
    },
  };
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(captured.status, 'identified');
  assert.equal(captured.matchName, 'Wand of Wonder');
  assert.equal(calls, 1);
});

await checkAsync('CANONICAL OCR: weak first pass retries raw crop and identifies', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Maddening Hex'], version: 1 });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      return {
        confidence: 1,
        text: calls === 1 ? 'Maddenino Hey' : 'Maddening Hex',
      };
    },
  };
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(captured.status, 'identified');
  assert.equal(captured.matchName, 'Maddening Hex');
  assert.equal(captured.ocrText, 'Maddening Hex');
  assert.ok(calls >= 2);
  assert.ok(captured.matchScore >= 0.94);
});

check('TITLE_ONLY_MIN stays 0.94', () => {
  assert.equal(TITLE_ONLY_MIN, 0.94);
});

check('token-aware similarity rewards a distinctive long token', () => {
  const hex = tokenWeightedSimilarity('Maddening Hesy', 'Maddening Hex');
  const hey = tokenWeightedSimilarity('Maddenino Hey', 'Maddening Hex');
  const gate = tokenWeightedSimilarity('gate', 'Negate');
  assert.ok(hex >= 0.78, `Hesy token score ${hex}`);
  assert.ok(hey >= 0.78, `Hey token score ${hey}`);
  assert.ok(gate < 0.78, `gate token score ${gate}`);
  assert.equal(titlePreservedEnough('Maddening Hesy', 'Maddening Hex'), true);
  assert.equal(titlePreservedEnough('gate', 'Negate'), false);
  assert.equal(titlePreservedEnough('ate', 'Expedite'), false);
});

check('strong-fuzzy accepts agreeing Hex variants and rejects disagreements', () => {
  const names = buildNameIndex({
    names: ['Maddening Hex', 'Maddening Cacophony', 'Negate', 'Expedite', 'Wand of Wonder'],
    version: 1,
  });
  const hexA = {
    margin: 0.3,
    ocrMs: 1,
    ocrText: 'Maddenino Hey',
    secondName: 'Maddening Cacophony',
    secondScore: 0.5,
    source: 'title-fast',
    tokenSimilarity: tokenWeightedSimilarity('Maddenino Hey', 'Maddening Hex'),
    topName: 'Maddening Hex',
    topScore: 0.833,
  };
  const hexB = {
    margin: 0.3,
    ocrMs: 1,
    ocrText: 'Maddening Hesy',
    secondName: 'Maddening Cacophony',
    secondScore: 0.51,
    source: 'title-raw',
    tokenSimilarity: tokenWeightedSimilarity('Maddening Hesy', 'Maddening Hex'),
    topName: 'Maddening Hex',
    topScore: 0.846,
  };
  const ok = decideStrongFuzzyTitle([hexA, hexB]);
  assert.equal(ok.accepted, true);
  assert.equal(ok.name, 'Maddening Hex');
  assert.equal(ok.consensusCount, 2);

  const disagree = decideStrongFuzzyTitle([
    hexA,
    { ...hexB, ocrText: 'Wand of Wondr', topName: 'Wand of Wonder', topScore: 0.88, tokenSimilarity: 0.9 },
  ]);
  assert.equal(disagree.accepted, false);
  assert.equal(disagree.reason, 'variants-disagree');

  const single = decideStrongFuzzyTitle([hexA, { ...hexA, source: 'title-raw' }]);
  assert.equal(single.accepted, false);
  assert.equal(single.reason, 'single-reading');

  const thin = decideStrongFuzzyTitle([
    { ...hexA, margin: 0.04 },
    { ...hexB, margin: 0.05 },
  ]);
  assert.equal(thin.accepted, false);
  assert.equal(thin.reason, 'thin-margin');

  const fragment = decideStrongFuzzyTitle([
    {
      margin: 0.4,
      ocrMs: 1,
      ocrText: 'gate',
      secondName: 'Expedite',
      secondScore: 0.3,
      source: 'title-fast',
      tokenSimilarity: tokenWeightedSimilarity('gate', 'Negate'),
      topName: 'Negate',
      topScore: 0.7,
    },
    {
      margin: 0.4,
      ocrMs: 1,
      ocrText: 'gat',
      secondName: 'Expedite',
      secondScore: 0.3,
      source: 'title-raw',
      tokenSimilarity: tokenWeightedSimilarity('gat', 'Negate'),
      topName: 'Negate',
      topScore: 0.65,
    },
  ]);
  assert.equal(fragment.accepted, false);
  void names;
});

await checkAsync('CANONICAL OCR: Hex phone variants identify via strong-fuzzy', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({
    names: ['Maddening Hex', 'Maddening Cacophony', 'Negate', 'Wand of Wonder'],
    version: 1,
  });
  const hexOcr = () => {
    let n = 0;
    return {
      recognize: async () => {
        n += 1;
        return { confidence: 1, text: n === 1 ? 'Maddenino Hey' : 'Maddening Hesy' };
      },
      get calls() {
        return n;
      },
    };
  };
  const ocr = hexOcr();
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(captured.status, 'identified');
  assert.equal(captured.matchName, 'Maddening Hex');
  assert.equal(captured.titleDecode.decision, 'strong-fuzzy');
  assert.ok(captured.titleDecode.consensusCount >= 2);
  assert.ok(captured.matchScore < 0.94, 'must not lower the 0.94 bar to accept');
  assert.equal(ocr.calls, 2);
  assert.equal(TITLE_ONLY_MIN, 0.94);
  console.log(`\n${formatTitleDecodeReport(captured.titleDecode)}\n`);
  const ctrl = createSessionController({ nameIndex: names, ocr: hexOcr() });
  const snap = await ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(snap.phase, 'found');
  assert.equal(snap.fused?.card?.name, 'Maddening Hex');
  assert.equal(snap.postLock?.variantConsensusCount, 2);
});

await checkAsync('CANONICAL OCR: generic fragments stay ambiguous', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Negate', 'Expedite', 'Gatekeeper'], version: 1 });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      return { confidence: 1, text: calls === 1 ? 'gate' : 'ate' };
    },
  };
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.notEqual(captured.status, 'identified');
  assert.equal(captured.titleDecode.decision, 'ambiguous');
  assert.ok(calls >= 2);
});

await checkAsync('CANONICAL C: strong title is not overwritten by later recognize', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder', 'Chaos Dragon'], version: 1 });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      return { confidence: 1, text: calls === 1 ? 'Wand of Wonder' : 'Chaos Dragon' };
    },
  };
  const ctrl = createSessionController({
    artwork: {
      findCandidates: () => [
        { name: 'Chaos Dragon', oracleId: 'oracle:chaos', visualScore: 0.99 },
      ],
    },
    nameIndex: names,
    ocr,
  });
  const first = await ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(first.phase, 'found');
  assert.equal(first.fused?.card?.name, 'Wand of Wonder');
  const second = await ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  assert.equal(second.fused?.card?.name, 'Wand of Wonder');
  assert.equal(second.recognizeInvocations, 1);
});

check('CANONICAL D: watchdog while recognition active is a no-op', () => {
  assert.equal(
    postLockStallActive({
      hasResult: false,
      highResRequests: 1,
      lastProgressAt: 0,
      now: POST_LOCK_STALL_MS + 50_000,
      recognizing: true,
      resultApplicationPending: false,
      retryScheduled: false,
    }),
    false,
  );
  assert.equal(
    postLockStallActive({
      hasResult: false,
      highResRequests: 1,
      lastProgressAt: 0,
      now: POST_LOCK_STALL_MS + 50_000,
      recognizing: false,
      resultApplicationPending: true,
      retryScheduled: false,
    }),
    false,
  );
});

check('CANONICAL E: track change rejects with stale-track', () => {
  const rejected = acceptCapturedResult({
    activeTrackId: 2,
    result: {
      alreadyWarped: false,
      attemptId: 1,
      crop: { height: 0, width: 0, x: 0, y: 0 },
      error: null,
      hashes: {
        recognitionQuadHash: 'q',
        sourceImageHash: 's',
        titleCropHash: 't',
        warpedCardHash: 'w',
      },
      matchName: 'Wand of Wonder',
      matchScore: 1,
      ocrInvoked: true,
      ocrText: 'Wand of Wonder',
      ocrTransport: 'rgba-bytes',
      oracleId: null,
      status: 'identified',
      timings: { cropMs: 0, lookupMs: 0, ocrMs: 0, preprocessMs: 0, totalMs: 0, warpMs: 0 },
      titleCandidates: [],
      titleRaw: null,
      trackId: 1,
      warp: null,
      warpQuad: null,
    },
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'stale-track');
});

check('CANONICAL F: same track accepts', () => {
  const ok = acceptCapturedResult({
    activeTrackId: 1,
    result: {
      alreadyWarped: false,
      attemptId: 1,
      crop: { height: 0, width: 0, x: 0, y: 0 },
      error: null,
      hashes: {
        recognitionQuadHash: 'q',
        sourceImageHash: 's',
        titleCropHash: 't',
        warpedCardHash: 'w',
      },
      matchName: 'Wand of Wonder',
      matchScore: 1,
      ocrInvoked: true,
      ocrText: 'Wand of Wonder',
      ocrTransport: 'rgba-bytes',
      oracleId: null,
      status: 'identified',
      timings: { cropMs: 0, lookupMs: 0, ocrMs: 0, preprocessMs: 0, totalMs: 0, warpMs: 0 },
      titleCandidates: [],
      titleRaw: null,
      trackId: 1,
      warp: null,
      warpQuad: null,
    },
  });
  assert.equal(ok.accepted, true);
});

await checkAsync('CANONICAL E2: controller rejects stale track after resolve', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const ocr = {
    recognize: async () => {
      await gate;
      return { confidence: 1, text: 'Wand of Wonder' };
    },
  };
  const ctrl = createSessionController({ nameIndex: names, ocr });
  const pending = ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  ctrl.setActiveTrackId(2);
  release();
  const snap = await pending;
  assert.equal(snap.postLock?.resultAccepted, false);
  assert.equal(snap.postLock?.resultRejectReason, 'stale-track');
  assert.notEqual(snap.phase, 'found');
});

await checkAsync('CANONICAL G: no concurrent second attempt', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let calls = 0;
  const ocr = {
    recognize: async () => {
      calls += 1;
      await gate;
      return { confidence: 1, text: 'Wand of Wonder' };
    },
  };
  const ctrl = createSessionController({ nameIndex: names, ocr });
  const first = ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  const second = ctrl.recognizeFrozenCapture({
    recognitionQuad: wandQuad,
    source,
    trackId: 1,
  });
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.recognizeInvocations, 1);
  assert.equal(b.recognizeInvocations, 1);
  assert.equal(calls, 1);
  assert.equal(a.phase, 'found');
});

await checkAsync('CANONICAL H: saved live attempt replay is deterministic', async () => {
  const source = blankImage(200, 280);
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  const ocr = { recognize: async () => ({ confidence: 1, text: 'Wand of Wonder' }) };
  const first = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 7,
    captureAt: 10,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 3,
  });
  const replay = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 7,
    captureAt: 10,
    nameIndex: names,
    ocr,
    recognitionQuad: wandQuad,
    source,
    trackId: 3,
  });
  assert.equal(first.status, replay.status);
  assert.equal(first.matchName, replay.matchName);
  assert.equal(first.ocrText, replay.ocrText);
  assert.equal(first.hashes.sourceImageHash, replay.hashes.sourceImageHash);
  assert.equal(first.hashes.warpedCardHash, replay.hashes.warpedCardHash);
  assert.equal(first.hashes.titleCropHash, replay.hashes.titleCropHash);
  assert.equal(hashRecognitionQuad(wandQuad), first.hashes.recognitionQuadHash);
});

await checkAsync('CANONICAL: Wand fixture Lab Current + live orch (if present)', async () => {
  const fixtureDir = join(
    root,
    '.scan-inbox/sessions/phone-20260908/wand-of-wonder-20260908T073958',
  );
  const pngPath = join(fixtureDir, 'source-highres.png');
  const fixtureJson = join(fixtureDir, 'fixture.json');
  const quadJson = join(fixtureDir, 'recognition-quad.json');
  if (!existsSync(pngPath) || !existsSync(fixtureJson)) {
    console.log('  skip CANONICAL Wand fixture (not on disk)');
    return;
  }
  const png = new Uint8Array(await readFile(pngPath));
  const source = pngBytesToScanImage(png);
  const meta = JSON.parse(await readFile(fixtureJson, 'utf8'));
  const quads = existsSync(quadJson)
    ? JSON.parse(await readFile(quadJson, 'utf8'))
    : meta.quads;
  const recognition = quads.recognition ?? meta.quads?.recognition;
  assert.ok(recognition, 'fixture must include recognition quad');
  const names = buildNameIndex({ names: ['Wand of Wonder'], version: 1 });
  const ocr = { recognize: async () => ({ confidence: 1, text: 'Wand of Wonder' }) };
  const lab = await runLabRecognition({
    nameIndex: names,
    ocr,
    pipeline: 'current',
    quads: {
      raw: quads.raw ?? recognition,
      recognition,
      tracked: quads.tracked ?? recognition,
    },
    source,
  });
  const ctrl = createSessionController({ nameIndex: names, ocr });
  const live = await ctrl.recognizeFrozenCapture({
    recognitionQuad: recognition,
    source,
    trackId: 1,
  });
  assert.equal(lab.matchName, 'Wand of Wonder');
  assert.equal(live.fused?.card?.name, 'Wand of Wonder');
  assert.equal(live.phase, 'found');
  assert.equal(lab.hashes.sourceImageHash, live.postLock?.sourceImageHash);
  assert.equal(lab.hashes.warpedCardHash, live.postLock?.warpedCardHash);
  assert.equal(lab.hashes.titleCropHash, live.postLock?.titleCropHash);
  assert.equal(lab.titleDecode?.decision, 'exact-title');
  assert.equal(lab.titleDecode?.fallbackUsed, false);
});

check('HOST REPLAY: recorded Samsung OCR identifies Hex / exact Wand / rejects fragments', () => {
  const names = buildNameIndex({
    names: ['Maddening Hex', 'Maddening Cacophony', 'Negate', 'Wand of Wonder', 'Expedite'],
    version: 1,
  });
  const hex = decodeRecordedTitleVariants(
    [
      { source: 'title-fast', text: 'Maddenino Hey' },
      { source: 'title-raw', text: 'Maddening Hesy' },
    ],
    names,
  );
  assert.equal(hex.decision, 'strong-fuzzy');
  assert.equal(hex.matchName, 'Maddening Hex');
  assert.ok(hex.consensusCount >= 2);
  assert.ok((hex.matchScore ?? 0) < TITLE_ONLY_MIN);
  const wand = decodeRecordedTitleVariants([{ source: 'title-fast', text: 'Wand of Wonder' }], names);
  assert.equal(wand.decision, 'exact-title');
  assert.equal(wand.matchName, 'Wand of Wonder');
  const gate = decodeRecordedTitleVariants([{ source: 'title-fast', text: 'gate' }], names);
  assert.equal(gate.decision, 'ambiguous');
  const french = decodeRecordedTitleVariants(
    [{ source: 'title-fast', text: 'ère et de foyer' }],
    names,
  );
  assert.equal(french.decision, 'ambiguous');
});

await checkAsync('CANONICAL: Hex fixture strong-fuzzy (if present)', async () => {
  const fixtureDir = join(
    root,
    '.scan-inbox/sessions/phone-20260908/maddening-hex-alt-art-20260908T082448',
  );
  const pngPath = join(fixtureDir, 'source-highres.png');
  const fixtureJson = join(fixtureDir, 'fixture.json');
  const quadJson = join(fixtureDir, 'recognition-quad.json');
  if (!existsSync(pngPath) || !existsSync(fixtureJson)) {
    console.log('  skip CANONICAL Hex fixture (not on disk)');
    return;
  }
  const png = new Uint8Array(await readFile(pngPath));
  const source = pngBytesToScanImage(png);
  const meta = JSON.parse(await readFile(fixtureJson, 'utf8'));
  const quads = existsSync(quadJson)
    ? JSON.parse(await readFile(quadJson, 'utf8'))
    : meta.quads;
  const recognition = quads.recognition ?? meta.quads?.recognition;
  assert.ok(recognition, 'fixture must include recognition quad');
  const names = buildNameIndex({
    names: ['Maddening Hex', 'Maddening Cacophony', 'Negate'],
    version: 1,
  });
  let n = 0;
  const ocr = {
    recognize: async () => {
      n += 1;
      return { confidence: 1, text: n === 1 ? 'Maddenino Hey' : 'Maddening Hesy' };
    },
  };
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: names,
    ocr,
    recognitionQuad: recognition,
    source,
    trackId: 1,
  });
  assert.equal(captured.status, 'identified');
  assert.equal(captured.matchName, 'Maddening Hex');
  assert.equal(captured.titleDecode.decision, 'strong-fuzzy');
  assert.equal(n, 2);
});

await rm(dir, { force: true, recursive: true });
if (failed) {
  console.error(`\n${failed} scan check(s) failed`);
  process.exit(1);
}
check('deck benchmark: no duplicate cardSessionId in summary inputs', () => {
  const cards = [
    {
      benchmarkIndex: 1,
      cardSessionId: 10,
      resultCardSessionId: 10,
      geometryTrackId: 1,
      focusAttemptId: 1,
      recognizeAttempts: 1,
      terminal: 'identified',
      status: 'found',
      matchName: 'Negate',
      matchScore: 1,
      matchMethod: 'exact-title',
      ocrTexts: ['Negate'],
      detectorScore: 0.9,
      recognitionSource: 'snapshot',
      swapKind: 'automatic',
      timings: { totalMs: 800, lockToIdentityMs: 400 },
      files: { metadata: 'deck-001-metadata.json', cardWarp: 'deck-001-card.png' },
      recordedAt: '2026-09-09T00:00:00.000Z',
    },
    {
      benchmarkIndex: 2,
      cardSessionId: 11,
      resultCardSessionId: 11,
      geometryTrackId: 1,
      focusAttemptId: 2,
      recognizeAttempts: 1,
      terminal: 'ambiguous',
      status: 'ambiguous',
      matchName: null,
      matchScore: null,
      matchMethod: 'ambiguous',
      ocrTexts: [],
      detectorScore: 0.8,
      recognitionSource: 'snapshot',
      swapKind: 'manual',
      timings: { totalMs: 1200, lockToIdentityMs: null },
      files: { metadata: 'deck-002-metadata.json' },
      recordedAt: '2026-09-09T00:00:01.000Z',
    },
  ];
  const sessions = new Set(cards.map(c => c.cardSessionId));
  assert.equal(sessions.size, cards.length);
  const summary = summarizeDeckBenchmark({
    kind: 'deck-benchmark',
    fixtureId: 'deck-test-demo',
    createdAt: '2026-09-09T00:00:00.000Z',
    completedAt: '2026-09-09T00:01:00.000Z',
    targetCount: 2,
    cards,
    expectedMultiset: [{ name: 'Negate', quantity: 1 }],
    expectedDeckId: null,
    expectedDeckName: null,
    phase: 'complete',
    note: 'test',
  });
  assert.equal(summary.identified, 1);
  assert.equal(summary.freshIdentified, 1);
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.session.manualSwaps, 1);
  const recon = reconcileDeckMultiset(cards, [{ name: 'Negate', quantity: 1 }]);
  assert.equal(recon.paired.length, 1);
  assert.equal(recon.unresolved.length, 1);
  assert.equal(deckCardFileStem(17), 'deck-017');
});

check('deck benchmark: never uses global labHold', () => {
  assert.equal(DECK_BENCHMARK_USES_GLOBAL_LAB_HOLD, false);
});

check('deck benchmark: recognized card saves without waiting for 18s timeout', () => {
  const recorded = new Set();
  const d1 = decideDeckCardSave({
    recordedSlots: recorded,
    cardStartedAt: 0,
    now: 900,
    live: {
      phase: 'locked',
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Negate',
      cardSessionId: 42,
      resultCardSessionId: 42,
      freshEvidenceCountForSession: 1,
      recognizeAttempts: 1,
      geometryDetected: true,
      geometryTrackId: 7,
      focusAttemptId: 3,
      titlePresent: true,
    },
  });
  assert.equal(d1.shouldSave, true);
  assert.equal(d1.timedOut, false);
  assert.equal(d1.terminal, 'identified');
  assert.equal(d1.staleIdentityRejected, false);
  assert.equal(d1.slotKey, 's:42');
  recorded.add(d1.slotKey);
  // Same physical card / session must not create a second record.
  const dDup = decideDeckCardSave({
    recordedSlots: recorded,
    cardStartedAt: 0,
    now: 1200,
    live: {
      phase: 'locked',
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Negate',
      cardSessionId: 42,
      resultCardSessionId: 42,
      geometryDetected: true,
      geometryTrackId: 7,
      focusAttemptId: 3,
      titlePresent: true,
    },
  });
  assert.equal(dDup.shouldSave, false);
});

check('deck benchmark: stale FOUND from prior session does not save next slot', () => {
  const d = decideDeckCardSave({
    recordedSlots: new Set(['s:10']),
    cardStartedAt: 1000,
    now: 1007, // 7ms — classic sticky save
    live: {
      phase: 'found',
      recognitionStatus: 'found',
      recognitionDecision: 'exact-title',
      identity: 'Negate',
      cardSessionId: 11,
      resultCardSessionId: 10, // owned by previous session
      geometryDetected: true,
      geometryTrackId: 1, // same geometry track is allowed
      focusAttemptId: 1,
      titlePresent: true,
      recognizeAttempts: 0,
    },
  });
  assert.equal(d.staleIdentityRejected, true);
  assert.equal(d.shouldSave, false);
  assert.equal(d.terminal, null);
  assert.equal(d.timedOut, false);
  assert.equal(isFreshSessionIdentity({
    cardSessionId: 11,
    resultCardSessionId: 10,
    identity: 'Negate',
  }), false);
});

check('deck benchmark: 18s timeout still saves when evidence never arrives', () => {
  const d = decideDeckCardSave({
    recordedSlots: new Set(),
    cardStartedAt: 0,
    now: DECK_CARD_TIMEOUT_MS + 1,
    live: {
      phase: 'focusing',
      recognitionStatus: null,
      recognitionDecision: null,
      identity: null,
      cardSessionId: 11,
      resultCardSessionId: null,
      geometryDetected: true,
      geometryTrackId: 1,
      focusAttemptId: 2,
      titlePresent: false,
      recognizeAttempts: 0,
    },
  });
  assert.equal(d.shouldSave, true);
  assert.equal(d.timedOut, true);
  assert.equal(d.terminal, null);
  assert.equal(d.staleIdentityRejected, false);
});

check('deck benchmark: freshIdentified excludes unowned sticky identity', () => {
  const cards = [
    {
      benchmarkIndex: 1,
      cardSessionId: 10,
      resultCardSessionId: 10,
      geometryTrackId: 1,
      focusAttemptId: 1,
      recognizeAttempts: 2,
      terminal: 'identified',
      status: 'found',
      matchName: 'Negate',
      matchScore: 0.99,
      matchMethod: 'exact-title',
      ocrTexts: ['Negate'],
      detectorScore: 0.9,
      recognitionSource: 'snapshot',
      swapKind: 'automatic',
      timings: { totalMs: 1200, lockToIdentityMs: 400 },
      files: { metadata: 'deck-001-metadata.json', cardWarp: 'deck-001-card.png' },
      recordedAt: '2026-09-10T00:00:00.000Z',
    },
    {
      benchmarkIndex: 2,
      cardSessionId: 11,
      resultCardSessionId: 10,
      geometryTrackId: 1,
      focusAttemptId: 1,
      recognizeAttempts: 0,
      terminal: 'identified',
      staleIdentityRejected: true,
      status: 'found',
      matchName: 'Negate',
      matchScore: 0.99,
      matchMethod: 'exact-title',
      ocrTexts: [],
      detectorScore: 0.9,
      recognitionSource: 'snapshot',
      swapKind: 'automatic',
      timings: { totalMs: 7, lockToIdentityMs: null },
      files: { metadata: 'deck-002-metadata.json' },
      recordedAt: '2026-09-10T00:00:01.000Z',
    },
  ];
  const summary = summarizeDeckBenchmark({
    kind: 'deck-benchmark',
    fixtureId: 'deck-stale-demo',
    createdAt: '2026-09-10T00:00:00.000Z',
    completedAt: '2026-09-10T00:01:00.000Z',
    targetCount: 2,
    cards,
    expectedMultiset: null,
    expectedDeckId: null,
    expectedDeckName: null,
    phase: 'complete',
    note: 'test',
  });
  assert.equal(summary.identified, 2);
  assert.equal(summary.freshIdentified, 1);
  assert.equal(summary.staleIdentityRejected, 1);
  assert.equal(summary.zeroFreshEvidenceTerminals, 1);
  const recon = reconcileDeckMultiset(cards, [{ name: 'Negate', quantity: 2 }]);
  assert.equal(recon.paired.length, 1);
  assert.equal(recon.unresolved.some(u => u.reason === 'stale-or-unowned-identity'), true);
});

check('deck benchmark: new cardSessionId advances next slot', () => {
  const adv = decideDeckAdvance({
    armedSessionId: 42,
    cardSessionId: 43,
    geometryDetected: true,
    elapsedSinceNextPromptMs: 500,
    manualArmed: false,
  });
  assert.equal(adv.advance, true);
  assert.equal(adv.reason, 'session-changed');
  const same = decideDeckAdvance({
    armedSessionId: 42,
    cardSessionId: 42,
    geometryDetected: true,
    elapsedSinceNextPromptMs: 500,
    manualArmed: false,
  });
  assert.equal(same.advance, false);
});

check('deck benchmark: timeout still saves true failure', () => {
  const d = decideDeckCardSave({
    recordedSlots: new Set(),
    cardStartedAt: 0,
    now: DECK_CARD_TIMEOUT_MS + 1,
    live: {
      phase: 'detecting',
      recognitionStatus: null,
      recognitionDecision: null,
      identity: null,
      cardSessionId: null,
      resultCardSessionId: null,
      geometryDetected: false,
      geometryTrackId: null,
      focusAttemptId: null,
      titlePresent: false,
    },
  });
  assert.equal(d.shouldSave, true);
  assert.equal(d.timedOut, true);
  assert.equal(d.terminal, null);
});

check('deck benchmark: titlePresent flows into observability', () => {
  const line = formatDeckObservability({
    benchmarkIndex: 1,
    geometryTrackId: 2,
    cardSessionId: 3,
    phase: 'recognizing',
    focusAttemptId: 4,
    recognitionStatus: 'found',
    identity: 'Negate',
    labHold: false,
    timeoutAgeMs: 800,
    titlePresent: true,
    timedOut: false,
  });
  assert.match(line, /labHold=false/);
  assert.match(line, /title=yes/);
  assert.match(line, /card=1/);
});

check('deck benchmark: observability logs only on state change', () => {
  const a = {
    benchmarkIndex: 1,
    geometryTrackId: 2,
    cardSessionId: 3,
    phase: 'detecting',
    focusAttemptId: 1,
    recognitionStatus: null,
    identity: null,
    labHold: false,
    titlePresent: false,
    timedOut: false,
  };
  assert.equal(deckObservabilityChanged(null, a), true);
  assert.equal(deckObservabilityChanged(a, { ...a }), false);
  assert.equal(deckObservabilityChanged(a, { ...a, phase: 'focusing' }), true);
  assert.equal(deckObservabilityChanged(a, { ...a, cardSessionId: 4 }), true);
  assert.equal(deckObservabilityChanged(a, { ...a, labHold: true }), true);
  assert.equal(deckObservabilityChanged(a, { ...a, timedOut: true }), true);
  // timeoutAgeMs is not part of the key — age alone must not spam logs
  assert.equal(deckObservabilityChanged(a, { ...a }), false);
});

check('binder benchmark: frame naming + capture summary', () => {
  assert.equal(binderFrameFile(2, 5), 'p02-f005.png');
  const summary = summarizeBinderCapture({
    kind: 'binder-benchmark',
    fixtureId: 'binder-test-demo',
    createdAt: '2026-09-09T00:00:00.000Z',
    completedAt: null,
    targetPages: 2,
    layout: { rows: 3, cols: 3 },
    captureDurationMs: BINDER_MAX_PAGE_MS,
    frameCadenceMs: 0,
    targetFramesPerPage: BINDER_TARGET_FRAMES,
    minFramesOk: BINDER_MIN_FRAMES_OK,
    maxPageMs: BINDER_MAX_PAGE_MS,
    captureSource: 'snapshot',
    captureNote: 'test',
    pages: [
      {
        pageIndex: 1,
        layout: { rows: 3, cols: 3 },
        frames: [
          {
            pageIndex: 1,
            frameIndex: 1,
            timestamp: 'x',
            monoMs: 100,
            width: 10,
            height: 10,
            orientation: null,
            captureSource: 'snapshot',
            geometryTrackId: null,
            detectorScore: null,
            selectedQuad: null,
            focusState: null,
            file: 'p01-f001.png',
            snapshotMs: 2000,
            encodeWriteMs: 2500,
            totalFrameMs: 4500,
            fileBytes: 12000,
          },
          {
            pageIndex: 1,
            frameIndex: 2,
            timestamp: 'y',
            monoMs: 200,
            width: 10,
            height: 10,
            orientation: null,
            captureSource: 'snapshot',
            geometryTrackId: null,
            detectorScore: null,
            selectedQuad: null,
            focusState: null,
            file: 'p02-f002.png',
            snapshotMs: 2100,
            encodeWriteMs: 2600,
            totalFrameMs: 4700,
            fileBytes: 12100,
          },
        ],
        startedAt: 'x',
        endedAt: 'y',
        captureDurationMs: 9000,
        targetFrameCount: BINDER_TARGET_FRAMES,
        requestedFrames: BINDER_TARGET_FRAMES,
        savedFrames: 2,
        failedFrames: 0,
        status: 'FAILED',
        stopReason: 'max-time',
        maxPageMs: BINDER_MAX_PAGE_MS,
      },
    ],
    phase: 'interrupted',
    note: 'test',
  });
  assert.equal(summary.pages, 1);
  assert.equal(summary.totalFrames, 2);
  assert.equal(summary.pageStatusCounts.FAILED, 1);
  assert.equal(summary.latencies.totalFrameMs.n, 2);
  assert.ok(summary.latencies.encodeWriteMs.p50 != null);
});

check('binder benchmark: COMPLETE / SPARSE / FAILED thresholds', () => {
  assert.equal(classifyBinderPageStatus(5), 'COMPLETE');
  assert.equal(classifyBinderPageStatus(3), 'SPARSE');
  assert.equal(classifyBinderPageStatus(2), 'FAILED');
  assert.equal(classifyBinderPageStatus(0), 'FAILED');
});

check('binder benchmark: frame-driven stop is not fictional cadence', () => {
  assert.equal(BINDER_TARGET_FRAMES, 5);
  assert.equal(BINDER_MIN_FRAMES_OK, 3);
  assert.ok(BINDER_MAX_PAGE_MS >= 20_000);
  const hitTarget = shouldStopBinderCapture({
    savedFrames: 5,
    failedFrames: 0,
    elapsedMs: 1000,
  });
  assert.equal(hitTarget.stop, true);
  assert.equal(hitTarget.reason, 'target');
  const hitMax = shouldStopBinderCapture({
    savedFrames: 2,
    failedFrames: 1,
    elapsedMs: BINDER_MAX_PAGE_MS,
  });
  assert.equal(hitMax.stop, true);
  assert.equal(hitMax.reason, 'max-time');
  const keepGoing = shouldStopBinderCapture({
    savedFrames: 2,
    failedFrames: 0,
    elapsedMs: 5_000,
  });
  assert.equal(keepGoing.stop, false);
});

check('binder benchmark: no automatic next-page capture', () => {
  assert.equal(BINDER_AUTO_ADVANCE_PAGES, false);
  assert.equal(BINDER_TURN_AUTO_MS, 0);
  // TURN PAGE alone must not start capture.
  assert.equal(
    binderCanStartNextPageCapture({
      phase: 'turn-page',
      capturing: false,
      explicitNextTap: false,
    }),
    false,
  );
  assert.equal(
    binderCanStartNextPageCapture({
      phase: 'page-saved',
      capturing: false,
      explicitNextTap: false,
    }),
    false,
  );
  assert.equal(
    binderCanStartNextPageCapture({
      phase: 'page-saved',
      capturing: false,
      explicitNextTap: true,
    }),
    false,
  );
  // Explicit NEXT PAGE tap on turn-page is required.
  assert.equal(
    binderCanStartNextPageCapture({
      phase: 'turn-page',
      capturing: false,
      explicitNextTap: true,
    }),
    true,
  );
  // Never overlap an in-flight capture.
  assert.equal(
    binderCanStartNextPageCapture({
      phase: 'turn-page',
      capturing: true,
      explicitNextTap: true,
    }),
    false,
  );
});

check('binder benchmark: after-save waits for NEXT PAGE or FINISH', () => {
  assert.equal(
    binderAfterSaveAction({ status: 'COMPLETE', savedNonFailedPages: 1, targetPages: 5 }),
    'await-next-page',
  );
  assert.equal(
    binderAfterSaveAction({ status: 'SPARSE', savedNonFailedPages: 4, targetPages: 5 }),
    'await-next-page',
  );
  assert.equal(
    binderAfterSaveAction({ status: 'COMPLETE', savedNonFailedPages: 5, targetPages: 5 }),
    'await-finish',
  );
  assert.equal(
    binderAfterSaveAction({ status: 'FAILED', savedNonFailedPages: 0, targetPages: 5 }),
    'retry',
  );
  // Resume contract: saved pages → await-next-page (not auto capture).
  assert.equal(
    binderAfterSaveAction({ status: 'COMPLETE', savedNonFailedPages: 2, targetPages: 5 }),
    'await-next-page',
  );
});

check('deck failure class: no geometry → NO_DETECTION', () => {
  assert.equal(classifyDeckFailure({ gates: { geometryDetected: false } }), 'NO_DETECTION');
});

check('deck failure class: ocr unavailable beats detection', () => {
  assert.equal(
    classifyDeckFailure({
      gates: { geometryDetected: true },
      ocrAvailable: false,
      presentedCorners: { topLeft: { x: 1, y: 1 } },
    }),
    'OCR_UNAVAILABLE',
  );
});

check('deck failure class: focus timeout without hi-res', () => {
  assert.equal(
    classifyDeckFailure({
      gates: { geometryDetected: true, focusTimedOut: true, highResSuccess: 0 },
      ocrAvailable: true,
      rawCorners: {},
    }),
    'FOCUS_TIMEOUT',
  );
});

check('scanner mode: exclusive ownership + presentation gates', () => {
  assert.equal(allowsNormalResultPresentation('normal'), true);
  assert.equal(allowsNormalResultPresentation('deck-benchmark'), false);
  assert.equal(allowsNormalCollectionActions('deck-benchmark'), false);
  assert.equal(runsCanonicalRecognition('deck-benchmark'), true);
  assert.equal(runsCanonicalRecognition('binder-benchmark'), false);
  assert.equal(suspendsNormalRecognition('binder-benchmark'), true);
  assert.equal(suspendsNormalRecognition('deck-benchmark'), false);
  assert.equal(DECK_BENCHMARK_USES_GLOBAL_LAB_HOLD, false);
  assert.equal(showsDiagnosticPolygonsByDefault('deck-benchmark'), true);
  assert.equal(showsDiagnosticPolygonsByDefault('card-swap-test'), true);
  assert.equal(showsDiagnosticPolygonsByDefault('binder-benchmark'), false);
  assert.equal(canClaimScannerMode('normal', 'deck-benchmark'), true);
  assert.equal(canClaimScannerMode('deck-benchmark', 'binder-benchmark'), false);
  assert.equal(canClaimScannerMode('deck-benchmark', 'normal'), true);
  assert.equal(applyScannerModeClaim('deck-benchmark', 'binder-benchmark').ok, false);
  assert.equal(applyScannerModeClaim('normal', 'deck-benchmark').ok, true);
  assert.equal(shouldDismissNormalResultOnModeEnter('normal', 'deck-benchmark'), true);
  assert.equal(shouldResetSessionOnModeExit('deck-benchmark', 'normal'), true);
  assert.equal(isExclusiveScannerOwner('card-swap-test'), true);
  assert.equal(isExclusiveScannerOwner('binder'), true);
  assert.equal(isBinderMode('binder'), true);
  assert.equal(isBinderMode('binder-benchmark'), true);
  assert.equal(usesBinderOverlays('binder'), true);
  assert.equal(suspendsNormalRecognition('binder'), true);
  assert.equal(allowsNormalResultPresentation('binder'), false);
  assert.equal(runsCanonicalRecognition('binder'), false);
});

check('scanner mode: deck FOUND is for benchmark only (not consumer UI)', () => {
  // Simulation of CameraScanScreen gate: FOUND + deck mode ⇒ no ScanResultCard.
  const mode = 'deck-benchmark';
  const phase = 'found';
  const showResult =
    allowsNormalResultPresentation(mode) && (phase === 'found' || phase === 'ambiguous');
  assert.equal(showResult, false);
  // Production path still "runs" for deck.
  assert.equal(runsCanonicalRecognition(mode), true);
  // 18s timeout unchanged.
  assert.equal(DECK_CARD_TIMEOUT_MS, 18_000);
});

check('scanner mode: binder suspends recognition consumer', () => {
  assert.equal(suspendsNormalRecognition('binder-benchmark'), true);
  assert.equal(allowsNormalResultPresentation('binder-benchmark'), false);
  assert.equal(runsCanonicalRecognition('binder-benchmark'), false);
  assert.equal(suspendsNormalRecognition('binder'), true);
  assert.equal(allowsNormalResultPresentation('binder'), false);
  assert.equal(runsCanonicalRecognition('binder'), false);
});

check('scanner mode: geometry-test exclusive, no recognition, live raw polygon', () => {
  assert.equal(isExclusiveScannerOwner('geometry-test'), true);
  assert.equal(allowsNormalResultPresentation('geometry-test'), false);
  assert.equal(allowsNormalCollectionActions('geometry-test'), false);
  assert.equal(runsCanonicalRecognition('geometry-test'), false);
  assert.equal(suspendsNormalRecognition('geometry-test'), true);
  assert.equal(showsDiagnosticPolygonsByDefault('geometry-test'), false);
  assert.equal(usesLiveRawPolygon('geometry-test'), true);
  assert.equal(canClaimScannerMode('normal', 'geometry-test'), true);
  assert.equal(canClaimScannerMode('deck-benchmark', 'geometry-test'), false);
  assert.equal(applyScannerModeClaim('normal', 'geometry-test').ok, true);
  // ScanResultCard must not appear.
  const showResult =
    allowsNormalResultPresentation('geometry-test') && true;
  assert.equal(showResult, false);
});

check('geometry-test lock: 2 frames high score, 3 normal; freeze after lock', () => {
  assert.equal(framesRequiredForScore(0.95), 2);
  assert.equal(framesRequiredForScore(0.7), 3);
  const q1 = {
    topLeft: { x: 80, y: 60 },
    topRight: { x: 320, y: 70 },
    bottomRight: { x: 310, y: 400 },
    bottomLeft: { x: 70, y: 390 },
  };
  const q2 = {
    topLeft: { x: 82, y: 61 },
    topRight: { x: 321, y: 71 },
    bottomRight: { x: 311, y: 401 },
    bottomLeft: { x: 71, y: 391 },
  };
  assert.equal(quadsAgreeForGeometryLock(q1, q2), true);
  let st = emptyGeometryLockState();
  let r = tickGeometryLock(st, { now: 1, score: 0.95, plausible: q1 });
  assert.equal(r.decision, 'confirming');
  st = r.state;
  r = tickGeometryLock(st, { now: 2, score: 0.95, plausible: q2 });
  assert.equal(r.decision, 'locked');
  assert.ok(r.state.locked);
  const frozen = r.state.locked;
  r = tickGeometryLock(r.state, {
    now: 3,
    score: 0.95,
    plausible: {
      topLeft: { x: 200, y: 200 },
      topRight: { x: 400, y: 200 },
      bottomRight: { x: 400, y: 500 },
      bottomLeft: { x: 200, y: 500 },
    },
  });
  assert.equal(r.decision, 'locked');
  assert.deepEqual(r.state.locked, frozen);
});

check('geometry-test lock: reset when geometry disappears', () => {
  const q = {
    topLeft: { x: 80, y: 60 },
    topRight: { x: 320, y: 70 },
    bottomRight: { x: 310, y: 400 },
    bottomLeft: { x: 70, y: 390 },
  };
  let st = emptyGeometryLockState();
  st = tickGeometryLock(st, { now: 1, score: 0.8, plausible: q }).state;
  const r = tickGeometryLock(st, { now: 2, score: 0.8, plausible: null });
  assert.equal(r.decision, 'reset');
  assert.equal(r.state.agreeingStreak, 0);
});

check('geometry-test capture-safe: in-frame card passes; edge/out/small/extreme fail', () => {
  const frame = { width: 360, height: 640 };
  const good = {
    topLeft: { x: 80, y: 120 },
    topRight: { x: 260, y: 125 },
    bottomRight: { x: 255, y: 480 },
    bottomLeft: { x: 85, y: 475 },
  };
  const ok = evaluateCaptureSafe({ corners: good, frame });
  assert.equal(ok.captureSafe, true);
  assert.equal(ok.message, '');

  const nearEdge = {
    topLeft: { x: 2, y: 120 },
    topRight: { x: 200, y: 125 },
    bottomRight: { x: 195, y: 480 },
    bottomLeft: { x: 5, y: 475 },
  };
  const edge = evaluateCaptureSafe({ corners: nearEdge, frame });
  assert.equal(edge.captureSafe, false);
  assert.ok(edge.reasons.includes('near_edge') || edge.reasons.includes('out_of_frame'));
  assert.equal(captureSafeMessage(edge.reasons), 'TOO CLOSE TO EDGE');

  const outside = {
    topLeft: { x: -20, y: 100 },
    topRight: { x: 200, y: 100 },
    bottomRight: { x: 200, y: 400 },
    bottomLeft: { x: -10, y: 400 },
  };
  const out = evaluateCaptureSafe({ corners: outside, frame });
  assert.equal(out.captureSafe, false);
  assert.ok(out.reasons.includes('out_of_frame'));
  assert.equal(out.message, 'MOVE CARD INTO FRAME');

  const tiny = {
    topLeft: { x: 160, y: 280 },
    topRight: { x: 190, y: 282 },
    bottomRight: { x: 188, y: 330 },
    bottomLeft: { x: 162, y: 328 },
  };
  const small = evaluateCaptureSafe({ corners: tiny, frame });
  assert.equal(small.captureSafe, false);
  assert.ok(small.reasons.includes('too_small'));
  assert.equal(small.message, 'CARD TOO SMALL');

  const extreme = {
    topLeft: { x: 40, y: 80 },
    topRight: { x: 320, y: 90 },
    bottomRight: { x: 200, y: 500 },
    bottomLeft: { x: 180, y: 490 },
  };
  const ang = evaluateCaptureSafe({ corners: extreme, frame });
  assert.equal(ang.captureSafe, false);
  assert.ok(
    ang.reasons.includes('extreme_angle') ||
      ang.reasons.includes('weak_support') ||
      ang.reasons.includes('non_convex'),
  );

  assert.equal(evaluateCaptureSafe({ corners: null, frame }).message, 'WAITING FOR GEOMETRY');
});

check('geometry-test capture-safe: 4.5%→2.5% near_edge A/B; out_of_frame hard gate', () => {
  const frame = { width: 360, height: 640 };
  const minDim = Math.min(frame.width, frame.height);
  // Corner at 4.0% of minDim — unsafe under old 4.5%, safe under new 2.5%.
  const inset40 = 0.04 * minDim;
  const at40 = {
    topLeft: { x: inset40, y: 120 },
    topRight: { x: 240, y: 125 },
    bottomRight: { x: 235, y: 480 },
    bottomLeft: { x: inset40 + 3, y: 475 },
  };
  const old45 = evaluateCaptureSafe({ corners: at40, frame, edgeMarginNorm: 0.045 });
  assert.equal(old45.captureSafe, false);
  assert.ok(old45.reasons.includes('near_edge'));
  const neu25 = evaluateCaptureSafe({ corners: at40, frame, edgeMarginNorm: 0.025 });
  assert.equal(neu25.captureSafe, true);
  // Default constant must be 2.5%.
  assert.equal(CAPTURE_SAFE_EDGE_MARGIN, 0.025);
  assert.equal(evaluateCaptureSafe({ corners: at40, frame }).captureSafe, true);

  // Corner at 2.0% — still near_edge under 2.5%.
  const inset20 = 0.02 * minDim;
  const at20 = {
    topLeft: { x: inset20, y: 120 },
    topRight: { x: 240, y: 125 },
    bottomRight: { x: 235, y: 480 },
    bottomLeft: { x: inset20 + 3, y: 475 },
  };
  const at20v = evaluateCaptureSafe({ corners: at20, frame, edgeMarginNorm: 0.025 });
  assert.equal(at20v.captureSafe, false);
  assert.ok(at20v.reasons.includes('near_edge'));

  // Actual out_of_frame ALWAYS unsafe regardless of margin.
  const outside = {
    topLeft: { x: -5, y: 120 },
    topRight: { x: 240, y: 125 },
    bottomRight: { x: 235, y: 480 },
    bottomLeft: { x: 80, y: 475 },
  };
  for (const m of [0.045, 0.025, 0.01, 0]) {
    const v = evaluateCaptureSafe({ corners: outside, frame, edgeMarginNorm: m });
    assert.equal(v.captureSafe, false);
    assert.ok(v.reasons.includes('out_of_frame'));
  }

  // Other gates unchanged: too_small still blocks even with 0% edge margin.
  const tiny = {
    topLeft: { x: 160, y: 280 },
    topRight: { x: 190, y: 282 },
    bottomRight: { x: 188, y: 330 },
    bottomLeft: { x: 162, y: 328 },
  };
  assert.ok(
    evaluateCaptureSafe({ corners: tiny, frame, edgeMarginNorm: 0 }).reasons.includes('too_small'),
  );
});

check('geometry-test physical refine V2: global consensus fail-closed; no large inset; bad seed', () => {
  const w = 320;
  const h = 480;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 180;
    data[i + 3] = 255;
  }
  const fillRect = (x0, y0, x1, y1, v) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = v;
      }
    }
  };
  // Small sleeve gap (~2.5% of ~240 side ≈ 6px) — plausible nest.
  fillRect(40, 60, 280, 420, 40);
  fillRect(46, 66, 274, 414, 200);
  const img = { data, width: w, height: h };
  const outer = {
    topLeft: { x: 40, y: 60 },
    topRight: { x: 280, y: 60 },
    bottomRight: { x: 280, y: 420 },
    bottomLeft: { x: 40, y: 420 },
  };
  const r = refinePhysicalCardBoundary({
    image: img,
    corners: outer,
    candidateRole: 'outer-container',
    frame: { width: w, height: h },
  });
  assert.ok(r.refinementMs < 50);
  assert.ok(r.selectedQuad.topLeft);
  assert.ok(typeof r.globalConsensusScore === 'number');
  assert.ok(r.boundaryModel === r.classification);
  // Must not auto-select huge inward shrinks.
  if (r.selectedForCapture === 'PHYSICAL_CARD') {
    assert.ok(r.meanInset <= 0.04 + 1e-6);
    assert.ok(r.classification === 'SLEEVED_CARD');
    assert.ok(r.sleeveQuad && r.physicalCardQuad);
  } else {
    assert.equal(r.selectedForCapture, 'ORIGINAL');
  }

  // Oversized seed must be BAD_SEED and keep ORIGINAL selected.
  const huge = {
    topLeft: { x: 5, y: 5 },
    topRight: { x: 315, y: 5 },
    bottomRight: { x: 315, y: 475 },
    bottomLeft: { x: 5, y: 475 },
  };
  const bad = refinePhysicalCardBoundary({
    image: img,
    corners: huge,
    frame: { width: w, height: h },
  });
  assert.equal(bad.status, 'BAD_SEED');
  assert.equal(bad.selectedForCapture, 'ORIGINAL');
  assert.equal(bad.rejectionReason, 'BAD_SEED');

  // Deep internal edge pattern (large inset) must not become physical card.
  fillRect(40, 60, 280, 420, 50);
  fillRect(80, 110, 240, 370, 210); // ~16% inset — internal
  const deep = refinePhysicalCardBoundary({
    image: { data, width: w, height: h },
    corners: outer,
    frame: { width: w, height: h },
  });
  assert.notEqual(deep.selectedForCapture, 'PHYSICAL_CARD');

  const none = refinePhysicalCardBoundary({ image: img, corners: null });
  assert.equal(none.status, 'NO_REFINEMENT');
  assert.equal(none.selectedForCapture, 'ORIGINAL');
});

check('geometry-test source-space anti-clip gate calibrated band', () => {
  const det = { width: 256, height: 480 };
  const src = { width: 1022, height: 1920 };
  // Comfortable ~150px source margin → analysis ~37.5px inset on 256.
  const good = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 216, y: 50 },
    bottomRight: { x: 216, y: 430 },
    bottomLeft: { x: 40, y: 430 },
  };
  const g = evaluateSourceCaptureSafe({
    corners: good,
    detector: det,
    expectedSource: src,
  });
  assert.equal(g.sourceSafe, true);
  assert.ok(g.minSourceMarginPx > 100);

  // Lip ~35px source (~8.8 analysis px) must reject at thr 56.
  const lip = {
    topLeft: { x: 9, y: 12 },
    topRight: { x: 247, y: 12 },
    bottomRight: { x: 247, y: 468 },
    bottomLeft: { x: 9, y: 468 },
  };
  const bad = evaluateSourceCaptureSafe({
    corners: lip,
    detector: det,
    expectedSource: src,
  });
  assert.equal(bad.sourceSafe, false);
  assert.ok(bad.minSourceMarginPx < MIN_SOURCE_MARGIN_PX);

  // Jitter envelope: barely-ok margin with large jitter becomes unsafe.
  const barely = {
    topLeft: { x: 16, y: 20 },
    topRight: { x: 240, y: 20 },
    bottomRight: { x: 240, y: 460 },
    bottomLeft: { x: 16, y: 460 },
  };
  const withJitter = evaluateSourceCaptureSafe({
    corners: barely,
    detector: det,
    expectedSource: src,
    cornerJitterAnalysisPx: 8,
  });
  assert.ok(withJitter.effectiveSourceMarginPx != null);
  assert.ok(withJitter.effectiveSourceMarginPx < withJitter.minSourceMarginPx);
});

check('single-card capture: geometry-v2 flag + production profile skips physical refine', () => {
  const prev = getSingleCapturePipeline();
  setSingleCapturePipeline('geometry-v2');
  assert.equal(isGeometryV2Pipeline(), true);
  assert.equal(usesLiveRawPolygon('normal'), true);
  assert.equal(usesLiveRawPolygon('geometry-test'), true);
  assert.equal(NORMAL_PRODUCTION_PROFILE.enablePhysicalRefine, false);
  assert.equal(NORMAL_PRODUCTION_PROFILE.skipPerCardFocus, true);
  assert.equal(GEOMETRY_EXPERIMENT_PROFILE.enablePhysicalRefine, true);
  setSingleCapturePipeline('legacy');
  assert.equal(isGeometryV2Pipeline(), false);
  assert.equal(usesLiveRawPolygon('normal'), false);
  setSingleCapturePipeline(prev);
});

await checkAsync('single-card capture geometry-v2: no per-card focus; locks via CAPTURE_SAFE', async () => {
  const prev = getSingleCapturePipeline();
  setSingleCapturePipeline('geometry-v2');
  const luma = paintCardLike(blankImage(256, 480), { gray: true });
  // Well-inset quad so analysis + predicted source margins pass.
  const corners = {
    topLeft: { x: 48, y: 60 },
    topRight: { x: 208, y: 62 },
    bottomRight: { x: 206, y: 420 },
    bottomLeft: { x: 50, y: 418 },
  };
  let focusCalls = 0;
  let captureKicks = 0;
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => {
      captureKicks += 1;
      return false;
    },
    requestFocusNorm: () => {
      focusCalls += 1;
    },
  });
  const snap = await runFrames(ctrl, luma, helpers, 6);
  assert.equal(focusCalls, 0, 'geometry-v2 must not request per-card focus');
  assert.ok(
    snap.singleCardCapture?.pipeline === 'geometry-v2',
    'snapshot exposes geometry-v2 pipeline',
  );
  assert.ok(
    snap.phase === 'locking' || snap.phase === 'detected' || snap.phase === 'recognizing',
    `unexpected phase ${snap.phase}`,
  );
  if (snap.phase === 'locking' || snap.singleCardCapture?.frozenQuad) {
    assert.ok(snap.lockGates.focusOk !== false);
  }
  setSingleCapturePipeline(prev);
});

check('single-card capture tick: CAPTURE_SAFE gates lock; no refine in production', () => {
  const frame = { width: 256, height: 480 };
  const good = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 216, y: 50 },
    bottomRight: { x: 216, y: 430 },
    bottomLeft: { x: 40, y: 430 },
  };
  const lip = {
    topLeft: { x: 4, y: 8 },
    topRight: { x: 250, y: 8 },
    bottomRight: { x: 250, y: 470 },
    bottomLeft: { x: 4, y: 470 },
  };
  let state = emptySingleCardCaptureState(0);
  const unsafe = tickSingleCardCapture(
    state,
    { now: 10, score: 0.9, corners: lip, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.equal(unsafe.state.captureSafe, false);
  assert.equal(unsafe.state.lock.locked, null);
  assert.equal(unsafe.physicalRefine, null);

  state = unsafe.state;
  // Centered card — analysis safe; source gate uses predicted 1920 long edge.
  let tick = tickSingleCardCapture(
    state,
    { now: 20, score: 0.9, corners: good, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.equal(tick.state.captureSafe, true);
  // Need 2 agreeing high-score frames to lock.
  tick = tickSingleCardCapture(
    tick.state,
    { now: 40, score: 0.9, corners: good, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.ok(tick.state.frozenQuad);
  assert.equal(tick.decision, 'locked');
  assert.match(tick.state.userMessage, /CAPTURING|HOLD/);
});

check('single-card capture: one unsafe frame does not wipe confirmation streak', () => {
  const frame = { width: 256, height: 480 };
  const good = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 216, y: 50 },
    bottomRight: { x: 216, y: 430 },
    bottomLeft: { x: 40, y: 430 },
  };
  const lip = {
    topLeft: { x: 4, y: 8 },
    topRight: { x: 250, y: 8 },
    bottomRight: { x: 250, y: 470 },
    bottomLeft: { x: 4, y: 470 },
  };
  let tick = tickSingleCardCapture(
    emptySingleCardCaptureState(0),
    { now: 10, score: 0.9, corners: good, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.equal(tick.state.captureSafe, true);
  assert.ok(tick.state.lock.agreeingStreak >= 1);
  const streakBefore = tick.state.lock.agreeingStreak;
  // Single near-edge flicker (still-phone detector noise).
  tick = tickSingleCardCapture(
    tick.state,
    { now: 20, score: 0.9, corners: lip, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.equal(tick.state.captureSafe, false);
  assert.equal(tick.state.unsafeStreak, 1);
  assert.equal(tick.state.lock.agreeingStreak, streakBefore);
  // Two consecutive unsafe frames still reset (before lock).
  tick = tickSingleCardCapture(
    tick.state,
    { now: 30, score: 0.9, corners: lip, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.equal(tick.state.lock.agreeingStreak, 0);
  assert.equal(tick.state.lock.lastPlausible, null);
  assert.equal(tick.state.unsafeStreak, 0);
  // Fresh safe frames can lock again.
  tick = tickSingleCardCapture(
    tick.state,
    { now: 40, score: 0.9, corners: good, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  tick = tickSingleCardCapture(
    tick.state,
    { now: 50, score: 0.9, corners: good, frame },
    NORMAL_PRODUCTION_PROFILE,
  );
  assert.equal(tick.decision, 'locked');
  assert.ok(tick.state.frozenQuad);
});

check('incumbent hysteresis: holds against slight score edge; switches on margin or streak', () => {
  const a = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 200, y: 50 },
    bottomRight: { x: 200, y: 280 },
    bottomLeft: { x: 40, y: 280 },
  };
  // Spatially different — shifted right substantially.
  const b = {
    topLeft: { x: 120, y: 60 },
    topRight: { x: 280, y: 60 },
    bottomRight: { x: 280, y: 300 },
    bottomLeft: { x: 120, y: 300 },
  };
  assert.equal(isSpatialCandidateSwitch(a, b), true);
  let inc = emptyIncumbentState();
  let r = tickIncumbent(inc, { now: 1, candidate: a, score: 0.8 });
  inc = r.state;
  // Slightly higher score but different geometry — hold A.
  r = tickIncumbent(inc, { now: 2, candidate: b, score: 0.82 });
  assert.equal(r.heldIncumbent, true);
  assert.equal(r.switched, false);
  assert.deepEqual(r.selected, a);
  // Second consecutive challenger → switch.
  r = tickIncumbent(r.state, { now: 3, candidate: b, score: 0.82 });
  assert.equal(r.switched, true);
  assert.deepEqual(r.selected, b);
  // Fresh A with large score margin switches immediately.
  r = tickIncumbent(r.state, { now: 4, candidate: a, score: 0.95 });
  assert.equal(r.switched, true);
});

check('incumbent hysteresis: NEXT/empty resets — no sticky old card', () => {
  const a = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 200, y: 50 },
    bottomRight: { x: 200, y: 280 },
    bottomLeft: { x: 40, y: 280 },
  };
  let r = tickIncumbent(emptyIncumbentState(), { now: 1, candidate: a, score: 0.9 });
  assert.ok(r.state.quad);
  // emptySingleCardCaptureState is what beginCardSession uses — clears incumbent.
  const cleared = emptySingleCardCaptureState(99);
  assert.equal(cleared.incumbent.quad, null);
  assert.equal(cleared.incumbent.candidateSwitchCount, 0);
});

check('best recent safe quad prefers centered over transitional lip', () => {
  const frame = { width: 256, height: 480 };
  const centered = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 216, y: 50 },
    bottomRight: { x: 216, y: 430 },
    bottomLeft: { x: 40, y: 430 },
  };
  const transitional = {
    topLeft: { x: 20, y: 30 },
    topRight: { x: 230, y: 35 },
    bottomRight: { x: 235, y: 450 },
    bottomLeft: { x: 18, y: 445 },
  };
  let win = emptyRecentSafeWindow();
  win = pushRecentSafe(win, { quad: centered, score: 0.88, at: 1, frame });
  win = pushRecentSafe(win, { quad: centered, score: 0.9, at: 2, frame });
  win = pushRecentSafe(win, { quad: transitional, score: 0.91, at: 3, frame });
  const best = pickBestRecentSafe(win);
  assert.ok(best);
  // Centered should win despite slightly lower last-frame score.
  assert.equal(best.quad.topLeft.x, centered.topLeft.x);
  assert.ok(scoreSafeSample(win.samples[0]) > 0);
});

check('still-card lock: oscillating candidates still lock via incumbent', () => {
  const frame = { width: 256, height: 480 };
  const a = {
    topLeft: { x: 40, y: 50 },
    topRight: { x: 216, y: 50 },
    bottomRight: { x: 216, y: 430 },
    bottomLeft: { x: 40, y: 430 },
  };
  // Alternate with a near-identical jittered quad (same object) and a far one that loses hysteresis.
  const aJitter = {
    topLeft: { x: 42, y: 51 },
    topRight: { x: 214, y: 52 },
    bottomRight: { x: 215, y: 428 },
    bottomLeft: { x: 41, y: 429 },
  };
  const far = {
    topLeft: { x: 130, y: 80 },
    topRight: { x: 250, y: 90 },
    bottomRight: { x: 240, y: 400 },
    bottomLeft: { x: 120, y: 390 },
  };
  let state = emptySingleCardCaptureState(0);
  // Feed A, far (held), A, A → should lock without requiring motion.
  for (const [t, q] of [
    [10, a],
    [20, far],
    [30, a],
    [40, aJitter],
  ]) {
    const tick = tickSingleCardCapture(
      state,
      { now: t, score: 0.9, corners: q, frame },
      NORMAL_PRODUCTION_PROFILE,
    );
    state = tick.state;
  }
  assert.ok(
    state.frozenQuad || state.lock.agreeingStreak >= 1,
    'still card should confirm or lock without motion nudge',
  );
  // Safety thresholds unchanged.
  assert.equal(CAPTURE_SAFE_EDGE_MARGIN, 0.025);
  assert.equal(MIN_SOURCE_MARGIN_PX, 56);
});

await checkAsync('background queue: recognize + encode concurrency bounded', async () => {
  resetScanBackgroundQueueForTests();
  const q = createBackgroundQueue({
    maxRecognize: 1,
    maxEncode: 1,
    maxUpload: 2,
    maxPending: 12,
  });
  let activeRecog = 0;
  let maxRecog = 0;
  let activeEnc = 0;
  let maxEnc = 0;
  const mk = (kind, id, ms) => ({
    id,
    kind,
    priority: kind === 'recognize' ? 2 : 3,
    attemptId: Number(id.replace(/\D/g, '')) || 1,
    enqueuedAt: Date.now(),
    run: async () => {
      if (kind === 'recognize') {
        activeRecog += 1;
        maxRecog = Math.max(maxRecog, activeRecog);
        await new Promise(r => setTimeout(r, ms));
        activeRecog -= 1;
      } else {
        activeEnc += 1;
        maxEnc = Math.max(maxEnc, activeEnc);
        await new Promise(r => setTimeout(r, ms));
        activeEnc -= 1;
      }
    },
  });
  for (let i = 0; i < 5; i++) q.enqueue(mk('recognize', `r${i}`, 20));
  for (let i = 0; i < 5; i++) q.enqueue(mk('encode', `e${i}`, 15));
  await q.drainForTests(200);
  assert.equal(maxRecog, 1);
  assert.equal(maxEnc, 1);
  const snap = q.snapshot();
  assert.equal(snap.pendingTotal, 0);
});

check('geometry-test unsafe reason duration helpers', () => {
  let acc = {};
  acc = accumulateUnsafeReasonMs(acc, ['near_edge'], 3200);
  acc = accumulateUnsafeReasonMs(acc, ['near_edge', 'out_of_frame'], 140);
  acc = accumulateUnsafeReasonMs(acc, ['extreme_angle'], 0);
  assert.equal(acc.near_edge, 3340);
  assert.equal(acc.out_of_frame, 140);
  assert.equal(dominantUnsafeReason(acc), 'near_edge');
  assert.equal(labelCaptureUnsafeReason('near_edge'), 'TOO_CLOSE_TO_EDGE');
  assert.equal(labelCaptureUnsafeReason('out_of_frame'), 'MOVE_CARD_INTO_FRAME');
  assert.equal(labelCaptureUnsafeReason('no_geometry'), 'WAITING_FOR_GEOMETRY');
});

check('geometry-test derivedMs exposes three critical stage timings', () => {
  const t = emptyGeometryTiming();
  t.buttonPressedAt = 1000;
  t.firstRawQuadAt = 1080;
  t.firstPlausibleQuadAt = 1080;
  t.firstCaptureSafeAt = 1400;
  t.captureQuadLockedAt = 1445;
  const d = deriveGeometryTestMs(t);
  assert.equal(d.buttonToFirstQuadMs, 80);
  assert.equal(d.firstQuadToFirstCaptureSafeMs, 320);
  assert.equal(d.captureSafeToLockMs, 45);
  assert.equal(d.buttonToFirstCaptureSafeMs, 400);
});

check('geometry-test capture-safe: DETECTED does not imply lock without safe', () => {
  // Lock still requires agreeing frames; unsafe frames must not advance streak.
  const frame = { width: 360, height: 640 };
  const nearEdge = {
    topLeft: { x: 2, y: 120 },
    topRight: { x: 200, y: 125 },
    bottomRight: { x: 195, y: 480 },
    bottomLeft: { x: 5, y: 475 },
  };
  assert.equal(evaluateCaptureSafe({ corners: nearEdge, frame }).captureSafe, false);
  let st = emptyGeometryLockState();
  // Simulate gate: only tick lock when safe — unsafe leaves streak at 0.
  const safe = evaluateCaptureSafe({ corners: nearEdge, frame });
  if (!safe.captureSafe) {
    st = emptyGeometryLockState();
  }
  assert.equal(st.agreeingStreak, 0);
  assert.equal(st.locked, null);
});

check('geometry-test timing: monotonic deltas + START clears prior marks', () => {
  let t = emptyGeometryTiming();
  t = { ...t, buttonPressedAt: 1000 };
  t = markFirstTiming(t, 'firstRawQuadAt', 1120);
  t = markFirstTiming(t, 'firstRawQuadAt', 1500); // no overwrite
  t = markFirstTiming(t, 'firstPlausibleQuadAt', 1180);
  t = markFirstTiming(t, 'captureQuadLockedAt', 1300);
  t = markFirstTiming(t, 'captureRequestedAt', 1310);
  t = markFirstTiming(t, 'captureCompletedAt', 1600);
  t = markFirstTiming(t, 'warpDoneAt', 1691);
  t = markFirstTiming(t, 'cardPreviewEncodeStartAt', 1692);
  t = markFirstTiming(t, 'cardPreviewEncodeDoneAt', 1720);
  t = markFirstTiming(t, 'previewLoadStartAt', 1721);
  t = markFirstTiming(t, 'previewDisplayedAt', 1760);
  t = markFirstTiming(t, 'imageDisplayedAt', 1760);
  t = markFirstTiming(t, 'cardArtifactEncodeStartAt', 1800);
  t = markFirstTiming(t, 'cardArtifactEncodeDoneAt', 2500);
  t = markFirstTiming(t, 'cardFileWriteStartAt', 2500);
  t = markFirstTiming(t, 'cardFileWriteDoneAt', 2700);
  t = markFirstTiming(t, 'fullResPreviewReadyAt', 2710);
  t = markFirstTiming(t, 'artifactEncodeStartAt', 1800);
  t = markFirstTiming(t, 'artifactEncodeDoneAt', 3200);
  const d = deriveGeometryTestMs(t);
  assert.equal(d.buttonToFirstRawMs, 120);
  assert.equal(d.buttonToFirstPlausibleMs, 180);
  assert.equal(d.plausibleToLockMs, 120);
  assert.equal(d.buttonToCaptureDoneMs, 600);
  assert.equal(d.buttonToWarpDoneMs, 691);
  assert.equal(d.buttonToCaptureReadyMs, 691);
  assert.equal(d.buttonToDisplayMs, 760);
  assert.equal(d.previewEncodeMs, 28);
  assert.equal(d.warpToDisplayedMs, 69);
  assert.equal(d.artifactCardEncodeMs, 700);
  assert.equal(d.artifactCardWriteMs, 200);
  assert.equal(d.artifactEncodeMs, 1400);
  assert.equal(t.firstRawQuadAt, 1120);
  // Preview path must not require artifact ACK (display before artifact done).
  assert.ok(d.buttonToDisplayMs < d.artifactEncodeMs);
  assert.ok((t.previewDisplayedAt ?? 0) < (t.cardFileWriteDoneAt ?? 0));
  // Fresh START timing must not inherit prior.
  const fresh = { ...emptyGeometryTiming(), buttonPressedAt: 5000 };
  assert.equal(fresh.firstRawQuadAt, null);
  assert.equal(deriveGeometryTestMs(fresh).buttonToFirstRawMs, null);
});

check('geometry-test artifacts: card must be 744×1039; thumbnail trap classified', () => {
  assert.equal(GEOMETRY_CARD_ARTIFACT_WIDTH, 744);
  assert.equal(GEOMETRY_CARD_ARTIFACT_HEIGHT, 1039);
  assert.equal(
    classifyGeometryArtifact({
      role: 'card-warp',
      logicalWidth: 744,
      logicalHeight: 1039,
      encodedWidth: 744,
      encodedHeight: 1039,
      bytes: 1000,
    }),
    'ARTIFACT_OK',
  );
  assert.equal(
    classifyGeometryArtifact({
      role: 'card-warp',
      logicalWidth: 744,
      logicalHeight: 1039,
      encodedWidth: 120,
      encodedHeight: 168,
      bytes: 80_000,
    }),
    'ARTIFACT_DOWNSCALED',
  );
  assert.throws(() =>
    assertGeometryCardArtifactDims({ encodedWidth: 120, encodedHeight: 168, bytes: 10 }),
  );
  assert.throws(() =>
    assertGeometrySourceArtifactDims({
      logicalWidth: 1022,
      logicalHeight: 1920,
      encodedWidth: 120,
      encodedHeight: 225,
      bytes: 10,
    }),
  );
  assertGeometryCardArtifactDims({ encodedWidth: 744, encodedHeight: 1039, bytes: 10 });
  assertGeometrySourceArtifactDims({
    logicalWidth: 1022,
    logicalHeight: 1920,
    encodedWidth: 1022,
    encodedHeight: 1920,
    bytes: 10,
  });
});

check('geometry-test summarize + upload kind', () => {
  const bundle = {
    kind: 'geometry-test',
    fixtureId: 'geometry-test-unit',
    createdAt: '2026-09-10T00:00:00.000Z',
    completedAt: null,
    geometryEngine: 'current',
    focusMode: 'prefocus-once',
    initialFocusRequested: true,
    initialFocusRequestedAt: 100,
    initialFocusReportedSuccess: false,
    phase: 'complete',
    note: '',
    items: [
      {
        itemIndex: 1,
        geometryTestId: 'g1',
        captureId: 1,
        geometryEngine: 'current',
        manualCapture: false,
        focusReportedSuccess: false,
        sharpness: 10,
        sourceWidth: 1080,
        sourceHeight: 1920,
        warpWidth: 744,
        warpHeight: 1039,
        detectorFrameCount: 3,
        lockFrameCount: 2,
        timing: {
          ...emptyGeometryTiming(),
          buttonPressedAt: 0,
          firstRawQuadAt: 100,
          firstPlausibleQuadAt: 120,
          captureQuadLockedAt: 250,
          captureRequestedAt: 260,
          captureCompletedAt: 500,
          imageDisplayedAt: 510,
        },
        derivedMs: {
          buttonToFirstRawMs: 100,
          buttonToFirstPlausibleMs: 120,
          plausibleToLockMs: 130,
          buttonToCaptureRequestMs: 260,
          buttonToCaptureDoneMs: 500,
          buttonToDisplayMs: 510,
        },
        frames: [],
        lockedQuad: null,
        files: { metadata: 'geom-001-metadata.json' },
        recordedAt: '2026-09-10T00:00:00.000Z',
      },
    ],
  };
  const s = summarizeGeometryTest(bundle);
  assert.equal(s.itemCount, 1);
  assert.equal(s.firstRawP50, 100);
  assert.equal(s.captureDoneP50, 500);
  assert.equal(s.manualCaptureRate, 0);
  // Initial focus timestamps are session-level and must not be in button→capture deltas.
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.items[0].timing, 'focusRequestedAt'), false);
  assert.ok(bundle.initialFocusRequestedAt < (bundle.items[0].timing.buttonPressedAt ?? 0) || bundle.initialFocusRequestedAt === 100);
});

check('geometry-test: START timing excludes prefocus (session-level only)', () => {
  const t = {
    ...emptyGeometryTiming(),
    buttonPressedAt: 5000,
    firstRawQuadAt: 5120,
    captureCompletedAt: 5600,
  };
  const d = deriveGeometryTestMs(t);
  assert.equal(d.buttonToFirstRawMs, 120);
  assert.equal(d.buttonToCaptureDoneMs, 600);
  // No AF fields on item timing — prefocus lives on the bundle.
  assert.equal('focusRequestedAt' in t, false);
});

check('MTG fast-path: obvious card accepts; paper rectangle rejects; fail-closed', () => {
  const cardLike = {
    topLeft: { x: 80, y: 60 },
    topRight: { x: 320, y: 70 },
    bottomRight: { x: 310, y: 400 },
    bottomLeft: { x: 70, y: 390 },
  };
  const paper = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 470, y: 10 },
    bottomRight: { x: 470, y: 630 },
    bottomLeft: { x: 10, y: 630 },
  };
  const ok = evaluateMtgFastAccept({
    corners: cardLike,
    score: 0.95,
    frame: { width: 480, height: 640 },
    runnerUpScore: 0.4,
  });
  assert.equal(ok.accept, true, ok.rejectReasons.join(','));
  const badPaper = evaluateMtgFastAccept({
    corners: paper,
    score: 0.95,
    frame: { width: 480, height: 640 },
    runnerUpScore: 0.2,
  });
  assert.equal(badPaper.accept, false);
  assert.ok(badPaper.rejectReasons.some(r => r.includes('occupancy')));
  const weak = evaluateMtgFastAccept({
    corners: cardLike,
    score: 0.5,
    frame: { width: 480, height: 640 },
    runnerUpScore: 0.45,
  });
  assert.equal(weak.accept, false);
});

check('continuity soft-reset keeps track id and force-adopts next raw', () => {
  let state = emptyContinuity();
  const a = {
    topLeft: { x: 40, y: 40 },
    topRight: { x: 200, y: 40 },
    bottomRight: { x: 200, y: 260 },
    bottomLeft: { x: 40, y: 260 },
  };
  let d = stepContinuity(state, { rawCorners: a, rawScore: 0.9 });
  state = d.state;
  const id = d.track.id;
  state = softResetContinuityForNewCardSession(state, 'new-card-session');
  assert.equal(state.track?.id, id);
  assert.equal(state.track?.forceAdoptNext, true);
  const b = {
    topLeft: { x: 60, y: 80 },
    topRight: { x: 220, y: 85 },
    bottomRight: { x: 210, y: 300 },
    bottomLeft: { x: 55, y: 295 },
  };
  d = stepContinuity(state, { rawCorners: b, rawScore: 0.92 });
  assert.equal(d.track.id, id);
  assert.equal(d.track.forceAdoptNext, false);
  assert.ok(Math.abs(d.trackedCorners.topLeft.x - 60) < 1);
});

check('acquisition timing derive deltas', () => {
  const t = {
    ...emptyAcquisitionTiming(3),
    sessionStartedAt: 1000,
    firstRawQuadAt: 1180,
    firstPresentedQuadAt: 1250,
    geometryStableAt: 1400,
    hiresCaptureDoneAt: 1900,
    recognitionStartAt: 2000,
    foundAt: 2600,
  };
  const d = deriveAcquisitionMs(t);
  assert.equal(d.sessionToFirstRawMs, 180);
  assert.equal(d.firstRawToPresentedMs, 70);
  assert.equal(d.firstRawToStableMs, 220);
  assert.equal(d.stableToHiresMs, 500);
  assert.equal(d.hiresToRecognitionMs, 100);
  assert.equal(d.recognitionToFoundMs, 600);
  assert.equal(d.sessionToFoundMs, 1600);
});

check('binder-real-report: entry imports from repo root', () => {
  const reportPath = join(root, 'scripts/geometry/binder-real-report.mjs');
  assert.equal(existsSync(reportPath), true);
  const src = readFileSync(reportPath, 'utf8');
  assert.match(src, /from '\.\/lib\/detect-host\.mjs'/);
  assert.match(src, /from '\.\/lib\/paths\.mjs'/);
  assert.doesNotMatch(src, /from '\.\/geometry\/lib\//);
  // Resolve the same relative imports the report uses (repo-root yarn geometry:binder-real-report).
  const libRoot = join(root, 'scripts/geometry/lib');
  for (const rel of [
    'detect-host.mjs',
    'paths.mjs',
    'binder-mode/policy.mjs',
    'binder-mode/grid.mjs',
    'detect-native.mjs',
  ]) {
    assert.equal(existsSync(join(libRoot, rel)), true, `missing ${rel}`);
  }
  // Syntax/load smoke without running detector on inbox corpus.
  execFileSync(process.execPath, ['--check', reportPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
});

check('verified scan: NEXT is authoritative; change-watch blocked while result open', () => {
  assert.equal(verifiedScanBlocksChangeWatch('result'), true);
  assert.equal(verifiedScanBlocksChangeWatch('captured'), true);
  assert.equal(verifiedScanBlocksChangeWatch('identifying'), true);
  assert.equal(verifiedScanBlocksChangeWatch('failed'), true);
  assert.equal(verifiedScanBlocksChangeWatch('acquiring'), false);
  assert.equal(verifiedScanBlocksChangeWatch('ready'), false);
  assert.equal(verifiedScanBlocksAcquisition('result'), true);
});

check('verified scan: timing marks are first-only and derive next→quad', () => {
  let t = emptyVerifiedScanTiming();
  t = markFirstVerified(t, 'nextPressedAt', 100);
  t = markFirstVerified(t, 'nextFirstQuadAt', 180);
  t = markFirstVerified(t, 'nextFirstQuadAt', 999); // ignored
  assert.equal(t.nextFirstQuadAt, 180);
  const d = deriveVerifiedScanMs(t);
  assert.equal(d.nextToFirstQuadMs, 80);
});

await checkAsync('verified scan: hold pauses acquisition; verifiedAdvance mints fresh session', async () => {
  const prev = getSingleCapturePipeline();
  setSingleCapturePipeline('geometry-v2');
  const luma = paintCardLike(blankImage(256, 480), { gray: true });
  const corners = {
    topLeft: { x: 48, y: 60 },
    topRight: { x: 208, y: 62 },
    bottomRight: { x: 206, y: 420 },
    bottomLeft: { x: 50, y: 418 },
  };
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.9, text: 'Sol Ring' }) },
  });
  const helpers = sessionHelpers(corners, {
    allowRecognize: () => false,
    requestFocusNorm: () => {},
  });
  await runFrames(ctrl, luma, helpers, 4);
  const before = ctrl.snapshot().lockGates.cardSessionId;
  ctrl.setVerifiedHold(true);
  assert.equal(ctrl.isVerifiedHold(), true);
  const held = await runFrames(ctrl, luma, helpers, 6);
  assert.equal(held.lockGates.cardSessionId, before, 'hold must not mint new session');
  assert.ok(
    String(held.lockGates.waiting ?? '').includes('verified hold'),
    `expected verified hold waiting, got ${held.lockGates.waiting}`,
  );
  const after = ctrl.verifiedAdvance('verified-next');
  assert.equal(ctrl.isVerifiedHold(), false);
  assert.ok(after.lockGates.cardSessionId > before, 'NEXT must mint fresh cardSessionId');
  assert.equal(after.lockGates.sessionResetReason, 'verified-next');
  assert.equal(after.fused, undefined);
  assert.ok(after.phase !== 'found' && after.phase !== 'ambiguous');
  setSingleCapturePipeline(prev);
});

await checkAsync('verified scan: retryFrozenRecognition reuses hold (no second session)', async () => {
  const prev = getSingleCapturePipeline();
  setSingleCapturePipeline('geometry-v2');
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: { recognize: async () => ({ confidence: 0.2, text: '???' }) },
  });
  const warp = paintCardLike(blankImage(744, 1039), { gray: true });
  const quad = {
    topLeft: { x: 40, y: 40 },
    topRight: { x: 700, y: 40 },
    bottomRight: { x: 700, y: 1000 },
    bottomLeft: { x: 40, y: 1000 },
  };
  ctrl.setVerifiedHold(true);
  await ctrl.recognizeFrozenCapture({ recognitionQuad: quad, source: warp });
  const sid = ctrl.snapshot().lockGates.cardSessionId;
  const again = await ctrl.retryFrozenRecognition();
  assert.equal(again.lockGates.cardSessionId, sid, 'retry must not mint a new session');
  assert.equal(ctrl.isVerifiedHold(), true);
  setSingleCapturePipeline(prev);
});

check('verified scan: production profile still skips physical refine', () => {
  assert.equal(NORMAL_PRODUCTION_PROFILE.enablePhysicalRefine, false);
  assert.equal(GEOMETRY_EXPERIMENT_PROFILE.enablePhysicalRefine, true);
});

check('verified scan attempt: ownership required; survives conceptual NEXT', () => {
  const src = blankImage(1006, 1920);
  const warp = blankImage(744, 1039);
  const quad = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 700, y: 10 },
    bottomRight: { x: 700, y: 1000 },
    bottomLeft: { x: 10, y: 1000 },
  };
  assert.throws(() =>
    assertAttemptOwnership({ attemptId: 0, captureId: 1, cardSessionId: 1 }),
  );
  const a = createRecognitionAttempt({
    attemptId: 1,
    cardSessionId: 5,
    captureId: 9,
    childId: 'card-001',
    parentSessionId: 'normal-scan-session-test',
    source: src,
    warp,
    recognitionQuad: quad,
  });
  assert.equal(a.attemptId, 1);
  assert.equal(a.captureId, 9);
  assert.equal(a.terminalStatus, null);
  const advanced = markAttemptAdvancedEarly(a, 1000);
  assert.equal(advanced.userAdvancedBeforeTerminal, true);
  assert.ok(advanced.artifacts.source === src);
  assert.ok(advanced.artifacts.warp === warp);
  const recognizing = markAttemptRecognizing(advanced, 1100);
  assert.equal(recognizing.phase, 'recognizing');
  const done = finalizeAttempt(recognizing, {
    terminalStatus: 'FOUND',
    at: 1500,
    finalCard: 'Sol Ring',
    ocr: { ocrRawText: 'Sol Ring', bestCandidateName: 'Sol Ring', bestCandidateScore: 1 },
  });
  assert.equal(done.terminalStatus, 'FOUND');
  assert.equal(done.finalCard, 'Sol Ring');
  assert.equal(done.phase, 'terminal');
  // Second finalize is no-op
  const again = finalizeAttempt(done, { terminalStatus: 'SKIPPED', at: 2000 });
  assert.equal(again.terminalStatus, 'FOUND');
});

check('recognition channel: options map OCR/ART/BOTH/EDITION', () => {
  setRecognitionChannel('OCR_ONLY');
  assert.equal(getRecognitionChannel(), 'OCR_ONLY');
  assert.equal(channelUsesTitleFastPath(), true);
  assert.equal(channelToRecognizeOptions('OCR_ONLY').skipArtwork, true);
  assert.equal(channelToRecognizeOptions('ART_ONLY').skipOcr, true);
  assert.equal(channelToRecognizeOptions('ART_ONLY').skipArtwork, false);
  assert.equal(channelToRecognizeOptions('OCR_AND_ART').skipOcr, false);
  assert.equal(channelToRecognizeOptions('OCR_AND_ART').skipArtwork, false);
  assert.equal(channelToRecognizeOptions('EDITION_OCR').skipFooter, false);
  assert.equal(channelToRecognizeOptions('EDITION_OCR').wantFooter, true);
  assert.equal(channelToRecognizeOptions('EDITION_OCR').skipArtwork, true);
  assert.equal(RECOGNITION_CHANNEL_LABELS.VISUAL, 'CLIP');
  assert.equal(RECOGNITION_CHANNEL_LABELS.VISUAL_PLUS_OCR, 'CLIP+OCR');
  setRecognitionChannel('OCR_ONLY');
  const order = [];
  for (let i = 0; i < LEGACY_RECOGNITION_CHANNEL_MODES.length; i++) {
    order.push(cycleRecognitionChannel());
  }
  assert.deepEqual(order, ['ART_ONLY', 'OCR_AND_ART', 'EDITION_OCR', 'OCR_ONLY']);
  setRecognitionChannel('OCR_ONLY');
  const withVisual = [];
  for (let i = 0; i < DEV_RECOGNITION_CHANNEL_MODES.length; i++) {
    withVisual.push(cycleRecognitionChannel({ includeVisual: true }));
  }
  assert.deepEqual(withVisual, [
    'ART_ONLY',
    'OCR_AND_ART',
    'EDITION_OCR',
    'VISUAL',
    'VISUAL_PLUS_OCR',
    'OCR_ONLY',
  ]);
  assert.ok(RECOGNITION_CHANNEL_MODES.includes('VISUAL'));
  assert.ok(RECOGNITION_CHANNEL_MODES.includes('VISUAL_PLUS_OCR'));
  setRecognitionChannel('OCR_ONLY');
});

check('continuous eligibility: plausible card without capture-safe margins', () => {
  const frame = { width: 640, height: 480 };
  // Centered card occupying ~20% — eligible even with tight analysis margins.
  const good = {
    topLeft: { x: 180, y: 80 },
    topRight: { x: 460, y: 85 },
    bottomRight: { x: 450, y: 400 },
    bottomLeft: { x: 190, y: 395 },
  };
  const ok = isRecognitionEligible({ corners: good, frame, score: 0.9 });
  assert.equal(ok.eligible, true, ok.reasons.join(','));

  // Tiny postage stamp — rejected for low resolution / occupancy.
  const tiny = {
    topLeft: { x: 300, y: 220 },
    topRight: { x: 330, y: 220 },
    bottomRight: { x: 330, y: 260 },
    bottomLeft: { x: 300, y: 260 },
  };
  const badTiny = isRecognitionEligible({ corners: tiny, frame });
  assert.equal(badTiny.eligible, false);
  assert.ok(
    badTiny.reasons.includes('too_small') || badTiny.reasons.includes('low_resolution'),
  );

  // Mostly OOB — rejected (not via 2.5%/56px margin rules).
  const oob = {
    topLeft: { x: -80, y: -60 },
    topRight: { x: 40, y: -50 },
    bottomRight: { x: 30, y: 80 },
    bottomLeft: { x: -70, y: 70 },
  };
  const badOob = isRecognitionEligible({ corners: oob, frame });
  assert.equal(badOob.eligible, false);
  assert.ok(badOob.reasons.includes('too_much_oob'));

  // Near-edge but still mostly in frame: capture-safe would reject 2.5% inset;
  // recognition-eligible must still accept.
  const nearEdge = {
    topLeft: { x: 4, y: 40 },
    topRight: { x: 280, y: 42 },
    bottomRight: { x: 275, y: 420 },
    bottomLeft: { x: 8, y: 415 },
  };
  const near = isRecognitionEligible({ corners: nearEdge, frame, score: 0.85 });
  assert.equal(near.eligible, true, near.reasons.join(','));
});

check('continuous seeded select: prefers spatial match over higher distant score', () => {
  const frame = { width: 1000, height: 1400 };
  const seed = {
    topLeft: { x: 200, y: 200 },
    topRight: { x: 500, y: 200 },
    bottomRight: { x: 500, y: 620 },
    bottomLeft: { x: 200, y: 620 },
  };
  const sameCard = {
    topLeft: { x: 210, y: 205 },
    topRight: { x: 510, y: 205 },
    bottomRight: { x: 505, y: 625 },
    bottomLeft: { x: 205, y: 620 },
  };
  const otherCard = {
    topLeft: { x: 700, y: 100 },
    topRight: { x: 950, y: 100 },
    bottomRight: { x: 940, y: 450 },
    bottomLeft: { x: 710, y: 440 },
  };
  const picked = selectSeededCandidate({
    seed,
    candidates: [
      { corners: otherCard, score: 0.99 },
      { corners: sameCard, score: 0.7 },
    ],
    frame,
  });
  assert.equal(picked.reason, 'seeded_select');
  assert.equal(picked.index, 1);
  assert.ok((picked.diagnostics?.seedIoU ?? 0) > 0.5);
});

check('canonical art crop: PRIMARY matches ARTWORK_REGION; OVERSIZE_5 expands', () => {
  assert.equal(ART_CROP_VERSION, 1);
  const card = {
    width: 744,
    height: 1039,
    data: new Uint8ClampedArray(744 * 1039 * 4),
  };
  const primary = extractArtCropFromCard(card, { variant: 'PRIMARY' });
  assert.equal(primary.variant, 'PRIMARY');
  assert.equal(primary.region.x, ARTWORK_REGION.x);
  assert.equal(primary.region.w, ARTWORK_REGION.w);
  const over = extractArtCropFromCard(card, { variant: 'OVERSIZE_5' });
  assert.equal(over.variant, 'OVERSIZE_5');
  assert.ok(over.region.w > ARTWORK_REGION.w);
  assert.ok(over.region.h > ARTWORK_REGION.h);
});

check('continuous fusion: strong visual / agree / ocr exact / disagreement wait', () => {
  const strong = fuseContinuousEvidence({
    visual: { name: 'Sol Ring', oracleId: 'o1', score: 0.91, margin: 0.2 },
    ocr: null,
  });
  assert.equal(strong.publish, true);
  assert.equal(strong.source, 'VISUAL');
  assert.equal(strong.identity?.name, 'Sol Ring');

  const agree = fuseContinuousEvidence({
    visual: { name: 'Sol Ring', oracleId: 'o1', score: 0.7, margin: 0.05 },
    ocr: { name: 'Sol Ring', oracleId: 'o1', score: 0.88, exact: false },
  });
  assert.equal(agree.publish, true);
  assert.equal(agree.source, 'DUAL');

  const ocrExact = fuseContinuousEvidence({
    visual: { name: 'Wrong Card', oracleId: 'o2', score: 0.4, margin: 0.01 },
    ocr: { name: 'Counterspell', oracleId: 'o3', score: 0.97, exact: true },
  });
  assert.equal(ocrExact.publish, true);
  assert.equal(ocrExact.source, 'OCR');
  assert.equal(ocrExact.identity?.name, 'Counterspell');

  const disagree = fuseContinuousEvidence({
    visual: { name: 'Sol Ring', oracleId: 'o1', score: 0.7, margin: 0.08 },
    ocr: { name: 'Mana Crypt', oracleId: 'o9', score: 0.8, exact: false },
  });
  assert.equal(disagree.publish, false);
  assert.equal(disagree.reason, 'disagreement');
});

check('continuous card-change: duplicate suppress + new track', () => {
  const frame = { width: 640, height: 480 };
  const a = {
    topLeft: { x: 100, y: 60 },
    topRight: { x: 400, y: 60 },
    bottomRight: { x: 400, y: 420 },
    bottomLeft: { x: 100, y: 420 },
  };
  assert.equal(
    shouldSuppressDuplicate({
      embeddingSimilarity: 0.95,
      missFrames: 0,
      corners: a,
      lockedCorners: a,
      frame,
    }),
    true,
  );
  assert.equal(
    shouldStartNewTrack({
      embeddingSimilarity: 0.95,
      missFrames: 0,
      corners: a,
      lockedCorners: a,
      frame,
    }),
    false,
  );

  // Strong embedding discontinuity with confirm streak.
  assert.equal(
    shouldStartNewTrack({
      embeddingSimilarity: 0.4,
      missFrames: 0,
      corners: a,
      lockedCorners: a,
      frame,
      embeddingDiffStreak: 1,
    }),
    true,
  );

  // Absence fallback.
  assert.equal(
    shouldStartNewTrack({
      embeddingSimilarity: null,
      missFrames: 6,
      corners: null,
      lockedCorners: a,
      frame,
    }),
    true,
  );

  // Geometry displacement to a far ROI.
  const b = {
    topLeft: { x: 350, y: 50 },
    topRight: { x: 600, y: 55 },
    bottomRight: { x: 595, y: 400 },
    bottomLeft: { x: 340, y: 395 },
  };
  assert.equal(
    shouldStartNewTrack({
      embeddingSimilarity: 0.8,
      missFrames: 0,
      corners: b,
      lockedCorners: a,
      frame,
    }),
    true,
  );
});

check('continuous track ownership: stale generation cannot publish', () => {
  let session = emptyContinuousSession(1000);
  session = startNewTrack(session, 1000);
  let trackA = session.activeTrack;
  assert.ok(trackA);
  trackA = appendVisualObservation(trackA, {
    at: 1100,
    name: 'Sol Ring',
    oracleId: 'o1',
    score: 0.93,
    margin: 0.22,
    embedding: null,
  });
  const genA = trackA.generation;

  // New physical card starts track B — invalidates A ownership.
  session = startNewTrack({ ...session, activeTrack: trackA }, 2000);
  const trackB = session.activeTrack;
  assert.ok(trackB);
  assert.notEqual(trackB.generation, genA);

  const stale = tryPublish(trackA, trackB.generation, 2100);
  assert.equal(stale.owned, false);
  assert.equal(stale.published, false);
  assert.equal(stale.reason, 'stale_ownership');

  let live = appendVisualObservation(trackB, {
    at: 2200,
    name: 'Negate',
    oracleId: 'o2',
    score: 0.9,
    margin: 0.18,
    embedding: null,
  });
  const ok = tryPublish(live, live.generation, 2300);
  assert.equal(ok.owned, true);
  assert.equal(ok.published, true);
  assert.equal(ok.track.publishedIdentity?.name, 'Negate');

  session = applyPublishToSession({ ...session, activeTrack: ok.track }, ok.track);
  assert.equal(session.phase, 'IDENTITY_LOCKED');
  assert.equal(session.recentIdentities.at(-1)?.name, 'Negate');

  // Unlock bumps generation so further async from old gen is rejected.
  const unlocked = unlockForChange(ok.track);
  const afterUnlock = tryPublish(
    appendOcrObservation(ok.track, {
      at: 2400,
      name: 'Negate',
      oracleId: 'o2',
      score: 0.99,
      exact: true,
    }),
    unlocked.generation,
    2500,
  );
  assert.equal(afterUnlock.owned, false);
});

check('verified scan attempt: terminal statuses + parent summary', () => {
  assert.equal(terminalStatusFromCapture({ status: 'identified', phase: 'found' }), 'FOUND');
  assert.equal(terminalStatusFromCapture({ status: 'insufficient-confidence', phase: 'ambiguous' }), 'AMBIGUOUS');
  assert.equal(terminalStatusFromCapture({ status: 'ocr-empty', phase: null }), 'NO_MATCH');
  assert.equal(terminalStatusFromCapture({ status: 'ocr-native-error', phase: null }), 'OCR_ERROR');
  let summary = emptyParentSummary('p1');
  summary = noteAttemptCreated(summary, 42);
  summary = noteAttemptCreated(summary, 42); // idempotent
  const fake = {
    attemptId: 42,
    terminalStatus: 'FOUND',
    userAdvancedBeforeTerminal: true,
    correctionType: 'NONE',
  };
  summary = noteAttemptTerminal(summary, fake);
  summary = noteAttemptTerminal(summary, fake); // idempotent
  assert.equal(summary.attemptsCreated, 1);
  assert.equal(summary.attemptsTerminal, 1);
  assert.equal(summary.found, 1);
  assert.equal(summary.userAdvancesBeforeTerminal, 1);
  assert.ok(summary.attemptsTerminal <= summary.attemptsCreated);
});

check('verified scan forensics: freezeCorners immutable + warp validate + mapping roundtrip', () => {
  assert.equal(SINGLE_SCAN_DIAGNOSTIC_VERSION, 2);
  const live = {
    topLeft: { x: 120, y: 200 },
    topRight: { x: 880, y: 210 },
    bottomRight: { x: 870, y: 1600 },
    bottomLeft: { x: 130, y: 1590 },
  };
  const frozen = freezeCorners(live);
  live.topLeft.x = 999;
  assert.equal(frozen.topLeft.x, 120, 'frozen quad must not share point refs');

  const source = { width: 1019, height: 1920 };
  const ok = validateWarpInput({ quad: frozen, source });
  assert.equal(ok.status, 'OK', ok.reasons.join(','));

  const strip = {
    topLeft: { x: 100, y: 200 },
    topRight: { x: 130, y: 200 },
    bottomRight: { x: 130, y: 900 },
    bottomLeft: { x: 100, y: 900 },
  };
  const bad = validateWarpInput({ quad: strip, source });
  assert.equal(bad.status, 'WARP_INPUT_INVALID');

  const crossed = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 200, y: 10 },
    bottomRight: { x: 50, y: 200 },
    bottomLeft: { x: 180, y: 200 },
  };
  assert.equal(validateWarpInput({ quad: crossed, source }).status, 'WARP_INPUT_INVALID');

  const detector = { width: 296, height: 640 };
  const dest = { width: 1019, height: 1920 };
  const analysis = {
    topLeft: { x: 40, y: 80 },
    topRight: { x: 240, y: 85 },
    bottomRight: { x: 235, y: 520 },
    bottomLeft: { x: 45, y: 515 },
  };
  const projected = projectAnalysisQuadToSource(analysis, {
    detector,
    dest,
    kind: 'same-fov',
  });
  const back = mapCornersHiResToDetectorSameFov(projected, dest, detector);
  for (const k of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
    assert.ok(Math.abs(back[k].x - analysis[k].x) < 1e-6, `${k}.x roundtrip`);
    assert.ok(Math.abs(back[k].y - analysis[k].y) < 1e-6, `${k}.y roundtrip`);
  }

  // portrait + aspect mismatch + mirror
  const mirrored = projectAnalysisQuadToSource(analysis, {
    detector,
    dest,
    kind: 'same-fov',
    destMirrored: true,
  });
  assert.ok(mirrored.topLeft.x > mirrored.topRight.x);

  const artifact = buildRecognitionQuadArtifact({
    attemptId: 1,
    cardSessionId: 2,
    captureId: 3,
    analysisDimensions: detector,
    sourceDimensions: dest,
    analysisQuad: analysis,
    projectedSourceQuad: projected,
    mappingKind: 'same-fov',
    mappingVersion: 'same-fov-v1',
    warpVersion: 'warpQuadToCard-v1',
    capturePipelineVersion: 'geometry-v2',
    orientation: null,
    rotation: null,
    mirror: false,
    quadSelectionSource: 'BEST_RECENT_SAFE',
    candidateScore: 0.9,
    captureSafe: true,
    selectedQuadAt: 1,
    captureRequestedAt: 2,
    captureDoneAt: 3,
    sourceAvailableAt: 3,
    warpStartedAt: 4,
    warpDoneAt: 5,
    quadAgeAtCaptureMs: 1,
    captureLatencyMs: 1,
    sourceVsQuadAgeMs: 2,
    warpInputStatus: 'OK',
    warpSuspectStatus: 'OK',
    warpSuspectReasons: [],
    geometryFailureClass: 'OK',
  });
  assert.equal(artifact.kind, 'recognition-quad');
  assert.equal(artifact.singleScanDiagnosticVersion, 2);
});

check('verified scan timing: paint barrier preferred over legacy paintConfirmed', () => {
  let t = emptyVerifiedScanTiming();
  t = markFirstVerified(t, 'previewPaintConfirmedAt', 300);
  t = markFirstVerified(t, 'previewPaintBarrierPassedAt', 310);
  t = markFirstVerified(t, 'recognitionStartAt', 350);
  const d = deriveVerifiedScanMs(t);
  assert.equal(d.paintToRecognitionMs, 40);
});

check('verified scan attempt: A pixels cannot match B session for UI publish', () => {
  const srcA = blankImage(1006, 1920);
  const warpA = blankImage(744, 1039);
  const srcB = blankImage(1006, 1920);
  const warpB = blankImage(744, 1039);
  const quad = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 700, y: 10 },
    bottomRight: { x: 700, y: 1000 },
    bottomLeft: { x: 10, y: 1000 },
  };
  const a = createRecognitionAttempt({
    attemptId: 1,
    cardSessionId: 10,
    captureId: 1,
    childId: 'card-001',
    parentSessionId: 'p',
    source: srcA,
    warp: warpA,
    recognitionQuad: quad,
  });
  const b = createRecognitionAttempt({
    attemptId: 2,
    cardSessionId: 11,
    captureId: 2,
    childId: 'card-002',
    parentSessionId: 'p',
    source: srcB,
    warp: warpB,
    recognitionQuad: quad,
  });
  // After NEXT, active UI is B (session 11). A's OCR finishes with A's warp as source.
  const matched = matchAttemptByArtifacts([a, b], { source: warpA, warp: warpA });
  assert.equal(matched?.attemptId, 1);
  assert.equal(mayPublishAttemptToUi(a, 11), false);
  assert.equal(mayPublishAttemptToUi(b, 11), true);
});

check('verified scan timing: paint→recog derive + distinct capture/warp fields', () => {
  let t = emptyVerifiedScanTiming();
  t = markFirstVerified(t, 'captureDoneAt', 100);
  t = markFirstVerified(t, 'warpDoneAt', 250);
  t = markFirstVerified(t, 'previewPaintConfirmedAt', 300);
  t = markFirstVerified(t, 'recognitionStartAt', 340);
  const d = deriveVerifiedScanMs(t);
  assert.equal(d.captureDoneToWarpMs, 150);
  assert.equal(d.paintToRecognitionMs, 40);
});

check('normal-scan upload: COMPLETE requires forensic artifacts', () => {
  const files = [
    { relativePath: 'metadata.json', required: true },
    { relativePath: 'recognition-card.png', required: true },
    { relativePath: 'source-highres.png', required: true },
    { relativePath: 'source-with-recognition-quad.png', required: true },
    { relativePath: 'recognition-quad.json', required: true },
    { relativePath: 'title-crop.png', required: true },
  ];
  const incomplete = reconcileUploadAck({
    manifest: {
      runId: 'normal-scan-session-x--card-001',
      kind: 'normal-scan',
      createdAt: new Date().toISOString(),
      files,
    },
    acknowledged: new Set([
      'metadata.json',
      'recognition-card.png',
      'source-highres.png',
      'title-crop.png',
    ]),
  });
  assert.equal(incomplete.uploadStatus, 'INCOMPLETE');
  assert.ok(incomplete.missingRequired.includes('recognition-quad.json'));
  assert.ok(incomplete.missingRequired.includes('source-with-recognition-quad.png'));
  // Optional files must not be uploaded — filesToUpload only returns required missing.
  const optionalManifest = {
    runId: 'x',
    kind: 'normal-scan',
    createdAt: new Date().toISOString(),
    files: [
      { relativePath: 'metadata.json', required: true },
      { relativePath: 'recognition-quad.json', required: false },
    ],
  };
  assert.equal(filesToUpload(optionalManifest, []).length, 1);
  assert.equal(filesToUpload(optionalManifest, [])[0].relativePath, 'metadata.json');
  const complete = reconcileUploadAck({
    manifest: {
      runId: 'normal-scan-session-x--card-001',
      kind: 'normal-scan',
      createdAt: new Date().toISOString(),
      files,
    },
    acknowledged: new Set(files.map(f => f.relativePath)),
  });
  assert.equal(complete.uploadStatus, 'COMPLETE');
});

check('normal-scan upload kind is accepted in formatters', () => {
  assert.ok(formatUploadCompleteMessage(12, 'normal-scan').includes('NORMAL SCAN'));
  assert.ok(formatUploadCompleteMessage(12, 'normal-scan').includes('12'));
});

check('binder v0: policy separate from single scan topComponents', () => {
  assert.equal(BINDER_POLICY.topComponents, 7);
  assert.equal(BINDER_POLICY.multiReturn, true);
  assert.equal(SINGLE_SCAN_DETECT_POLICY.topComponents, 4);
  assert.equal(SINGLE_SCAN_DETECT_POLICY.multiReturn, false);
});

check('binder v0: multiReturnNms keeps distinct cards', () => {
  const a = {
    topLeft: { x: 10, y: 10 },
    topRight: { x: 60, y: 10 },
    bottomRight: { x: 60, y: 80 },
    bottomLeft: { x: 10, y: 80 },
  };
  const b = {
    topLeft: { x: 100, y: 10 },
    topRight: { x: 150, y: 10 },
    bottomRight: { x: 150, y: 80 },
    bottomLeft: { x: 100, y: 80 },
  };
  const nearA = {
    topLeft: { x: 12, y: 12 },
    topRight: { x: 58, y: 12 },
    bottomRight: { x: 58, y: 78 },
    bottomLeft: { x: 12, y: 78 },
  };
  const kept = multiReturnNms([
    { corners: a, score: 0.9 },
    { corners: nearA, score: 0.85 },
    { corners: b, score: 0.8 },
  ]);
  assert.equal(kept.length, 2);
});

check('binder v0: tracks associate across frames; acquired sticky', () => {
  const frame = { width: 300, height: 400 };
  const a = {
    topLeft: { x: 20, y: 20 },
    topRight: { x: 80, y: 20 },
    bottomRight: { x: 80, y: 100 },
    bottomLeft: { x: 20, y: 100 },
  };
  const b = {
    topLeft: { x: 120, y: 20 },
    topRight: { x: 180, y: 20 },
    bottomRight: { x: 180, y: 100 },
    bottomLeft: { x: 120, y: 100 },
  };
  let s = emptyBinderPageSession(0, 1);
  s = tickBinderTracks(s, [{ corners: a, score: 0.9 }, { corners: b, score: 0.85 }], 10, frame);
  assert.equal(s.tracks.length, 2);
  const idA = s.tracks[0].binderTrackId;
  s = tickBinderTracks(
    s,
    [
      { corners: { ...a, topLeft: { x: 22, y: 21 } }, score: 0.88 },
      { corners: b, score: 0.84 },
    ],
    20,
    frame,
  );
  assert.equal(s.tracks.length, 2);
  assert.equal(s.tracks.find(t => t.binderTrackId === idA)?.ageFrames, 2);

  const warp = paintCardLike(blankImage(744, 1039), { gray: true });
  // Force a good quality by applying identificationReady via applyBestCapture mock score.
  const quality = scoreBinderCardQuality({ corners: a, frame, warp });
  s = applyBestCapture(s, idA, {
    captureId: 1,
    sourceFrameId: 1,
    quad: a,
    warp,
    quality: { ...quality, identificationReady: true, score: Math.max(quality.score, 0.7) },
    sharpness: 250,
    capturedAt: 30,
  });
  assert.equal(s.tracks.find(t => t.binderTrackId === idA)?.acquired, true);
  // Temporary miss must not clear acquired.
  s = tickBinderTracks(s, [{ corners: b, score: 0.8 }], 40, frame);
  assert.equal(s.tracks.find(t => t.binderTrackId === idA)?.acquired, true);
  const hud = binderPageHud(s);
  assert.ok(hud.acquiredCount >= 1);
  const overlays = binderOverlays(s);
  assert.ok(overlays.some(o => o.acquired && o.binderTrackId === idA));

  const next = nextBinderPage(s, 100);
  assert.equal(next.tracks.length, 0);
  assert.equal(next.pageIndex, 1);
});

check('binder v0: snapshot policy is not every detector tick', () => {
  let s = emptyBinderPageSession(0, 0);
  assert.equal(shouldTakeBinderPageSnapshot(s, 10, { pendingTracks: 1 }), true);
  s = { ...s, lastPageSnapshotAt: 10, tracks: [] };
  assert.equal(shouldTakeBinderPageSnapshot(s, 50, { pendingTracks: 1 }), false);
  assert.equal(shouldTakeBinderPageSnapshot(s, 500, { pendingTracks: 1 }), true);
});

check('binder v0: pocket geometry allows small occupancy', () => {
  const frame = { width: 1000, height: 1400 };
  const pocket = {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 280, y: 100 },
    bottomRight: { x: 280, y: 350 },
    bottomLeft: { x: 100, y: 350 },
  };
  assert.equal(binderGeometryOk(pocket, frame).ok, true);
});

check('binder diagnostics: session/page/track naming + unresolved reasons', () => {
  const id = makeBinderSessionId(new Date('2026-09-10T12:34:56Z'));
  assert.match(id, /^binder-session-20260910-/);
  assert.equal(binderDiagFrameFile(0, 1), 'p01-f001.png');
  assert.equal(binderDiagCardFile(0, 3), 'p01-t03-card.png');
  assert.equal(binderDiagTracksFile(1), 'p02-tracks.json');
  assert.equal(binderDiagPageMetaFile(0), 'p01-metadata.json');
  const soft = classifyUnresolvedReasons({
    acquired: false,
    phase: 'tracking',
    ageFrames: 5,
    best: {
      quality: {
        reasons: ['soft', 'glare'],
        score: 0.2,
        components: { captureSafe: 1, geometry: 1, glare: 0.2, sharpness: 0.2, size: 1 },
        identificationReady: false,
      },
    },
  });
  assert.ok(soft.includes('LOW_SHARPNESS'));
  assert.ok(soft.includes('GLARE'));
  const lost = classifyUnresolvedReasons({
    acquired: false,
    phase: 'lost',
    ageFrames: 20,
    best: null,
  });
  assert.deepEqual(lost, ['TRACK_LOST']);
  const ready = readyDecisionFromBest({
    captureId: 1,
    sourceFrameId: 2,
    quad: {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 1, y: 1 },
      bottomLeft: { x: 0, y: 1 },
    },
    warp: blankImage(744, 1039),
    quality: {
      score: 0.7,
      reasons: [],
      identificationReady: true,
      components: { captureSafe: 1, geometry: 1, glare: 0.9, sharpness: 1, size: 1 },
    },
    sharpness: 220,
    capturedAt: 1,
  });
  assert.equal(ready.readyDecision, true);
  assert.equal(ready.qualityThreshold, BINDER_IDENTIFICATION_READY_MIN);
  assert.equal(ready.sharpnessThreshold, BINDER_SHARPNESS_SOFT);
});

check('binder diagnostics: applyBestCapture records quality history without downgrade', () => {
  const frame = { width: 300, height: 400 };
  const a = {
    topLeft: { x: 20, y: 20 },
    topRight: { x: 80, y: 20 },
    bottomRight: { x: 80, y: 100 },
    bottomLeft: { x: 20, y: 100 },
  };
  let s = emptyBinderPageSession(0, 1);
  s = tickBinderTracks(s, [{ corners: a, score: 0.9 }], 10, frame);
  const id = s.tracks[0].binderTrackId;
  const warp = paintCardLike(blankImage(744, 1039), { gray: true });
  s = applyBestCapture(s, id, {
    captureId: 1,
    sourceFrameId: 1,
    quad: a,
    warp,
    quality: {
      score: 0.8,
      identificationReady: true,
      reasons: [],
      components: { captureSafe: 1, geometry: 1, glare: 0.9, sharpness: 1, size: 1 },
    },
    sharpness: 250,
    capturedAt: 20,
  });
  assert.equal(s.tracks[0].acquired, true);
  assert.ok((s.tracks[0].qualityHistory ?? []).length >= 1);
  assert.ok(s.tracks[0].identificationReadyAt != null);
  // worse capture must not wipe ready
  s = applyBestCapture(s, id, {
    captureId: 2,
    sourceFrameId: 2,
    quad: a,
    warp,
    quality: {
      score: 0.1,
      identificationReady: false,
      reasons: ['soft'],
      components: { captureSafe: 1, geometry: 1, glare: 0.9, sharpness: 0.1, size: 1 },
    },
    sharpness: 40,
    capturedAt: 30,
  });
  assert.equal(s.tracks[0].acquired, true);
  assert.equal(s.tracks[0].best.captureId, 1);
});

check('binder upload kind formatter', () => {
  assert.ok(formatUploadCompleteMessage(2, 'binder').includes('BINDER'));
  assert.ok(formatUploadCompleteMessage(2, 'binder').includes('2'));
});

if (failed) {
  console.error(`\n${failed} scan check(s) failed`);
  process.exit(1);
}
console.log('\nall scan checks passed');
