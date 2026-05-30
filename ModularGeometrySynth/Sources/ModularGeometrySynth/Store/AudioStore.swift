import Foundation
import Observation

@Observable
@MainActor
final class AudioStore {
    enum EngineStatus: String {
        case stopped, ready, running, error
    }

    var isRunning: Bool = false
    var status: EngineStatus = .stopped
    var errorMessage: String?
}
