package expo.modules.luginvisual

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VNextFrozenIdentityTest {
  private fun validManifest() = JSONObject(
    """
    {
      "geometryId": "gbm-iou-all-2dd2ec36b833",
      "geometrySha256": "369b264919888a09ff4f72b85ec83d1fbe0eb7081cc100ad3eb7280f3c95ee70",
      "adapterId": "linear-identity-v1",
      "adapterWSha256": "c667fc8f197331b382bb9abdc66ccfc9d884121feab532e77645e71545b9da02",
      "adapterBSha256": "2378682f6732d0f02795b7fca5b64281caad6fde1fa952a283fae3484b7c4d6d",
      "cleanSha256": "785519ce3deda47f248392e66786d5b9008899cfec158390a31e2e3556e99b9c",
      "prototypeSha256": "7cfb59e52db439239ee4a1af6b22596a539d43eccfe1afb3d7835027d5a683d1",
      "refsSha256": "58ea2f9bd6ef2c01f81a11db9865c713f9035a83b0d45bf9ae44eb0c714ae057"
    }
    """.trimIndent(),
  )

  @Test
  fun acceptsCompleteFrozenIdentity() {
    val identity = VNextGallery.validateFrozenIdentity(validManifest())
    assertEquals("linear-identity-v1", identity.adapterId)
    assertEquals("gbm-iou-all-2dd2ec36b833", identity.geometryId)
  }

  @Test
  fun rejectsMissingOrMismatchedFrozenIdentity() {
    val missing = validManifest().apply { remove("adapterBSha256") }
    assertThrows(IllegalStateException::class.java) {
      VNextGallery.validateFrozenIdentity(missing)
    }
    val mismatch = validManifest().apply { put("prototypeSha256", "bad") }
    assertThrows(IllegalStateException::class.java) {
      VNextGallery.validateFrozenIdentity(mismatch)
    }
  }
}
