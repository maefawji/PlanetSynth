import SwiftUI
import AppKit

struct PatchEditorView: NSViewRepresentable {
    @Environment(ProjectStore.self)   var projectStore
    @Environment(SelectionStore.self) var selectionStore
    @Environment(AudioEngine.self)    var audioEngine

    func makeNSView(context: Context) -> PatchCanvasNSView {
        let view = PatchCanvasNSView()
        view.onNodeMoved = { id, pos in
            Task { @MainActor in projectStore.moveNode(nodeId: id, position: pos) }
        }
        view.onNodeSelected = { id in
            Task { @MainActor in selectionStore.selectNode(id) }
        }
        view.onEdgeAdded = { fromNodeId, fromPortId, toNodeId, toPortId in
            Task { @MainActor in
                projectStore.addEdge(fromNodeId: fromNodeId, fromPortId: fromPortId,
                                     toNodeId: toNodeId, toPortId: toPortId)
                if audioEngine.isRunning {
                    audioEngine.rebuild(project: projectStore.project)
                }
            }
        }
        view.onNodeDeleted = { id in
            Task { @MainActor in
                projectStore.removeNode(nodeId: id)
                selectionStore.clearAll()
                if audioEngine.isRunning {
                    audioEngine.rebuild(project: projectStore.project)
                }
            }
        }
        return view
    }

    func updateNSView(_ nsView: PatchCanvasNSView, context: Context) {
        nsView.nodes = projectStore.project.nodes
        nsView.edges = projectStore.project.edges
        nsView.selectedNodeId = selectionStore.selectedNodeId
    }
}
