import Foundation
import Observation

@Observable
@MainActor
final class SelectionStore {
    var selectedNodeId: String?
    var selectedGeometryId: String?
    var hoveredNodeId: String?

    func selectNode(_ id: String?) {
        selectedNodeId = id
        if id != nil { selectedGeometryId = nil }
    }

    func selectGeometry(_ id: String?) {
        selectedGeometryId = id
        if id != nil { selectedNodeId = nil }
    }

    func clearAll() {
        selectedNodeId = nil
        selectedGeometryId = nil
    }
}
