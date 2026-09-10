import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import { extractTitleCrop } from '@/lib/scan/ocrInput';
import { sharpnessScore } from '@/lib/scan/quality';
import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';
import { cardFingerprintFromWarp } from '@/lib/scan/session/cardSession';
import type { CardNameIndex } from '@/lib/scan/matchName';
import type { TextRecognizer } from '@/lib/scan/textRecognizer';
import type { CardCorners, ScanImage } from '@/lib/scan/types';
import {
  swapIdForIndex,
  type SwapTestCaptureRecord,
  type SwapTestGateSnapshot,
} from '@/lib/scan/swapTest';

import { HIRES_MAX_LONG_EDGE, type HiResSpaces } from '../hiresCapture';
import { mapCornersToHiRes } from '../hiresMap';
import { imageToScanImage } from '../imageToScanImage';
import type { CameraRef } from 'react-native-vision-camera';

export type SwapSlotLatch = {
  detectorCorners: CardCorners;
  spaces: HiResSpaces;
  trackId: number | null;
};

export type SwapSlotCapture = {
  card: ScanImage;
  record: SwapTestCaptureRecord;
  source: ScanImage;
};

export type SwapSlotContext = {
  cameraRef: { current: CameraRef | null };
  expectedLabel: string | null;
  gates: SwapTestGateSnapshot;
  index: number;
  liveIdentity: string | null;
  liveRecognitionDecision: string | null;
  liveRecognitionStatus: string | null;
  nameIndex: CardNameIndex | null;
  ocr: TextRecognizer | null;
  peekLatch: () => SwapSlotLatch | null;
  recognizeAttemptsForTrack: number | null;
};

export const captureSwapSlot = async (ctx: SwapSlotContext): Promise<SwapSlotCapture> => {
  const cam = ctx.cameraRef.current;
  if (!cam?.takeSnapshot) throw new Error('takeSnapshot is not available');
  const latch = ctx.peekLatch();
  if (!latch) throw new Error('no valid recognitionQuad — keep a card in view');

  const focusBefore = ctx.gates.focusAttemptId;
  const snap = await cam.takeSnapshot();
  try {
    const source = await imageToScanImage(snap, HIRES_MAX_LONG_EDGE);
    const live = ctx.peekLatch() ?? latch;
    const mapped = mapCornersToHiRes(live.detectorCorners, {
      dest: { height: source.height, width: source.width },
      detector: live.spaces.detector,
      kind: 'same-fov',
    });
    const warp = warpQuadToCard(source, cornersToQuad(mapped));
    const { image: title } = extractTitleCrop(warp);

    let matchName = ctx.liveIdentity;
    let decision = ctx.liveRecognitionDecision;
    let status = ctx.liveRecognitionStatus;
    let card = warp;

    if (ctx.ocr && ctx.nameIndex && !matchName) {
      const recognized = await recognizeCapturedCard({
        alreadyWarped: false,
        attemptId: 1,
        captureAt: null,
        nameIndex: ctx.nameIndex,
        ocr: ctx.ocr,
        recognitionQuad: mapped,
        source,
        trackId: live.trackId ?? ctx.gates.geometryTrackId,
      });
      card = recognized.warp ?? warp;
      matchName = recognized.matchName;
      decision = recognized.titleDecode.decision;
      status = recognized.status;
    }

    void cardFingerprintFromWarp(card);

    return {
      card,
      record: {
        actualDelayFromFocusRequestMs: null,
        cardSessionId: ctx.gates.cardSessionId,
        cardSharpness: sharpnessScore(card),
        expectedLabel: ctx.expectedLabel,
        focusAttemptId: focusBefore,
        geometryTrackId: ctx.gates.geometryTrackId,
        identity: matchName,
        index: ctx.index,
        label: swapIdForIndex(ctx.index),
        recognizeAttemptsForTrack: ctx.recognizeAttemptsForTrack,
        recognitionDecision: decision,
        recognitionStatus: status,
        sessionResetReason: ctx.gates.sessionResetReason,
        sourceHeight: source.height,
        sourceWidth: source.width,
        swapId: swapIdForIndex(ctx.index),
        titleSharpness: sharpnessScore(title),
        visualFingerprintDelta: ctx.gates.changeWatchDelta ?? ctx.gates.fingerprintDelta,
        changeWatchBand: ctx.gates.changeWatchBand,
        changeWatchDelta: ctx.gates.changeWatchDelta,
        changeWatchState: ctx.gates.changeWatchState,
      },
      source,
    };
  } finally {
    snap.dispose();
  }
};
