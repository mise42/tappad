import AppKit
import Foundation

let host = "0.0.0.0"
let port = UInt16(8765)
let token = PairingToken.resolve()
let pairingInfo = PairingInfo(port: port, token: token)
let staticRoot = discoverStaticRoot()

let server = HttpWebSocketServer(
    host: host,
    port: port,
    staticRoot: staticRoot,
    token: token,
    input: MacInputDevice(),
    clipboard: MacClipboardGateway(),
    commands: MacCommandRegistry()
)

do {
    try server.start()
} catch {
    fputs("failed to start TapPad macOS backend: \(error)\n", stderr)
    exit(1)
}

let app = NSApplication.shared
let delegate = TapPadAppDelegate(pairingInfo: pairingInfo)
app.delegate = delegate
app.run()

private func discoverStaticRoot() -> URL {
    if let bundled = Bundle.main.resourceURL?.appendingPathComponent("mobile") {
        let index = bundled.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: index.path) {
            return bundled
        }
    }

    if let explicit = ProcessInfo.processInfo.environment["TAPPAD_MOBILE_ROOT"] {
        return URL(fileURLWithPath: explicit)
    }

    let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    let candidates = [
        cwd.appendingPathComponent("mobile"),
        cwd.appendingPathComponent("../mobile"),
        cwd.appendingPathComponent("../../mobile"),
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("../../../mobile"),
    ]

    for candidate in candidates {
        let index = candidate.standardizedFileURL.appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: index.path) {
            return candidate.standardizedFileURL
        }
    }

    return cwd.appendingPathComponent("mobile")
}
