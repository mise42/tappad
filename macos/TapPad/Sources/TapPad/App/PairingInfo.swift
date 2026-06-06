import Foundation

struct PairingInfo: Sendable {
    let port: UInt16
    let token: String
    let lanURL: URL?
    let localURL: URL

    var preferredURL: URL {
        lanURL ?? localURL
    }

    init(port: UInt16, token: String) {
        self.port = port
        self.token = token

        let hostName = ProcessInfo.processInfo.hostName
        localURL = PairingInfo.controlURL(host: hostName, port: port, token: token)

        if let address = NetworkAddresses.preferredLANAddress() {
            lanURL = PairingInfo.controlURL(host: address, port: port, token: token)
        } else {
            lanURL = nil
        }
    }

    static func controlURL(host: String, port: UInt16, token: String) -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = Int(port)
        components.path = "/"
        components.queryItems = [
            URLQueryItem(name: "token", value: token)
        ]
        return components.url!
    }
}

enum PairingToken {
    private static let storageKey = "TapPadPairingToken"

    static func resolve() -> String {
        if let token = ProcessInfo.processInfo.environment["TOUCHPAD_TOKEN"],
           !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return token
        }

        if let stored = UserDefaults.standard.string(forKey: storageKey),
           !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return stored
        }

        let token = generate()
        UserDefaults.standard.set(token, forKey: storageKey)
        return token
    }

    private static func generate() -> String {
        var bytes = [UInt8](repeating: 0, count: 18)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status == errSecSuccess {
            return Data(bytes).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }

        return UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }
}
