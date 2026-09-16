package expo.modules.luginvisual

import android.graphics.Bitmap
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * On-device CLIP ViT-B/32 + F16 full-gallery retrieval.
 * Large assets stay in native memory — never cross the RN bridge.
 */
class LuginVisualModule : Module() {
  private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
  private var session: OrtSession? = null
  private var embeddingsF16: ShortArray? = null
  /** Expanded once at init for fast brute-force search (~100MB RAM). */
  private var embeddingsF32: FloatArray? = null
  private var names: Array<String> = emptyArray()
  private var oracleIds: Array<String> = emptyArray()
  private var artIds: Array<String> = emptyArray()
  private var artCount: Int = 0
  private var dims: Int = 512
  private var status: String = "UNINITIALIZED"
  private var modelSha: String? = null
  private var indexSha: String? = null

  private val handleSeq = AtomicInteger(1)
  private val handleStore = HashMap<Int, FloatArray>()
  private val lockedEmbedding = AtomicReference<FloatArray?>(null)

  override fun definition() = ModuleDefinition {
    Name("LuginVisual")

    Constant("implementationStatus") { "clip-vit-b32-f16-v1" }

    AsyncFunction("initialize") { promise: Promise ->
      val t0 = System.nanoTime()
      try {
        status = "LOADING"
        val ctx = appContext.reactContext
          ?: throw VisualFailedException("no React context")
        val assetMgr = ctx.assets

        val manifestJson = assetMgr.open("lugin-visual/manifest.json").bufferedReader().use { it.readText() }
        val manifest = JSONObject(manifestJson)
        dims = manifest.optInt("dims", 512)

        val tModel = System.nanoTime()
        val modelBytes = assetMgr.open("lugin-visual/clip-vit-b32-quant.onnx").use { it.readBytes() }
        modelSha = sha256(modelBytes)
        val expectedModelSha = manifest.getJSONObject("files").getJSONObject("model").getString("sha256")
        if (modelSha != expectedModelSha) {
          throw VisualFailedException("model SHA mismatch")
        }
        val modelFile = File(ctx.cacheDir, "lugin-clip-vit-b32-quant.onnx")
        if (!modelFile.exists() || modelFile.length() != modelBytes.size.toLong()) {
          FileOutputStream(modelFile).use { it.write(modelBytes) }
        }
        val opts = OrtSession.SessionOptions()
        opts.setIntraOpNumThreads(2)
        opts.setInterOpNumThreads(1)
        session = env.createSession(modelFile.absolutePath, opts)
        val modelLoadMs = elapsedMs(tModel)

        val tIndex = System.nanoTime()
        val embBytes = assetMgr.open("lugin-visual/embeddings.f16.bin").use { it.readBytes() }
        indexSha = sha256(embBytes)
        val expectedIndexSha = manifest.getJSONObject("files").getJSONObject("embeddings").getString("sha256")
        if (indexSha != expectedIndexSha) {
          throw VisualFailedException("index SHA mismatch")
        }
        val bb = ByteBuffer.wrap(embBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val shorts = ShortArray(bb.remaining())
        bb.get(shorts)
        embeddingsF16 = shorts
        val f32 = FloatArray(shorts.size)
        for (i in shorts.indices) f32[i] = float16ToFloat(shorts[i])
        embeddingsF32 = f32

        val mapBytes = assetMgr.open("lugin-visual/oracle-map.json").use { it.readBytes() }
        val mapSha = sha256(mapBytes)
        val expectedMapSha = manifest.getJSONObject("files").getJSONObject("oracleMap").getString("sha256")
        if (mapSha != expectedMapSha) {
          throw VisualFailedException("oracle-map SHA mismatch")
        }
        val map = JSONObject(String(mapBytes, Charsets.UTF_8))
        artCount = map.getInt("count")
        val namesArr = map.getJSONArray("names")
        val oracleArr = map.getJSONArray("oracleIds")
        val artArr = map.getJSONArray("artIds")
        names = Array(artCount) { i -> namesArr.getString(i) }
        oracleIds = Array(artCount) { i -> oracleArr.getString(i) }
        artIds = Array(artCount) { i -> artArr.getString(i) }

        if (shorts.size != artCount * dims) {
          throw VisualFailedException("embedding length ${shorts.size} != artCount*dims (${artCount * dims})")
        }
        val indexLoadMs = elapsedMs(tIndex)
        status = "READY"

        val oracles = oracleIds.toSet().size
        promise.resolve(
          mapOf(
            "status" to "READY",
            "modelLoadMs" to modelLoadMs,
            "indexLoadMs" to indexLoadMs,
            "artCount" to artCount,
            "oracleCount" to oracles,
            "dims" to dims,
            "modelSha256" to modelSha,
            "indexSha256" to indexSha,
            "error" to null,
            "totalMs" to elapsedMs(t0),
          ),
        )
      } catch (e: Exception) {
        status = "ERROR"
        promise.resolve(
          mapOf(
            "status" to "ERROR",
            "modelLoadMs" to 0.0,
            "indexLoadMs" to 0.0,
            "artCount" to 0,
            "oracleCount" to 0,
            "dims" to dims,
            "modelSha256" to modelSha,
            "indexSha256" to indexSha,
            "error" to (e.message ?: "initialize failed"),
          ),
        )
      }
    }

    AsyncFunction("getStatus") { promise: Promise ->
      promise.resolve(status)
    }

    AsyncFunction("recognizeFromRgbaBytes") { rgba: ByteArray, width: Int, height: Int, topK: Int, promise: Promise ->
      val started = System.nanoTime()
      try {
        ensureReady()
        val sess = session!!
        val embF32 = embeddingsF32!!

        val tPre = System.nanoTime()
        val pixels = preprocessRgba(rgba, width, height)
        val preprocessMs = elapsedMs(tPre)

        val tEnc = System.nanoTime()
        val shape = longArrayOf(1, 3, 224, 224)
        val tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(pixels), shape)
        val out = sess.run(mapOf("pixel_values" to tensor))
        val embTensor = out[0].value as Array<*>
        @Suppress("UNCHECKED_CAST")
        val row = embTensor[0] as FloatArray
        val query = l2Normalize(row)
        out.close()
        tensor.close()
        val encoderMs = elapsedMs(tEnc)

        val tSearch = System.nanoTime()
        val top = searchTopK(query, embF32, max(1, min(topK, 20)))
        val searchMs = elapsedMs(tSearch)

        val tCollapse = System.nanoTime()
        val collapsed = collapseByOracle(top)
        val collapseMs = elapsedMs(tCollapse)

        val handle = handleSeq.getAndIncrement()
        handleStore[handle] = query
        // Cap store size
        if (handleStore.size > 64) {
          val oldest = handleStore.keys.minOrNull()
          if (oldest != null) handleStore.remove(oldest)
        }

        promise.resolve(
          mapOf(
            "topCandidates" to collapsed.map {
              mapOf(
                "oracleId" to it.oracleId,
                "name" to it.name,
                "score" to it.score,
                "artReferenceId" to it.artId,
              )
            },
            "embeddingHandle" to handle,
            "timing" to mapOf(
              "preprocessMs" to preprocessMs,
              "encoderMs" to encoderMs,
              "searchMs" to searchMs,
              "collapseMs" to collapseMs,
              "totalMs" to elapsedMs(started),
            ),
          ),
        )
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(VisualFailedException(e.message ?: "recognize failed"))
      }
    }

    AsyncFunction("compareToHandle") { rgba: ByteArray, width: Int, height: Int, handle: Int, promise: Promise ->
      val t0 = System.nanoTime()
      try {
        ensureReady()
        val locked = lockedEmbedding.get()
          ?: handleStore[handle]
          ?: throw VisualFailedException("unknown embedding handle $handle")
        val pixels = preprocessRgba(rgba, width, height)
        val shape = longArrayOf(1, 3, 224, 224)
        val tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(pixels), shape)
        val out = session!!.run(mapOf("pixel_values" to tensor))
        @Suppress("UNCHECKED_CAST")
        val row = (out[0].value as Array<*>)[0] as FloatArray
        val query = l2Normalize(row)
        out.close()
        tensor.close()
        var dot = 0f
        for (i in query.indices) dot += query[i] * locked[i]
        promise.resolve(mapOf("similarity" to dot.toDouble(), "ms" to elapsedMs(t0)))
      } catch (e: Exception) {
        promise.reject(VisualFailedException(e.message ?: "compare failed"))
      }
    }

    AsyncFunction("lockHandle") { handle: Int, promise: Promise ->
      val emb = handleStore[handle]
      if (emb == null) {
        promise.reject(VisualFailedException("unknown handle $handle"))
      } else {
        lockedEmbedding.set(emb.copyOf())
        promise.resolve(null)
      }
    }

    AsyncFunction("clearLockedHandle") { promise: Promise ->
      lockedEmbedding.set(null)
      promise.resolve(null)
    }

    AsyncFunction("warmUp") { promise: Promise ->
      try {
        ensureReady()
        val blank = ByteArray(224 * 224 * 4) { -1 }
        val tCold = System.nanoTime()
        runDummy(blank)
        val coldMs = elapsedMs(tCold)
        val tWarm = System.nanoTime()
        runDummy(blank)
        val warmMs = elapsedMs(tWarm)
        promise.resolve(mapOf("coldMs" to coldMs, "warmMs" to warmMs))
      } catch (e: Exception) {
        promise.reject(VisualFailedException(e.message ?: "warmUp failed"))
      }
    }
  }

  private fun runDummy(rgba: ByteArray) {
    val pixels = preprocessRgba(rgba, 224, 224)
    val tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(pixels), longArrayOf(1, 3, 224, 224))
    val out = session!!.run(mapOf("pixel_values" to tensor))
    out.close()
    tensor.close()
  }

  private fun ensureReady() {
    if (status != "READY" || session == null || embeddingsF32 == null) {
      throw VisualFailedException("CLIP engine not READY (status=$status)")
    }
  }

  private data class Hit(val index: Int, val score: Float)

  private data class Collapsed(
    val oracleId: String,
    val name: String,
    val score: Float,
    val artId: String,
  )

  private fun searchTopK(query: FloatArray, embF32: FloatArray, k: Int): List<Hit> {
    val bestScores = FloatArray(k) { -1f }
    val bestIdx = IntArray(k) { -1 }
    var filled = 0
    for (i in 0 until artCount) {
      val off = i * dims
      var dot = 0f
      for (d in 0 until dims) {
        dot += query[d] * embF32[off + d]
      }
      if (filled < k) {
        bestScores[filled] = dot
        bestIdx[filled] = i
        filled++
        if (filled == k) {
          var mi = 0
          for (j in 1 until k) if (bestScores[j] < bestScores[mi]) mi = j
          if (mi != 0) {
            val ts = bestScores[0]; bestScores[0] = bestScores[mi]; bestScores[mi] = ts
            val ti = bestIdx[0]; bestIdx[0] = bestIdx[mi]; bestIdx[mi] = ti
          }
        }
      } else if (dot > bestScores[0]) {
        bestScores[0] = dot
        bestIdx[0] = i
        var mi = 0
        for (j in 1 until k) if (bestScores[j] < bestScores[mi]) mi = j
        if (mi != 0) {
          val ts = bestScores[0]; bestScores[0] = bestScores[mi]; bestScores[mi] = ts
          val ti = bestIdx[0]; bestIdx[0] = bestIdx[mi]; bestIdx[mi] = ti
        }
      }
    }
    return (0 until filled)
      .map { Hit(bestIdx[it], bestScores[it]) }
      .sortedByDescending { it.score }
  }

  private fun collapseByOracle(hits: List<Hit>): List<Collapsed> {
    val best = LinkedHashMap<String, Collapsed>()
    for (h in hits) {
      val oid = oracleIds[h.index]
      val prev = best[oid]
      if (prev == null || h.score > prev.score) {
        best[oid] = Collapsed(oid, names[h.index], h.score, artIds[h.index])
      }
    }
    return best.values.sortedByDescending { it.score }
  }

  companion object {
    private val MEAN = floatArrayOf(0.48145466f, 0.4578275f, 0.40821073f)
    private val STD = floatArrayOf(0.26862954f, 0.26130258f, 0.27577711f)

    fun elapsedMs(startNs: Long): Double = (System.nanoTime() - startNs) / 1_000_000.0

    fun sha256(bytes: ByteArray): String {
      val dig = MessageDigest.getInstance("SHA-256").digest(bytes)
      return dig.joinToString("") { "%02x".format(it) }
    }

    fun l2Normalize(v: FloatArray): FloatArray {
      var s = 0f
      for (x in v) s += x * x
      val n = sqrt(s.toDouble()).toFloat().let { if (it < 1e-12f) 1f else it }
      return FloatArray(v.size) { i -> v[i] / n }
    }

    /** IEEE half → float32 */
    fun float16ToFloat(h: Short): Float {
      val bits = h.toInt() and 0xffff
      val sign = (bits ushr 15) and 0x1
      var exp = (bits ushr 10) and 0x1f
      var frac = bits and 0x3ff
      val outBits: Int
      if (exp == 0) {
        if (frac == 0) {
          outBits = sign shl 31
        } else {
          exp = 1
          while (frac and 0x400 == 0) {
            frac = frac shl 1
            exp -= 1
          }
          frac = frac and 0x3ff
          outBits = (sign shl 31) or ((exp + 127 - 15) shl 23) or (frac shl 13)
        }
      } else if (exp == 31) {
        outBits = (sign shl 31) or 0x7f800000 or (frac shl 13)
      } else {
        outBits = (sign shl 31) or ((exp + 127 - 15) shl 23) or (frac shl 13)
      }
      return Float.fromBits(outBits)
    }

    /**
     * RGBA packed → CLIP pixel_values [1,3,224,224].
     * Resize shortest edge to 224, center-crop 224, rescale/normalize.
     */
    fun preprocessRgba(rgba: ByteArray, width: Int, height: Int): FloatArray {
      if (rgba.size != width * height * 4) {
        throw VisualFailedException("RGBA length mismatch")
      }
      val src = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      val px = IntArray(width * height)
      var i = 0
      var p = 0
      while (i < px.size) {
        val r = rgba[p].toInt() and 0xff
        val g = rgba[p + 1].toInt() and 0xff
        val b = rgba[p + 2].toInt() and 0xff
        val a = rgba[p + 3].toInt() and 0xff
        px[i] = (a shl 24) or (r shl 16) or (g shl 8) or b
        i++
        p += 4
      }
      src.setPixels(px, 0, width, 0, 0, width, height)

      val scale = 224f / min(width, height).toFloat()
      val rw = max(224, Math.round(width * scale))
      val rh = max(224, Math.round(height * scale))
      val scaled = Bitmap.createScaledBitmap(src, rw, rh, true)
      src.recycle()
      val left = (rw - 224) / 2
      val top = (rh - 224) / 2
      val cropped = Bitmap.createBitmap(scaled, left, top, 224, 224)
      if (scaled != cropped) scaled.recycle()

      val out = FloatArray(3 * 224 * 224)
      val cpx = IntArray(224 * 224)
      cropped.getPixels(cpx, 0, 224, 0, 0, 224, 224)
      cropped.recycle()
      for (y in 0 until 224) {
        for (x in 0 until 224) {
          val c = cpx[y * 224 + x]
          val r = ((c shr 16) and 0xff) / 255f
          val g = ((c shr 8) and 0xff) / 255f
          val b = (c and 0xff) / 255f
          val idx = y * 224 + x
          out[0 * 224 * 224 + idx] = (r - MEAN[0]) / STD[0]
          out[1 * 224 * 224 + idx] = (g - MEAN[1]) / STD[1]
          out[2 * 224 * 224 + idx] = (b - MEAN[2]) / STD[2]
        }
      }
      return out
    }
  }
}

class VisualFailedException(message: String) : CodedException("ERR_LUGIN_VISUAL", message, null)
