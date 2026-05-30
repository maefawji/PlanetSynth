import AppKit
import CoreGraphics

enum GeometryTool: String, CaseIterable {
    case select, addCircle, addPoint, addPath
    var label: String {
        switch self {
        case .select:    return "Select"
        case .addCircle: return "Circle"
        case .addPoint:  return "Point"
        case .addPath:   return "Path"
        }
    }
}

final class GeometryCanvasNSView: NSView {

    var geometryObjects: [GeometryObject] = [] { didSet { needsDisplay = true } }
    var selectedGeometryId: String?             { didSet { needsDisplay = true } }
    var currentTool: GeometryTool = .select

    var onGeometryAdded:    ((GeometryObject) -> Void)?
    var onGeometrySelected: ((String?) -> Void)?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        let area = NSTrackingArea(rect: bounds,
            options: [.activeAlways, .mouseMoved, .inVisibleRect], owner: self)
        addTrackingArea(area)
    }
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - Drawing

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }

        // Background
        NSColor(calibratedWhite: 0.97, alpha: 1).setFill()
        NSBezierPath(rect: bounds).fill()

        // Subtle dot grid
        drawDotGrid(ctx)

        // Geometry objects
        for obj in geometryObjects {
            drawObject(obj, ctx: ctx)
        }
    }

    private func drawDotGrid(_ ctx: CGContext) {
        let step: CGFloat = 24
        ctx.setFillColor(NSColor.black.withAlphaComponent(0.06).cgColor)
        var x: CGFloat = step
        while x < bounds.width {
            var y: CGFloat = step
            while y < bounds.height {
                ctx.fillEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                y += step
            }
            x += step
        }
    }

    private func drawObject(_ obj: GeometryObject, ctx: CGContext) {
        let isSelected = obj.id == selectedGeometryId
        let strokeColor = parseColor(obj.style.stroke)
        let lineWidth = obj.style.strokeWidth

        ctx.setLineWidth(lineWidth)
        ctx.setStrokeColor(strokeColor.cgColor)

        if isSelected {
            ctx.setLineWidth(lineWidth + 1)
            ctx.setStrokeColor(NSColor(calibratedRed: 0.15, green: 0.45, blue: 0.95, alpha: 0.9).cgColor)
        }

        switch obj.type {
        case .circle:
            let cx = obj.params["cx"]?.doubleValue ?? 300
            let cy = obj.params["cy"]?.doubleValue ?? 200
            let r  = obj.params["r"]?.doubleValue  ?? 100
            let rect = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
            ctx.setFillColor(CGColor.clear)
            if obj.style.fill != "none",
               let fillColor = try? parseColorFill(obj.style.fill) {
                ctx.setFillColor(fillColor.cgColor)
                ctx.fillEllipse(in: rect)
            }
            ctx.strokeEllipse(in: rect)

            // Center dot
            ctx.setFillColor(strokeColor.withAlphaComponent(0.4).cgColor)
            ctx.fillEllipse(in: CGRect(x: cx - 2, y: cy - 2, width: 4, height: 4))

        case .point:
            let x = obj.params["x"]?.doubleValue ?? 300
            let y = obj.params["y"]?.doubleValue ?? 200
            ctx.setFillColor(strokeColor.cgColor)
            ctx.fillEllipse(in: CGRect(x: x - 4, y: y - 4, width: 8, height: 8))
            ctx.strokeEllipse(in: CGRect(x: x - 4, y: y - 4, width: 8, height: 8))

        case .path:
            guard let svgPath = obj.params["svgPath"]?.stringValue else { return }
            if let path = parseSVGPath(svgPath) {
                ctx.addPath(path)
                ctx.strokePath()
            }
        }

        // Selection handles
        if isSelected {
            drawSelectionHandles(for: obj, ctx: ctx)
        }
    }

    private func drawSelectionHandles(for obj: GeometryObject, ctx: CGContext) {
        var points: [CGPoint] = []
        switch obj.type {
        case .circle:
            let cx = obj.params["cx"]?.doubleValue ?? 0
            let cy = obj.params["cy"]?.doubleValue ?? 0
            let r  = obj.params["r"]?.doubleValue ?? 0
            points = [CGPoint(x: cx + r, y: cy), CGPoint(x: cx - r, y: cy),
                      CGPoint(x: cx, y: cy + r), CGPoint(x: cx, y: cy - r)]
        case .point:
            let x = obj.params["x"]?.doubleValue ?? 0
            let y = obj.params["y"]?.doubleValue ?? 0
            points = [CGPoint(x: x, y: y)]
        case .path: return
        }
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.15, green: 0.45, blue: 0.95, alpha: 0.9).cgColor)
        ctx.setLineWidth(1)
        for p in points {
            let r: CGFloat = 4
            ctx.fillEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
            ctx.strokeEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2))
        }
    }

    // MARK: - Mouse events

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        switch currentTool {
        case .select:
            if let obj = hitTestGeometry(at: p) {
                onGeometrySelected?(obj.id)
            } else {
                onGeometrySelected?(nil)
            }
        case .addCircle:
            let id = "geom_\(UUID().uuidString.prefix(8))"
            let obj = GeometryObject(
                id: id, type: .circle, sourceNodeId: nil,
                params: ["cx": .number(p.x), "cy": .number(p.y), "r": .number(60)],
                style: GeometryStyle()
            )
            onGeometryAdded?(obj)
        case .addPoint:
            let id = "geom_\(UUID().uuidString.prefix(8))"
            let obj = GeometryObject(
                id: id, type: .point, sourceNodeId: nil,
                params: ["x": .number(p.x), "y": .number(p.y)],
                style: GeometryStyle()
            )
            onGeometryAdded?(obj)
        case .addPath:
            let id = "geom_\(UUID().uuidString.prefix(8))"
            let svgPath = "M \(Int(p.x)) \(Int(p.y)) C \(Int(p.x + 60)) \(Int(p.y - 60)), \(Int(p.x + 140)) \(Int(p.y + 60)), \(Int(p.x + 200)) \(Int(p.y))"
            let obj = GeometryObject(
                id: id, type: .path, sourceNodeId: nil,
                params: ["svgPath": .string(svgPath)],
                style: GeometryStyle()
            )
            onGeometryAdded?(obj)
        }
    }

    private func hitTestGeometry(at p: CGPoint) -> GeometryObject? {
        geometryObjects.reversed().first { obj in
            switch obj.type {
            case .circle:
                let cx = obj.params["cx"]?.doubleValue ?? 0
                let cy = obj.params["cy"]?.doubleValue ?? 0
                let r  = obj.params["r"]?.doubleValue ?? 0
                let d  = hypot(p.x - cx, p.y - cy)
                return abs(d - r) < 8 || d < r
            case .point:
                let x = obj.params["x"]?.doubleValue ?? 0
                let y = obj.params["y"]?.doubleValue ?? 0
                return hypot(p.x - x, p.y - y) < 10
            case .path:
                return false
            }
        }
    }

    // MARK: - Helpers

    private func parseColor(_ str: String) -> NSColor {
        // Accepts "rgba(r,g,b,a)" or basic named colors
        if str.hasPrefix("rgba(") {
            let inner = str.dropFirst(5).dropLast(1)
            let parts = inner.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if parts.count == 4 {
                return NSColor(calibratedRed: parts[0]/255, green: parts[1]/255,
                               blue: parts[2]/255, alpha: parts[3])
            }
        }
        return NSColor.black.withAlphaComponent(0.75)
    }

    private func parseColorFill(_ str: String) throws -> NSColor {
        return parseColor(str)
    }
}

// MARK: - Minimal SVG path parser (M, L, C, Z)

func parseSVGPath(_ svg: String) -> CGPath? {
    let path = CGMutablePath()
    let tokens = svg.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
    var i = 0
    var current = CGPoint.zero

    func nextDouble() -> Double? {
        guard i < tokens.count else { return nil }
        let d = Double(tokens[i])
        i += 1
        return d
    }

    while i < tokens.count {
        let cmd = tokens[i]; i += 1
        switch cmd {
        case "M":
            if let x = nextDouble(), let y = nextDouble() {
                current = CGPoint(x: x, y: y)
                path.move(to: current)
            }
        case "L":
            if let x = nextDouble(), let y = nextDouble() {
                current = CGPoint(x: x, y: y)
                path.addLine(to: current)
            }
        case "C":
            if let x1 = nextDouble(), let y1 = nextDouble(),
               let x2 = nextDouble(), let y2 = nextDouble(),
               let x  = nextDouble(), let y  = nextDouble() {
                let c1 = CGPoint(x: x1, y: y1)
                let c2 = CGPoint(x: x2, y: y2)
                current = CGPoint(x: x, y: y)
                path.addCurve(to: current, control1: c1, control2: c2)
            }
        case "Z", "z":
            path.closeSubpath()
        default:
            break
        }
    }
    return path.isEmpty ? nil : path
}
