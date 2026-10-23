export type VisualEngineStatus = 'UNINITIALIZED' | 'LOADING' | 'READY' | 'ERROR';

export type VisualCandidate = {
  oracleId: string;
  name: string;
  score: number;
  artReferenceId: string | null;
};

export type VisualTiming = {
  preprocessMs: number;
  encoderMs: number;
  searchMs: number;
  collapseMs: number;
  totalMs: number;
};

export type VisualRecognizeResult = {
  topCandidates: VisualCandidate[];
  /** Opaque native handle id for locked-card similarity (0 if unavailable). */
  embeddingHandle: number;
  timing: VisualTiming;
};

export type VisualInitResult = {
  status: 'READY' | 'ERROR';
  modelLoadMs: number;
  indexLoadMs: number;
  artCount: number;
  oracleCount: number;
  dims: number;
  modelSha256: string | null;
  indexSha256: string | null;
  error: string | null;
};

export type VisualCompareResult = {
  similarity: number;
  ms: number;
};

export type LuginVisualNativeModule = {
  implementationStatus: string;
  initialize(): Promise<VisualInitResult>;
  getStatus(): Promise<VisualEngineStatus>;
  /**
   * Packed RGBA art-crop bytes → top-K oracle candidates.
   * Layout: length == width * height * 4, R,G,B,A.
   */
  recognizeFromRgbaBytes(
    rgba: Uint8Array | ArrayBuffer,
    width: number,
    height: number,
    topK: number,
  ): Promise<VisualRecognizeResult>;
  /** Cosine similarity vs locked embedding handle from a prior recognize. */
  compareToHandle(
    rgba: Uint8Array | ArrayBuffer,
    width: number,
    height: number,
    handle: number,
  ): Promise<VisualCompareResult>;
  lockHandle(handle: number): Promise<void>;
  clearLockedHandle(): Promise<void>;
  warmUp(): Promise<{ coldMs: number; warmMs: number }>;
  /**
   * Development-only dual gallery. Absent on binaries built before vNext.
   * Does not replace recognizeFromRgbaBytes.
   */
  recognizeVNextFromRgbaBytes?(
    rgba: Uint8Array | ArrayBuffer,
    width: number,
    height: number,
    topK: number,
  ): Promise<VNextNativeResult>;
  /** Debuggable builds only. Uses the same frozen implementation without camera or OCR. */
  runVNextParityProbeFromRgbaBytes?(
    rgba: Uint8Array | ArrayBuffer,
    width: number,
    height: number,
  ): Promise<VNextParityProbeResult>;
  lookupVNextExactName?(name: string): Promise<VNextNameLookup>;
};

export type VNextNativeHit = {
  oracleId: string;
  name: string;
  score: number;
};

export type VNextNativeResult = {
  cleanTop: VNextNativeHit[];
  prototypeTop: VNextNativeHit[];
  galleryBytes: number;
  nativeHeapBytes: number;
  frozenIdentity: VNextFrozenIdentity;
  timing: {
    preprocessMs: number;
    encoderMs: number;
    adapterMs: number;
    searchMs: number;
    totalMs: number;
  };
  error: string | null;
};

export type VNextFrozenIdentity = {
  geometryId: string;
  geometrySha256: string;
  adapterId: string;
  adapterWSha256: string;
  adapterBSha256: string;
  cleanSha256: string;
  prototypeSha256: string;
  refsSha256: string;
};

export type VNextParityProbeResult = {
  preparedRgbaSha256: string;
  embedding: number[];
  cleanTop: VNextNativeHit[];
  prototypeTop: VNextNativeHit[];
  prototypeMargin: number | null;
  agreement: boolean;
  publish: boolean;
  publishedOracleId: string | null;
  decisionSource: 'VISUAL_AGREEMENT' | 'WITHHELD';
  ocrIncluded: false;
  frozenIdentity: VNextFrozenIdentity;
  timing: VNextNativeResult['timing'];
  error: string | null;
};

export type VNextNameLookup = {
  oracleIds: string[];
  unique: boolean;
  error?: string | null;
};
