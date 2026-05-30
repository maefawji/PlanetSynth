import SwiftUI

struct RightInspector: View {
    @Environment(ProjectStore.self)   var projectStore
    @Environment(SelectionStore.self) var selectionStore
    @Environment(AudioEngine.self)    var audioEngine
    @Environment(AudioStore.self)     var audioStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            panelHeader("Inspector")

            if let nodeId = selectionStore.selectedNodeId,
               let node = projectStore.project.nodes.first(where: { $0.id == nodeId }),
               let def  = nodeRegistry[node.type] {
                NodeInspector(node: node, def: def)
            } else if let geomId = selectionStore.selectedGeometryId,
                      let geom = projectStore.project.geometry.first(where: { $0.id == geomId }) {
                GeometryInspector(geom: geom)
            } else {
                Text("Select a node or shape")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
        .frame(width: 240)
        .background(Color(NSColor.controlBackgroundColor))
        .overlay(alignment: .leading) { Divider() }
    }
}

struct NodeInspector: View {
    @Environment(ProjectStore.self) var projectStore
    @Environment(AudioEngine.self)  var audioEngine
    @Environment(AudioStore.self)   var audioStore
    let node: PatchNodeInstance
    let def: PatchNodeDefinition

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                // Node type badge
                HStack {
                    Text(def.label)
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Text(node.type)
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

                Divider()

                // Params
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(sortedParams, id: \.key) { key, value in
                        ParamRow(nodeId: node.id, key: key, value: value)
                    }
                }
                .padding(.vertical, 8)

                Divider()

                // Ports info
                if !def.inputs.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("INPUTS")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 12)
                            .padding(.top, 8)
                        ForEach(def.inputs, id: \.id) { port in
                            portRow(port)
                        }
                    }
                }
                if !def.outputs.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("OUTPUTS")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 12)
                            .padding(.top, 8)
                        ForEach(def.outputs, id: \.id) { port in
                            portRow(port)
                        }
                    }
                }
            }
        }
    }

    private var sortedParams: [(key: String, value: JSONValue)] {
        node.params.sorted { $0.key < $1.key }.map { (key: $0.key, value: $0.value) }
    }

    private func portRow(_ port: PortDefinition) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(signalColor(port.signalType))
                .frame(width: 5, height: 5)
            Text(port.id)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
            Spacer()
            Text(port.signalType.rawValue)
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
    }

    private func signalColor(_ s: SignalType) -> Color {
        switch s {
        case .audio:    return Color(white: 0.2)
        case .control:  return Color(hue: 0.6, saturation: 0.8, brightness: 0.8)
        case .trigger:  return Color(hue: 0.05, saturation: 0.8, brightness: 0.7)
        case .geometry: return Color(hue: 0.37, saturation: 0.7, brightness: 0.6)
        }
    }
}

struct ParamRow: View {
    @Environment(ProjectStore.self) var projectStore
    @Environment(AudioEngine.self)  var audioEngine
    @Environment(AudioStore.self)   var audioStore
    let nodeId: String
    let key: String
    let value: JSONValue

    var body: some View {
        HStack(spacing: 8) {
            Text(key)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .trailing)
            paramControl
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 3)
    }

    @ViewBuilder
    private var paramControl: some View {
        switch value {
        case .number(let n):
            TextField("", value: Binding<Double>(
                get: { n },
                set: { newVal in
                    projectStore.updateNodeParams(nodeId: nodeId, params: [key: .number(newVal)])
                    if audioStore.isRunning {
                        let proj = projectStore.project
                        audioEngine.applyControlValues(project: proj)
                        if key == "frequency" {
                            audioEngine.updateOscillatorFrequency(nodeId: nodeId, frequency: newVal)
                        }
                    }
                }
            ), format: .number)
            .font(.system(size: 11, design: .monospaced))
            .textFieldStyle(.plain)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.black.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: 4))

        case .string(let s):
            if key == "waveform" {
                Picker("", selection: Binding(
                    get: { s },
                    set: { projectStore.updateNodeParams(nodeId: nodeId, params: [key: .string($0)]) }
                )) {
                    ForEach(["sine", "square", "sawtooth", "triangle"], id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .font(.system(size: 11))
                .frame(maxWidth: .infinity)
            } else {
                TextField("", text: Binding(
                    get: { s },
                    set: { projectStore.updateNodeParams(nodeId: nodeId, params: [key: .string($0)]) }
                ))
                .font(.system(size: 11))
                .textFieldStyle(.plain)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }

        case .null:
            Text("—")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
        default:
            Text(key)
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
        }
    }
}

struct GeometryInspector: View {
    @Environment(ProjectStore.self) var projectStore
    let geom: GeometryObject

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(geom.type.rawValue.capitalized)
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
                Text(geom.id)
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            Divider()

            VStack(alignment: .leading, spacing: 2) {
                ForEach(geom.params.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                    GeomParamRow(geomId: geom.id, key: key, value: value)
                }
            }
            .padding(.vertical, 8)
        }
    }
}

struct GeomParamRow: View {
    @Environment(ProjectStore.self) var projectStore
    let geomId: String
    let key: String
    let value: JSONValue

    var body: some View {
        if case .number(let n) = value {
            HStack(spacing: 8) {
                Text(key)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .frame(width: 72, alignment: .trailing)
                TextField("", value: Binding(
                    get: { n },
                    set: { projectStore.updateGeometryObject(id: geomId, params: [key: .number($0)]) }
                ), format: .number)
                .font(.system(size: 11, design: .monospaced))
                .textFieldStyle(.plain)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 3)
        }
    }
}

private func panelHeader(_ title: String) -> some View {
    Text(title.uppercased())
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(.secondary)
        .kerning(0.8)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(NSColor.windowBackgroundColor).opacity(0.5))
        .overlay(alignment: .bottom) { Divider() }
}
