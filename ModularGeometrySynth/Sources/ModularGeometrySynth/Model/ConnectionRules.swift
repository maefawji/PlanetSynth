import Foundation

// Pure function: can these two ports be connected?
func canConnect(fromSignal: SignalType, toSignal: SignalType) -> Bool {
    switch (fromSignal, toSignal) {
    case (.audio,    .audio):   return true
    case (.control,  .control): return true
    case (.trigger,  .trigger): return true
    case (.geometry, .geometry): return true
    case (.geometry, .control): return true  // geometry → control is allowed (e.g. radius → frequency)
    default: return false
    }
}

func canConnect(from: PortDefinition, to: PortDefinition) -> Bool {
    guard from.direction == .output, to.direction == .input else { return false }
    return canConnect(fromSignal: from.signalType, toSignal: to.signalType)
}

// Find the output port def and input port def for a potential edge
func resolveConnection(
    fromNodeId: String, fromPortId: String,
    toNodeId: String,   toPortId: String,
    project: ModularProject
) -> Bool {
    guard
        let fromNode = project.nodes.first(where: { $0.id == fromNodeId }),
        let toNode   = project.nodes.first(where: { $0.id == toNodeId }),
        let fromDef  = nodeRegistry[fromNode.type],
        let toDef    = nodeRegistry[toNode.type],
        let fromPort = fromDef.outputs.first(where: { $0.id == fromPortId }),
        let toPort   = toDef.inputs.first(where:  { $0.id == toPortId })
    else { return false }
    return canConnect(from: fromPort, to: toPort)
}
