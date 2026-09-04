package expo.modules.lugincarddetector

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Faithful Kotlin port of `src/lib/scan/detectCard.ts` geometric path.
 *
 * Magic ranking / OCR / artwork stay out — corners + score + diagnostics only.
 */
internal object DetectCard {
  /** Analysis resolution — corners mapped back to full resolution at the end. */
  private const val WORK_WIDTH = 320

  data class ScoredCandidate(
    val corners: List<Pt>,
    val score: Double,
    val aspectRatio: Double,
    val areaRatio: Double,
    val method: String,
  )

  data class DetectionResult(
    val detected: Boolean,
    val corners: List<Pt>?,
    val score: Double,
    val candidateCount: Int,
    val aspectRatio: Double?,
    val areaRatio: Double?,
    val rejectReason: String?,
    val workWidth: Int,
    val workHeight: Int,
    /** Ranked plausible card-like quads (≤12). Primary is [corners]. */
    val candidates: List<ScoredCandidate> = emptyList(),
    /** True when primary was chosen as inner of a nested sleeve pair. */
    val nestedInnerPreferred: Boolean = false,
  )

  /**
   * @param rgba packed R,G,B,A bytes (unsigned via `and 0xFF`), length == fullW*fullH*4
   */
  fun detectFromRgba(rgba: ByteArray, fullW: Int, fullH: Int): DetectionResult {
    val scale = if (fullW > WORK_WIDTH) WORK_WIDTH.toDouble() / fullW else 1.0
    val w = max(32, round(fullW * scale).toInt())
    val h = max(32, round(fullH * scale).toInt())
    val gray = downscaleGrayFromRgba(rgba, fullW, fullH, w, h)
    val rgb = downscaleRgb(rgba, fullW, fullH, w, h)
    return detectFromGray(gray, w, h, scale, fullW, fullH, rgb = rgb)
  }

  /**
   * Live VisionCamera path: Y (luma) plane only.
   *
   * Packs/downscales plane-0 into the same WORK_WIDTH gray buffer used by
   * [detectFromRgba], then runs the **same** luma multi-threshold + Sobel edge
   * candidate path. **Chroma is skipped** — no R/G/B is available from Y alone;
   * chroma remains on the RGBA parity path only.
   *
   * @param yBytes   plane-0 bytes (may include row padding)
   * @param fullW    visible width
   * @param fullH    visible height
   * @param rowStride bytes per row (>= fullW)
   */
  fun detectFromYPlane(
    yBytes: ByteArray,
    fullW: Int,
    fullH: Int,
    rowStride: Int,
  ): DetectionResult {
    val scale = if (fullW > WORK_WIDTH) WORK_WIDTH.toDouble() / fullW else 1.0
    val w = max(32, round(fullW * scale).toInt())
    val h = max(32, round(fullH * scale).toInt())
    val gray = downscaleGrayFromYPlane(yBytes, fullW, fullH, rowStride, w, h)
    // No chroma: Y plane has no RGB — see KDoc above.
    return detectFromGray(gray, w, h, scale, fullW, fullH, rgb = null)
  }

  /**
   * Shared geometric pipeline on a WORK_WIDTH gray buffer.
   *
   * Always: luma multi-threshold + Sobel edge.
   * Optional [rgb]: chroma masks (RGBA parity path only).
   * Corners are scaled back to [fullW]×[fullH] via [scale].
   */
  private fun detectFromGray(
    gray: FloatArray,
    w: Int,
    h: Int,
    scale: Double,
    fullW: Int,
    fullH: Int,
    rgb: RgbPlanes?,
  ): DetectionResult {
    var candidateCount = 0
    var lastReject: String? = "no candidates"
    val scored = ArrayList<ScoredCandidate>()

    fun consider(mask: ByteArray, method: String, edgeExtra: Double? = null) {
      val comps = topComponents(mask, w, h, DetectParams.DETECT_TOP_COMPONENTS)
      for (component in comps) {
        candidateCount += 1
        val areaShare = component.area.toDouble() / (w * h)
        val rejected = mutableListOf<String>()
        if (areaShare < DetectParams.DETECT_MIN_AREA_SHARE) rejected.add("insufficient area")
        if (areaShare > DetectParams.DETECT_MAX_AREA_SHARE) rejected.add("covers whole frame")

        if (rejected.isEmpty()) {
          val boundary = boundaryPoints(component.pixels, w, h)
          val hull = convexHull(boundary)
          if (hull.size < 4) {
            rejected.add("hull too small")
          } else {
            val approx = extremalCorners(hull)
            if (approx == null) {
              rejected.add("degenerate corners")
            } else {
              val refined = refineCorners(boundary, approx) ?: approx
              val scaled = refined.map { Pt(it.x / scale, it.y / scale) }
              val quad = Geometry.orderCorners(scaled)
              val score = Geometry.scoreCardQuad(quad, fullW, fullH)
              val parts = Geometry.scoreParts(quad, fullW, fullH, edgeExtra)
              if (score < 0.15) rejected.add("low silhouette score")
              if (parts.aspect < 0.25) rejected.add("aspect ratio")
              if ((method.startsWith("edge") || method.startsWith("chroma")) && score < 0.45) {
                rejected.add("weak non-luma candidate")
              }
              if (rejected.isEmpty()) {
                val frameArea = (fullW * fullH).toDouble().coerceAtLeast(1.0)
                val polyArea =
                  abs(
                    quad[0].x * quad[1].y +
                      quad[1].x * quad[2].y +
                      quad[2].x * quad[3].y +
                      quad[3].x * quad[0].y -
                      (quad[0].y * quad[1].x +
                        quad[1].y * quad[2].x +
                        quad[2].y * quad[3].x +
                        quad[3].y * quad[0].x),
                  ) / 2.0
                scored.add(
                  ScoredCandidate(
                    corners = quad,
                    score = score,
                    aspectRatio = widthHeightAspect(quad),
                    areaRatio = polyArea / frameArea,
                    method = method,
                  ),
                )
                continue
              }
            }
          }
        }

        if (rejected.isNotEmpty()) {
          lastReject = rejected.joinToString("; ")
        }
      }
    }

    // --- luminance difference masks (multi-threshold) ---
    val ringStats = sampleRingStats(gray, w, h)
    if (ringStats != null) {
      val (background, spread) = ringStats
      for (mult in doubleArrayOf(2.5, 3.5, 5.0, 7.0)) {
        val thr = max(10.0, spread * mult)
        consider(diffMask(gray, w, h, background, thr), "luma×$mult")
      }
      for (thr in intArrayOf(12, 18, 28)) {
        consider(diffMask(gray, w, h, background, thr.toDouble()), "luma@$thr")
      }
    }

    // --- chroma difference (playmat / wood grain) — RGBA parity only ---
    if (rgb != null) {
      val chromaBg = sampleRingRgb(rgb, w, h)
      if (chromaBg != null) {
        for (thr in intArrayOf(18, 28, 40)) {
          consider(chromaMask(rgb, w, h, chromaBg, thr.toDouble()), "chroma@$thr")
        }
      }
    }

    // --- edge magnitude fallback ---
    val edges = sobelMask(gray, w, h)
    if (edges != null) consider(edges, "edge", edgeExtra = 0.5)

    val unique = dedupeCandidates(scored)
    if (unique.isEmpty()) {
      return DetectionResult(
        detected = false,
        corners = null,
        score = 0.0,
        candidateCount = candidateCount,
        aspectRatio = null,
        areaRatio = null,
        rejectReason = lastReject,
        workWidth = w,
        workHeight = h,
        candidates = emptyList(),
        nestedInnerPreferred = false,
      )
    }

    val pick = pickPrimaryWithNested(unique)
    val primary = unique[pick.index]
    return DetectionResult(
      detected = true,
      corners = primary.corners,
      score = primary.score,
      candidateCount = candidateCount,
      aspectRatio = primary.aspectRatio,
      areaRatio = primary.areaRatio,
      rejectReason = null,
      workWidth = w,
      workHeight = h,
      candidates = unique.take(12),
      nestedInnerPreferred = pick.nestedInner,
    )
  }

  private data class PrimaryPick(val index: Int, val nestedInner: Boolean)

  /** Prefer an inner card when nested inside a stronger outer (sleeve) silhouette. */
  private fun pickPrimaryWithNested(cands: List<ScoredCandidate>): PrimaryPick {
    var best = 0
    for (i in 1 until cands.size) {
      if (cands[i].score > cands[best].score) best = i
    }
    val n = min(cands.size, 8)
    for (o in 0 until n) {
      for (i in 0 until n) {
        if (o == i) continue
        if (cands[o].areaRatio <= cands[i].areaRatio) continue
        if (!isNestedSleeve(cands[o], cands[i])) continue
        val inner = cands[i]
        val outer = cands[o]
        if (inner.score >= 0.28 || inner.score >= outer.score * 0.75) {
          return PrimaryPick(index = i, nestedInner = true)
        }
      }
    }
    return PrimaryPick(index = best, nestedInner = false)
  }

  private fun isNestedSleeve(outer: ScoredCandidate, inner: ScoredCandidate): Boolean {
    val areaFraction = inner.areaRatio / max(outer.areaRatio, 1e-9)
    if (areaFraction < 0.55 || areaFraction > 0.97) return false
    val cO = centerOf(outer.corners)
    val cI = centerOf(inner.corners)
    val outerDiag = hypot(
      outer.corners[0].x - outer.corners[2].x,
      outer.corners[0].y - outer.corners[2].y,
    )
    val centerDistNorm = hypot(cO.x - cI.x, cO.y - cI.y) / max(outerDiag, 1.0)
    if (centerDistNorm > 0.12) return false
    return true
  }

  private fun centerOf(corners: List<Pt>): Pt {
    var x = 0.0
    var y = 0.0
    for (p in corners) {
      x += p.x
      y += p.y
    }
    val n = corners.size.coerceAtLeast(1).toDouble()
    return Pt(x / n, y / n)
  }

  private fun widthHeightAspect(quad: List<Pt>): Double {
    val top = hypot(quad[0].x - quad[1].x, quad[0].y - quad[1].y)
    val bottom = hypot(quad[3].x - quad[2].x, quad[3].y - quad[2].y)
    val left = hypot(quad[0].x - quad[3].x, quad[0].y - quad[3].y)
    val right = hypot(quad[1].x - quad[2].x, quad[1].y - quad[2].y)
    val width = (top + bottom) / 2
    val height = (left + right) / 2
    return width / max(height, 1e-6)
  }

  private fun dedupeCandidates(raw: List<ScoredCandidate>): List<ScoredCandidate> {
    val kept = ArrayList<ScoredCandidate>()
    for (c in raw.sortedByDescending { it.score }) {
      val dup = kept.any { k ->
        val d = hypot(
          centerOf(k.corners).x - centerOf(c.corners).x,
          centerOf(k.corners).y - centerOf(c.corners).y,
        )
        d < 8.0 && abs(k.areaRatio - c.areaRatio) < 0.04 && !isNestedSleeve(k, c) && !isNestedSleeve(c, k)
      }
      if (!dup) kept.add(c)
      if (kept.size >= 12) break
    }
    return kept
  }

  // ---------------------------------------------------------------------------
  // Foreground / background separation
  // ---------------------------------------------------------------------------

  private fun downscaleGrayFromRgba(
    rgba: ByteArray,
    sw: Int,
    sh: Int,
    dw: Int,
    dh: Int,
  ): FloatArray {
    val out = FloatArray(dw * dh)
    val xStep = sw.toDouble() / dw
    val yStep = sh.toDouble() / dh
    for (y in 0 until dh) {
      val sy = min(sh - 1, floor((y + 0.5) * yStep).toInt())
      for (x in 0 until dw) {
        val sx = min(sw - 1, floor((x + 0.5) * xStep).toInt())
        val i = (sy * sw + sx) * 4
        val r = (rgba[i].toInt() and 0xFF).toDouble()
        val g = (rgba[i + 1].toInt() and 0xFF).toDouble()
        val b = (rgba[i + 2].toInt() and 0xFF).toDouble()
        out[y * dw + x] = (0.299 * r + 0.587 * g + 0.114 * b).toFloat()
      }
    }
    return out
  }

  /** Pack Y plane (respecting [rowStride] padding) into a packed WORK_WIDTH gray FloatArray. */
  private fun downscaleGrayFromYPlane(
    yBytes: ByteArray,
    sw: Int,
    sh: Int,
    rowStride: Int,
    dw: Int,
    dh: Int,
  ): FloatArray {
    val out = FloatArray(dw * dh)
    val xStep = sw.toDouble() / dw
    val yStep = sh.toDouble() / dh
    for (y in 0 until dh) {
      val sy = min(sh - 1, floor((y + 0.5) * yStep).toInt())
      val rowBase = sy * rowStride
      for (x in 0 until dw) {
        val sx = min(sw - 1, floor((x + 0.5) * xStep).toInt())
        out[y * dw + x] = (yBytes[rowBase + sx].toInt() and 0xFF).toFloat()
      }
    }
    return out
  }

  private data class RgbPlanes(val r: FloatArray, val g: FloatArray, val b: FloatArray)

  private fun downscaleRgb(
    rgba: ByteArray,
    sw: Int,
    sh: Int,
    dw: Int,
    dh: Int,
  ): RgbPlanes {
    val r = FloatArray(dw * dh)
    val g = FloatArray(dw * dh)
    val b = FloatArray(dw * dh)
    val xStep = sw.toDouble() / dw
    val yStep = sh.toDouble() / dh
    for (y in 0 until dh) {
      val sy = min(sh - 1, floor((y + 0.5) * yStep).toInt())
      for (x in 0 until dw) {
        val sx = min(sw - 1, floor((x + 0.5) * xStep).toInt())
        val i = (sy * sw + sx) * 4
        val o = y * dw + x
        r[o] = (rgba[i].toInt() and 0xFF).toFloat()
        g[o] = (rgba[i + 1].toInt() and 0xFF).toFloat()
        b[o] = (rgba[i + 2].toInt() and 0xFF).toFloat()
      }
    }
    return RgbPlanes(r, g, b)
  }

  private fun median(values: DoubleArray): Double {
    if (values.isEmpty()) return 0.0
    val sorted = values.copyOf().also { it.sort() }
    return sorted[sorted.size shr 1]
  }

  private fun sampleRingStats(gray: FloatArray, w: Int, h: Int): Pair<Double, Double>? {
    val band = max(3, round(min(w, h) * 0.03).toInt())
    val ring = ArrayList<Double>(w * h / 4)
    for (y in 0 until h) {
      val edgeRow = y < band || y >= h - band
      for (x in 0 until w) {
        if (edgeRow || x < band || x >= w - band) {
          ring.add(gray[y * w + x].toDouble())
        }
      }
    }
    if (ring.size < 16) return null
    val arr = ring.toDoubleArray()
    val background = median(arr)
    val diffs = DoubleArray(arr.size) { abs(arr[it] - background) }
    val spread = median(diffs)
    return background to spread
  }

  private data class RgbBg(val r: Double, val g: Double, val b: Double)

  private fun sampleRingRgb(rgb: RgbPlanes, w: Int, h: Int): RgbBg? {
    val band = max(3, round(min(w, h) * 0.03).toInt())
    val rs = ArrayList<Double>()
    val gs = ArrayList<Double>()
    val bs = ArrayList<Double>()
    for (y in 0 until h) {
      val edgeRow = y < band || y >= h - band
      for (x in 0 until w) {
        if (!(edgeRow || x < band || x >= w - band)) continue
        val i = y * w + x
        rs.add(rgb.r[i].toDouble())
        gs.add(rgb.g[i].toDouble())
        bs.add(rgb.b[i].toDouble())
      }
    }
    if (rs.size < 16) return null
    return RgbBg(
      r = median(rs.toDoubleArray()),
      g = median(gs.toDoubleArray()),
      b = median(bs.toDoubleArray()),
    )
  }

  private fun diffMask(
    gray: FloatArray,
    w: Int,
    h: Int,
    background: Double,
    threshold: Double,
  ): ByteArray {
    val mask = ByteArray(w * h)
    for (i in mask.indices) {
      mask[i] = if (abs(gray[i] - background) > threshold) 1 else 0
    }
    dilate(mask, w, h)
    erode(mask, w, h)
    return mask
  }

  private fun chromaMask(
    rgb: RgbPlanes,
    w: Int,
    h: Int,
    bg: RgbBg,
    threshold: Double,
  ): ByteArray {
    val mask = ByteArray(w * h)
    for (i in mask.indices) {
      val dr = rgb.r[i] - bg.r
      val dg = rgb.g[i] - bg.g
      val db = rgb.b[i] - bg.b
      mask[i] = if (sqrt(dr * dr + dg * dg + db * db) > threshold) 1 else 0
    }
    dilate(mask, w, h)
    dilate(mask, w, h)
    erode(mask, w, h)
    return mask
  }

  private fun sobelMask(gray: FloatArray, w: Int, h: Int): ByteArray? {
    val mag = FloatArray(w * h)
    var sum = 0.0
    var count = 0
    for (y in 1 until h - 1) {
      for (x in 1 until w - 1) {
        val i = y * w + x
        val gx =
          -gray[i - w - 1] +
            gray[i - w + 1] -
            2 * gray[i - 1] +
            2 * gray[i + 1] -
            gray[i + w - 1] +
            gray[i + w + 1]
        val gy =
          -gray[i - w - 1] -
            2 * gray[i - w] -
            gray[i - w + 1] +
            gray[i + w - 1] +
            2 * gray[i + w] +
            gray[i + w + 1]
        val m = hypot(gx.toDouble(), gy.toDouble()).toFloat()
        mag[i] = m
        sum += m
        count += 1
      }
    }
    if (count == 0) return null
    val mean = sum / count
    val thr = max(25.0, mean * 1.8)
    val mask = ByteArray(w * h)
    for (i in mask.indices) {
      mask[i] = if (mag[i] > thr) 1 else 0
    }
    dilate(mask, w, h)
    dilate(mask, w, h)
    erode(mask, w, h)
    return mask
  }

  private fun dilate(mask: ByteArray, w: Int, h: Int) {
    val copy = mask.copyOf()
    for (y in 0 until h) {
      for (x in 0 until w) {
        val i = y * w + x
        if (copy[i].toInt() != 0) continue
        if (
          (x > 0 && copy[i - 1].toInt() != 0) ||
          (x < w - 1 && copy[i + 1].toInt() != 0) ||
          (y > 0 && copy[i - w].toInt() != 0) ||
          (y < h - 1 && copy[i + w].toInt() != 0)
        ) {
          mask[i] = 1
        }
      }
    }
  }

  private fun erode(mask: ByteArray, w: Int, h: Int) {
    val copy = mask.copyOf()
    for (y in 0 until h) {
      for (x in 0 until w) {
        val i = y * w + x
        if (copy[i].toInt() == 0) continue
        val edge =
          x == 0 ||
            y == 0 ||
            x == w - 1 ||
            y == h - 1 ||
            copy[i - 1].toInt() == 0 ||
            copy[i + 1].toInt() == 0 ||
            copy[i - w].toInt() == 0 ||
            copy[i + w].toInt() == 0
        if (edge && x > 0 && y > 0 && x < w - 1 && y < h - 1) mask[i] = 0
      }
    }
  }

  private data class Component(val area: Int, val pixels: ByteArray)

  private fun topComponents(mask: ByteArray, w: Int, h: Int, n: Int): List<Component> {
    val labels = IntArray(w * h)
    val queue = IntArray(w * h)
    val areas = ArrayList<Int>().apply { add(0) }
    var label = 0

    for (start in mask.indices) {
      if (mask[start].toInt() == 0 || labels[start] != 0) continue
      label += 1
      var head = 0
      var tail = 0
      queue[tail++] = start
      labels[start] = label
      var area = 0

      while (head < tail) {
        val i = queue[head++]
        area += 1
        val x = i % w
        val y = (i - x) / w
        if (x > 0 && mask[i - 1].toInt() != 0 && labels[i - 1] == 0) {
          labels[i - 1] = label
          queue[tail++] = i - 1
        }
        if (x < w - 1 && mask[i + 1].toInt() != 0 && labels[i + 1] == 0) {
          labels[i + 1] = label
          queue[tail++] = i + 1
        }
        if (y > 0 && mask[i - w].toInt() != 0 && labels[i - w] == 0) {
          labels[i - w] = label
          queue[tail++] = i - w
        }
        if (y < h - 1 && mask[i + w].toInt() != 0 && labels[i + w] == 0) {
          labels[i + w] = label
          queue[tail++] = i + w
        }
      }
      while (areas.size <= label) areas.add(0)
      areas[label] = area
    }

    val ranked =
      areas
        .mapIndexed { id, area -> id to area }
        .filter { it.first > 0 }
        .sortedByDescending { it.second }
        .take(max(1, n))

    return ranked.map { (id, area) ->
      val pixels = ByteArray(w * h)
      for (i in labels.indices) {
        if (labels[i] == id) pixels[i] = 1
      }
      Component(area, pixels)
    }
  }

  private fun boundaryPoints(pixels: ByteArray, w: Int, h: Int): List<Pt> {
    val out = ArrayList<Pt>()
    for (y in 0 until h) {
      var left = -1
      var right = -1
      for (x in 0 until w) {
        if (pixels[y * w + x].toInt() == 0) continue
        if (left < 0) left = x
        right = x
      }
      if (left < 0) continue
      out.add(Pt(left.toDouble(), y.toDouble()))
      if (right != left) out.add(Pt(right.toDouble(), y.toDouble()))
    }
    for (x in 0 until w) {
      var top = -1
      var bottom = -1
      for (y in 0 until h) {
        if (pixels[y * w + x].toInt() == 0) continue
        if (top < 0) top = y
        bottom = y
      }
      if (top < 0) continue
      out.add(Pt(x.toDouble(), top.toDouble()))
      if (bottom != top) out.add(Pt(x.toDouble(), bottom.toDouble()))
    }
    return out
  }

  private fun cross(o: Pt, a: Pt, b: Pt): Double =
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  private fun convexHull(points: List<Pt>): List<Pt> {
    if (points.size < 3) return points.toList()
    val sorted = points.sortedWith(compareBy({ it.x }, { it.y }))

    fun half(input: List<Pt>): MutableList<Pt> {
      val out = ArrayList<Pt>()
      for (p in input) {
        while (out.size >= 2 && cross(out[out.size - 2], out[out.size - 1], p) <= 0) {
          out.removeAt(out.size - 1)
        }
        out.add(p)
      }
      return out
    }

    val lower = half(sorted)
    val upper = half(sorted.asReversed())
    return lower.dropLast(1) + upper.dropLast(1)
  }

  private fun minAreaRectAngle(hull: List<Pt>): Double {
    var bestAngle = 0.0
    var bestArea = Double.POSITIVE_INFINITY
    for (i in hull.indices) {
      val a = hull[i]
      val b = hull[(i + 1) % hull.size]
      val angle = atan2(b.y - a.y, b.x - a.x)
      val c = cos(-angle)
      val s = sin(-angle)
      var minX = Double.POSITIVE_INFINITY
      var maxX = Double.NEGATIVE_INFINITY
      var minY = Double.POSITIVE_INFINITY
      var maxY = Double.NEGATIVE_INFINITY
      for (p in hull) {
        val x = p.x * c - p.y * s
        val y = p.x * s + p.y * c
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      val area = (maxX - minX) * (maxY - minY)
      if (area < bestArea) {
        bestArea = area
        bestAngle = angle
      }
    }
    return bestAngle
  }

  private fun extremalCorners(hull: List<Pt>): List<Pt>? {
    if (hull.size < 4) return null
    val angle = minAreaRectAngle(hull)
    val c = cos(-angle)
    val s = sin(-angle)

    var tl = hull[0]
    var tr = hull[0]
    var br = hull[0]
    var bl = hull[0]
    var minSum = Double.POSITIVE_INFINITY
    var maxSum = Double.NEGATIVE_INFINITY
    var minDiff = Double.POSITIVE_INFINITY
    var maxDiff = Double.NEGATIVE_INFINITY

    for (p in hull) {
      val x = p.x * c - p.y * s
      val y = p.x * s + p.y * c
      if (x + y < minSum) {
        minSum = x + y
        tl = p
      }
      if (x + y > maxSum) {
        maxSum = x + y
        br = p
      }
      if (x - y > maxDiff) {
        maxDiff = x - y
        tr = p
      }
      if (x - y < minDiff) {
        minDiff = x - y
        bl = p
      }
    }

    val corners = listOf(tl, tr, br, bl)
    for (i in 0 until 4) {
      for (j in i + 1 until 4) {
        if (Geometry.dist(corners[i], corners[j]) < 2) return null
      }
    }
    return corners
  }

  private data class Line(val dx: Double, val dy: Double, val x: Double, val y: Double)

  private fun fitLine(points: List<Pt>): Line? {
    if (points.size < 2) return null
    var mx = 0.0
    var my = 0.0
    for (p in points) {
      mx += p.x
      my += p.y
    }
    mx /= points.size
    my /= points.size

    var sxx = 0.0
    var syy = 0.0
    var sxy = 0.0
    for (p in points) {
      val dx = p.x - mx
      val dy = p.y - my
      sxx += dx * dx
      syy += dy * dy
      sxy += dx * dy
    }

    val theta = 0.5 * atan2(2 * sxy, sxx - syy)
    val dx = cos(theta)
    val dy = sin(theta)
    if (!dx.isFinite() || !dy.isFinite()) return null
    return Line(dx, dy, mx, my)
  }

  private fun intersect(a: Line, b: Line): Pt? {
    val det = a.dx * -b.dy - a.dy * -b.dx
    if (abs(det) < 1e-9) return null
    val rx = b.x - a.x
    val ry = b.y - a.y
    val t = (rx * -b.dy - ry * -b.dx) / det
    val p = Pt(a.x + a.dx * t, a.y + a.dy * t)
    return if (p.x.isFinite() && p.y.isFinite()) p else null
  }

  private fun pointLineDist(p: Pt, a: Pt, b: Pt): Double {
    val dx = b.x - a.x
    val dy = b.y - a.y
    val len = hypot(dx, dy)
    if (len < 1e-6) return Geometry.dist(p, a)
    return abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len
  }

  private fun refineCorners(boundary: List<Pt>, approx: List<Pt>): List<Pt>? {
    val sides = ArrayList<Line>(4)
    for (i in 0 until 4) {
      val a = approx[i]
      val b = approx[(i + 1) % 4]
      val length = Geometry.dist(a, b)
      if (length < 8) return null
      val tolerance = max(1.5, length * 0.04)

      val along =
        boundary.filter { p ->
          if (pointLineDist(p, a, b) > tolerance) return@filter false
          val t =
            ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length)
          t > 0.12 && t < 0.88
        }
      val line = if (along.size >= 3) fitLine(along) else null
      if (line == null) return null
      sides.add(line)
    }

    val out = ArrayList<Pt>(4)
    for (i in 0 until 4) {
      val previous = sides[(i + 3) % 4]
      val next = sides[i]
      val point = intersect(previous, next)
      if (
        point == null ||
        Geometry.dist(point, approx[i]) > Geometry.dist(approx[i], approx[(i + 1) % 4]) * 0.25
      ) {
        return null
      }
      out.add(point)
    }
    return out
  }
}
