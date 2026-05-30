// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ModularGeometrySynth",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "ModularGeometrySynth",
            path: "Sources/ModularGeometrySynth"
        )
    ]
)
