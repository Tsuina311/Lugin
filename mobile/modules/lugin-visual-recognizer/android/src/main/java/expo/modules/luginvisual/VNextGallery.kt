package expo.modules.luginvisual

import java.io.File
import java.io.FileInputStream
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.security.MessageDigest
import kotlin.math.sqrt
import org.json.JSONObject

/**
 * Frozen vNext retrieval. Loaded only when the development flag asks for it.
 * Clean and prototype stay separate. Scores are not fused.
 * Top-K is oracle identity: the best printing of an oracle keeps the score.
 */
data class VNextHit(val oracleId: String, val name: String, val score: Float, val index: Int)

data class VNextDual(val clean: List<VNextHit>, val prototype: List<VNextHit>)

class VNextIndex(
  val clean: FloatArray,
  val prototype: FloatArray,
  val oracleIds: Array<String>,
  val names: Array<String>,
  val dims: Int,
  val adapterW: FloatArray,
  val adapterB: FloatArray,
  val nameToOracles: Map<String, List<String>>,
  val galleryBytes: Long,
)

object VNextGallery {
  fun load(dir: File): VNextIndex {
    val manifest = JSONObject(File(dir, "manifest.json").readText())
    val dims = manifest.optInt("dims", 512)
    val count = manifest.getInt("count")
    val cleanFile = File(dir, manifest.getString("clean"))
    val prototypeFile = File(dir, manifest.getString("prototype"))
    val clean = readF32(cleanFile, manifest.optString("cleanSha256", ""))
    val prototype = readF32(prototypeFile, manifest.optString("prototypeSha256", ""))
    val adapterW = readF32(File(dir, manifest.getString("adapterW")))
    val adapterB = readF32(File(dir, manifest.getString("adapterB")))
    if (clean.size != count * dims || prototype.size != count * dims) {
      throw IllegalStateException("vNext gallery length != count*dims")
    }
    if (adapterW.size != dims * dims || adapterB.size != dims) {
      throw IllegalStateException("vNext adapter shape != ${dims}x$dims")
    }
    val refs = JSONObject(File(dir, manifest.getString("refs")).readText())
    val nameArr = refs.getJSONArray("names")
    val oracleArr = refs.getJSONArray("oracleIds")
    if (nameArr.length() != count || oracleArr.length() != count) {
      throw IllegalStateException("vNext refs length != count")
    }
    val names = Array(count) { i -> nameArr.getString(i) }
    val oracleIds = Array(count) { i -> oracleArr.getString(i) }
    val byName = HashMap<String, LinkedHashSet<String>>()
    for (i in 0 until count) {
      byName.getOrPut(names[i]) { LinkedHashSet() }.add(oracleIds[i])
    }
    val nameToOracles = byName.mapValues { it.value.toList() }
    return VNextIndex(
      clean,
      prototype,
      oracleIds,
      names,
      dims,
      adapterW,
      adapterB,
      nameToOracles,
      (clean.size + prototype.size + adapterW.size + adapterB.size) * 4L,
    )
  }

  /** y = normalize(x W + b). W is row-major [in, out], matching embedding/math.mjs gemv. */
  fun applyLinear(query: FloatArray, w: FloatArray, b: FloatArray): FloatArray {
    val out = b.copyOf()
    val n = query.size
    for (i in 0 until n) {
      val xi = query[i]
      if (xi == 0f) continue
      val row = i * n
      for (j in 0 until n) out[j] += xi * w[row + j]
    }
    var sum = 0f
    for (value in out) sum += value * value
    val norm = sqrt(sum).let { if (it < 1e-12f) 1f else it }
    for (j in out.indices) out[j] /= norm
    return out
  }

  fun dualTop(
    query: FloatArray,
    clean: FloatArray,
    prototype: FloatArray,
    oracleIds: Array<String>,
    names: Array<String>,
    dims: Int,
    k: Int,
  ): VNextDual {
    val count = oracleIds.size
    val oracleIndex = HashMap<String, Int>(count)
    var nextIndex = 0
    val cleanBest = HashMap<String, VNextHit>(count)
    val protoBest = HashMap<String, VNextHit>(count)
    for (i in 0 until count) {
      var cleanScore = 0f
      var protoScore = 0f
      val off = i * dims
      for (d in 0 until dims) {
        val q = query[d]
        cleanScore += q * clean[off + d]
        protoScore += q * prototype[off + d]
      }
      val id = oracleIds[i]
      val index = oracleIndex.getOrPut(id) { nextIndex++ }
      val prevClean = cleanBest[id]
      if (prevClean == null || cleanScore > prevClean.score) {
        cleanBest[id] = VNextHit(id, names[i], cleanScore, index)
      }
      val prevProto = protoBest[id]
      if (prevProto == null || protoScore > prevProto.score) {
        protoBest[id] = VNextHit(id, names[i], protoScore, index)
      }
    }
    return VNextDual(rank(cleanBest, k), rank(protoBest, k))
  }

  private fun rank(best: Map<String, VNextHit>, k: Int): List<VNextHit> =
    best.values.sortedWith(compareByDescending<VNextHit> { it.score }.thenBy { it.index }).take(k)

  /**
   * One read of the gallery file. The mapped copy is released after the floats
   * are in the array the search keeps, so the camera is not left holding both.
   */
  private fun readF32(file: File, expectedSha: String = ""): FloatArray {
    FileInputStream(file).use { input ->
      val channel = input.channel
      val size = channel.size()
      if (size <= 0L || size % 4L != 0L) {
        throw IllegalStateException("vNext gallery not float32 ${file.name}")
      }
      val mapped = channel.map(FileChannel.MapMode.READ_ONLY, 0, size).order(ByteOrder.LITTLE_ENDIAN)
      try {
        if (expectedSha.isNotEmpty()) {
          val digest = MessageDigest.getInstance("SHA-256")
          val bytes = mapped.duplicate()
          val buf = ByteArray(1024 * 1024)
          while (bytes.hasRemaining()) {
            val n = minOf(buf.size, bytes.remaining())
            bytes.get(buf, 0, n)
            digest.update(buf, 0, n)
          }
          val actual = digest.digest().joinToString("") { "%02x".format(it) }
          if (!actual.equals(expectedSha, ignoreCase = true)) {
            throw IllegalStateException("vNext sha mismatch ${file.name}")
          }
          mapped.position(0)
        }
        val out = FloatArray((size / 4).toInt())
        mapped.asFloatBuffer().get(out)
        return out
      } finally {
        unmap(mapped)
      }
    }
  }

  private fun unmap(buffer: java.nio.ByteBuffer) {
    try {
      val unsafeClass = Class.forName("sun.misc.Unsafe")
      val field = unsafeClass.getDeclaredField("theUnsafe")
      field.isAccessible = true
      val unsafe = field.get(null)
      val invokeCleaner = unsafeClass.getMethod("invokeCleaner", java.nio.ByteBuffer::class.java)
      invokeCleaner.invoke(unsafe, buffer)
    } catch (_: Throwable) {
      // The float array is already copied. A leftover mapping is collected later.
    }
  }
}
