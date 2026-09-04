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

/**
 * Offline OCR via Google ML Kit Text Recognition v2 (Latin, bundled model).
 *
 * Scope (keep Magic / ranking / fusion OUT of this module):
 *   RGBA or image file → raw text + word boxes + confidence + timingMs
 *
 * Intended input: normalized 744×1039 *region crops* from shared TypeScript
 * (`readTitle` / `readRules` / footer), never live camera frames at detector cadence.
 */
class LuginOcrModule : Module() {
  private val recognizer by lazy {
    TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  }

  override fun definition() = ModuleDefinition {
    Name("LuginOcr")

    /**
     * `ready` once ML Kit Latin is wired. JS adapters gate on module presence;
     * old APKs without this package still see `null` from requireOptionalNativeModule.
     */
    Constant("implementationStatus") {
      IMPLEMENTATION_STATUS
    }

    /**
     * RGBA bytes (base64) → NativeOcrResult.
     * Expected layout: length == width * height * 4, channel order R,G,B,A
     * (same as portable `ScanImage`).
     */
    AsyncFunction("recognizeFromRgba") { rgbaBase64: String, width: Int, height: Int, promise: Promise ->
      val started = System.nanoTime()
      try {
        validateDimensions(width, height)
        val bytes = decodeBase64(rgbaBase64)
        val expected = width * height * 4
        if (bytes.size != expected) {
          throw InvalidOcrInputException(
            "RGBA byte length ${bytes.size} != width*height*4 ($expected) for ${width}x$height",
          )
        }
        val bitmap = rgbaToBitmap(bytes, width, height)
        processBitmap(bitmap, started, promise)
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(OcrFailedException(e.message ?: "recognizeFromRgba failed"))
      }
    }

    /**
     * JPEG/PNG path → NativeOcrResult.
     * Accepts absolute paths or file:// URIs (temp files from JS debug bridges).
     */
    AsyncFunction("recognizeFromFile") { path: String, promise: Promise ->
      val started = System.nanoTime()
      try {
        val file = resolveFile(path)
        if (!file.exists() || !file.isFile) {
          throw InvalidOcrInputException("File not found: ${file.absolutePath}")
        }
        val bitmap =
          BitmapFactory.decodeFile(file.absolutePath)
            ?: throw InvalidOcrInputException("Could not decode image at ${file.absolutePath}")
        processBitmap(bitmap, started, promise)
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(OcrFailedException(e.message ?: "recognizeFromFile failed"))
      }
    }

    OnDestroy {
      recognizer.close()
    }
  }

  private fun processBitmap(bitmap: Bitmap, startedNs: Long, promise: Promise) {
    val image = InputImage.fromBitmap(bitmap, 0)
    recognizer
      .process(image)
      .addOnSuccessListener { visionText ->
        promise.resolve(mapVisionText(visionText, elapsedMs(startedNs)))
      }
      .addOnFailureListener { e ->
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
 * Word units = ML Kit `Text.Element` (roughly space-separated tokens).
 */
private fun mapVisionText(visionText: Text, timingMs: Double): Map<String, Any?> {
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
  )
}

/**
 * ML Kit Element confidence is 0–1 when available; fall back to symbol mean,
 * then a neutral prior so fusion does not treat missing scores as zero-trust.
 */
private fun elementConfidence(element: Text.Element): Double {
  val symbols = element.symbols
  if (symbols != null && symbols.isNotEmpty()) {
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
