/** Shared benchmark upload manifest + ACK comparison (phone + host tests). */

export type BenchmarkUploadKind =
  | 'deck-benchmark'
  | 'binder-benchmark'
  | 'geometry-test'
  | 'normal-scan'
  | 'binder';
export type BenchmarkUploadFileSpec = {
  relativePath: string;
  pageIndex?: number;
  frameIndex?: number;
  bytes?: number | null;
  checksum?: string | null;
  required: boolean;
  role?: 'card-warp' | 'source' | 'metadata' | 'summary' | 'thumbnail' | 'title-crop' | 'quad';
  logicalWidth?: number | null;
  logicalHeight?: number | null;
  encodedWidth?: number | null;
  encodedHeight?: number | null;
};

export type BenchmarkUploadManifest = {
  runId: string;
  kind: BenchmarkUploadKind;
  pages?: number;
  files: BenchmarkUploadFileSpec[];
  createdAt: string;
};

export type BenchmarkUploadAckState = {
  runId: string;
  kind: BenchmarkUploadKind;
  endpointUrl: string | null;
  acknowledged: string[];
  failed: string[];
  /** Distinct client/server failure reasons (e.g. unexpected file / tunnel). */
  failReasons?: string[];
  uploadStatus: 'PENDING' | 'INCOMPLETE' | 'COMPLETE';
  missingRequired: string[];
  updatedAt: string;
};

export const emptyAckState = (
  manifest: BenchmarkUploadManifest,
  endpointUrl: string | null = null,
): BenchmarkUploadAckState => ({
  runId: manifest.runId,
  kind: manifest.kind,
  endpointUrl,
  acknowledged: [],
  failed: [],
  uploadStatus: 'PENDING',
  missingRequired: manifest.files.filter(f => f.required).map(f => f.relativePath),
  updatedAt: new Date().toISOString(),
});

export const reconcileUploadAck = (args: {
  manifest: BenchmarkUploadManifest;
  acknowledged: Iterable<string>;
  endpointUrl?: string | null;
}): BenchmarkUploadAckState => {
  const ack = new Set(args.acknowledged);
  const required = args.manifest.files.filter(f => f.required).map(f => f.relativePath);
  const missingRequired = required.filter(p => !ack.has(p));
  const acknowledged = required.filter(p => ack.has(p));
  return {
    runId: args.manifest.runId,
    kind: args.manifest.kind,
    endpointUrl: args.endpointUrl ?? null,
    acknowledged,
    failed: [],
    uploadStatus: missingRequired.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
    missingRequired,
    updatedAt: new Date().toISOString(),
  };
};

export const missingRequiredFiles = (
  manifest: BenchmarkUploadManifest,
  acknowledged: Iterable<string>,
): string[] => {
  const ack = new Set(acknowledged);
  return manifest.files.filter(f => f.required && !ack.has(f.relativePath)).map(f => f.relativePath);
};

/** Upload only paths that are still missing (retry / resume). */
export const filesToUpload = (
  manifest: BenchmarkUploadManifest,
  acknowledged: Iterable<string>,
): BenchmarkUploadFileSpec[] => {
  const missing = new Set(missingRequiredFiles(manifest, acknowledged));
  return manifest.files.filter(f => missing.has(f.relativePath));
};

export const formatUploadIncompleteMessage = (ack: BenchmarkUploadAckState): string => {
  const base = `UPLOAD INCOMPLETE · ${ack.acknowledged.length} / ${ack.acknowledged.length + ack.missingRequired.length} files uploaded`;
  const why = (ack.failReasons ?? []).filter(Boolean).slice(0, 2);
  if (!why.length) return base;
  return `${base}\n${why.join(' · ')}`;
};

export const formatUploadCompleteMessage = (pagesOrCards: number, kind: BenchmarkUploadKind): string =>
  kind === 'binder-benchmark' || kind === 'binder'
    ? `BINDER · ${pagesOrCards} pages · UPLOADED ✓`
    : kind === 'geometry-test'
      ? `GEOMETRY TEST COMPLETE · ${pagesOrCards} items · UPLOADED ✓`
      : kind === 'normal-scan'
        ? `NORMAL SCAN · ${pagesOrCards} cards · UPLOADED ✓`
        : `DECK TEST COMPLETE · ${pagesOrCards} cards · UPLOADED ✓`;