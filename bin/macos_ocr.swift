import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    print("{\"error\": \"Missing image path argument\"}")
    exit(1)
}

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath) else {
    print("{\"error\": \"Could not load image at path: \(imagePath)\"}")
    exit(1)
}

guard let tiffData = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    print("{\"error\": \"Could not convert NSImage to CGImage\"}")
    exit(1)
}

let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
let request = VNRecognizeTextRequest { (request, error) in
    if let error = error {
        print("{\"error\": \"\(error.localizedDescription)\"}")
        return
    }
    
    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        print("{\"text\": \"\", \"confidence\": 0.0, \"lines\": []}")
        return
    }
    
    var lines: [String] = []
    var totalConfidence: Float = 0.0
    
    for observation in observations {
        if let topCandidate = observation.topCandidates(1).first {
            lines.append(topCandidate.string)
            totalConfidence += topCandidate.confidence
        }
    }
    
    let avgConfidence = lines.isEmpty ? 0.0 : Double(totalConfidence / Float(lines.count))
    let fullText = lines.joined(separator: "\n")
    
    let result: [String: Any] = [
        "success": true,
        "text": fullText,
        "confidence": avgConfidence,
        "lineCount": lines.count
    ]
    
    if let jsonData = try? JSONSerialization.data(withJSONObject: result, options: []),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
    }
}

// Support accurate recognition with available languages
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 12.0, *) {
    request.recognitionLanguages = ["ar-SA", "en-US", "hi-IN"]
}

do {
    try requestHandler.perform([request])
} catch {
    print("{\"error\": \"\(error.localizedDescription)\"}")
    exit(1)
}
