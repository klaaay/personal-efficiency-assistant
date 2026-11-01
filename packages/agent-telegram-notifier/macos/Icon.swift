import AppKit
let target = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
for size in [16,32,128,256,512] {
    for scale in [1,2] {
        let pixels = size * scale
        let image = NSImage(size: NSSize(width: pixels, height: pixels))
        image.lockFocus()
        let p = CGFloat(pixels)
        let rect = NSRect(x: p * 0.08, y: p * 0.08, width: p * 0.84, height: p * 0.84)
        NSColor(calibratedRed: 0.20, green: 0.36, blue: 0.65, alpha: 1).setFill()
        NSBezierPath(roundedRect: rect, xRadius: p * 0.19, yRadius: p * 0.19).fill()
        if let bird = NSImage(systemSymbolName: "bird.fill", accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: p * 0.55, weight: .medium)) {
            let tinted = NSImage(size: bird.size)
            tinted.lockFocus(); NSColor.white.set(); NSRect(origin: .zero, size: bird.size).fill(); bird.draw(at: .zero, from: .zero, operation: .destinationIn, fraction: 1); tinted.unlockFocus()
            let ratio = min(p * 0.58 / bird.size.width, p * 0.58 / bird.size.height)
            let w = bird.size.width * ratio; let h = bird.size.height * ratio
            tinted.draw(in: NSRect(x: (p-w)/2, y: (p-h)/2, width: w, height: h))
        }
        image.unlockFocus()
        let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let name = "icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: target.appendingPathComponent(name))
    }
}
