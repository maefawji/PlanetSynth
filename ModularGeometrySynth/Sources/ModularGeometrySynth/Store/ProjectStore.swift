import Foundation
import Observation

@Observable
@MainActor
final class ProjectStore {
    var project: ModularProject = .makeDefault()
    var isDirty: Bool = false

    // MARK: - Node operations

    func addNode(type: String, position: PointCodable) {
        guard let def = nodeRegistry[type] else { return }
        let id = "node_\(UUID().uuidString.prefix(8))"
        let node = PatchNodeInstance(id: id, type: type, position: position, params: def.defaultParams)
        project.nodes.append(node)
        isDirty = true

        // Auto-add geometry object if geometry node
        if def.category == .geometry {
            let geomId = "geom_\(UUID().uuidString.prefix(8))"
            let geom = GeometryObject(id: geomId, type: geomTypeFor(type), sourceNodeId: id,
                                      params: def.defaultParams, style: GeometryStyle())
            project.geometry.append(geom)
        }
    }

    func updateNodeParams(nodeId: String, params: [String: JSONValue]) {
        guard let idx = project.nodes.firstIndex(where: { $0.id == nodeId }) else { return }
        for (k, v) in params {
            project.nodes[idx].params[k] = v
        }
        // Sync geometry objects that are linked to this node
        syncGeometry(fromNode: nodeId, params: project.nodes[idx].params)
        isDirty = true
    }

    func removeNode(nodeId: String) {
        project.nodes.removeAll { $0.id == nodeId }
        project.edges.removeAll { $0.fromNodeId == nodeId || $0.toNodeId == nodeId }
        project.geometry.removeAll { $0.sourceNodeId == nodeId }
        isDirty = true
    }

    func moveNode(nodeId: String, position: PointCodable) {
        guard let idx = project.nodes.firstIndex(where: { $0.id == nodeId }) else { return }
        project.nodes[idx].position = position
        isDirty = true
    }

    // MARK: - Edge operations

    func addEdge(fromNodeId: String, fromPortId: String, toNodeId: String, toPortId: String) {
        guard resolveConnection(fromNodeId: fromNodeId, fromPortId: fromPortId,
                                toNodeId: toNodeId, toPortId: toPortId,
                                project: project) else { return }
        // Remove any existing edge that targets the same input port (single input rule)
        project.edges.removeAll { $0.toNodeId == toNodeId && $0.toPortId == toPortId }

        let fromType = project.nodes.first(where: { $0.id == fromNodeId })
            .flatMap { nodeRegistry[$0.type] }?.outputs.first(where: { $0.id == fromPortId })?.signalType ?? .control

        let edge = PatchEdge(
            id: "edge_\(UUID().uuidString.prefix(8))",
            fromNodeId: fromNodeId, fromPortId: fromPortId,
            toNodeId: toNodeId,     toPortId: toPortId,
            signalType: fromType
        )
        project.edges.append(edge)
        isDirty = true
    }

    func removeEdge(edgeId: String) {
        project.edges.removeAll { $0.id == edgeId }
        isDirty = true
    }

    // MARK: - Geometry operations

    func addGeometryObject(_ obj: GeometryObject) {
        project.geometry.append(obj)
        isDirty = true
    }

    func updateGeometryObject(id: String, params: [String: JSONValue]) {
        guard let idx = project.geometry.firstIndex(where: { $0.id == id }) else { return }
        for (k, v) in params {
            project.geometry[idx].params[k] = v
        }
        isDirty = true
    }

    // MARK: - Persistence

    func save(to url: URL) throws {
        project.meta.updatedAt = Date()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(project)
        try data.write(to: url)
        isDirty = false
    }

    func load(from url: URL) throws {
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        project = try decoder.decode(ModularProject.self, from: data)
        isDirty = false
    }

    // MARK: - Computed: control value for a node output port

    /// Returns the current control value from a node's output port (used by patchEngine).
    func controlValue(nodeId: String, portId: String) -> Double? {
        guard let node = project.nodes.first(where: { $0.id == nodeId }) else { return nil }
        switch node.type {
        case "geometry.circle":
            let r  = node.params["r"]?.doubleValue ?? 100
            let cx = node.params["cx"]?.doubleValue ?? 0
            let cy = node.params["cy"]?.doubleValue ?? 0
            switch portId {
            case "radius":        return r
            case "area":          return .pi * r * r
            case "circumference": return 2 * .pi * r
            case "x":             return cx
            case "y":             return cy
            default: return nil
            }
        case "geometry.point":
            switch portId {
            case "x": return node.params["x"]?.doubleValue
            case "y": return node.params["y"]?.doubleValue
            default:  return nil
            }
        case "control.number":
            return node.params["value"]?.doubleValue
        default:
            return node.params[portId]?.doubleValue
        }
    }

    // MARK: - Private helpers

    private func syncGeometry(fromNode nodeId: String, params: [String: JSONValue]) {
        guard let idx = project.geometry.firstIndex(where: { $0.sourceNodeId == nodeId }) else { return }
        for (k, v) in params {
            project.geometry[idx].params[k] = v
        }
    }

    private func geomTypeFor(_ type: String) -> GeometryType {
        switch type {
        case "geometry.circle": return .circle
        case "geometry.point":  return .point
        case "geometry.path":   return .path
        default:                return .circle
        }
    }
}
