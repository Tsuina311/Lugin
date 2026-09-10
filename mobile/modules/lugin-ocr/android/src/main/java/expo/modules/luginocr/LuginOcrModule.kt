package expo.modules.luginocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Offline OCR via Google ML Kit Text Recognition v2 (Latin, bundled model).
 *
 * Hot path: packed RGBA Uint8Array (ByteArray) → Bitmap → InputImage → ML Kit.
 * Magic / ranking / fusion stay in shared TypeScript.
 *
 * Prefer [recognizeFromRgbaBytes] — never base64 on the production path.
 * [recognizeFromRgba] (base64) remains for old JS until OTA+APK both ship bytes.
 */
class LuginOcrModule : Module() {
  /** Single shared client for the module lifetime (do not recreate per crop). */
  private val recognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }

  private val warmed = AtomicBoolean(false)

  override fun definition() = ModuleDefinition {
    Name("LuginOcr")

    Constant("implementationStatus") {
      IMPLEMENTATION_STATUS
    }

    /**
     * Production hot path: packed RGBA bytes (no base64).
     * Layout: length == width * height * 4, channel order R,G,B,A.
     */
    AsyncFunction("recognizeFromRgbaBytes") { rgba: ByteArray, width: Int, height: Int, promise: Promise ->
      val started = System.nanoTime()
      try {
        validateDimensions(width, height)
        val expected = width * height * 4
        if (rgba.size != expected) {
          throw InvalidOcrInputException(
            "RGBA byte length ${rgba.size} != width*height*4 ($expected) for ${width}x$height",
          )
        }
        val tBitmap = System.nanoTime()
        val bitmap = rgbaToBitmap(rgba, width, height)
        val bitmapMs = elapsedMs(tBitmap)
        processBitmap(
          bitmap = bitmap,
          width = width,
          height = height,
          startedNs = started,
          promise = promise,
          decodeMs = 0.0,
          bitmapMs = bitmapMs,
          bytesIn = rgba.size,
          transport = "rgba-bytes",
        )
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(OcrFailedException(e.message ?: "recognizeFromRgbaBytes failed"))
      }
    }

    /**
     * Legacy: RGBA as base64. Kept for older OTA JS on pre-bytes APKs.
     * Do not use on the production hot path.
     */
    AsyncFunction("recognizeFromRgba") { rgbaBase64: String, width: Int, height: Int, promise: Promise ->
      val started = System.nanoTime()
      try {
        validateDimensions(width, height)
        val tDecode = System.nanoTime()
        val bytes = decodeBase64(rgbaBase64)
        val decodeMs = elapsedMs(tDecode)
        val expected = width * height * 4
        if (bytes.size != expected) {
          throw InvalidOcrInputException(
            "RGBA byte length ${bytes.size} != width*height*4 ($expected) for ${width}x$height",
          )
        }
        val tBitmap = System.nanoTime()
        val bitmap = rgbaToBitmap(bytes, width, height)
        val bitmapMs = elapsedMs(tBitmap)
        processBitmap(
          bitmap = bitmap,
          width = width,
          height = height,
          startedNs = started,
          promise = promise,
          decodeMs = decodeMs,
          bitmapMs = bitmapMs,
          bytesIn = bytes.size,
          transport = "rgba-base64",
        )
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(OcrFailedException(e.message ?: "recognizeFromRgba failed"))
      }
    }

    AsyncFunction("recognizeFromFile") { path: String, promise: Promise ->
      val started = System.nanoTime()
      try {
        val tDecode = System.nanoTime()
        val file = resolveFile(path)
        if (!file.exists() || !file.isFile) {
          throw InvalidOcrInputException("File not found: ${file.absolutePath}")
        }
        val bitmap =
          BitmapFactory.decodeFile(file.absolutePath)
            ?: throw InvalidOcrInputException("Could not decode image at ${file.absolutePath}")
        val decodeMs = elapsedMs(tDecode)
        processBitmap(
          bitmap = bitmap,
          width = bitmap.width,
          height = bitmap.height,
          startedNs = started,
          promise = promise,
          decodeMs = decodeMs,
          bitmapMs = 0.0,
          bytesIn = file.length().toInt().coerceAtLeast(0),
          transport = "file",
        )
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(OcrFailedException(e.message ?: "recognizeFromFile failed"))
      }
    }

    /**
     * Fire-and-forget ML Kit warmup with a tiny bitmap.
     * Idempotent; does not block camera startup when called from JS without await.
     */
    AsyncFunction("warmUp") { promise: Promise ->
      val started = System.nanoTime()
      if (warmed.get()) {
        promise.resolve(
          mapOf(
            "alreadyWarm" to true,
            "timingMs" to elapsedMs(started),
          ),
        )
        return@AsyncFunction
      }
      try {
        // 32×32 opaque gray — enough to force model/client init.
        val w = 32
        val h = 32
        val rgba = ByteArray(w * h * 4) { i ->
          when (i % 4) {
            3 -> 0xFF.toByte()
            else -> 0x80.toByte()
          }
        }
        val bitmap = rgbaToBitmap(rgba, w, h)
        val image = InputImage.fromBitmap(bitmap, 0)
        recognizer
          .process(image)
          .addOnSuccessListener {
            warmed.set(true)
            bitmap.recycle()
            promise.resolve(
              mapOf(
                "alreadyWarm" to false,
                "timingMs" to elapsedMs(started),
              ),
            )
          }
          .addOnFailureListener { e ->
            bitmap.recycle()
            promise.reject(OcrFailedException(e.message ?: "warmUp failed"))
          }
      } catch (e: Exception) {
        promise.reject(OcrFailedException(e.message ?: "warmUp failed"))
      }
    }

    OnDestroy {
      recognizer.close()
      warmed.set(false)
    }
  }

  private fun processBitmap(
    bitmap: Bitmap,
    width: Int,
    height: Int,
    startedNs: Long,
    promise: Promise,
    decodeMs: Double,
    bitmapMs: Double,
    bytesIn: Int,
    transport: String,
  ) {
    val tMlkit = System.nanoTime()
    val image = InputImage.fromBitmap(bitmap, 0)
    recognizer
      .process(image)
      .addOnSuccessListener { visionText ->
        val mlkitMs = elapsedMs(tMlkit)
        warmed.set(true)
        val totalMs = elapsedMs(startedNs)
        if (!bitmap.isRecycled) bitmap.recycle()
        promise.resolve(
          mapVisionText(
            visionText = visionText,
            timingMs = totalMs,
            decodeMs = decodeMs,
            bitmapMs = bitmapMs,
            mlkitMs = mlkitMs,
            bytesIn = bytesIn,
            transport = transport,
            width = width,
            height = height,
          ),
        )
      }
      .addOnFailureListener { e ->
        if (!bitmap.isRecycled) bitmap.recycle()
        promise.reject(OcrFailedException(e.message ?: "ML Kit process failed"))
      }
  }

  companion object {
    const val IMPLEMENTATION_STATUS = "ready"
  }
}

internal class InvalidOcrInputException(message: String) : CodedException(message)

internal class OcrFailedException(message: String) : CodedException(message)

private fun validateDimensions(width: Int, height: Int) {
  if (width < 8 || height < 8) {
    throw InvalidOcrInputException("width/height must be >= 8 (got ${width}x$height)")
  }
  if (width > 4096 || height > 4096) {
    throw InvalidOcrInputException("width/height must be <= 4096 (got ${width}x$height)")
  }
}

private fun decodeBase64(value: String): ByteArray {
  return try {
    Base64.decode(value, Base64.DEFAULT)
  } catch (e: IllegalArgumentException) {
    throw InvalidOcrInputException("Invalid base64: ${e.message}")
  }
}

private fun resolveFile(path: String): File {
  val trimmed = path.trim()
  if (trimmed.startsWith("file:", ignoreCase = true)) {
    return File(Uri.parse(trimmed).path ?: trimmed.removePrefix("file://"))
  }
  return File(trimmed)
}

/** ScanImage RGBA → ARGB_8888 Bitmap for InputImage.fromBitmap. */
private fun rgbaToBitmap(rgba: ByteArray, width: Int, height: Int): Bitmap {
  val pixelCount = width * height
  val argb = IntArray(pixelCount)
  var i = 0
  var p = 0
  while (p < pixelCount) {
    val r = rgba[i].toInt() and 0xFF
    val g = rgba[i + 1].toInt() and 0xFF
    val b = rgba[i + 2].toInt() and 0xFF
    val a = rgba[i + 3].toInt() and 0xFF
    argb[p] = (a shl 24) or (r shl 16) or (g shl 8) or b
    i += 4
    p += 1
  }
  val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
  bitmap.setPixels(argb, 0, width, 0, 0, width, height)
  return bitmap
}

private fun elapsedMs(startedNs: Long): Double =
  (System.nanoTime() - startedNs) / 1_000_000.0

/**
 * Shape matches `NativeOcrResult` / portable `TextRecognitionResult`.
 * Stage timings are native-clock-local (do not mix with JS performance.now).
 */
private fun mapVisionText(
  visionText: Text,
  timingMs: Double,
  decodeMs: Double,
  bitmapMs: Double,
  mlkitMs: Double,
  bytesIn: Int,
  transport: String,
  width: Int,
  height: Int,
): Map<String, Any?> {
  val words = mutableListOf<Map<String, Any?>>()
  for (block in visionText.textBlocks) {
    for (line in block.lines) {
      for (element in line.elements) {
        val text = element.text
        if (text.isBlank()) continue
        val box = element.boundingBox
        val conf = elementConfidence(element)
        val word = mutableMapOf<String, Any?>(
          "text" to text,
          "confidence" to conf,
        )
        if (box != null) {
          word["boundingBox"] = mapOf(
            "x" to box.left.toDouble(),
            "y" to box.top.toDouble(),
            "w" to box.width().toDouble(),
            "h" to box.height().toDouble(),
          )
        }
        words.add(word)
      }
    }
  }

  val mean =
    if (words.isEmpty()) {
      0.0
    } else {
      words.sumOf { (it["confidence"] as Double) } / words.size
    }

  return mapOf(
    "text" to visionText.text,
    "confidence" to mean,
    "words" to words,
    "timingMs" to timingMs,
    "decodeMs" to decodeMs,
    "bitmapMs" to bitmapMs,
    "mlkitMs" to mlkitMs,
    "bytesIn" to bytesIn,
    "transport" to transport,
    "width" to width,
    "height" to height,
  )
}

private fun elementConfidence(element: Text.Element): Double {
  val symbols = element.symbols
  if (symbols.isNotEmpty()) {
    var sum = 0f
    var n = 0
    for (symbol in symbols) {
      val c = symbol.confidence
      if (c in 0f..1f) {
        sum += c
        n += 1
      }
    }
    if (n > 0) return (sum / n).toDouble()
  }
  return DEFAULT_WORD_CONFIDENCE
}

private const val DEFAULT_WORD_CONFIDENCE = 0.85
