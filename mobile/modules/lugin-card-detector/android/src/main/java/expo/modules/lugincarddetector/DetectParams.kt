package expo.modules.lugincarddetector

/**
 * Mirrors `src/lib/scan/params.ts` detector constants.
 * Keep in sync when shared thresholds change.
 */
internal object DetectParams {
  const val DETECT_MIN_AREA_SHARE = 0.04
  const val DETECT_MAX_AREA_SHARE = 0.82
  const val DETECT_TOP_COMPONENTS = 4
}
