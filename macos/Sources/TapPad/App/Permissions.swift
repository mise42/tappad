import ApplicationServices
import Foundation

enum Permissions {
    private static let hasPromptedAccessibilityKey = "TapPadHasPromptedAccessibilityPermission"

    static var isAccessibilityTrusted: Bool {
        AXIsProcessTrusted()
    }

    static func requestAccessibilityTrustOnce() {
        guard !isAccessibilityTrusted else {
            return
        }

        guard !UserDefaults.standard.bool(forKey: hasPromptedAccessibilityKey) else {
            return
        }

        UserDefaults.standard.set(true, forKey: hasPromptedAccessibilityKey)
        requestAccessibilityTrust()
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
