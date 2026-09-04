package expo.modules.lugincarddetector

import java.io.File
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Parity / smoke tests for [DetectCard.detectFromRgba].
 *
 * Synthetic smoke always runs (no fixtures).
 *
 * Fixture corpus: export with `yarn scan:detect-native-parity`, then:
 *
 *   DETECT_PARITY_DIR=/abs/path/to/.scan-fixtures/detect-parity \
 *     ./gradlew :lugin-card-detector:testDebugUnitTest -p mobile/android
 */
class DetectCardParityTest {

  @Test
  fun detectsSyntheticHighContrastCard() {
    val w = 240
    val h = 320
    val rgba = ByteArray(w * h * 4)
    // Light desk
    for (i in rgba.indices step 4) {
      rgba[i] = 220.toByte()
      rgba[i + 1] = 218.toByte()
      rgba[i + 2] = 210.toByte()
      rgba[i + 3] = 255.toByte()
    }
    // Dark card rectangle (~card aspect) centered
    val cardW = 120
    val cardH = 168
    val ox = (w - cardW) / 2
    val oy = (h - cardH) / 2
    for (y in oy until oy + cardH) {
      for (x in ox until ox + cardW) {
        val i = (y * w + x) * 4
        val border = x == ox || y == oy || x == ox + cardW - 1 || y == oy + cardH - 1
        val v = if (border) 20 else 90
        rgba[i] = v.toByte()
        rgba[i + 1] = v.toByte()
        rgba[i + 2] = v.toByte()
        rgba[i + 3] = 255.toByte()
      }
    }

    val result = DetectCard.detectFromRgba(rgba, w, h)
    assertTrue("expected synthetic card detection, got reject=${result.rejectReason}", result.detected)
    assertTrue(result.corners != null && result.corners!!.size == 4)
    assertTrue("score ${result.score}", result.score >= 0.28)
  }

  @Test
  fun parityFixturesMatchSharedJsWhenPresent() {
    val dirPath = System.getenv("DETECT_PARITY_DIR")
    assumeTrue(
      "Set DETECT_PARITY_DIR to .scan-fixtures/detect-parity (after yarn scan:detect-native-parity)",
      !dirPath.isNullOrBlank(),
    )
    val dir = File(dirPath!!)
    assumeTrue("parity dir missing: $dirPath", dir.isDirectory)

    val metas =
      dir.listFiles { f -> f.isFile && f.name.endsWith(".json") && f.name != "index.json" }
        ?.sortedBy { it.name }
        .orEmpty()
    assumeTrue("no case JSON in $dirPath — run yarn scan:detect-native-parity", metas.isNotEmpty())

    var checked = 0
    var detectionsMatch = 0
    var iouSum = 0.0
    var iouN = 0
    var cornerClose = 0

    for (metaFile in metas) {
      val text = metaFile.readText()
      val rgbaName = jsonString(text, "rgbaFile") ?: continue
      val width = jsonInt(text, "width") ?: continue
      val height = jsonInt(text, "height") ?: continue
      val rgbaFile = File(dir, rgbaName)
      if (!rgbaFile.isFile) continue

      val rgba = rgbaFile.readBytes()
      require(rgba.size == width * height * 4) {
        "${metaFile.name}: rgba size ${rgba.size} != ${width * height * 4}"
      }

      val native = DetectCard.detectFromRgba(rgba, width, height)
      val sharedDetected = jsonBool(jsonObject(text, "sharedJs") ?: "", "detected") == true
      val gt = parseCorners(jsonObject(text, "groundTruth"))
      val sharedCorners = parseCorners(jsonObject(jsonObject(text, "sharedJs") ?: "", "corners"))

      checked += 1
      if (native.detected == sharedDetected) detectionsMatch += 1

      if (native.detected && gt != null) {
        val iou = polygonIoU(native.corners!!, gt)
        iouSum += iou
        iouN += 1
        // Same gate as scan-detect-eval: IoU < 0.35 is a false positive
        assertTrue("${metaFile.name}: native IoU $iou vs GT", iou >= 0.35 || !sharedDetected)
      }

      if (native.detected && sharedDetected && sharedCorners != null) {
        val diag = hypot(width.toDouble(), height.toDouble())
        val err = meanCornerErr(native.corners!!, sharedCorners, diag)
        if (err < 0.02) cornerClose += 1 // within 2% of frame diagonal
      }

      if (!native.detected && gt == null && sharedDetected == false) {
        // negative / no-card agreement
      }
    }

    assertTrue("checked 0 fixtures in $dirPath", checked > 0)
    val meanIoUReport = if (iouN > 0) iouSum / iouN else 0.0
    println(
      "PARITY_SUMMARY checked=$checked detectAgree=$detectionsMatch/$checked " +
        "meanIoUVsGt=${"%.4f".format(meanIoUReport)} cornerClose=$cornerClose/$detectionsMatch",
    )
    val detectAgree = detectionsMatch.toDouble() / checked
    assertTrue(
      "detection agreement $detectionsMatch/$checked (${"%.1f".format(100 * detectAgree)}%) — expect ≥ 90%",
      detectAgree >= 0.9,
    )
    if (iouN > 0) {
      val meanIoU = iouSum / iouN
      assertTrue("mean native IoU vs GT $meanIoU — expect ≥ 0.85", meanIoU >= 0.85)
    }
    if (cornerClose > 0 || detectionsMatch > 0) {
      // Soft: report closeness; hard fail only if many detections but none close
      val closeRate = if (detectionsMatch > 0) cornerClose.toDouble() / max(1, detectionsMatch) else 1.0
      assertTrue(
        "corner closeness to shared-js $cornerClose/$detectionsMatch — expect ≥ 80% within 2% diag",
        closeRate >= 0.8 || detectionsMatch < 3,
      )
    }
  }

  // --- tiny JSON helpers (avoid pulling org.json Android-only into JVM tests) ---

  private fun jsonObject(src: String, key: String): String? {
    val needle = "\"$key\""
    val i = src.indexOf(needle)
    if (i < 0) return null
    val afterColon = src.substring(i + needle.length).trimStart()
    if (!afterColon.startsWith(":")) return null
    val rest = afterColon.substring(1).trimStart()
    if (rest.startsWith("null")) return null
    if (!rest.startsWith("{")) return null
    val j = src.length - rest.length
    var depth = 0
    for (k in j until src.length) {
      when (src[k]) {
        '{' -> depth++
        '}' -> {
          depth--
          if (depth == 0) return src.substring(j, k + 1)
        }
      }
    }
    return null
  }

  private fun jsonString(src: String, key: String): String? {
    val re = Regex("\"$key\"\\s*:\\s*\"([^\"]*)\"")
    return re.find(src)?.groupValues?.get(1)
  }

  private fun jsonInt(src: String, key: String): Int? {
    val re = Regex("\"$key\"\\s*:\\s*(-?\\d+)")
    return re.find(src)?.groupValues?.get(1)?.toIntOrNull()
  }

  private fun jsonBool(src: String, key: String): Boolean? {
    val re = Regex("\"$key\"\\s*:\\s*(true|false)")
    return re.find(src)?.groupValues?.get(1)?.toBooleanStrictOrNull()
  }

  private fun jsonDouble(obj: String, key: String): Double? {
    val re = Regex("\"$key\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)")
    return re.find(obj)?.groupValues?.get(1)?.toDoubleOrNull()
  }

  private fun parseCorners(obj: String?): List<Pt>? {
    if (obj == null) return null
    fun pt(name: String): Pt? {
      val block = jsonObject(obj, name) ?: return null
      val x = jsonDouble(block, "x") ?: return null
      val y = jsonDouble(block, "y") ?: return null
      return Pt(x, y)
    }
    val tl = pt("topLeft") ?: return null
    val tr = pt("topRight") ?: return null
    val br = pt("bottomRight") ?: return null
    val bl = pt("bottomLeft") ?: return null
    return listOf(tl, tr, br, bl)
  }

  private fun meanCornerErr(a: List<Pt>, b: List<Pt>, diag: Double): Double {
    var sum = 0.0
    for (i in 0 until 4) {
      sum += hypot(a[i].x - b[i].x, a[i].y - b[i].y)
    }
    return sum / 4.0 / max(diag, 1.0)
  }

  private fun shoelace(pts: List<Pt>): Double {
    if (pts.size < 3) return 0.0
    var s = 0.0
    for (i in pts.indices) {
      val p = pts[i]
      val q = pts[(i + 1) % pts.size]
      s += p.x * q.y - q.x * p.y
    }
    return abs(s) / 2.0
  }

  private fun cross(a: Pt, b: Pt, p: Pt): Double =
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)

  private fun edgeIntersect(p: Pt, q: Pt, a: Pt, b: Pt): Pt? {
    val dx = q.x - p.x
    val dy = q.y - p.y
    val ex = b.x - a.x
    val ey = b.y - a.y
    val det = dx * ey - dy * ex
    if (abs(det) < 1e-9) return null
    val t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / det
    return Pt(p.x + t * dx, p.y + t * dy)
  }

  private fun clipPolygon(subject: List<Pt>, clip: List<Pt>): List<Pt> {
    var output = subject.toList()
    for (i in clip.indices) {
      val a = clip[i]
      val b = clip[(i + 1) % clip.size]
      val input = output
      output = ArrayList()
      if (input.isEmpty()) break
      for (j in input.indices) {
        val p = input[j]
        val q = input[(j + 1) % input.size]
        val pin = cross(a, b, p) >= 0
        val qin = cross(a, b, q) >= 0
        if (pin && qin) output = output + q
        else if (pin && !qin) {
          edgeIntersect(p, q, a, b)?.let { output = output + it }
        } else if (!pin && qin) {
          edgeIntersect(p, q, a, b)?.let { output = output + it }
          output = output + q
        }
      }
    }
    return output
  }

  private fun polygonIoU(a: List<Pt>, b: List<Pt>): Double {
    val areaA = shoelace(a)
    val areaB = shoelace(b)
    val inter = shoelace(clipPolygon(a, b))
    val union = areaA + areaB - inter
    return if (union > 1e-6) inter / union else 0.0
  }
}
