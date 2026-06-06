import AppKit
import CoreImage
import Foundation

@MainActor
final class PairingWindowController: NSWindowController {
    private let port: UInt16
    private let token: String
    private var pairingInfo: PairingInfo
    private let accessibilityStatus = NSTextField(labelWithString: "")
    private let qrView = NSImageView()
    private let preferredLabel = NSTextField(labelWithString: "")
    private let localLabel = NSTextField(labelWithString: "")

    init(pairingInfo: PairingInfo) {
        self.port = pairingInfo.port
        self.token = pairingInfo.token
        self.pairingInfo = pairingInfo

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 560),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "TapPad Pairing"
        window.center()

        super.init(window: window)
        window.contentView = makeContentView()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override func showWindow(_ sender: Any?) {
        refreshPairingInfo()
        refreshPermissionStatus()
        super.showWindow(sender)
        window?.makeKeyAndOrderFront(sender)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func makeContentView() -> NSView {
        let content = NSView()

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        let title = NSTextField(labelWithString: "Scan to control this Mac")
        title.font = .systemFont(ofSize: 22, weight: .semibold)

        let subtitle = NSTextField(labelWithString: "Works from iPhone, iPad, Android, or any browser on the same local network.")
        subtitle.font = .systemFont(ofSize: 13)
        subtitle.textColor = .secondaryLabelColor
        subtitle.alignment = .center
        subtitle.maximumNumberOfLines = 2
        subtitle.lineBreakMode = .byWordWrapping

        qrView.image = qrImage(for: pairingInfo.preferredURL.absoluteString)
        qrView.imageScaling = .scaleProportionallyUpOrDown
        qrView.setContentHuggingPriority(.required, for: .vertical)
        qrView.widthAnchor.constraint(equalToConstant: 260).isActive = true
        qrView.heightAnchor.constraint(equalToConstant: 260).isActive = true

        configureSelectableLabel(preferredLabel, text: pairingInfo.preferredURL.absoluteString, fontSize: 13)
        preferredLabel.alignment = .center

        configureSelectableLabel(localLabel, text: "Backup: \(pairingInfo.localURL.absoluteString)", fontSize: 12)
        localLabel.textColor = .secondaryLabelColor
        localLabel.alignment = .center

        let buttonRow = NSStackView()
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 10
        buttonRow.alignment = .centerY

        let copyButton = NSButton(title: "Copy Link", target: self, action: #selector(copyLink))
        copyButton.bezelStyle = .rounded

        let openButton = NSButton(title: "Open Locally", target: self, action: #selector(openLocally))
        openButton.bezelStyle = .rounded

        let permissionButton = NSButton(title: "Check Permissions", target: self, action: #selector(requestPermissions))
        permissionButton.bezelStyle = .rounded

        buttonRow.addArrangedSubview(copyButton)
        buttonRow.addArrangedSubview(openButton)
        buttonRow.addArrangedSubview(permissionButton)

        accessibilityStatus.font = .systemFont(ofSize: 12)
        accessibilityStatus.textColor = .secondaryLabelColor
        accessibilityStatus.alignment = .center

        for view in [title, subtitle, qrView, preferredLabel, localLabel, buttonRow, accessibilityStatus] {
            stack.addArrangedSubview(view)
        }

        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: content.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor, constant: -24),
            subtitle.widthAnchor.constraint(equalTo: stack.widthAnchor),
            preferredLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            localLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            accessibilityStatus.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])

        refreshPermissionStatus()
        return content
    }

    @objc private func copyLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingInfo.preferredURL.absoluteString, forType: .string)
    }

    @objc private func openLocally() {
        NSWorkspace.shared.open(pairingInfo.preferredURL)
    }

    @objc private func requestPermissions() {
        Permissions.requestAccessibilityTrust()
        refreshPermissionStatus()
    }

    private func refreshPermissionStatus() {
        accessibilityStatus.stringValue = Permissions.isAccessibilityTrusted
            ? "Accessibility: allowed"
            : "Accessibility: needed for pointer, keyboard, and paste"
    }

    private func refreshPairingInfo() {
        pairingInfo = PairingInfo(port: port, token: token)
        qrView.image = qrImage(for: pairingInfo.preferredURL.absoluteString)
        preferredLabel.stringValue = pairingInfo.preferredURL.absoluteString
        localLabel.stringValue = "Backup: \(pairingInfo.localURL.absoluteString)"
    }

    private func configureSelectableLabel(_ field: NSTextField, text: String, fontSize: CGFloat) {
        field.stringValue = text
        field.font = .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        field.isSelectable = true
        field.maximumNumberOfLines = 2
        field.lineBreakMode = .byTruncatingMiddle
    }

    private func qrImage(for text: String) -> NSImage? {
        let filter = CIFilter(name: "CIQRCodeGenerator")
        filter?.setValue(Data(text.utf8), forKey: "inputMessage")
        filter?.setValue("M", forKey: "inputCorrectionLevel")

        guard let output = filter?.outputImage else {
            return nil
        }

        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        let representation = NSCIImageRep(ciImage: scaled)
        let image = NSImage(size: representation.size)
        image.addRepresentation(representation)
        return image
    }
}
