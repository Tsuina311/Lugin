package expo.modules.lugincarddetector

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Geometric card detector — Kotlin port of `src/lib/scan/detectCard.ts`.
 *
 * Scope (keep Magic / OCR / ranking OUT of this module):
 *   camera pixels → card corners + score + diagnostics + timingMs
 *
 * IMPLEMENTATION_STATUS: "ready"
 * - RGBA parity: luma + chroma + edge
 * - Y-plane live: luma + edge (chroma skipped — no RGB from Y alone)
 */
class LuginCardDetectorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LuginCardDetector")

    /**
     * `ready` = geometric port usable for live + parity.
     * Y-plane ready for live (luma/edge); chroma only on RGBA parity path.
     */
    Constant("implementationStatus") {
      IMPLEMENTATION_STATUS
    }

    /** Debug bisection: nested sleeve preference ON|OFF (affects next detect). */
    Function("setNestedSleeveEnabled") { enabled: Boolean ->
      DetectCard.nestedSleeveEnabled = enabled
      null
    }

    /**
     * Parity / offline path: packed RGBA bytes → NativeDetectionResult.
     *
     * Expected layout: length == width * height * 4, channel order R,G,B,A
     * (same as portable `ScanImage`). Prefer Uint8Array from JS (no base64).
     */
    Function("detectFromRgba") { rgba: ByteArray, width: Int, height: Int ->
      val started = System.nanoTime()
      validateDimensions(width, height)
      val expected = width * height * 4
      if (rgba.size != expected) {
        throw InvalidRgbaException(
          "RGBA byte length ${rgba.size} != width*height*4 ($expected) for ${width}x$height",
        )
      }

      val result = DetectCard.detectFromRgba(rgba, width, height)
      toNativeResult(result, elapsedMs(started))
    }

    /**
     * Live path: Y (luma) plane from VisionCamera YUV, no full RGB to RN.
     *
     * Return-value AsyncFunction (no explicit Promise arg). The Promise-last-arg
     * form can resolve as Unit/undefined on some expo-modules-core versions,
     * which made the live polygon disappear after the emergency APK.
     *
     * Runs off the JS thread. Hot-path payload is slim (no candidate list).
     */
    AsyncFunction("detectFromYPlane") { yBytes: ByteArray, width: Int, height: Int, rowStride: Int ->
      val started = System.nanoTime()
      validateDimensions(width, height)
      if (rowStride < width) {
        throw InvalidRgbaException("rowStride ($rowStride) must be >= width ($width)")
      }
      val minBytes = rowStride * (height - 1) + width
      if (yBytes.size < minBytes) {
        throw InvalidRgbaException(
          "Y plane byte length ${yBytes.size} < rowStride*(height-1)+width ($minBytes)",
        )
      }

      val result = DetectCard.detectFromYPlane(yBytes, width, height, rowStride)
      toNativeResult(result, elapsedMs(started), slim = true)
    }
  }

  companion object {
    /**
     * Y-plane ready for live; chroma only on RGBA parity path.
     * Status stays `"ready"`.
     */
    const val IMPLEMENTATION_STATUS = "ready"
  }
}

internal class InvalidRgbaException(message: String) : CodedException(message)

private fun validateDimensions(width: Int, height: Int) {
  if (width < 32 || height < 32) {
    throw InvalidRgbaException("width/height must be >= 32 (got ${width}x$height)")
  }
  if (width > 4096 || height > 4096) {
    throw InvalidRgbaException("width/height must be <= 4096 (got ${width}x$height)")
  }
}

private fun elapsedMs(startedNs: Long): Double =
  (System.nanoTime() - startedNs) / 1_000_000.0

private fun toNativeResult(
  result: DetectCard.DetectionResult,
  timingMs: Double,
  /** Hot path: omit candidate list (primary corners only). */
  slim: Boolean = false,
): Map<String, Any?> {
  val cornersPts = result.corners
  if (!result.detected || cornersPts == null || cornersPts.size != 4) {
    return mapOf(
      "detected" to false,
      "score" to result.score,
      "timingMs" to timingMs,
      "diagnostics" to mapOf(
        "candidateCount" to result.candidateCount,
        "rejectReason" to (result.rejectReason ?: "no card"),
        "workWidth" to result.workWidth,
        "workHeight" to result.workHeight,
      ),
    )
  }

  val corners = cornersPts.map { mapOf("x" to it.x, "y" to it.y) }
  val diagnostics =
    mapOf(
      "areaRatio" to result.areaRatio,
      "aspectRatio" to result.aspectRatio,
      "candidateCount" to result.candidateCount,
      "nestedInnerPreferred" to result.nestedInnerPreferred,
      "workWidth" to result.workWidth,
      "workHeight" to result.workHeight,
    )

  if (slim) {
    return mapOf(
      "detected" to true,
      "corners" to corners,
      "score" to result.score,
      "timingMs" to timingMs,
      "diagnostics" to diagnostics,
    )
  }

  val candidates =
    result.candidates.map { c ->
      mapOf(
        "corners" to c.corners.map { mapOf("x" to it.x, "y" to it.y) },
        "score" to c.score,
        "aspectRatio" to c.aspectRatio,
        "areaRatio" to c.areaRatio,
        "method" to c.method,
      )
    }

  return mapOf(
    "detected" to true,
    "corners" to corners,
    "score" to result.score,
    "timingMs" to timingMs,
    "candidates" to candidates,
    "diagnostics" to diagnostics,
  )
}
