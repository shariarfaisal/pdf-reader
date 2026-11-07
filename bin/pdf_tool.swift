import Foundation
import PDFKit

guard CommandLine.arguments.count > 2 else {
    print("{\"error\": \"Usage: pdf_tool <pdfPath> <command: info|extract-text|render-page> [pageIndex] [outputPath] [scale]\"}")
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
let command = CommandLine.arguments[2]

guard let pdfDoc = PDFDocument(url: URL(fileURLWithPath: pdfPath)) else {
    print("{\"error\": \"Failed to open PDF document at \(pdfPath)\"}")
    exit(1)
}

let pageCount = pdfDoc.pageCount

if command == "info" {
    var hasEmbeddedText = false
    var sampleText = ""
    for i in 0..<min(3, pageCount) {
        if let page = pdfDoc.page(at: i), let text = page.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            hasEmbeddedText = true
            sampleText += text + " "
        }
    }
    let res: [String: Any] = [
        "pageCount": pageCount,
        "hasEmbeddedText": hasEmbeddedText,
        "sampleLength": sampleText.count
    ]
    if let data = try? JSONSerialization.data(withJSONObject: res), let str = String(data: data, encoding: .utf8) {
        print(str)
    }
} else if command == "extract-text" {
    guard CommandLine.arguments.count > 3, let pageIdx = Int(CommandLine.arguments[3]), pageIdx >= 0, pageIdx < pageCount else {
        print("{\"error\": \"Invalid page index\"}")
        exit(1)
    }
    let page = pdfDoc.page(at: pageIdx)
    let text = page?.string ?? ""
    let res: [String: Any] = [
        "pageIndex": pageIdx,
        "text": text,
        "charCount": text.count
    ]
    if let data = try? JSONSerialization.data(withJSONObject: res), let str = String(data: data, encoding: .utf8) {
        print(str)
    }
} else if command == "render-page" {
    guard CommandLine.arguments.count > 4, let pageIdx = Int(CommandLine.arguments[3]), pageIdx >= 0, pageIdx < pageCount else {
        print("{\"error\": \"Invalid page index or output path\"}")
        exit(1)
    }
    let outPath = CommandLine.arguments[4]
    guard let page = pdfDoc.page(at: pageIdx) else {
        print("{\"error\": \"Failed to get page at \(pageIdx)\"}")
        exit(1)
    }
    let pageRect = page.bounds(for: .mediaBox)
    // Scale for crisp OCR / viewing (default 2x DPI). An optional trailing
    // argument allows small on-demand preview renders.
    var scale: CGFloat = 2.0
    if CommandLine.arguments.count > 5, let requested = Double(CommandLine.arguments[5]), requested > 0.05, requested <= 4.0 {
        scale = CGFloat(requested)
    }
    let width = Int(pageRect.width * scale)
    let height = Int(pageRect.height * scale)
    
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        print("{\"error\": \"Could not create CGContext\"}")
        exit(1)
    }
    
    context.setFillColor(CGColor.white)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.scaleBy(x: scale, y: scale)
    
    // Draw PDF page into context
    page.draw(with: .mediaBox, to: context)
    
    guard let cgImage = context.makeImage() else {
        print("{\"error\": \"Could not generate CGImage\"}")
        exit(1)
    }
    
    let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
    // JPEG keeps lightweight preview renders small; everything else stays PNG.
    let lowerOutPath = outPath.lowercased()
    let wantsJPEG = lowerOutPath.hasSuffix(".jpg") || lowerOutPath.hasSuffix(".jpeg")
    let imageData = wantsJPEG
        ? bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: 0.75])
        : bitmapRep.representation(using: .png, properties: [:])
    guard let pngData = imageData else {
        print("{\"error\": \"Could not encode page image\"}")
        exit(1)
    }
    
    do {
        try pngData.write(to: URL(fileURLWithPath: outPath))
        let res: [String: Any] = [
            "success": true,
            "pageIndex": pageIdx,
            "width": width,
            "height": height,
            "outPath": outPath
        ]
        if let data = try? JSONSerialization.data(withJSONObject: res), let str = String(data: data, encoding: .utf8) {
            print(str)
        }
    } catch {
        print("{\"error\": \"Failed to write image: \(error.localizedDescription)\"}")
        exit(1)
    }
}
