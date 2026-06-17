import AppKit
import Foundation

@MainActor
final class SettingsWindowController: NSWindowController {
    private let pairingInfo: PairingInfo
    private let showPairing: (Any?) -> Void
    private let permissionStatus = NSTextField(labelWithString: "")

    init(pairingInfo: PairingInfo, showPairing: @escaping (Any?) -> Void) {
        self.pairingInfo = pairingInfo
        self.showPairing = showPairing

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 360),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "TapPad Settings"
        window.center()

        super.init(window: window)
        window.contentView = makeContentView()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override func showWindow(_ sender: Any?) {
        refreshPermissionStatus()
        super.showWindow(sender)
        window?.makeKeyAndOrderFront(sender)
        NSApp.activate(ignoringOtherApps: true)
        Permissions.requestAccessibilityTrustOnce()
    }

    private func makeContentView() -> NSView {
        let content = NSView()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false

        let header = NSTextField(labelWithString: "TapPad Beta")
        header.font = .systemFont(ofSize: 22, weight: .semibold)

        let summary = NSTextField(labelWithString: "Free while the product experience is being validated.")
        summary.translatesAutoresizingMaskIntoConstraints = false
        summary.font = .systemFont(ofSize: 13)
        summary.textColor = .secondaryLabelColor
        summary.maximumNumberOfLines = 2
        summary.lineBreakMode = .byWordWrapping

        let statusBox = makeInfoStack(rows: [
            ("Server", "Port \(pairingInfo.port)"),
            ("Pairing", "Token saved on this Mac"),
            ("Web app", pairingInfo.preferredURL.absoluteString),
        ])
        statusBox.translatesAutoresizingMaskIntoConstraints = false

        let buttonRow = NSStackView()
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 10
        buttonRow.alignment = .centerY

        let pairingButton = NSButton(title: "Show Pairing Code", target: self, action: #selector(openPairing))
        pairingButton.bezelStyle = .rounded

        let copyButton = NSButton(title: "Copy Link", target: self, action: #selector(copyLink))
        copyButton.bezelStyle = .rounded

        let permissionButton = NSButton(title: "Check Permissions", target: self, action: #selector(requestPermissions))
        permissionButton.bezelStyle = .rounded

        buttonRow.addArrangedSubview(pairingButton)
        buttonRow.addArrangedSubview(copyButton)
        buttonRow.addArrangedSubview(permissionButton)

        permissionStatus.font = .systemFont(ofSize: 12)
        permissionStatus.textColor = .secondaryLabelColor
        permissionStatus.translatesAutoresizingMaskIntoConstraints = false

        for view in [header, summary, statusBox, buttonRow, permissionStatus] {
            stack.addArrangedSubview(view)
        }

        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
            summary.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusBox.widthAnchor.constraint(equalTo: stack.widthAnchor),
            permissionStatus.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])

        refreshPermissionStatus()
        return content
    }

    private func makeInfoStack(rows: [(String, String)]) -> NSStackView {
        let stack = NSStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8

        for row in rows {
            let line = NSStackView()
            line.translatesAutoresizingMaskIntoConstraints = false
            line.orientation = .horizontal
            line.alignment = .firstBaseline
            line.spacing = 12

            let label = NSTextField(labelWithString: row.0)
            label.translatesAutoresizingMaskIntoConstraints = false
            label.font = .systemFont(ofSize: 13, weight: .medium)
            label.textColor = .secondaryLabelColor
            label.widthAnchor.constraint(equalToConstant: 70).isActive = true

            let value = NSTextField(labelWithString: row.1)
            value.translatesAutoresizingMaskIntoConstraints = false
            value.font = .systemFont(ofSize: 13)
            value.isSelectable = true
            value.maximumNumberOfLines = 2
            value.lineBreakMode = .byTruncatingMiddle

            line.addArrangedSubview(label)
            line.addArrangedSubview(value)
            stack.addArrangedSubview(line)
        }

        return stack
    }

    @objc private func openPairing(_ sender: Any?) {
        showPairing(sender)
    }

    @objc private func copyLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingInfo.preferredURL.absoluteString, forType: .string)
    }

    @objc private func requestPermissions() {
        Permissions.requestAccessibilityTrust()
        refreshPermissionStatus()
    }

    private func refreshPermissionStatus() {
        permissionStatus.stringValue = Permissions.isAccessibilityTrusted
            ? "Accessibility: allowed"
            : "Accessibility: needed before pointer, keyboard, and paste can control the Mac"
    }
}
