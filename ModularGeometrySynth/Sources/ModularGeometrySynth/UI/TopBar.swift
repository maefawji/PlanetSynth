import SwiftUI
import AppKit

struct TopBar: View {
    @Environment(ProjectStore.self) var projectStore
    @Environment(AudioStore.self)   var audioStore
    @Environment(AudioEngine.self)  var audioEngine

    var body: some View {
        HStack(spacing: 12) {
            // Transport
            HStack(spacing: 6) {
                Button(action: play) {
                    Label("Play", systemImage: "play.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 28, height: 22)
                }
                .buttonStyle(BarButtonStyle(active: audioStore.isRunning))
                .disabled(audioStore.isRunning)

                Button(action: stop) {
                    Label("Stop", systemImage: "stop.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 28, height: 22)
                }
                .buttonStyle(BarButtonStyle(active: false))
                .disabled(!audioStore.isRunning)
            }

            Divider().frame(height: 16)

            // BPM
            HStack(spacing: 4) {
                Text("BPM")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("", value: Binding(
                    get: { projectStore.project.transport.bpm },
                    set: { projectStore.project.transport.bpm = $0 }
                ), format: .number)
                .frame(width: 44)
                .font(.system(size: 11, design: .monospaced))
                .textFieldStyle(.plain)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 4)
                .background(Color.black.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 4))
            }

            Divider().frame(height: 16)

            // Save / Load
            Button("Save") { saveProject() }
                .buttonStyle(BarButtonStyle(active: false))
            Button("Load") { loadProject() }
                .buttonStyle(BarButtonStyle(active: false))

            Spacer()

            // Project name
            if projectStore.isDirty {
                Text("•")
                    .font(.system(size: 16))
                    .foregroundStyle(.orange)
            }
            Text(projectStore.project.meta.name)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)

            Divider().frame(height: 16)

            // Engine status
            engineStatusView
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(Color(NSColor.windowBackgroundColor).opacity(0.95))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private var engineStatusView: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(audioStore.status.rawValue)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
    }

    private var statusColor: Color {
        switch audioStore.status {
        case .running: return .green
        case .ready:   return .yellow
        case .error:   return .red
        case .stopped: return Color(white: 0.6)
        }
    }

    private func play() {
        Task {
            do {
                audioEngine.rebuild(project: projectStore.project)
                try audioEngine.start()
                audioStore.isRunning = true
                audioStore.status = .running
            } catch {
                audioStore.status = .error
                audioStore.errorMessage = error.localizedDescription
            }
        }
    }

    private func stop() {
        audioEngine.stop()
        audioStore.isRunning = false
        audioStore.status = .stopped
    }

    private func saveProject() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = projectStore.project.meta.name + ".json"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            try? projectStore.save(to: url)
        }
    }

    private func loadProject() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            try? projectStore.load(from: url)
            if audioEngine.isRunning {
                audioEngine.rebuild(project: projectStore.project)
            }
        }
    }
}

struct BarButtonStyle: ButtonStyle {
    var active: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(active
                        ? Color.accentColor.opacity(0.15)
                        : Color.black.opacity(configuration.isPressed ? 0.08 : 0.04))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(Color.black.opacity(0.12), lineWidth: 0.5)
            )
    }
}
