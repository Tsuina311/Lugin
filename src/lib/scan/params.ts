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

/**
 * High-confidence FAST_ACCEPT may lock after this many agreeing samples
 * (still ≥1). Does not weaken low-confidence scenes.
 */
export const STABILITY_WINDOW_FAST = 2;

/** Detector score at/above which FAST stability window applies. */
export const STABILITY_FAST_MIN_SCORE = 0.88;

/** Robust lock: AABB IoU vs previous tracked quad (same physical card). */
export const STABILITY_MIN_IOU = 0.78;

/** Max center travel as a fraction of the card diagonal. */
export const STABILITY_MAX_CENTER_MOVE = 0.08;

/** Keep the current track when IoU with a candidate is at least this. */
export const CONTINUITY_KEEP_IOU = 0.55;

/** Treat a candidate as a different object below this IoU (unless nested). */
export const CONTINUITY_SWITCH_IOU = 0.35;

/** Instantaneous score must beat the track by this to start a switch. */
export const CONTINUITY_SWITCH_SCORE_MARGIN = 0.12;

/** Consecutive switch-intent frames required before replacing the track. */
export const CONTINUITY_SWITCH_FRAMES = 3;

/** Outer sleeve may promote to inner card after this many nested observations. */
export const CONTINUITY_INNER_PROMOTE_FRAMES = 3;

/** Brief detector misses while tracking before clearing the candidate. */
export const TRACK_COAST_FRAMES = 3;

/**
 * Max age of the last detector hit before lock/overlay treat geometry as gone.
 * Native detect at ~8 Hz can gap ~250 ms; 220 ms was clearing mid-cadence.
 * Still short enough that a removed card does not linger for seconds.
 */
export const DETECT_STALE_MS = 450;

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

/**
 * Minimum combined quality score before expensive recognition runs.
 * Raised so geometry-stable but soft frames stay in FOCUSING.
 */
export const QUALITY_MIN_SCORE = 0.32;

/**
 * Minimum raw sharpness (variance of luminance diffs) on the recognition crop.
 * Relative across frames of the same scene; absolute floor rejects mush.
 */
export const SHARPNESS_MIN = 55;

/** How long to wait in FOCUSING before showing distance/tap guidance (ms). */
export const FOCUS_TIMEOUT_MS = 2800;

/**
 * Bounded focus attempt. ~3–4 frames at the phone's 8 Hz detector.
 * Vendor focus callbacks oscillate; do not wait for a permanent "ok".
 */
export const FOCUS_ATTEMPT_MS = 400;

/** After a focus attempt on this track, do not request again immediately. */
export const FOCUS_COOLDOWN_MS = 1800;

/** Lock requires this detector score (table/glare in trace-0001 stayed lower). */
export const LOCK_MIN_SCORE = 0.7;

/** Min ms between automatic card-center focus requests. */
export const FOCUS_POINT_THROTTLE_MS = 700;

/** Card area share above which soft focus often means "too close". */
export const FOCUS_TOO_CLOSE_AREA_SHARE = 0.52;

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

/** Max automatic recognizeCard calls on one stable track (Scan again resets). */
export const RECOGNIZE_MAX_ATTEMPTS = 3;

/** Wait this long after an insufficient pass before the next attempt. */
export const RECOGNIZE_RETRY_MS = RECOGNIZE_COOLDOWN_MS;

/**
 * After a hi-res request, if nothing terminal / retry / recognize is active
 * for this long, POST_LOCK_STALL fires and a safe retry is scheduled.
 */
export const POST_LOCK_STALL_MS = 1200;

/** Recapture once when the live track has moved this far from the frozen warp quad. */
export const CAPTURE_STALE_IOU = 0.72;

/** Recapture once when the live track center has shifted this fraction of the diagonal. */
export const CAPTURE_STALE_CENTER = 0.1;

/** At most one geometry-stale recapture before the first recognize (plus bounded retries). */
export const CAPTURE_REPLACE_MAX = 1;

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
