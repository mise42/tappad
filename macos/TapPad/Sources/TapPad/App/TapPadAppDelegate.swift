import AppKit
import Foundation

@MainActor
final class TapPadAppDelegate: NSObject, NSApplicationDelegate {
    private static let hasShownPairingKey = "TapPadHasShownPairingWindow"
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let pairingInfo: PairingInfo
    private lazy var pairingWindow = PairingWindowController(pairingInfo: pairingInfo)

    init(pairingInfo: PairingInfo) {
        self.pairingInfo = pairingInfo
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.button?.title = "TapPad"

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "TapPad :\(pairingInfo.port)", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Show Pairing Code", action: #selector(showPairing), keyEquivalent: "p"))
        menu.addItem(NSMenuItem(title: "Copy Pairing Link", action: #selector(copyPairingLink), keyEquivalent: "c"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        statusItem.menu = menu

        if !UserDefaults.standard.bool(forKey: Self.hasShownPairingKey) {
            showPairing(nil)
            UserDefaults.standard.set(true, forKey: Self.hasShownPairingKey)
        }
    }

    @MainActor @objc private func showPairing(_ sender: Any?) {
        pairingWindow.showWindow(sender)
    }

    @MainActor @objc private func copyPairingLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingInfo.preferredURL.absoluteString, forType: .string)
    }

    @MainActor @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}
