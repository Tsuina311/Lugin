import type { VNextDecisionSource } from './decide';
import type { VNextTimingSample } from './timing';

export type VNextHit = {
  oracleId: string;
  name: string;
  score: number;
};

export type VNextDebugSnapshot = {
  at: number;
  cardSessionId: number;
  candidateIndex: number | null;
  candidateCount: number;
  gbmUtility: number | null;
  geometrySource: string;
  artAnchor: string | null;
  cleanTop1: VNextHit | null;
  prototypeTop1: VNextHit | null;
  prototypeMargin: number | null;
  agreement: boolean | null;
  prototypeTop5: VNextHit[];
  ocrRaw: string | null;
  ocrNormalized: string | null;
  ocrExactOracle: string | null;
  ocrInTop5: boolean | null;
  recoveredOracle: string | null;
  finalPublishedOracle: string | null;
  frozenIdentity: Record<string, string> | null;
  source: VNextDecisionSource;
  note: string | null;
  timing: VNextTimingSample | null;
};

let last: VNextDebugSnapshot | null = null;
const listeners = new Set<() => void>();

export const setVNextDebug = (snapshot: VNextDebugSnapshot): void => {
  last = snapshot;
  listeners.forEach(listener => listener());
};

export const subscribeVNextDebug = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getVNextDebug = (): VNextDebugSnapshot | null => last;
