import AppKit
import CoreGraphics
import Foundation

protocol InputDevice {
    func move(dx: Double, dy: Double)
    func click(button: String, clickCount: Int)
    func scroll(dy: Double)
    func key(code: String, down: Bool)
    func typeText(_ text: String)
}

final class MacInputDevice: InputDevice, @unchecked Sendable {
    private let lock = NSLock()
    private let scrollPoster = ScrollPoster()
    private var cursor: CGPoint
    private let desktopBounds: CGRect

    init() {
        desktopBounds = Self.activeDesktopBounds()
        cursor = CGEvent(source: nil)?.location
            ?? CGPoint(x: desktopBounds.midX, y: desktopBounds.midY)
    }

    func move(dx: Double, dy: Double) {
        lock.withLock {
            cursor.x = min(max(cursor.x + dx, desktopBounds.minX), desktopBounds.maxX - 1)
            cursor.y = min(max(cursor.y + dy, desktopBounds.minY), desktopBounds.maxY - 1)
            postMouse(.mouseMoved, at: cursor, button: .left)
        }
    }

    func click(button: String, clickCount: Int) {
        lock.withLock {
            let kind = mouseKind(button)
            postMouse(kind.down, at: cursor, button: kind.button, clickCount: clickCount)
            postMouse(kind.up, at: cursor, button: kind.button, clickCount: clickCount)
        }
    }

    func scroll(dy: Double) {
        scrollPoster.push(deltaY: dy)
    }

    func key(code: String, down: Bool) {
        guard let keyCode = keyCode(for: code),
              let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: down)
        else {
            return
        }
        event.post(tap: .cghidEventTap)
    }

    func typeText(_ text: String) {
        for scalar in text.unicodeScalars {
            var utf16 = Array(String(scalar).utf16)
            postUnicodeKey(&utf16)
        }
    }

    private func postMouse(
        _ type: CGEventType,
        at point: CGPoint,
        button: CGMouseButton,
        clickCount: Int = 1
    ) {
        guard let event = CGEvent(
            mouseEventSource: nil,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button
        ) else {
            return
        }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
        event.post(tap: .cghidEventTap)
    }

    private static func activeDesktopBounds() -> CGRect {
        var displayCount: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &displayCount) == .success, displayCount > 0 else {
            return CGDisplayBounds(CGMainDisplayID())
        }

        var displays = [CGDirectDisplayID](repeating: 0, count: Int(displayCount))
        guard CGGetActiveDisplayList(displayCount, &displays, &displayCount) == .success else {
            return CGDisplayBounds(CGMainDisplayID())
        }

        return displays
            .prefix(Int(displayCount))
            .map(CGDisplayBounds)
            .reduce(CGRect.null) { $0.union($1) }
    }

    private func postUnicodeKey(_ utf16: inout [UniChar]) {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) else {
            return
        }
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        down.post(tap: .cghidEventTap)

        guard let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            return
        }
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up.post(tap: .cghidEventTap)
    }

    private func mouseKind(_ name: String) -> (
        down: CGEventType,
        up: CGEventType,
        button: CGMouseButton
    ) {
        switch name {
        case "right":
            return (.rightMouseDown, .rightMouseUp, .right)
        case "middle":
            return (.otherMouseDown, .otherMouseUp, .center)
        default:
            return (.leftMouseDown, .leftMouseUp, .left)
        }
    }

    private func keyCode(for name: String) -> CGKeyCode? {
        switch name {
        case "KeyA": 0
        case "KeyS": 1
        case "KeyD": 2
        case "KeyF": 3
        case "KeyH": 4
        case "KeyG": 5
        case "KeyZ": 6
        case "KeyX": 7
        case "KeyC": 8
        case "KeyV": 9
        case "KeyB": 11
        case "KeyQ": 12
        case "KeyW": 13
        case "KeyE": 14
        case "KeyR": 15
        case "KeyY": 16
        case "KeyT": 17
        case "Digit1": 18
        case "Digit2": 19
        case "Digit3": 20
        case "Digit4": 21
        case "Digit6": 22
        case "Digit5": 23
        case "Equal": 24
        case "Digit9": 25
        case "Digit7": 26
        case "Minus": 27
        case "Digit8": 28
        case "Digit0": 29
        case "BracketRight": 30
        case "KeyO": 31
        case "KeyU": 32
        case "BracketLeft": 33
        case "KeyI": 34
        case "KeyP": 35
        case "Enter": 36
        case "KeyL": 37
        case "KeyJ": 38
        case "Quote": 39
        case "KeyK": 40
        case "Semicolon": 41
        case "Backslash": 42
        case "Comma": 43
        case "Slash": 44
        case "KeyN": 45
        case "KeyM": 46
        case "Period": 47
        case "Tab": 48
        case "Space": 49
        case "Backquote": 50
        case "Backspace": 51
        case "Escape": 53
        case "MetaLeft", "MetaRight": 55
        case "ShiftLeft": 56
        case "CapsLock": 57
        case "AltLeft", "AltRight": 58
        case "ControlLeft", "ControlRight": 59
        case "ShiftRight": 60
        case "F1": 122
        case "F2": 120
        case "F3": 99
        case "F4": 118
        case "F5": 96
        case "F6": 97
        case "F7": 98
        case "F8": 100
        case "F9": 101
        case "F10": 109
        case "F11": 103
        case "F12": 111
        case "Home": 115
        case "PageUp": 116
        case "Delete": 117
        case "End": 119
        case "PageDown": 121
        case "ArrowLeft": 123
        case "ArrowRight": 124
        case "ArrowDown": 125
        case "ArrowUp": 126
        default: nil
        }
    }
}
