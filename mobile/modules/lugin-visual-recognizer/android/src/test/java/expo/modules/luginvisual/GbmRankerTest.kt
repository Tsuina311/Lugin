package expo.modules.luginvisual

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Same tiny tree the host parity test scores.
 * Full frozen-model parity is scanner:vnext-parity (JS vs hydrateModel).
 */
class GbmRankerTest {
  private val tree = GbmNode(
    feature = 0,
    threshold = 0.5f,
    left = GbmNode(value = -1f),
    right = GbmNode(value = 2f),
  )

  @Test
  fun leafOnThresholdMatchesHost() {
    val utility = GbmRanker.utility(0.5f, 0.1f, listOf(tree), floatArrayOf(0.5f))
    assertEquals(0.4f, utility, 1e-6f)
  }

  @Test
  fun rightBranchMatchesHost() {
    val utility = GbmRanker.utility(0.5f, 0.1f, listOf(tree), floatArrayOf(0.5000001f))
    assertEquals(0.7f, utility, 1e-5f)
  }

  @Test
  fun tieBreaksToHigherDetectorScore() {
    val index = GbmRanker.select(floatArrayOf(0.4f, 0.4f), floatArrayOf(0.2f, 0.9f))
    assertEquals(1, index)
  }

  @Test
  fun dualSearchKeepsGalleriesIndependent() {
    val query = floatArrayOf(1f, 0f)
    val clean = floatArrayOf(1f, 0f, 0f, 1f)
    val prototype = floatArrayOf(0f, 1f, 1f, 0f)
    val dual = VNextGallery.dualTop(
      query,
      clean,
      prototype,
      arrayOf("a", "b"),
      arrayOf("Alpha", "Beta"),
      2,
      5,
    )
    assertEquals("a", dual.clean[0].oracleId)
    assertEquals("b", dual.prototype[0].oracleId)
    assertEquals(1f, dual.clean[0].score, 1e-6f)
    assertEquals(1f, dual.prototype[0].score, 1e-6f)
  }

  @Test
  fun dualSearchReadsDirectMappedStyleBuffersWithoutChangingMath() {
    fun direct(vararg values: Float) = ByteBuffer
      .allocateDirect(values.size * 4)
      .order(ByteOrder.LITTLE_ENDIAN)
      .asFloatBuffer()
      .apply {
        put(values)
        position(0)
      }

    val dual = VNextGallery.dualTop(
      floatArrayOf(1f, 0f),
      direct(1f, 0f, 0f, 1f),
      direct(0f, 1f, 1f, 0f),
      arrayOf("a", "b"),
      arrayOf("Alpha", "Beta"),
      2,
      5,
    )

    assertEquals("a", dual.clean[0].oracleId)
    assertEquals("b", dual.prototype[0].oracleId)
    assertEquals(1f, dual.clean[0].score, 1e-6f)
    assertEquals(1f, dual.prototype[0].score, 1e-6f)
  }
}
