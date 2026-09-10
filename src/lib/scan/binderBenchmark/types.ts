/** Portable Binder Benchmark types — phone capture + host replay. */

export const BINDER_PAGE_COUNTS = [1, 3, 5, 10] as const;
export type BinderPageCount = (typeof BINDER_PAGE_COUNTS)[number] | number;

export type BinderBenchmarkPhase =
  | 'idle'
  | 'config'
  | 'capturing'
  | 'turn-page'
  | 'waiting-next'
  | 'complete'
  | 'interrupted'
  | 'cancelled';

export interface BinderFrameMeta {
  pageIndex: number;
  frameIndex: number;
  timestamp: string;
  monoMs: number;
  width: number;
  height: number;
  orientation: string | null;
  captureSource: 'snapshot' | 'photo' | 'analysis-fallback';
  geometryTrackId: number | null;
  detectorScore: number | null;
  selectedQuad: unknown | null;
  focusState: string | null;
  file: string;
}

export interface BinderPageRecord {
  pageIndex: number;
  layout: { rows: number; cols: number };
  frames: BinderFrameMeta[];
  startedAt: string;
  endedAt: string | null;
  captureDurationMs: number;
  targetFrameCount: number;
}

export interface BinderBenchmarkBundle {
  kind: 'binder-benchmark';
  fixtureId: string;
  createdAt: string;
  completedAt: string | null;
  targetPages: number;
  layout: { rows: number; cols: number };
  captureDurationMs: number;
  frameCadenceMs: number;
  captureSource: string;
  captureNote: string;
  pages: BinderPageRecord[];
  phase: BinderBenchmarkPhase;
  note: string;
}

export const binderFrameFile = (pageIndex: number, frameIndex: number) =>
  `p${String(pageIndex).padStart(2, '0')}-f${String(frameIndex).padStart(3, '0')}.png`;

export const binderPageMetaFile = (pageIndex: number) =>
  `p${String(pageIndex).padStart(2, '0')}-metadata.json`;
