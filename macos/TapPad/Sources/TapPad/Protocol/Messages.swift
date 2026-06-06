import Foundation

enum ClientMessage {
    case move(dx: Double, dy: Double)
    case wheel(dy: Double)
    case click(button: String, clickCount: Int)
    case key(code: String, down: Bool)
    case text(value: String)
    case paste(value: String)
    case exec(command: String)
    case cmd(action: String)
}

struct ServerMessage: Encodable {
    let type: String
    let host: String
    let time: UInt64

    static func ready(host: String) -> ServerMessage {
        ServerMessage(
            type: "ready",
            host: host,
            time: UInt64(Date().timeIntervalSince1970 * 1000)
        )
    }
}

enum ClientMessageDecoder {
    static func decode(_ text: String) throws -> ClientMessage {
        guard
            let data = text.data(using: .utf8),
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else {
            throw MessageError.invalidMessage
        }

        switch type {
        case "move":
            return .move(
                dx: object["dx"] as? Double ?? 0,
                dy: object["dy"] as? Double ?? 0
            )
        case "wheel":
            return .wheel(dy: object["dy"] as? Double ?? 0)
        case "click":
            return .click(
                button: object["button"] as? String ?? "left",
                clickCount: object["clickCount"] as? Int ?? 1
            )
        case "key":
            return .key(
                code: object["code"] as? String ?? "",
                down: object["down"] as? Bool ?? false
            )
        case "text":
            return .text(value: object["value"] as? String ?? "")
        case "paste":
            return .paste(value: object["value"] as? String ?? "")
        case "exec":
            return .exec(command: object["command"] as? String ?? "")
        case "cmd":
            return .cmd(action: object["action"] as? String ?? "")
        default:
            throw MessageError.unknownType(type)
        }
    }
}

enum MessageError: Error {
    case invalidMessage
    case unknownType(String)
}
