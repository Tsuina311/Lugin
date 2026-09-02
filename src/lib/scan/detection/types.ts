// Structured detection debug — why a candidate was kept or rejected.
// Portable: no DOM.

import type { CardCorners, Point } from '../types';

export interface DetectionScoreParts {
  aspect: number;
  area: number;
  center: number;
  edge?: number;
  parallel: number;
  temporal?: number;
}

export interface DetectionCandidateDebug {
  corners: CardCorners | null;
  /** Which mask produced this blob. */
  method: string;
  components: DetectionScoreParts;
  rejectedBecause: string[];
  score: number;
}

export interface DetectionDebug {
  candidates: DetectionCandidateDebug[];
  /** Wall time of detectCardQuadExtras, ms. */
  ms: number;
  selectedIndex: number;
  workSize: { height: number; width: number };
}

export const emptyDetectionDebug = (): DetectionDebug => ({
  candidates: [],
  ms: 0,
  selectedIndex: -1,
  workSize: { height: 0, width: 0 },
});

export const cornerPoints = (c: CardCorners): Point[] => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];
