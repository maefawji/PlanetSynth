import SwiftUI

struct BottomPatchPanel: View {
    @Environment(ProjectStore.self)   var projectStore
    @Environment(SelectionStore.self) var selectionStore
    @Environment(AudioEngine.self)    var audioEngine
    @Environment(AudioStore.self)     var audioStore

    var body: some View {
        VStack(spacing: 0) {
            // Header bar
            HStack {
                Text("PATCH")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .kerning(0.8)

                Spacer()

                Text("\(projectStore.project.nodes.count) nodes  ·  \(projectStore.project.edges.count) edges")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)

                Button {
                    // Delete selected node
                    if let id = selectionStore.selectedNodeId {
                        projectStore.removeNode(nodeId: id)
                        selectionStore.clearAll()
                        if audioEngine.isRunning {
                            audioEngine.rebuild(project: projectStore.project)
                        }
                    }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .disabled(selectionStore.selectedNodeId == nil)
            }
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Color(NSColor.windowBackgroundColor).opacity(0.8))
            .overlay(alignment: .top) { Divider() }

            // Patch canvas
            PatchEditorView()
        }
    }
}
