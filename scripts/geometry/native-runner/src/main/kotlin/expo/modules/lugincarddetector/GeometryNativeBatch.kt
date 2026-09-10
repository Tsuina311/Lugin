package expo.modules.lugincarddetector

import java.io.File
import kotlin.system.measureTimeMillis

/**
 * Host batch runner for the **production** [DetectCard] implementation.
 *
 * Reads a manifest from GEOMETRY_NATIVE_BATCH_DIR and writes results.json.
 * One JVM process → N fixtures (no per-image Gradle spawn).
 *
 * Input modes (GEOMETRY_NATIVE_INPUT):
 *   rgba         — packed RGBA → detectFromRgba (matches shared-js ScanImage / chroma on)
 *   y-from-rgba  — derive Y from RGBA → detectFromYPlane (closer to live VisionCamera; no chroma)
 *
 * Runtime is HOST JVM algorithm time — NOT device latency.
 */
fun main(args: Array<String>) {
  val dirPath =
    System.getenv("GEOMETRY_NATIVE_BATCH_DIR")
      ?: args.getOrNull(0)
      ?: error("Set GEOMETRY_NATIVE_BATCH_DIR to the batch directory")
  val inputMode = (System.getenv("GEOMETRY_NATIVE_INPUT") ?: "rgba").lowercase()
  val exportPipeline =
    (System.getenv("GEOMETRY_NATIVE_PIPELINE") ?: "0").let {
      it == "1" || it.equals("true", ignoreCase = true)
    }
  val diagTop = System.getenv("GEOMETRY_NATIVE_DIAG_TOP_COMPONENTS")?.toIntOrNull()
  val diagDedupe = System.getenv("GEOMETRY_NATIVE_DIAG_DEDUPE_CAP")?.toIntOrNull()
  // Host diagnosis only — does not change DetectCard selection when true.
  DetectCard.exportPipelineStages = exportPipeline
  DetectCard.diagnosticTopComponents = diagTop
  DetectCard.diagnosticDedupeCap = diagDedupe
  val dir = File(dirPath)
  require(dir.isDirectory) { "batch dir missing: $dirPath" }

  val manifestFile = File(dir, "manifest.json")
  require(manifestFile.isFile) { "missing manifest.json in $dirPath" }

  val cases = parseManifestCases(manifestFile.readText())
  val results = ArrayList<MutableMap<String, Any?>>()
  var ok = 0
  var fail = 0

  for (c in cases) {
    val id = c["id"] as String
    val rgbaFile = c["rgbaFile"] as String
    val width = (c["width"] as Number).toInt()
    val height = (c["height"] as Number).toInt()
    val orientation = c["orientation"] as? String
    val file = File(dir, rgbaFile)
    val row = linkedMapOf<String, Any?>(
      "id" to id,
      "width" to width,
      "height" to height,
      "orientation" to orientation,
      "inputMode" to inputMode,
      "runtimeNote" to "HOST_JVM_NOT_DEVICE_LATENCY",
    )
    try {
      require(file.isFile) { "missing rgba $rgbaFile" }
      val rgba = file.readBytes()
      require(rgba.size == width * height * 4) {
        "rgba size ${rgba.size} != ${width * height * 4}"
      }

      lateinit var result: DetectCard.DetectionResult
      val ms = measureTimeMillis {
        result =
          when (inputMode) {
            "y-from-rgba", "y", "yplane" -> {
              val y = lumaFromRgba(rgba, width, height)
              DetectCard.detectFromYPlane(y, width, height, width)
            }
            else -> DetectCard.detectFromRgba(rgba, width, height)
          }
      }

      val detected = result.detected && result.score >= 0.28
      val selectedIndex = findSelectedIndex(result)
      row["detected"] = detected
      row["score"] = result.score
      row["runtimeMs"] = ms.toDouble()
      row["candidateCount"] = result.candidateCount
      row["shortlistCount"] = result.candidates.size
      row["rejectReason"] = result.rejectReason
      row["workWidth"] = result.workWidth
      row["workHeight"] = result.workHeight
      row["nestedInnerPreferred"] = result.nestedInnerPreferred
      row["selectedIndex"] = selectedIndex
      row["method"] =
        selectedIndex?.let { result.candidates.getOrNull(it)?.method }
          ?: result.candidates.firstOrNull()?.method
      row["corners"] =
        if (result.corners != null && result.corners!!.size == 4) {
          cornersMap(result.corners!!)
        } else null
      // Host/debug export only — production Expo API unchanged.
      // ScoreParts recomputed via Geometry.scoreParts (not stored on ScoredCandidate).
      row["candidates"] =
        result.candidates.mapIndexed { i, c ->
          enrichCandidate(c, rank = i + 1, fullW = width, fullH = height, selected = i == selectedIndex)
        }
      row["nestedPairs"] = nestedPairsAmong(result.candidates)
      if (exportPipeline && result.pipeline != null) {
        row["pipeline"] = serializePipeline(result.pipeline!!)
      }
      row["failureReason"] = if (detected) null else (result.rejectReason ?: "not-detected")
      ok += 1
    } catch (e: Exception) {
      row["detected"] = false
      row["score"] = 0.0
      row["runtimeMs"] = null
      row["corners"] = null
      row["failureReason"] = e.message ?: e.toString()
      fail += 1
    }
    results.add(row)
  }

  val out =
    linkedMapOf(
      "engine" to "android-native",
      "detector" to "DetectCard.kt",
      "inputMode" to inputMode,
      "pipelineExport" to exportPipeline,
      "runtimeNote" to "HOST_JVM_NOT_DEVICE_LATENCY",
      "generatedAt" to java.time.Instant.now().toString(),
      "batchDir" to dir.absolutePath,
      "ok" to ok,
      "fail" to fail,
      "results" to results,
    )

  File(dir, "results.json").writeText(toJson(out) + "\n")
  println("GEOMETRY_NATIVE_BATCH ok=$ok fail=$fail mode=$inputMode → ${File(dir, "results.json").absolutePath}")
}

private fun ptMap(p: Pt) = mapOf("x" to p.x, "y" to p.y)

private fun cornersMap(corners: List<Pt>) =
  mapOf(
    "topLeft" to ptMap(corners[0]),
    "topRight" to ptMap(corners[1]),
    "bottomRight" to ptMap(corners[2]),
    "bottomLeft" to ptMap(corners[3]),
  )

/** Match DetectionResult.corners to shortlist index (nested pick may not be rank-1 by score). */
private fun findSelectedIndex(result: DetectCard.DetectionResult): Int? {
  val sel = result.corners ?: return null
  if (sel.size != 4) return null
  for ((i, c) in result.candidates.withIndex()) {
    if (c.corners.size != 4) continue
    var same = true
    for (k in 0 until 4) {
      if (kotlin.math.abs(c.corners[k].x - sel[k].x) > 0.5 ||
        kotlin.math.abs(c.corners[k].y - sel[k].y) > 0.5
      ) {
        same = false
        break
      }
    }
    if (same) return i
  }
  return 0.takeIf { result.candidates.isNotEmpty() }
}

/**
 * Host-only enrichment: recompute [Geometry.scoreParts] for component breakdown.
 * Does not change DetectCard selection — diagnosis only.
 */
private fun enrichCandidate(
  c: DetectCard.ScoredCandidate,
  rank: Int,
  fullW: Int,
  fullH: Int,
  selected: Boolean,
): Map<String, Any?> {
  val parts = Geometry.scoreParts(c.corners, fullW, fullH)
  return linkedMapOf(
    "rank" to rank,
    "selected" to selected,
    "quad" to cornersMap(c.corners),
    "finalScore" to c.score,
    "method" to c.method,
    "aspectRatio" to c.aspectRatio,
    "areaShare" to c.areaRatio,
    "components" to
      linkedMapOf(
        "aspect" to parts.aspect,
        "parallel" to parts.parallel,
        "area" to parts.area,
        "center" to parts.center,
        "edge" to parts.edge,
        "weights" to
          linkedMapOf(
            "aspect" to 0.4,
            "parallel" to 0.25,
            "area" to 0.25,
            "center" to 0.1,
          ),
        "formula" to "aspect*0.4 + parallel*0.25 + area*0.25 + center*0.1",
        "note" to
          "edge is not in the weighted sum (gate/extra only). Gates that reject before shortlist are not listed here.",
      ),
  )
}

/**
 * Nested-sleeve relationships among the returned shortlist, using the same
 * geometric rules as DetectCard.isNestedSleeve (areaFraction 0.55–0.97, center≤0.12).
 * Host analysis only — does not alter selection.
 */
private fun nestedPairsAmong(cands: List<DetectCard.ScoredCandidate>): List<Map<String, Any?>> {
  val out = ArrayList<Map<String, Any?>>()
  val n = cands.size
  for (o in 0 until n) {
    for (i in 0 until n) {
      if (o == i) continue
      if (cands[o].areaRatio <= cands[i].areaRatio) continue
      if (!hostIsNestedSleeve(cands[o], cands[i])) continue
      val outer = cands[o]
      val inner = cands[i]
      val areaFraction = inner.areaRatio / maxOf(outer.areaRatio, 1e-9)
      val cO = hostCenter(outer.corners)
      val cI = hostCenter(inner.corners)
      val outerDiag =
        kotlin.math.hypot(
          outer.corners[0].x - outer.corners[2].x,
          outer.corners[0].y - outer.corners[2].y,
        )
      val centerDistNorm =
        kotlin.math.hypot(cO.x - cI.x, cO.y - cI.y) / maxOf(outerDiag, 1.0)
      val preferInner = inner.score >= 0.28 || inner.score >= outer.score * 0.75
      out.add(
        linkedMapOf(
          "outerRank" to o + 1,
          "innerRank" to i + 1,
          "areaFraction" to areaFraction,
          "centerDistNorm" to centerDistNorm,
          "outerScore" to outer.score,
          "innerScore" to inner.score,
          "preferInnerGate" to preferInner,
          "preferInnerThresholds" to
            linkedMapOf(
              "innerScoreMin" to 0.28,
              "orFractionOfOuter" to 0.75,
            ),
        ),
      )
    }
  }
  return out
}

private fun hostCenter(corners: List<Pt>): Pt {
  var x = 0.0
  var y = 0.0
  for (p in corners) {
    x += p.x
    y += p.y
  }
  val n = corners.size.coerceAtLeast(1).toDouble()
  return Pt(x / n, y / n)
}

private fun hostIsNestedSleeve(
  outer: DetectCard.ScoredCandidate,
  inner: DetectCard.ScoredCandidate,
): Boolean {
  val areaFraction = inner.areaRatio / maxOf(outer.areaRatio, 1e-9)
  if (areaFraction < 0.55 || areaFraction > 0.97) return false
  val cO = hostCenter(outer.corners)
  val cI = hostCenter(inner.corners)
  val outerDiag =
    kotlin.math.hypot(
      outer.corners[0].x - outer.corners[2].x,
      outer.corners[0].y - outer.corners[2].y,
    )
  val centerDistNorm =
    kotlin.math.hypot(cO.x - cI.x, cO.y - cI.y) / maxOf(outerDiag, 1.0)
  return centerDistNorm <= 0.12
}

private fun candSlim(c: DetectCard.ScoredCandidate): Map<String, Any?> =
  linkedMapOf(
    "quad" to cornersMap(c.corners),
    "finalScore" to c.score,
    "method" to c.method,
    "areaShare" to c.areaRatio,
    "aspectRatio" to c.aspectRatio,
  )

private fun serializePipeline(p: DetectCard.PipelineStages): Map<String, Any?> =
  linkedMapOf(
    "considerAttempts" to p.considerAttempts,
    "rawAfterQuadCount" to p.rawAfterQuadCount,
    "postGatesCount" to p.postGatesCount,
    "postDedupeCount" to p.postDedupeCount,
    "shortlistCount" to p.shortlistCount,
    "topComponentsUsed" to p.topComponentsUsed,
    "dedupeCapUsed" to p.dedupeCapUsed,
    "rawAfterQuad" to p.rawAfterQuad.map { candSlim(it) },
    "postGates" to p.postGates.map { candSlim(it) },
    "postDedupe" to p.postDedupe.map { candSlim(it) },
    "shortlist" to p.shortlist.map { candSlim(it) },
    "rejected" to
      p.rejected.map { r ->
        linkedMapOf(
          "quad" to (r.corners?.let { cornersMap(it) }),
          "finalScore" to r.score,
          "method" to r.method,
          "areaShare" to r.areaShare,
          "reason" to r.reason,
          "stage" to r.stage,
        )
      },
  )

private fun lumaFromRgba(rgba: ByteArray, w: Int, h: Int): ByteArray {
  val y = ByteArray(w * h)
  for (i in 0 until w * h) {
    val o = i * 4
    val r = rgba[o].toInt() and 0xFF
    val g = rgba[o + 1].toInt() and 0xFF
    val b = rgba[o + 2].toInt() and 0xFF
    y[i] = (0.299 * r + 0.587 * g + 0.114 * b).toInt().coerceIn(0, 255).toByte()
  }
  return y
}

/** Minimal manifest parser: { "cases": [ { id, rgbaFile, width, height, orientation? }, ... ] } */
private fun parseManifestCases(text: String): List<Map<String, Any?>> {
  val casesIdx = text.indexOf("\"cases\"")
  require(casesIdx >= 0) { "manifest missing cases" }
  val arrStart = text.indexOf('[', casesIdx)
  require(arrStart >= 0)
  var depth = 0
  var end = -1
  for (i in arrStart until text.length) {
    when (text[i]) {
      '[' -> depth++
      ']' -> {
        depth--
        if (depth == 0) {
          end = i
          break
        }
      }
    }
  }
  require(end > arrStart)
  val arr = text.substring(arrStart + 1, end)
  val out = ArrayList<Map<String, Any?>>()
  var i = 0
  while (i < arr.length) {
    val objStart = arr.indexOf('{', i)
    if (objStart < 0) break
    var d = 0
    var objEnd = -1
    for (j in objStart until arr.length) {
      when (arr[j]) {
        '{' -> d++
        '}' -> {
          d--
          if (d == 0) {
            objEnd = j
            break
          }
        }
      }
    }
    require(objEnd > objStart)
    val obj = arr.substring(objStart, objEnd + 1)
    val id = jsonString(obj, "id") ?: error("case missing id")
    val rgbaFile = jsonString(obj, "rgbaFile") ?: error("$id missing rgbaFile")
    val width = jsonInt(obj, "width") ?: error("$id missing width")
    val height = jsonInt(obj, "height") ?: error("$id missing height")
    out.add(
      mapOf(
        "id" to id,
        "rgbaFile" to rgbaFile,
        "width" to width,
        "height" to height,
        "orientation" to jsonString(obj, "orientation"),
      ),
    )
    i = objEnd + 1
  }
  return out
}

private fun jsonString(src: String, key: String): String? {
  val re = Regex("\"$key\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
  return re.find(src)?.groupValues?.get(1)
}

private fun jsonInt(src: String, key: String): Int? {
  val re = Regex("\"$key\"\\s*:\\s*(-?\\d+)")
  return re.find(src)?.groupValues?.get(1)?.toIntOrNull()
}

private fun toJson(value: Any?): String {
  return when (value) {
    null -> "null"
    is String -> "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
    is Number -> value.toString()
    is Boolean -> value.toString()
    is Map<*, *> -> {
      value.entries.joinToString(prefix = "{", postfix = "}") { (k, v) ->
        toJson(k.toString()) + ":" + toJson(v)
      }
    }
    is List<*> -> value.joinToString(prefix = "[", postfix = "]") { toJson(it) }
    else -> toJson(value.toString())
  }
}
