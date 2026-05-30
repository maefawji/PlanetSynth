import SwiftUI

struct LeftLibraryPanel: View {
    @Environment(ProjectStore.self) var projectStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            panelHeader("Library")

            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(nodeLibraryOrder, id: \.category) { section in
                        categorySection(section)
                    }
                }
                .padding(.bottom, 8)
            }

            Divider()
            panelHeader("Samples")
            SampleListView()
        }
        .frame(width: 210)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(alignment: .trailing) { Divider() }
    }

    private func categorySection(_ section: (category: String, types: [String])) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(section.category.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 4)

            ForEach(section.types, id: \.self) { type in
                if let def = nodeRegistry[type] {
                    NodeLibraryRow(def: def) {
                        projectStore.addNode(type: type,
                            position: PointCodable(x: 200 + Double.random(in: 0...40),
                                                   y: 100 + Double.random(in: 0...40)))
                    }
                }
            }
        }
    }
}

struct NodeLibraryRow: View {
    let def: PatchNodeDefinition
    let onAdd: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: onAdd) {
            HStack(spacing: 8) {
                Circle()
                    .fill(categoryColor(def.category))
                    .frame(width: 6, height: 6)
                Text(def.label)
                    .font(.system(size: 11))
                    .foregroundStyle(.primary)
                Spacer()
                Text(def.type.components(separatedBy: ".").first ?? "")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(isHovered ? Color.black.opacity(0.04) : Color.clear)
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
    }

    private func categoryColor(_ cat: NodeCategory) -> Color {
        switch cat {
        case .audio:    return Color(white: 0.2)
        case .control:  return Color(hue: 0.6, saturation: 0.8, brightness: 0.8)
        case .geometry: return Color(hue: 0.37, saturation: 0.7, brightness: 0.6)
        case .output:   return Color(hue: 0.05, saturation: 0.8, brightness: 0.7)
        case .utility:  return Color(white: 0.5)
        }
    }
}

struct SampleListView: View {
    @Environment(ProjectStore.self) var projectStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if projectStore.project.samples.isEmpty {
                Text("Drop audio files here")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 12)
            } else {
                ForEach(projectStore.project.samples) { sample in
                    HStack(spacing: 6) {
                        Image(systemName: "waveform")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                        Text(sample.name)
                            .font(.system(size: 10))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                }
            }

            Button {
                let panel = NSOpenPanel()
                panel.allowedContentTypes = [.audio]
                panel.allowsMultipleSelection = true
                panel.begin { response in
                    guard response == .OK else { return }
                    for url in panel.urls {
                        let sample = SampleAsset(
                            id: UUID().uuidString,
                            name: url.lastPathComponent,
                            fileURL: url.path,
                            fileType: url.pathExtension
                        )
                        projectStore.project.samples.append(sample)
                    }
                }
            } label: {
                Label("Add Sample", systemImage: "plus")
                    .font(.system(size: 10))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .frame(maxHeight: 120)
    }
}

private func panelHeader(_ title: String) -> some View {
    Text(title.uppercased())
        .font(.system(size: 9, weight: .semibold, design: .default))
        .foregroundStyle(.secondary)
        .kerning(0.8)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(NSColor.windowBackgroundColor).opacity(0.5))
        .overlay(alignment: .bottom) { Divider() }
}
