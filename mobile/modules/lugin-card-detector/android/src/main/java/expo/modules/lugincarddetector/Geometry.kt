package expo.modules.lugincarddetector

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

/** Point — mirrors `src/lib/scan/geometry.ts` `Pt`. */
internal data class Pt(val x: Double, val y: Double)

/** Corners in order TL, TR, BR, BL. */
internal typealias Quad = List<Pt>

internal object Geometry {
  /** Physical Magic card aspect (mm): width / height — geometry.ts CARD_ASPECT. */
  const val CARD_ASPECT = 63.0 / 88.0

  fun dist(a: Pt, b: Pt): Double {
    val dx = a.x - b.x
    val dy = a.y - b.y
    return hypot(dx, dy)
  }

  /** Reorder any 4 corners into TL, TR, BR, BL. */
  fun orderCorners(pts: List<Pt>): Quad {
    require(pts.size == 4) { "orderCorners expects 4 points" }
    val sorted = pts.sortedWith(compareBy({ it.y }, { it.x }))
    val top = sorted.take(2).sortedBy { it.x }
    val bottom = sorted.drop(2).sortedBy { it.x }
    return listOf(top[0], top[1], bottom[1], bottom[0])
  }

  /**
   * How well a quad matches a Magic card silhouette (0–1-ish).
   * Faithful port of `scoreCardQuad` in geometry.ts.
   */
  fun scoreCardQuad(quad: Quad, imageW: Int, imageH: Int): Double {
    val tl = quad[0]
    val tr = quad[1]
    val br = quad[2]
    val bl = quad[3]
    val top = dist(tl, tr)
    val bottom = dist(bl, br)
    val left = dist(tl, bl)
    val right = dist(tr, br)
    if (top < 8 || bottom < 8 || left < 8 || right < 8) return 0.0

    val width = (top + bottom) / 2
    val height = (left + right) / 2
    val aspect = width / height
    val aspectScore = 1.0 - min(1.0, abs(aspect - CARD_ASPECT) / CARD_ASPECT)

    val parallel =
      1.0 -
        min(
          1.0,
          (abs(top - bottom) / width + abs(left - right) / height) / 2,
        )

    val area =
      abs(
        tl.x * tr.y +
          tr.x * br.y +
          br.x * bl.y +
          bl.x * tl.y -
          (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
      ) / 2
    val areaScore = min(1.0, area / (imageW * imageH * 0.35))

    val cx = (tl.x + tr.x + br.x + bl.x) / 4
    val cy = (tl.y + tr.y + br.y + bl.y) / 4
    val centerDist = hypot(cx - imageW / 2.0, cy - imageH / 2.0)
    val centerScore = 1.0 - min(1.0, centerDist / (hypot(imageW.toDouble(), imageH.toDouble()) / 2))

    return aspectScore * 0.4 + parallel * 0.25 + areaScore * 0.25 + centerScore * 0.1
  }

  data class ScoreParts(
    val aspect: Double,
    val area: Double,
    val center: Double,
    val parallel: Double,
    val edge: Double? = null,
  )

  fun scoreParts(quad: Quad, imageW: Int, imageH: Int, edge: Double? = null): ScoreParts {
    val tl = quad[0]
    val tr = quad[1]
    val br = quad[2]
    val bl = quad[3]
    val top = dist(tl, tr)
    val bottom = dist(bl, br)
    val left = dist(tl, bl)
    val right = dist(tr, br)
    val width = (top + bottom) / 2
    val height = (left + right) / 2
    val aspect = width / maxOf(height, 1e-6)
    val aspectScore = 1.0 - min(1.0, abs(aspect - CARD_ASPECT) / CARD_ASPECT)
    val parallel =
      1.0 -
        min(
          1.0,
          (abs(top - bottom) / maxOf(width, 1.0) + abs(left - right) / maxOf(height, 1.0)) / 2,
        )
    val area =
      abs(
        tl.x * tr.y +
          tr.x * br.y +
          br.x * bl.y +
          bl.x * tl.y -
          (tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x),
      ) / 2
    val areaScore = min(1.0, area / (imageW * imageH * 0.35))
    val cx = (tl.x + tr.x + br.x + bl.x) / 4
    val cy = (tl.y + tr.y + br.y + bl.y) / 4
    val centerDist = hypot(cx - imageW / 2.0, cy - imageH / 2.0)
    val centerScore = 1.0 - min(1.0, centerDist / (hypot(imageW.toDouble(), imageH.toDouble()) / 2))
    return ScoreParts(
      aspect = aspectScore,
      area = areaScore,
      center = centerScore,
      parallel = parallel,
      edge = edge,
    )
  }
}
