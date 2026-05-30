import SwiftUI
import AppKit

struct GeometryCanvasView: NSViewRepresentable {
    @Environment(ProjectStore.self)   var projectStore
    @Environment(SelectionStore.self) var selectionStore
    var currentTool: GeometryTool

    func makeNSView(context: Context) -> GeometryCanvasNSView {
        let view = GeometryCanvasNSView()
        view.onGeometryAdded = { obj in
            Task { @MainActor in projectStore.addGeometryObject(obj) }
        }
        view.onGeometrySelected = { id in
            Task { @MainActor in selectionStore.selectGeometry(id) }
        }
        return view
    }

    func updateNSView(_ nsView: GeometryCanvasNSView, context: Context) {
        nsView.geometryObjects = projectStore.project.geometry
        nsView.selectedGeometryId = selectionStore.selectedGeometryId
        nsView.currentTool = currentTool
    }
}
