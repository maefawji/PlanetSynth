import SwiftUI

struct AppShell: View {
    @State private var projectStore   = ProjectStore()
    @State private var selectionStore = SelectionStore()
    @State private var audioStore     = AudioStore()
    @State private var audioEngine    = AudioEngine()
    @State private var currentTool: GeometryTool = .select
    @State private var bottomPanelHeight: CGFloat = 280

    var body: some View {
        VStack(spacing: 0) {
            // Top Bar
            TopBar()

            // Main area
            HStack(spacing: 0) {
                // Left library panel
                LeftLibraryPanel()

                // Center + Bottom
                VStack(spacing: 0) {
                    // Geometry canvas
                    GeometryArea(currentTool: $currentTool)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                    // Draggable divider
                    PanelDivider(height: $bottomPanelHeight)

                    // Patch panel
                    BottomPatchPanel()
                        .frame(height: bottomPanelHeight)
                }

                // Right inspector
                RightInspector()
            }
        }
        .environment(projectStore)
        .environment(selectionStore)
        .environment(audioStore)
        .environment(audioEngine)
        .background(Color(NSColor.windowBackgroundColor))
    }
}

struct GeometryArea: View {
    @Binding var currentTool: GeometryTool
    @Environment(ProjectStore.self)   var projectStore
    @Environment(SelectionStore.self) var selectionStore

    var body: some View {
        ZStack(alignment: .topLeading) {
            GeometryCanvasView(currentTool: currentTool)

            // Geometry toolbar overlay
            GeometryToolbar(currentTool: $currentTool)
                .padding(8)
        }
    }
}

struct GeometryToolbar: View {
    @Binding var currentTool: GeometryTool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(GeometryTool.allCases, id: \.self) { tool in
                Button {
                    currentTool = tool
                } label: {
                    Text(tool.label)
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            RoundedRectangle(cornerRadius: 5)
                                .fill(currentTool == tool
                                    ? Color.accentColor.opacity(0.15)
                                    : Color.white.opacity(0.85))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .stroke(Color.black.opacity(0.12), lineWidth: 0.5)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(6)
        .background(Color.white.opacity(0.75).shadow(.drop(color: .black.opacity(0.06), radius: 4, y: 1)))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct PanelDivider: View {
    @Binding var height: CGFloat
    @State private var isDragging = false

    var body: some View {
        Rectangle()
            .fill(Color.black.opacity(isDragging ? 0.15 : 0.08))
            .frame(height: 4)
            .cursor(.resizeUpDown)
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { value in
                        isDragging = true
                        height = max(160, min(600, height - value.translation.height))
                    }
                    .onEnded { _ in isDragging = false }
            )
            .overlay(
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { _ in
                        Rectangle().frame(width: 16, height: 1)
                            .foregroundStyle(.secondary.opacity(0.4))
                    }
                }
            )
    }
}

extension View {
    func cursor(_ cursor: NSCursor) -> some View {
        self.onHover { inside in
            if inside { cursor.push() } else { NSCursor.pop() }
        }
    }
}
