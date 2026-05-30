import AVFoundation
import Foundation
import Observation

// MARK: - Thread-safe oscillator state (read by audio render thread)

final class OscillatorState: @unchecked Sendable {
    // Use raw pointers so render block can read without Swift overhead
    private let _freq:  UnsafeMutablePointer<Double>
    private let _amp:   UnsafeMutablePointer<Float>
    private let _wave:  UnsafeMutablePointer<Int32>  // 0 sine 1 square 2 saw 3 tri
    private let _phase: UnsafeMutablePointer<Double>

    init(frequency: Double = 440, amplitude: Float = 0.3, waveform: Int32 = 0) {
        _freq  = .allocate(capacity: 1); _freq.initialize(to: frequency)
        _amp   = .allocate(capacity: 1); _amp.initialize(to: amplitude)
        _wave  = .allocate(capacity: 1); _wave.initialize(to: waveform)
        _phase = .allocate(capacity: 1); _phase.initialize(to: 0)
    }

    deinit {
        _freq.deallocate(); _amp.deallocate()
        _wave.deallocate(); _phase.deallocate()
    }

    var frequency: Double { get { _freq.pointee }  set { _freq.pointee = newValue } }
    var amplitude: Float  { get { _amp.pointee }   set { _amp.pointee = newValue  } }
    var waveform:  Int32  { get { _wave.pointee }  set { _wave.pointee = newValue  } }

    // Called from audio render thread
    func nextSample(sampleRate: Double) -> Float {
        let f = _freq.pointee
        let a = _amp.pointee
        let w = _wave.pointee
        let p = _phase.pointee
        let inc = 2.0 * .pi * f / sampleRate

        let value: Float
        switch w {
        case 0: value = Float(sin(p)) * a
        case 1: value = (p < .pi ? 1.0 : -1.0) * a
        case 2: value = Float((p / .pi) - 1.0) * a
        default: value = Float(p < .pi ? (2 * p / .pi - 1) : (3 - 2 * p / .pi)) * a
        }

        var next = p + inc
        if next >= 2 * .pi { next -= 2 * .pi }
        _phase.pointee = next
        return value
    }
}

// MARK: - Audio Engine

@Observable
@MainActor
final class AudioEngine {
    private let engine = AVAudioEngine()
    private var oscillators:  [String: (state: OscillatorState, node: AVAudioSourceNode)] = [:]
    private var mixerNodes:   [String: AVAudioMixerNode] = [:]
    private(set) var isRunning = false

    // Build or rebuild the audio graph from a project snapshot
    func rebuild(project: ModularProject) {
        teardown()

        let format = engine.mainMixerNode.inputFormat(forBus: 0)
        let sampleRate = format.sampleRate == 0 ? 44100.0 : format.sampleRate

        // 1. Create audio nodes
        for node in project.nodes {
            switch node.type {
            case "audio.oscillator":
                let freq = node.params["frequency"]?.doubleValue ?? 440
                let gain = node.params["gain"]?.doubleValue ?? 0.5
                let wave = waveformIndex(node.params["waveform"]?.stringValue ?? "sine")
                let state = OscillatorState(frequency: freq, amplitude: Float(gain), waveform: wave)
                let srcNode = AVAudioSourceNode(format: format) { [state] _, _, frameCount, abl in
                    let ptr = UnsafeMutableAudioBufferListPointer(abl)
                    for frame in 0..<Int(frameCount) {
                        let s = state.nextSample(sampleRate: sampleRate)
                        for buf in ptr {
                            buf.mData?.assumingMemoryBound(to: Float.self)[frame] = s
                        }
                    }
                    return noErr
                }
                engine.attach(srcNode)
                oscillators[node.id] = (state, srcNode)

            case "audio.gain":
                let mixer = AVAudioMixerNode()
                engine.attach(mixer)
                mixerNodes[node.id] = mixer

            case "audio.output":
                break // uses engine.mainMixerNode

            default:
                break
            }
        }

        // 2. Connect edges
        var connectedToMain = false
        for edge in project.edges where edge.signalType == .audio {
            let srcAVNode = avNode(for: edge.fromNodeId, portId: edge.fromPortId, project: project)
            let dstAVNode = avNode(for: edge.toNodeId,   portId: edge.toPortId,   project: project)
            guard let src = srcAVNode, let dst = dstAVNode else { continue }
            engine.connect(src, to: dst, format: format)
            if dst === engine.mainMixerNode { connectedToMain = true }
        }

        // If output node connects to main mixer, ensure it's wired
        for node in project.nodes where node.type == "audio.output" {
            let inEdge = project.edges.first { $0.toNodeId == node.id && $0.signalType == .audio }
            if let edge = inEdge, let mixerSrc = mixerNodes[edge.fromNodeId], !connectedToMain {
                engine.connect(mixerSrc, to: engine.mainMixerNode, format: format)
            }
        }

        // 3. Apply control values (geometry → audio mappings)
        applyControlValues(project: project)
    }

    func applyControlValues(project: ModularProject) {
        // Traverse control edges: compute source value → map → apply to target
        for edge in project.edges where edge.signalType == .control {
            guard let rawValue = evaluateControlOutput(
                    nodeId: edge.fromNodeId, portId: edge.fromPortId, project: project)
            else { continue }
            applyControlInput(
                nodeId: edge.toNodeId, portId: edge.toPortId,
                rawValue: rawValue, project: project)
        }
        // Also apply geometry→control edges
        for edge in project.edges where edge.signalType == .geometry {
            // geometry edges: handle in geometry engine; skip for audio
        }
    }

    func start() throws {
        guard !isRunning else { return }
        try engine.start()
        isRunning = true
    }

    func stop() {
        engine.stop()
        isRunning = false
    }

    // Update a single parameter on a live oscillator
    func updateOscillatorFrequency(nodeId: String, frequency: Double) {
        oscillators[nodeId]?.state.frequency = frequency
    }

    func updateOscillatorGain(nodeId: String, gain: Double) {
        oscillators[nodeId]?.state.amplitude = Float(gain)
    }

    // MARK: - Private

    private func teardown() {
        engine.stop()
        for (_, pair) in oscillators { engine.detach(pair.node) }
        for (_, mixer) in mixerNodes { engine.detach(mixer) }
        oscillators = [:]
        mixerNodes = [:]
        isRunning = false
    }

    private func avNode(for nodeId: String, portId: String, project: ModularProject) -> AVAudioNode? {
        if let osc = oscillators[nodeId] { return osc.node }
        if let mix = mixerNodes[nodeId]  { return mix }
        // audio.output → main mixer
        if project.nodes.first(where: { $0.id == nodeId })?.type == "audio.output" {
            return engine.mainMixerNode
        }
        return nil
    }

    private func evaluateControlOutput(nodeId: String, portId: String, project: ModularProject) -> Double? {
        guard let node = project.nodes.first(where: { $0.id == nodeId }) else { return nil }
        switch node.type {
        case "geometry.circle":
            let r = node.params["r"]?.doubleValue ?? 100
            switch portId {
            case "radius":        return r
            case "area":          return .pi * r * r
            case "circumference": return 2 * .pi * r
            default: return nil
            }
        case "geometry.point":
            return node.params[portId]?.doubleValue
        case "control.number":
            return node.params["value"]?.doubleValue
        default:
            return node.params[portId]?.doubleValue
        }
    }

    private func applyControlInput(nodeId: String, portId: String, rawValue: Double, project: ModularProject) {
        guard let targetNode = project.nodes.first(where: { $0.id == nodeId }) else { return }
        switch targetNode.type {
        case "audio.oscillator":
            switch portId {
            case "frequency":
                let freq = mapRange(rawValue, inMin: 0, inMax: 400, outMin: 80, outMax: 1200)
                oscillators[nodeId]?.state.frequency = freq
            case "gain":
                oscillators[nodeId]?.state.amplitude = Float(rawValue.clamped(0, 1))
            default: break
            }
        case "audio.gain":
            if portId == "gain" {
                mixerNodes[nodeId]?.outputVolume = Float(rawValue.clamped(0, 1))
            }
        default: break
        }
    }

    private func waveformIndex(_ name: String) -> Int32 {
        switch name {
        case "sine":     return 0
        case "square":   return 1
        case "sawtooth": return 2
        case "triangle": return 3
        default:         return 0
        }
    }
}

// MARK: - Pure mapping helpers

func mapRange(_ value: Double, inMin: Double, inMax: Double, outMin: Double, outMax: Double) -> Double {
    guard inMax != inMin else { return outMin }
    let t = (value - inMin) / (inMax - inMin)
    return (outMin + t * (outMax - outMin)).clamped(outMin, outMax)
}

extension Double {
    func clamped(_ lo: Double, _ hi: Double) -> Double { max(lo, min(hi, self)) }
}
