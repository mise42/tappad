import AppKit
import CoreGraphics
import Foundation

protocol ClipboardGateway {
    func paste(_ text: String)
}

final class MacClipboardGateway: ClipboardGateway, @unchecked Sendable {
    func paste(_ text: String) {
        DispatchQueue.main.async {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                self.pressCommandV()
            }
        }
    }

    private func pressCommandV() {
        guard
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false)
        else {
            return
        }

        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}
