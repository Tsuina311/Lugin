package expo.modules.luginvisual

/**
 * Frozen GBM walk. A node with no left child is a leaf.
 * Otherwise branch on row[feature] <= threshold.
 * Utility = base + learningRate * sum of leaf values.
 * Tie-break: higher detector score.
 */
data class GbmNode(
  val feature: Int = -1,
  val threshold: Float = 0f,
  val left: GbmNode? = null,
  val right: GbmNode? = null,
  val value: Float? = null,
)

object GbmRanker {
  fun predict(node: GbmNode?, row: FloatArray): Float {
    if (node == null || node.left == null) return node?.value ?: 0f
    val value = if (node.feature in row.indices) row[node.feature] else 0f
    val next = if (value <= node.threshold) node.left else node.right
    return predict(next, row)
  }

  fun treeValues(trees: List<GbmNode>, row: FloatArray): FloatArray =
    FloatArray(trees.size) { index -> predict(trees[index], row) }

  fun utility(base: Float, learningRate: Float, trees: List<GbmNode>, row: FloatArray): Float {
    var sum = base
    for (tree in trees) sum += learningRate * predict(tree, row)
    return sum
  }

  fun select(utilities: FloatArray, detectorScores: FloatArray): Int {
    var best = -1
    for (i in utilities.indices) {
      if (
        best < 0 ||
        utilities[i] > utilities[best] + 1e-12f ||
        (kotlin.math.abs(utilities[i] - utilities[best]) <= 1e-12f && detectorScores[i] > detectorScores[best])
      ) {
        best = i
      }
    }
    return best
  }
}
