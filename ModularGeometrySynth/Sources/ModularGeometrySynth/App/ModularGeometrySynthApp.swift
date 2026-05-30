import SwiftUI

@main
struct ModularGeometrySynthApp: App {
    var body: some Scene {
        WindowGroup {
            AppShell()
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands {
            CommandGroup(replacing: .newItem) { }
        }
    }
}
