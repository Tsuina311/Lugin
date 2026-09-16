/** Portable Binder Benchmark types — phone capture + host replay. */

export const BINDER_PAGE_COUNTS = [1, 3, 5, 10] as const;
export type BinderPageCount = (typeof BINDER_PAGE_COUNTS)[number] | number;

export type BinderBenchmarkPhase =
  | 'idle'
  | 'config'
  | 'capturing'
  | 'page-saved'
  | 'turn-page'
  | 'waiting-next'
  | 'retry-page'
  | 'complete'
  | 'interrupted'
  | 'cancelled';

export type BinderPageStatus = 'COMPLETE' | 'SPARSE' | 'FAILED';

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
  /** Wall time for takeSnapshot() alone. */
  snapshotMs?: number | null;
  /** Nitro → ScanImage → persist encode/write. */
  encodeWriteMs?: number | null;
  /** snapshot + encode/write for this frame. */
  totalFrameMs?: number | null;
  /** Persisted file size in bytes when known. */
  fileBytes?: number | null;
}

export interface BinderPageRecord {
  pageIndex: number;
  layout: { rows: number; cols: number };
  frames: BinderFrameMeta[];
  startedAt: string;
  endedAt: string | null;
  captureDurationMs: number;
  /** Target frames for this page (frame-driven). */
  targetFrameCount: number;
  requestedFrames?: number;
  savedFrames?: number;
  failedFrames?: number;
  status?: BinderPageStatus;
  /** Why capture loop stopped. */
  stopReason?: 'target' | 'max-time' | 'cancelled' | null;
  maxPageMs?: number;
}

export interface BinderBenchmarkBundle {
  kind: 'binder-benchmark';
  fixtureId: string;
  createdAt: string;
  completedAt: string | null;
  targetPages: number;
  layout: { rows: number; cols: number };
  /** @deprecated Prefer targetFramesPerPage + maxPageMs (legacy bundles only). */
  captureDurationMs: number;
  /** @deprecated Fictional cadence; ignored by frame-driven capture. */
  frameCadenceMs: number;
  targetFramesPerPage: number;
  minFramesOk: number;
  maxPageMs: number;
  captureSource: string;
  captureNote: string;
  pages: BinderPageRecord[];
  phase: BinderBenchmarkPhase;
  note: string;
  /** Present after upload packaging — host can verify ACK completeness. */
  uploadStatus?: 'PENDING' | 'INCOMPLETE' | 'COMPLETE';
  missingFiles?: string[];
  uploadManifest?: {
    expectedFiles: string[];
    uploadedFiles: string[];
    missingFiles: string[];
  };
}

export const binderFrameFile = (pageIndex: number, frameIndex: number) =>
  `p${String(pageIndex).padStart(2, '0')}-f${String(frameIndex).padStart(3, '0')}.png`;

export const binderPageMetaFile = (pageIndex: number) =>
  `p${String(pageIndex).padStart(2, '0')}-metadata.json`;
