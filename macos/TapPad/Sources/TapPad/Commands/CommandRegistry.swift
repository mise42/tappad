import Foundation

protocol CommandRegistry {
    func run(action: String)
}

final class MacCommandRegistry: CommandRegistry, @unchecked Sendable {
    private let commands: [String: [String]]

    init() {
        commands = [
            "media.play_pause": [
                "osascript",
                "-e",
                "tell application \"System Events\" to key code 49",
            ],
            "media.next": [
                "osascript",
                "-e",
                "tell application \"System Events\" to key code 124 using command down",
            ],
            "media.prev": [
                "osascript",
                "-e",
                "tell application \"System Events\" to key code 123 using command down",
            ],
            "media.volume_up": [
                "osascript",
                "-e",
                "set volume output volume ((output volume of (get volume settings)) + 5)",
            ],
            "media.volume_down": [
                "osascript",
                "-e",
                "set volume output volume ((output volume of (get volume settings)) - 5)",
            ],
            "media.mute": [
                "osascript",
                "-e",
                "set volume output muted not (output muted of (get volume settings))",
            ],
            "lock_screen": [
                "pmset",
                "displaysleepnow",
            ],
        ]
    }

    func run(action: String) {
        guard let command = commands[action] else {
            print("unknown or unsupported macOS command: \(action)")
            return
        }

        DispatchQueue.global(qos: .utility).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = command

            do {
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus != 0 {
                    print("command failed: \(action) status=\(process.terminationStatus)")
                }
            } catch {
                print("command error: \(action) \(error)")
            }
        }
    }
}
