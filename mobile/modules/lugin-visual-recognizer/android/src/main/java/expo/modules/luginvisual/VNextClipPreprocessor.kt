package expo.modules.luginvisual

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Frozen CLIP preprocessing used only by scanner vNext.
 *
 * This mirrors the Node reference path in Transformers.js 2.17.2:
 * RawImage.resize(..., resample=3) -> sharp.affine(..., bicubic) -> center crop
 * -> Float32 rescale -> normalize -> HWC-to-CHW.
 *
 * Sharp/libvips bicubic details which matter for parity:
 * - direct affine coordinates (output * input / output size), without half-pixel offset
 * - Catmull-Rom coefficients quantized to 1/64-pixel lookup positions
 * - 12-bit fixed-point coefficients and rounding after each separable pass
 * - black extension outside the source image
 * - no downscale antialias pass (Sharp's affine interpolator is used directly)
 */
internal object VNextClipPreprocessor {
  private const val TARGET = 224
  private const val TRANSFORM_SCALE = 64
  private const val INTERPOLATE_SCALE = 4096
  private const val INTERPOLATE_ROUND = INTERPOLATE_SCALE / 2

  val normalizationMean = doubleArrayOf(0.48145466, 0.4578275, 0.40821073)
  val normalizationStd = doubleArrayOf(0.26862954, 0.26130258, 0.27577711)

  data class Plan(
    val resizedWidth: Int,
    val resizedHeight: Int,
    val cropLeft: Int,
    val cropTop: Int,
  )

  fun plan(width: Int, height: Int): Plan {
    require(width > 0 && height > 0) { "image dimensions must be positive" }
    val scale = max(TARGET.toDouble() / width, TARGET.toDouble() / height)
    val resizedWidth = transformersJsDimension(width * scale)
    val resizedHeight = transformersJsDimension(height * scale)
    return Plan(
      resizedWidth = resizedWidth,
      resizedHeight = resizedHeight,
      cropLeft = (resizedWidth - TARGET) / 2,
      cropTop = (resizedHeight - TARGET) / 2,
    )
  }

  fun preprocess(rgba: ByteArray, width: Int, height: Int): FloatArray {
    require(rgba.size == width * height * 4) { "RGBA length mismatch" }
    val plan = plan(width, height)
    val out = FloatArray(3 * TARGET * TARGET)
    val channelSize = TARGET * TARGET

    for (outputY in 0 until TARGET) {
      val resizedY = outputY + plan.cropTop
      val sourceY = resizedY.toDouble() * height / plan.resizedHeight
      val sourceYFloor = floor(sourceY).toInt()
      val coefficientsY = coefficients(sourceY)

      for (outputX in 0 until TARGET) {
        val resizedX = outputX + plan.cropLeft
        val sourceX = resizedX.toDouble() * width / plan.resizedWidth
        val sourceXFloor = floor(sourceX).toInt()
        val coefficientsX = coefficients(sourceX)
        val outputIndex = outputY * TARGET + outputX

        for (channel in 0..2) {
          val rows = IntArray(4)
          for (j in 0..3) {
            var horizontal = 0
            val sampleY = sourceYFloor + j - 1
            for (i in 0..3) {
              val sampleX = sourceXFloor + i - 1
              val sample = if (
                sampleX < 0 || sampleX >= width ||
                sampleY < 0 || sampleY >= height
              ) {
                0
              } else {
                rgba[(sampleY * width + sampleX) * 4 + channel].toInt() and 0xff
              }
              horizontal += coefficientsX[i] * sample
            }
            rows[j] = fixedRound(horizontal)
          }

          var vertical = 0
          for (j in 0..3) vertical += coefficientsY[j] * rows[j]
          val byteValue = min(255, max(0, fixedRound(vertical)))

          // Transformers.js stores rescaling back into Float32Array before
          // performing normalization, so preserve that intermediate rounding.
          val rescaled = (byteValue * (1.0 / 255.0)).toFloat()
          out[channel * channelSize + outputIndex] =
            (
              (rescaled.toDouble() - normalizationMean[channel]) /
                normalizationStd[channel]
            ).toFloat()
        }
      }
    }
    return out
  }

  private fun transformersJsDimension(value: Double): Int {
    // Number(value.toFixed(2)) followed by Math.floor in Transformers.js.
    val roundedToTwoDecimals =
      BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).toDouble()
    return floor(roundedToTwoDecimals).toInt()
  }

  private fun coefficients(sourceCoordinate: Double): IntArray {
    // libvips rounds the fractional coordinate to the nearest one of its
    // 64 precomputed transform-table positions.
    val scaled = (sourceCoordinate * TRANSFORM_SCALE * 2).toInt()
    val fractionIndex = ((scaled and (TRANSFORM_SCALE * 2 - 1)) + 1) shr 1
    val x = fractionIndex.toDouble() / TRANSFORM_SCALE

    val cr1 = 1.0 - x
    val cr2 = -0.5 * x
    val cr3 = cr1 * cr2
    val one = cr1 * cr3
    val four = x * cr3
    val cr4 = four - one
    return intArrayOf(
      (one * INTERPOLATE_SCALE).toInt(),
      ((cr1 - one + cr4) * INTERPOLATE_SCALE).toInt(),
      ((x - four - cr4) * INTERPOLATE_SCALE).toInt(),
      (four * INTERPOLATE_SCALE).toInt(),
    )
  }

  private fun fixedRound(value: Int): Int =
    (value + INTERPOLATE_ROUND) shr 12
}
