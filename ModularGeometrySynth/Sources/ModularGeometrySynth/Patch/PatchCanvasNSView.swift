import AppKit
import Foundation

// MARK: - Patch canvas rendered with Core Graphics / AppKit

final class PatchCanvasNSView: NSView {

    // Data (set from SwiftUI via updateNSView)
    var nodes: [PatchNodeInstance] = [] { didSet { needsDisplay = true } }
    var edges: [PatchEdge] = []         { didSet { needsDisplay = true } }
    var selectedNodeId: String?         { didSet { needsDisplay = true } }

    // Callbacks → main-thread safe because we're always on main
    var onNodeMoved:    ((String, PointCodable) -> Void)?
    var onNodeSelected: ((String?) -> Void)?
    var onEdgeAdded:    ((String, String, String, String) -> Void)? // fromId, fromPort, toId, toPort
    var onNodeDeleted:  ((String) -> Void)?
    var onEdgeDeleted:  ((String) -> Void)?

    // Interaction state
    private var draggingNodeId: String?
    private var dragOffset: CGPoint = .zero
    private var connectingFromNode: String?
    private var connectingFromPort: String?
    private var connectingFromIsOutput = false
    private var connectingPoint: CGPoint = .zero
    private var mousePoint: CGPoint = .zero

    // Layout constants
    static let nodeWidth: CGFloat   = 140
    static let nodeHeaderH: CGFloat = 22
    static let portRowH: CGFloat    = 16
    static let portRadius: CGFloat  = 5
    static let nodeCorner: CGFloat  = 6
    static let portPadX: CGFloat    = 10

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        let trackingArea = NSTrackingArea(rect: bounds,
            options: [.activeAlways, .mouseMoved, .inVisibleRect], owner: self)
        addTrackingArea(trackingArea)
    }
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - Layout helpers

    func nodeFrame(for node: PatchNodeInstance) -> CGRect {
        let def = nodeRegistry[node.type]
        let rows = max((def?.inputs.count ?? 0), (def?.outputs.count ?? 0))
        let h = Self.nodeHeaderH + CGFloat(max(rows, 1)) * Self.portRowH + 8
        return CGRect(x: node.position.x, y: node.position.y,
                      width: Self.nodeWidth, height: h)
    }

    func inputPortCenter(nodeId: String, portId: String) -> CGPoint? {
        guard let node = nodes.first(where: { $0.id == nodeId }),
              let def  = nodeRegistry[node.type],
              let idx  = def.inputs.firstIndex(where: { $0.id == portId })
        else { return nil }
        let frame = nodeFrame(for: node)
        let y = frame.minY + Self.nodeHeaderH + CGFloat(idx) * Self.portRowH + Self.portRowH / 2
        return CGPoint(x: frame.minX + Self.portPadX, y: y)
    }

    func outputPortCenter(nodeId: String, portId: String) -> CGPoint? {
        guard let node = nodes.first(where: { $0.id == nodeId }),
              let def  = nodeRegistry[node.type],
              let idx  = def.outputs.firstIndex(where: { $0.id == portId })
        else { return nil }
        let frame = nodeFrame(for: node)
        let y = frame.minY + Self.nodeHeaderH + CGFloat(idx) * Self.portRowH + Self.portRowH / 2
        return CGPoint(x: frame.maxX - Self.portPadX, y: y)
    }

    // MARK: - Hit testing

    func hitTestNode(at p: CGPoint) -> String? {
        nodes.reversed().first { nodeFrame(for: $0).contains(p) }?.id
    }

    struct PortHit {
        let nodeId: String
        let portId: String
        let isOutput: Bool
        let center: CGPoint
    }

    func hitTestPort(at p: CGPoint) -> PortHit? {
        let r = Self.portRadius + 4
        for node in nodes.reversed() {
            let def = nodeRegistry[node.type]
            for port in def?.inputs ?? [] {
                if let c = inputPortCenter(nodeId: node.id, portId: port.id),
                   hypot(p.x - c.x, p.y - c.y) < r {
                    return PortHit(nodeId: node.id, portId: port.id, isOutput: false, center: c)
                }
            }
            for port in def?.outputs ?? [] {
                if let c = outputPortCenter(nodeId: node.id, portId: port.id),
                   hypot(p.x - c.x, p.y - c.y) < r {
                    return PortHit(nodeId: node.id, portId: port.id, isOutput: true, center: c)
                }
            }
        }
        return nil
    }

    // MARK: - Drawing

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }

        // Background
        NSColor(calibratedWhite: 0.94, alpha: 1).setFill()
        NSBezierPath(rect: bounds).fill()

        // Grid
        drawGrid(ctx)

        // Cables
        for edge in edges { drawEdge(edge, ctx) }

        // In-progress connection
        if connectingFromNode != nil {
            drawTempCable(ctx)
        }

        // Nodes
        for node in nodes { drawNode(node, ctx) }
    }

    private func drawGrid(_ ctx: CGContext) {
        ctx.setStrokeColor(NSColor(calibratedWhite: 0.86, alpha: 1).cgColor)
        ctx.setLineWidth(0.5)
        let step: CGFloat = 20
        var x: CGFloat = 0
        while x <= bounds.width { ctx.move(to: CGPoint(x: x, y: 0)); ctx.addLine(to: CGPoint(x: x, y: bounds.height)); x += step }
        var y: CGFloat = 0
        while y <= bounds.height { ctx.move(to: CGPoint(x: 0, y: y)); ctx.addLine(to: CGPoint(x: bounds.width, y: y)); y += step }
        ctx.strokePath()
    }

    private func drawEdge(_ edge: PatchEdge, _ ctx: CGContext) {
        guard
            let from = outputPortCenter(nodeId: edge.fromNodeId, portId: edge.fromPortId),
            let to   = inputPortCenter(nodeId: edge.toNodeId,   portId: edge.toPortId)
        else { return }
        drawCable(from: from, to: to, type: edge.signalType, ctx: ctx)
    }

    private func drawTempCable(_ ctx: CGContext) {
        guard let nid = connectingFromNode, let pid = connectingFromPort else { return }
        let from: CGPoint
        if connectingFromIsOutput {
            from = outputPortCenter(nodeId: nid, portId: pid) ?? connectingPoint
            drawCable(from: from, to: mousePoint, type: .control, ctx: ctx, alpha: 0.4)
        } else {
            from = inputPortCenter(nodeId: nid, portId: pid) ?? connectingPoint
            drawCable(from: mousePoint, to: from, type: .control, ctx: ctx, alpha: 0.4)
        }
    }

    private func drawCable(from: CGPoint, to: CGPoint, type: SignalType, ctx: CGContext, alpha: CGFloat = 1) {
        let path = CGMutablePath()
        path.move(to: from)
        let dx = abs(to.x - from.x) * 0.5
        path.addCurve(to: to,
                      control1: CGPoint(x: from.x + dx, y: from.y),
                      control2: CGPoint(x: to.x - dx,   y: to.y))

        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        switch type {
        case .audio:
            ctx.setStrokeColor(NSColor(calibratedRed: 0.08, green: 0.08, blue: 0.08, alpha: alpha * 0.85).cgColor)
            ctx.setLineWidth(2)
            ctx.addPath(path); ctx.strokePath()
        case .control:
            ctx.setStrokeColor(NSColor(calibratedRed: 0.15, green: 0.35, blue: 0.8, alpha: alpha * 0.65).cgColor)
            ctx.setLineWidth(1.5)
            ctx.setLineDash(phase: 0, lengths: [4, 4])
            ctx.addPath(path); ctx.strokePath()
            ctx.setLineDash(phase: 0, lengths: [])
        case .trigger:
            ctx.setStrokeColor(NSColor(calibratedRed: 0.7, green: 0.25, blue: 0.1, alpha: alpha * 0.7).cgColor)
            ctx.setLineWidth(1.25)
            ctx.setLineDash(phase: 0, lengths: [2, 3])
            ctx.addPath(path); ctx.strokePath()
            ctx.setLineDash(phase: 0, lengths: [])
        case .geometry:
            ctx.setStrokeColor(NSColor(calibratedRed: 0.15, green: 0.55, blue: 0.3, alpha: alpha * 0.6).cgColor)
            ctx.setLineWidth(1.25)
            ctx.addPath(path); ctx.strokePath()
        }
    }

    private func drawNode(_ node: PatchNodeInstance, _ ctx: CGContext) {
        let frame = nodeFrame(for: node)
        let def = nodeRegistry[node.type]
        let isSelected = node.id == selectedNodeId

        // Shadow
        ctx.setShadow(offset: CGSize(width: 0, height: 2), blur: 6,
                      color: NSColor.black.withAlphaComponent(0.12).cgColor)

        // Node background
        let path = CGPath(roundedRect: frame, cornerWidth: Self.nodeCorner, cornerHeight: Self.nodeCorner, transform: nil)
        ctx.setFillColor(NSColor.white.cgColor)
        ctx.addPath(path); ctx.fillPath()

        ctx.setShadow(offset: .zero, blur: 0, color: nil)

        // Border
        ctx.setStrokeColor(isSelected
            ? NSColor(calibratedRed: 0.15, green: 0.45, blue: 0.95, alpha: 0.8).cgColor
            : NSColor.black.withAlphaComponent(0.12).cgColor)
        ctx.setLineWidth(isSelected ? 1.5 : 0.5)
        ctx.addPath(path); ctx.strokePath()

        // Header background
        let headerRect = CGRect(x: frame.minX, y: frame.minY,
                                width: frame.width, height: Self.nodeHeaderH)
        let headerColor = categoryColor(for: def?.category ?? .utility).withAlphaComponent(0.12)
        let headerPath = CGPath(roundedRect: headerRect, cornerWidth: Self.nodeCorner, cornerHeight: 0, transform: nil)
        ctx.setFillColor(headerColor.cgColor)
        ctx.addPath(headerPath); ctx.fillPath()

        // Label
        let label = def?.label ?? node.type
        drawText(label, at: CGPoint(x: frame.minX + 8, y: frame.minY + 4),
                 font: .systemFont(ofSize: 10, weight: .semibold),
                 color: .black.withAlphaComponent(0.75), ctx: ctx)

        // Ports
        let inputs  = def?.inputs  ?? []
        let outputs = def?.outputs ?? []

        for (i, port) in inputs.enumerated() {
            let y = frame.minY + Self.nodeHeaderH + CGFloat(i) * Self.portRowH + Self.portRowH / 2
            let cx = frame.minX + Self.portPadX
            drawPort(center: CGPoint(x: cx, y: y), signal: port.signalType, isOutput: false, ctx: ctx)
            drawText(port.label, at: CGPoint(x: cx + Self.portRadius + 4, y: y - 5),
                     font: .systemFont(ofSize: 9), color: .black.withAlphaComponent(0.5), ctx: ctx)
        }

        for (i, port) in outputs.enumerated() {
            let y = frame.minY + Self.nodeHeaderH + CGFloat(i) * Self.portRowH + Self.portRowH / 2
            let cx = frame.maxX - Self.portPadX
            drawPort(center: CGPoint(x: cx, y: y), signal: port.signalType, isOutput: true, ctx: ctx)
            let label = port.label
            let labelW = (label as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 9)]).width
            drawText(label, at: CGPoint(x: cx - Self.portRadius - 4 - labelW, y: y - 5),
                     font: .systemFont(ofSize: 9), color: .black.withAlphaComponent(0.5), ctx: ctx)
        }
    }

    private func drawPort(center: CGPoint, signal: SignalType, isOutput: Bool, ctx: CGContext) {
        let r = Self.portRadius
        let portRect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
        ctx.setFillColor(portColor(signal).cgColor)
        ctx.fillEllipse(in: portRect)
        ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.8).cgColor)
        ctx.setLineWidth(1)
        ctx.strokeEllipse(in: portRect)
    }

    private func drawText(_ text: String, at point: CGPoint, font: NSFont, color: NSColor, ctx: CGContext) {
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        (text as NSString).draw(at: point, withAttributes: attrs)
    }

    private func portColor(_ signal: SignalType) -> NSColor {
        switch signal {
        case .audio:    return NSColor(calibratedRed: 0.15, green: 0.15, blue: 0.15, alpha: 1)
        case .control:  return NSColor(calibratedRed: 0.2,  green: 0.45, blue: 0.95, alpha: 1)
        case .trigger:  return NSColor(calibratedRed: 0.75, green: 0.25, blue: 0.1,  alpha: 1)
        case .geometry: return NSColor(calibratedRed: 0.15, green: 0.6,  blue: 0.35, alpha: 1)
        }
    }

    private func categoryColor(for category: NodeCategory) -> NSColor {
        switch category {
        case .audio:    return NSColor(calibratedRed: 0.1, green: 0.1, blue: 0.1, alpha: 1)
        case .control:  return NSColor(calibratedRed: 0.2, green: 0.4, blue: 0.9, alpha: 1)
        case .geometry: return NSColor(calibratedRed: 0.1, green: 0.6, blue: 0.3, alpha: 1)
        case .output:   return NSColor(calibratedRed: 0.7, green: 0.2, blue: 0.1, alpha: 1)
        case .utility:  return NSColor(calibratedRed: 0.5, green: 0.5, blue: 0.5, alpha: 1)
        }
    }

    // MARK: - Mouse events

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if let port = hitTestPort(at: p) {
            connectingFromNode = port.nodeId
            connectingFromPort = port.portId
            connectingFromIsOutput = port.isOutput
            connectingPoint = port.center
            mousePoint = p
            return
        }
        if let nodeId = hitTestNode(at: p) {
            let frame = nodeFrame(for: nodes.first { $0.id == nodeId }!)
            draggingNodeId = nodeId
            dragOffset = CGPoint(x: p.x - frame.minX, y: p.y - frame.minY)
            onNodeSelected?(nodeId)
        } else {
            onNodeSelected?(nil)
        }
    }

    override func mouseDragged(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        mousePoint = p
        if let nid = draggingNodeId {
            let newPos = PointCodable(x: p.x - dragOffset.x, y: p.y - dragOffset.y)
            onNodeMoved?(nid, newPos)
        } else if connectingFromNode != nil {
            needsDisplay = true
        }
    }

    override func mouseUp(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if let fromNode = connectingFromNode, let fromPort = connectingFromPort {
            if let toPort = hitTestPort(at: p), toPort.isOutput != connectingFromIsOutput {
                let (outNode, outPort, inNode, inPort) = connectingFromIsOutput
                    ? (fromNode, fromPort, toPort.nodeId, toPort.portId)
                    : (toPort.nodeId, toPort.portId, fromNode, fromPort)
                onEdgeAdded?(outNode, outPort, inNode, inPort)
            }
        }
        draggingNodeId = nil
        connectingFromNode = nil
        connectingFromPort = nil
        needsDisplay = true
    }

    override func mouseMoved(with event: NSEvent) {
        mousePoint = convert(event.locationInWindow, from: nil)
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 51 || event.characters == "\u{7F}" {
            // Backspace / Delete
            if let id = selectedNodeId { onNodeDeleted?(id) }
        }
    }
}
