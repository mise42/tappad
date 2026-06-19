import AppKit
import Foundation

@MainActor
final class TapPadAppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let pairingInfo: PairingInfo
    private lazy var pairingWindow = PairingWindowController(pairingInfo: pairingInfo)
    private lazy var settingsWindow = SettingsWindowController(
        pairingInfo: pairingInfo,
        showPairing: { [weak self] sender in
            self?.showPairing(sender)
        }
    )

    init(pairingInfo: PairingInfo) {
        self.pairingInfo = pairingInfo
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureStatusItem()

        DispatchQueue.main.async { [weak self] in
            self?.showPairing(nil)
        }
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        item.isVisible = true

        if let button = item.button {
            button.title = "TapPad"
            button.toolTip = "TapPad"
        } else {
            NSLog("TapPad status item has no button")
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "TapPad :\(pairingInfo.port)", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Settings...", action: #selector(showSettings), keyEquivalent: ","))
        menu.addItem(NSMenuItem(title: "Show Pairing Code", action: #selector(showPairing), keyEquivalent: "p"))
        menu.addItem(NSMenuItem(title: "Copy Pairing Link", action: #selector(copyPairingLink), keyEquivalent: "c"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        item.menu = menu

        NSLog("TapPad status item configured")
    }

    @MainActor @objc private func showPairing(_ sender: Any?) {
        pairingWindow.showWindow(sender)
    }

    @MainActor @objc private func showSettings(_ sender: Any?) {
        settingsWindow.showWindow(sender)
    }

    @MainActor @objc private func copyPairingLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingInfo.preferredURL.absoluteString, forType: .string)
    }

    @MainActor @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}
