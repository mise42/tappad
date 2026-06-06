import ApplicationServices
import Foundation

enum Permissions {
    static var isAccessibilityTrusted: Bool {
        AXIsProcessTrusted()
    }

    static func requestAccessibilityTrust() {
        let options = [
            "AXTrustedCheckOptionPrompt": true
        ] as CFDictionary

        if !AXIsProcessTrustedWithOptions(options) {
            print("Accessibility permission is required for pointer and keyboard input.")
        }
    }
}
