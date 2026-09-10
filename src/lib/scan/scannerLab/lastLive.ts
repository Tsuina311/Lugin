// Portable last-live-attempt snapshot. Phone FS lives in mobile/scannerLab.

import type { CardCorners } from '../types';
import type { RecognitionParityHashes } from '../recognizeCaptured';

export interface LastLiveAttemptMeta {
  attemptId: number;
  captureAt: number | null;
  hashes: RecognitionParityHashes;
  live: {
    matchName: string | null;
    matchScore: number | null;
    ocrText: string;
    published: boolean;
    rejectReason: string | null;
    status: string;
  };
  quadSource: string | null;
  recognitionQuad: CardCorners | null;
  savedAt: string;
  sourceHeight: number;
  sourceWidth: number;
  trackId: number | null;
}
