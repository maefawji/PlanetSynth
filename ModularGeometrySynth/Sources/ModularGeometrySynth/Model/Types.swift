import Foundation
import CoreGraphics

// MARK: - JSON-compatible value (mirrors Swift Codable ↔ Swift future Codable)

enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self)   { self = .bool(v);   return }
        if let v = try? c.decode(Double.self) { self = .number(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([JSONValue].self) { self = .array(v); return }
        if let v = try? c.decode([String: JSONValue].self) { self = .object(v); return }
        throw DecodingError.typeMismatch(JSONValue.self,
            DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unknown JSON type"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v):   try c.encode(v)
        case .null:          try c.encodeNil()
        case .array(let v):  try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    var doubleValue: Double?  { if case .number(let v) = self { return v }; return nil }
    var stringValue: String?  { if case .string(let v) = self { return v }; return nil }
    var boolValue: Bool?      { if case .bool(let v)   = self { return v }; return nil }
    var intValue: Int?        { doubleValue.map { Int($0) } }
}

// MARK: - Signal / Port types

enum SignalType: String, Codable, Sendable {
    case audio, control, trigger, geometry
}

enum PortDirection: String, Sendable {
    case input, output
}

struct PortDefinition: Sendable {
    let id: String
    let label: String
    let direction: PortDirection
    let signalType: SignalType
}

enum NodeCategory: String, Sendable {
    case audio, control, geometry, utility, output
}

struct PatchNodeDefinition: Sendable {
    let type: String
    let label: String
    let category: NodeCategory
    let inputs: [PortDefinition]
    let outputs: [PortDefinition]
    let defaultParams: [String: JSONValue]
}

// MARK: - Project model (Codable → maps directly to JSON project format)

struct PointCodable: Codable, Equatable, Sendable {
    var x: Double
    var y: Double
    var cgPoint: CGPoint { CGPoint(x: x, y: y) }
    init(_ p: CGPoint) { x = p.x; y = p.y }
    init(x: Double, y: Double) { self.x = x; self.y = y }
}

struct PatchNodeInstance: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var type: String
    var position: PointCodable
    var params: [String: JSONValue]
}

struct PatchEdge: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var fromNodeId: String
    var fromPortId: String
    var toNodeId: String
    var toPortId: String
    var signalType: SignalType
}

struct GeometryStyle: Codable, Equatable, Sendable {
    var stroke: String      = "rgba(0,0,0,0.75)"
    var strokeWidth: Double = 1.5
    var fill: String        = "none"
}

enum GeometryType: String, Codable, Sendable {
    case circle, path, point
}

struct GeometryObject: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var type: GeometryType
    var sourceNodeId: String?
    var params: [String: JSONValue]
    var style: GeometryStyle
}

struct SampleAsset: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var fileURL: String     // bookmark-resolved path in macOS native
    var fileType: String
}

struct ProjectMeta: Codable, Equatable, Sendable {
    var name: String
    var createdAt: Date
    var updatedAt: Date
}

struct TransportState: Codable, Equatable, Sendable {
    var bpm: Double
}

struct ModularProject: Codable, Equatable, Sendable {
    var version: String           = "0.1.0"
    var meta: ProjectMeta
    var transport: TransportState
    var nodes: [PatchNodeInstance]
    var edges: [PatchEdge]
    var geometry: [GeometryObject]
    var samples: [SampleAsset]
}

// MARK: - Default project (initial patch)

extension ModularProject {
    static func makeDefault() -> ModularProject {
        let now = Date()
        return ModularProject(
            meta: ProjectMeta(name: "Initial Patch", createdAt: now, updatedAt: now),
            transport: TransportState(bpm: 120),
            nodes: [
                PatchNodeInstance(
                    id: "circle_1",
                    type: "geometry.circle",
                    position: PointCodable(x: 60, y: 60),
                    params: ["cx": .number(300), "cy": .number(200), "r": .number(100)]
                ),
                PatchNodeInstance(
                    id: "osc_1",
                    type: "audio.oscillator",
                    position: PointCodable(x: 280, y: 60),
                    params: ["waveform": .string("sine"), "frequency": .number(440), "gain": .number(0.5)]
                ),
                PatchNodeInstance(
                    id: "gain_1",
                    type: "audio.gain",
                    position: PointCodable(x: 480, y: 60),
                    params: ["gain": .number(0.6)]
                ),
                PatchNodeInstance(
                    id: "out_1",
                    type: "audio.output",
                    position: PointCodable(x: 680, y: 60),
                    params: ["volume": .number(0.8)]
                ),
            ],
            edges: [
                PatchEdge(id: "e1", fromNodeId: "circle_1", fromPortId: "radius",
                          toNodeId: "osc_1", toPortId: "frequency", signalType: .control),
                PatchEdge(id: "e2", fromNodeId: "osc_1", fromPortId: "audio",
                          toNodeId: "gain_1", toPortId: "audio", signalType: .audio),
                PatchEdge(id: "e3", fromNodeId: "gain_1", fromPortId: "audio",
                          toNodeId: "out_1", toPortId: "audio", signalType: .audio),
            ],
            geometry: [
                GeometryObject(
                    id: "geom_1",
                    type: .circle,
                    sourceNodeId: "circle_1",
                    params: ["cx": .number(300), "cy": .number(200), "r": .number(100)],
                    style: GeometryStyle()
                )
            ],
            samples: []
        )
    }
}
