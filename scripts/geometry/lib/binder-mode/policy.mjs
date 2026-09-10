/**
 * Binder Mode v0 — host-only policy (does NOT change production DetectCard).
 */

/** Production Single-mode equivalent (unchanged shipping default). */
export const SINGLE_MODE_POLICY = Object.freeze({
  name: 'single',
  diagnosticTopComponents: 4,
  diagnosticDedupeCap: 12,
  multiReturn: false,
  maxCards: 1,
});

/** Binder Mode v0 host experiment policy. */
export const BINDER_MODE_V0_POLICY = Object.freeze({
  name: 'binder-v0',
  diagnosticTopComponents: 7,
  diagnosticDedupeCap: 12,
  multiReturn: true,
  maxCards: 12,
  nmsIou: 0.35,
  minScore: 0.28,
  gridRows: 3,
  gridCols: 3,
  /** Accept local recovery when mean edge |Δluma|/255 ≥ this (weaker than global). */
  localEdgeMinMean: 0.095,
  /** Require at least this many sides above localEdgeMinSide. */
  localEdgeMinSides: 3,
  localEdgeMinSide: 0.06,
  localSearchTranslatePx: 18,
  localSearchScale: 0.08,
});

export const PIPELINE_STAGES = ['A', 'B', 'C', 'D', 'E'];
