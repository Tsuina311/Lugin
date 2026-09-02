// Centralized scanner thresholds.
//
// Every acceptance / stability / quality gate lives here so evaluation can tune
// one table instead of hunting magic numbers across the pipeline. Values are
// starting points measured against the synthetic corpus and should be revisited
// whenever `yarn scan:eval` moves.

/** Detector score below which we treat the frame as "no card". */
export const DETECT_MIN_SCORE = 0.28;

/** Max mean corner displacement (fraction of card diagonal) across recent frames. */
export const STABILITY_MAX_CORNER_MOVE = 0.04;

/** Max relative area change between consecutive tracked quads. */
export const STABILITY_MAX_AREA_CHANGE = 0.1;

/** How many recent detections must agree before we lock. */
export const STABILITY_WINDOW = 3;

/** Brief detector misses while tracking before clearing the candidate. */
export const TRACK_COAST_FRAMES = 3;

/** EMA factor when smoothing tracked corners (0 = raw, 1 = freeze). */
export const TRACK_SMOOTH_ALPHA = 0.45;

/** Minimum share of the analysis frame a card blob must occupy. */
export const DETECT_MIN_AREA_SHARE = 0.04;

/** Blob covering nearly the whole frame ⇒ background estimation failed. */
export const DETECT_MAX_AREA_SHARE = 0.82;

/** How many component candidates to score per mask. */
export const DETECT_TOP_COMPONENTS = 4;

/** Rolling pool of candidate frames while locking. */
export const QUALITY_POOL_SIZE = 4;

/** Minimum quality score before expensive recognition runs. */
export const QUALITY_MIN_SCORE = 0.12;

/** Title match score treated as strong evidence on its own. */
export const TITLE_STRONG = 0.82;

/** Artwork visual score treated as strong evidence on its own. */
export const VISUAL_STRONG = 0.78;

/** Combined (fused) score needed to auto-accept a card identity. */
export const ACCEPT_CARD_SCORE = 0.68;

/** Margin over runner-up required for auto-accept. */
export const ACCEPT_MARGIN = 0.05;

/** Temporal: same top oracle across this many good frames → boost. */
export const TEMPORAL_AGREE_FRAMES = 2;

/** After FOUND, how much visual descriptor change means "new card". */
export const REPLACE_VISUAL_DELTA = 0.28;

/** After FOUND, frames without a detectable card before returning to SEARCHING. */
export const GONE_FRAMES = 4;

/**
 * Cheap detection cadence (ms between analysis frames).
 * ~10–12 Hz default — tune via detect-eval, not by hardcoding elsewhere.
 */
export const DETECT_INTERVAL_MS = 90;

/** Max analysis width for live detection (keeps CV cheap). */
export const DETECT_ANALYSIS_MAX_WIDTH = 640;

/** Full recognition cooldown after a failed/ambiguous pass (ms). */
export const RECOGNIZE_COOLDOWN_MS = 350;

/** How many artwork candidates to keep before fusion. */
export const VISUAL_TOP_N = 12;

/** How many title candidates to keep before fusion. */
export const TITLE_TOP_N = 8;

/** Fusion weights — sum need not be 1; scores are normalized per signal first. */
export const FUSION_WEIGHTS = {
  footer: 0.2,
  temporal: 0.15,
  text: 0.15,
  title: 0.4,
  typeLine: 0.05,
  visual: 0.45,
} as const;
