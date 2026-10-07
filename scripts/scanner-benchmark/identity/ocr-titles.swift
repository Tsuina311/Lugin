import AppKit
import Foundation
import Vision

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let image = NSImage(contentsOf: url),
      let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage else {
  fputs("FAIL \(path)\n", stderr)
  exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US", "fr-FR", "it-IT", "de-DE", "es-ES", "pt-BR"]
request.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
