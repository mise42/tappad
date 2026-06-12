import Foundation

final class ProtocolRouter: @unchecked Sendable {
    private let input: InputDevice
    private let clipboard: ClipboardGateway
    private let commands: CommandRegistry
    private let activeClient = ActiveClientTracker(timeout: 2)

    init(
        input: InputDevice,
        clipboard: ClipboardGateway,
        commands: CommandRegistry
    ) {
        self.input = input
        self.clipboard = clipboard
        self.commands = commands
    }

    func route(_ message: ClientMessage, from clientID: String) {
        guard accepts(message, from: clientID) else {
            return
        }

        switch message {
        case let .move(dx, dy):
            input.move(dx: dx, dy: dy)
        case let .wheel(dy):
            input.scroll(dy: dy.rounded())
        case let .click(button, clickCount):
            input.click(button: button, clickCount: clickCount)
        case let .key(code, down):
            input.key(code: code, down: down)
        case let .text(value):
            input.typeText(value)
        case let .paste(value):
            clipboard.paste(value)
        case let .cmd(action):
            commands.run(action: action)
        case let .exec(command):
            print("raw exec is intentionally unsupported on macOS backend: \(command)")
        }
    }

    private func accepts(_ message: ClientMessage, from clientID: String) -> Bool {
        switch message {
        case .move, .wheel:
            return activeClient.accepts(clientID)
        default:
            return true
        }
    }
}

private final class ActiveClientTracker: @unchecked Sendable {
    private let lock = NSLock()
    private let timeout: TimeInterval
    private var current: (id: String, time: TimeInterval)?

    init(timeout: TimeInterval) {
        self.timeout = timeout
    }

    func accepts(_ clientID: String) -> Bool {
        lock.withLock {
            let now = ProcessInfo.processInfo.systemUptime
            if let current {
                if current.id == clientID || now - current.time > timeout {
                    self.current = (clientID, now)
                    return true
                }
                return false
            }

            current = (clientID, now)
            return true
        }
    }
}
