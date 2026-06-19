// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "TapPad",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "TapPad", targets: ["TapPad"])
    ],
    targets: [
        .executableTarget(
            name: "TapPad",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreImage"),
                .linkedFramework("CryptoKit"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("Security")
            ]
        )
    ]
)
