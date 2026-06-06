import CryptoKit
import Foundation
import Darwin

final class HttpWebSocketServer: @unchecked Sendable {
    private let host: String
    private let port: UInt16
    private let staticRoot: URL
    private let token: String?
    private let input: InputDevice
    private let clipboard: ClipboardGateway
    private let commands: CommandRegistry
    private let queue = DispatchQueue(label: "tap-pad.server", qos: .userInitiated)
    private var serverFd: Int32 = -1

    init(
        host: String,
        port: UInt16,
        staticRoot: URL,
        token: String?,
        input: InputDevice,
        clipboard: ClipboardGateway,
        commands: CommandRegistry
    ) {
        self.host = host
        self.port = port
        self.staticRoot = staticRoot
        self.token = token
        self.input = input
        self.clipboard = clipboard
        self.commands = commands
    }

    func start() throws {
        serverFd = socket(AF_INET, SOCK_STREAM, 0)
        guard serverFd >= 0 else {
            throw ServerError.socket(errno)
        }

        var yes: Int32 = 1
        setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = htons(port)
        addr.sin_addr = in_addr(s_addr: host == "127.0.0.1" ? inet_addr(host) : INADDR_ANY)

        let bindResult = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                Darwin.bind(serverFd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            throw ServerError.bind(errno)
        }

        guard listen(serverFd, 64) == 0 else {
            throw ServerError.listen(errno)
        }

        print("TapPad macOS backend listening on http://\(host):\(port)")
        print("Serving static files from \(staticRoot.path)")

        queue.async { [self] in
            acceptLoop()
        }
    }

    private func acceptLoop() {
        while true {
            let fd = accept(serverFd, nil, nil)
            if fd < 0 {
                continue
            }

            DispatchQueue.global(qos: .userInitiated).async { [self] in
                handleConnection(fd)
            }
        }
    }

    private func handleConnection(_ fd: Int32) {
        defer { close(fd) }

        guard let request = readHttpRequest(fd) else {
            return
        }

        if request.path == "/ws" {
            handleWebSocket(fd, request: request)
        } else {
            serveStatic(fd, request: request)
        }
    }

    private func handleWebSocket(_ fd: Int32, request: HttpRequest) {
        if let token, request.query["token"] != token {
            writeString(fd, "HTTP/1.1 403 Forbidden\r\nContent-Length: 10\r\n\r\nForbidden\n")
            return
        }

        guard let key = request.headers["sec-websocket-key"] else {
            writeString(fd, "HTTP/1.1 400 Bad Request\r\nContent-Length: 12\r\n\r\nBad Request\n")
            return
        }

        let accept = websocketAccept(key)
        writeString(
            fd,
            """
            HTTP/1.1 101 Switching Protocols\r
            Upgrade: websocket\r
            Connection: Upgrade\r
            Sec-WebSocket-Accept: \(accept)\r
            \r

            """
        )

        if let data = try? JSONEncoder().encode(ServerMessage.ready(host: localHostName())),
           let text = String(data: data, encoding: .utf8) {
            writeWebSocketText(fd, text)
        }

        while let frame = readWebSocketFrame(fd) {
            switch frame.opcode {
            case 0x1:
                guard let text = String(data: frame.payload, encoding: .utf8) else {
                    continue
                }
                handleClientText(text)
            case 0x8:
                writeWebSocketFrame(fd, opcode: 0x8, payload: frame.payload)
                return
            case 0x9:
                writeWebSocketFrame(fd, opcode: 0xA, payload: frame.payload)
            default:
                continue
            }
        }
    }

    private func handleClientText(_ text: String) {
        do {
            switch try ClientMessageDecoder.decode(text) {
            case let .move(dx, dy):
                input.move(dx: dx, dy: dy)
            case let .wheel(dy):
                input.scroll(dy: dy.rounded())
            case let .click(button, clickCount):
                input.click(button: button, clickCount: clickCount)
            case let .key(code, down):
                input.key(code: code, down: down)
            case let .text(value):
                input.typeText(value)
            case let .paste(value):
                clipboard.paste(value)
            case let .cmd(action):
                commands.run(action: action)
            case let .exec(command):
                print("raw exec is intentionally unsupported on macOS backend: \(command)")
            }
        } catch {
            print("invalid client message: \(error)")
        }
    }

    private func serveStatic(_ fd: Int32, request: HttpRequest) {
        let requestedPath = request.path == "/" ? "index.html" : String(request.path.dropFirst())
        guard !requestedPath.contains("..") else {
            writeString(fd, "HTTP/1.1 400 Bad Request\r\nContent-Length: 12\r\n\r\nBad Request\n")
            return
        }

        let fileURL = staticRoot.appendingPathComponent(requestedPath)
        guard let data = try? Data(contentsOf: fileURL) else {
            writeString(fd, "HTTP/1.1 404 Not Found\r\nContent-Length: 10\r\n\r\nNot found\n")
            return
        }

        writeString(
            fd,
            """
            HTTP/1.1 200 OK\r
            Content-Type: \(mimeType(for: fileURL))\r
            Cache-Control: no-store\r
            Content-Length: \(data.count)\r
            \r

            """
        )
        writeAll(fd, [UInt8](data))
    }
}

private struct HttpRequest {
    let path: String
    let query: [String: String]
    let headers: [String: String]
}

private struct WebSocketFrame {
    let opcode: UInt8
    let payload: Data
}

private enum ServerError: Error {
    case socket(Int32)
    case bind(Int32)
    case listen(Int32)
}

private func readHttpRequest(_ fd: Int32) -> HttpRequest? {
    var bytes: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: 1024)

    while bytes.count < 16_384 {
        let count = recv(fd, &buffer, buffer.count, 0)
        if count <= 0 {
            return nil
        }
        bytes.append(contentsOf: buffer.prefix(count))
        if bytes.count >= 4,
           bytes.suffix(4) == [13, 10, 13, 10] {
            break
        }
    }

    guard let raw = String(bytes: bytes, encoding: .utf8) else {
        return nil
    }

    let lines = raw.components(separatedBy: "\r\n")
    guard let requestLine = lines.first else {
        return nil
    }
    let requestParts = requestLine.split(separator: " ")
    guard requestParts.count >= 2 else {
        return nil
    }

    let target = String(requestParts[1])
    let splitTarget = target.split(separator: "?", maxSplits: 1).map(String.init)
    let path = splitTarget.first ?? "/"
    let query = splitTarget.count > 1 ? parseQuery(splitTarget[1]) : [:]

    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
        let pair = line.split(separator: ":", maxSplits: 1).map(String.init)
        if pair.count == 2 {
            headers[pair[0].lowercased()] = pair[1].trimmingCharacters(in: .whitespaces)
        }
    }

    return HttpRequest(path: path, query: query, headers: headers)
}

private func parseQuery(_ query: String) -> [String: String] {
    var values: [String: String] = [:]
    for part in query.split(separator: "&") {
        let pair = part.split(separator: "=", maxSplits: 1).map(String.init)
        if pair.count == 2 {
            values[pair[0].removingPercentEncoding ?? pair[0]] =
                pair[1].removingPercentEncoding ?? pair[1]
        }
    }
    return values
}

private func websocketAccept(_ key: String) -> String {
    let input = Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8)
    let digest = Insecure.SHA1.hash(data: input)
    return Data(digest).base64EncodedString()
}

private func readWebSocketFrame(_ fd: Int32) -> WebSocketFrame? {
    guard let header = readExact(fd, count: 2) else {
        return nil
    }

    let first = header[0]
    let second = header[1]
    let opcode = first & 0x0F
    let masked = (second & 0x80) != 0
    var length = Int(second & 0x7F)

    if length == 126 {
        guard let extended = readExact(fd, count: 2) else {
            return nil
        }
        length = Int(UInt16(extended[0]) << 8 | UInt16(extended[1]))
    } else if length == 127 {
        guard let extended = readExact(fd, count: 8) else {
            return nil
        }
        length = extended.reduce(0) { ($0 << 8) | Int($1) }
    }

    let mask = masked ? readExact(fd, count: 4) : nil
    guard var payload = readExact(fd, count: length) else {
        return nil
    }

    if let mask {
        for index in payload.indices {
            payload[index] ^= mask[index % 4]
        }
    }

    return WebSocketFrame(opcode: opcode, payload: Data(payload))
}

private func writeWebSocketText(_ fd: Int32, _ text: String) {
    writeWebSocketFrame(fd, opcode: 0x1, payload: Data(text.utf8))
}

private func writeWebSocketFrame(_ fd: Int32, opcode: UInt8, payload: Data) {
    var bytes: [UInt8] = [0x80 | opcode]
    let count = payload.count

    if count < 126 {
        bytes.append(UInt8(count))
    } else if count <= UInt16.max {
        bytes.append(126)
        bytes.append(UInt8((count >> 8) & 0xFF))
        bytes.append(UInt8(count & 0xFF))
    } else {
        bytes.append(127)
        for shift in stride(from: 56, through: 0, by: -8) {
            bytes.append(UInt8((count >> shift) & 0xFF))
        }
    }

    bytes.append(contentsOf: payload)
    writeAll(fd, bytes)
}

private func readExact(_ fd: Int32, count: Int) -> [UInt8]? {
    if count == 0 {
        return []
    }

    var result: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: count)

    while result.count < count {
        let remaining = count - result.count
        let readCount = recv(fd, &buffer, remaining, 0)
        if readCount <= 0 {
            return nil
        }
        result.append(contentsOf: buffer.prefix(readCount))
    }

    return result
}

private func writeString(_ fd: Int32, _ string: String) {
    writeAll(fd, [UInt8](string.utf8))
}

private func writeAll(_ fd: Int32, _ bytes: [UInt8]) {
    var sent = 0
    bytes.withUnsafeBytes { rawBuffer in
        guard let base = rawBuffer.baseAddress else {
            return
        }
        while sent < bytes.count {
            let count = Darwin.send(fd, base.advanced(by: sent), bytes.count - sent, 0)
            if count <= 0 {
                break
            }
            sent += count
        }
    }
}

private func mimeType(for url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "html": "text/html; charset=utf-8"
    case "css": "text/css; charset=utf-8"
    case "js": "application/javascript; charset=utf-8"
    case "json": "application/json; charset=utf-8"
    case "svg": "image/svg+xml"
    default: "application/octet-stream"
    }
}

private func localHostName() -> String {
    ProcessInfo.processInfo.hostName
}

private func htons(_ value: UInt16) -> UInt16 {
    value.bigEndian
}
