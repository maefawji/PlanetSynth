import Foundation

// Central registry of all node definitions.
// No Tone.js / React Flow / Paper.js types – pure data.

let nodeRegistry: [String: PatchNodeDefinition] = {
    var r: [String: PatchNodeDefinition] = [:]

    // MARK: audio.oscillator
    r["audio.oscillator"] = PatchNodeDefinition(
        type: "audio.oscillator", label: "Osc", category: .audio,
        inputs: [
            PortDefinition(id: "frequency", label: "freq", direction: .input, signalType: .control),
            PortDefinition(id: "detune",    label: "det",  direction: .input, signalType: .control),
        ],
        outputs: [
            PortDefinition(id: "audio", label: "out", direction: .output, signalType: .audio),
        ],
        defaultParams: ["waveform": .string("sine"), "frequency": .number(440), "gain": .number(0.5)]
    )

    // MARK: audio.gain
    r["audio.gain"] = PatchNodeDefinition(
        type: "audio.gain", label: "Gain", category: .audio,
        inputs: [
            PortDefinition(id: "audio", label: "in",   direction: .input, signalType: .audio),
            PortDefinition(id: "gain",  label: "gain", direction: .input, signalType: .control),
        ],
        outputs: [
            PortDefinition(id: "audio", label: "out", direction: .output, signalType: .audio),
        ],
        defaultParams: ["gain": .number(0.7)]
    )

    // MARK: audio.output
    r["audio.output"] = PatchNodeDefinition(
        type: "audio.output", label: "Out", category: .output,
        inputs: [
            PortDefinition(id: "audio", label: "in", direction: .input, signalType: .audio),
        ],
        outputs: [],
        defaultParams: ["volume": .number(0.8)]
    )

    // MARK: audio.sampler
    r["audio.sampler"] = PatchNodeDefinition(
        type: "audio.sampler", label: "Sampler", category: .audio,
        inputs: [
            PortDefinition(id: "trigger", label: "trig",  direction: .input, signalType: .trigger),
            PortDefinition(id: "pitch",   label: "pitch", direction: .input, signalType: .control),
            PortDefinition(id: "gain",    label: "gain",  direction: .input, signalType: .control),
        ],
        outputs: [
            PortDefinition(id: "audio", label: "out", direction: .output, signalType: .audio),
        ],
        defaultParams: ["sampleId": .null, "playbackRate": .number(1.0), "gain": .number(0.8)]
    )

    // MARK: control.lfo
    r["control.lfo"] = PatchNodeDefinition(
        type: "control.lfo", label: "LFO", category: .control,
        inputs: [
            PortDefinition(id: "rate", label: "rate", direction: .input, signalType: .control),
        ],
        outputs: [
            PortDefinition(id: "value", label: "val", direction: .output, signalType: .control),
        ],
        defaultParams: ["waveform": .string("sine"), "rate": .number(1.0), "min": .number(0.0), "max": .number(1.0)]
    )

    // MARK: control.number
    r["control.number"] = PatchNodeDefinition(
        type: "control.number", label: "Number", category: .control,
        inputs: [],
        outputs: [
            PortDefinition(id: "value", label: "val", direction: .output, signalType: .control),
        ],
        defaultParams: ["value": .number(0.5)]
    )

    // MARK: control.trigger
    r["control.trigger"] = PatchNodeDefinition(
        type: "control.trigger", label: "Trigger", category: .control,
        inputs: [],
        outputs: [
            PortDefinition(id: "trigger", label: "trig", direction: .output, signalType: .trigger),
        ],
        defaultParams: ["mode": .string("momentary")]
    )

    // MARK: geometry.circle
    r["geometry.circle"] = PatchNodeDefinition(
        type: "geometry.circle", label: "Circle", category: .geometry,
        inputs: [
            PortDefinition(id: "radius", label: "r", direction: .input, signalType: .control),
        ],
        outputs: [
            PortDefinition(id: "geometry",     label: "geom",  direction: .output, signalType: .geometry),
            PortDefinition(id: "radius",        label: "r",     direction: .output, signalType: .control),
            PortDefinition(id: "area",          label: "area",  direction: .output, signalType: .control),
            PortDefinition(id: "circumference", label: "circ",  direction: .output, signalType: .control),
        ],
        defaultParams: ["cx": .number(300), "cy": .number(200), "r": .number(100)]
    )

    // MARK: geometry.point
    r["geometry.point"] = PatchNodeDefinition(
        type: "geometry.point", label: "Point", category: .geometry,
        inputs: [
            PortDefinition(id: "x", label: "x", direction: .input, signalType: .control),
            PortDefinition(id: "y", label: "y", direction: .input, signalType: .control),
        ],
        outputs: [
            PortDefinition(id: "geometry", label: "geom", direction: .output, signalType: .geometry),
            PortDefinition(id: "x",        label: "x",    direction: .output, signalType: .control),
            PortDefinition(id: "y",        label: "y",    direction: .output, signalType: .control),
        ],
        defaultParams: ["x": .number(300), "y": .number(200)]
    )

    // MARK: geometry.path
    r["geometry.path"] = PatchNodeDefinition(
        type: "geometry.path", label: "Path", category: .geometry,
        inputs: [],
        outputs: [
            PortDefinition(id: "geometry", label: "geom", direction: .output, signalType: .geometry),
            PortDefinition(id: "length",   label: "len",  direction: .output, signalType: .control),
        ],
        defaultParams: ["svgPath": .string("M 100 100 C 160 40, 240 160, 300 100")]
    )

    return r
}()

// Ordered list for UI display
let nodeLibraryOrder: [(category: String, types: [String])] = [
    ("Audio",    ["audio.oscillator", "audio.gain", "audio.output", "audio.sampler"]),
    ("Control",  ["control.number", "control.lfo", "control.trigger"]),
    ("Geometry", ["geometry.circle", "geometry.point", "geometry.path"]),
]
