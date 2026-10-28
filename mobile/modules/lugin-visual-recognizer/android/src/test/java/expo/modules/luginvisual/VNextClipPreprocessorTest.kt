package expo.modules.luginvisual

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Test

class VNextClipPreprocessorTest {
  @Test
  fun deterministicFixtureMatchesFrozenHostTensorExactly() {
    val width = 625
    val height = 436
    val rgba = ByteArray(width * height * 4)
    var offset = 0
    for (y in 0 until height) {
      for (x in 0 until width) {
        rgba[offset++] = (x * 13 + y * 7 + ((x * y) % 251)).toByte()
        rgba[offset++] = (x * 3 + y * 17 + ((x xor y) % 239)).toByte()
        rgba[offset++] = (x * 19 + y * 5 + ((x + y) % 233)).toByte()
        rgba[offset++] = 255.toByte()
      }
    }

    val plan = VNextClipPreprocessor.plan(width, height)
    assertEquals(321, plan.resizedWidth)
    assertEquals(224, plan.resizedHeight)
    assertEquals(48, plan.cropLeft)
    assertEquals(0, plan.cropTop)

    val tensor = VNextClipPreprocessor.preprocess(rgba, width, height)
    val bytes = ByteBuffer.allocate(tensor.size * Float.SIZE_BYTES)
      .order(ByteOrder.LITTLE_ENDIAN)
    tensor.forEach(bytes::putFloat)
    val sha256 = MessageDigest.getInstance("SHA-256")
      .digest(bytes.array())
      .joinToString("") { "%02x".format(it) }

    // Generated independently by the frozen Transformers.js 2.17.2
    // AutoProcessor + Sharp/libvips reference implementation.
    assertEquals(
      "0cd2b81daf8576bdedc651d2a6a1b00118c04c66ea470674d86f422e28082307",
      sha256,
    )
  }
}
