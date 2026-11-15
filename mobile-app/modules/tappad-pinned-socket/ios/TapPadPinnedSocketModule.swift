import CryptoKit
import ExpoModulesCore
import Foundation
import Security

/// WebSocket to one TapPad Host, trusting only the leaf certificate with the paired SHA-256
/// fingerprint. Each connection has its own URLSession delegate; global trust is never changed.
public class TapPadPinnedSocketModule: Module {
  private var connections: [String: PinnedConnection] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("TapPadPinnedSocket")
    Events("onOpen", "onMessage", "onClose", "onError")

    Function("randomNonce") { () -> String in
      var bytes = [UInt8](repeating: 0, count: 24)
      _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
      return Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }

    // Reads the certificate a Host presents and cancels before any request is sent. The caller
    // pins the result and must still verify the Host's token-bound proof before trusting it.
    AsyncFunction("probeFingerprint") { (host: String, port: Int, promise: Promise) in
      let urlHost = host.contains(":") ? "[\(host)]" : host
      guard let url = URL(string: "https://\(urlHost):\(port)/") else {
        promise.reject("ERR_TAPPAD_PROBE", "Invalid host address.")
        return
      }
      let probe = PinnedConnection(expected: nil, emit: { _, _ in })
      let session = URLSession(configuration: .ephemeral, delegate: probe, delegateQueue: nil)
      var request = URLRequest(url: url)
      request.timeoutInterval = 5
      session.dataTask(with: request) { _, _, _ in
        session.invalidateAndCancel()
        if let fingerprint = probe.observed {
          promise.resolve(fingerprint)
        } else {
          promise.reject("ERR_TAPPAD_PROBE", "Could not reach the desktop host.")
        }
      }.resume()
    }

    Function("connect") { (socketId: String, url: String, fingerprint: String, authorization: String) in
      guard let target = URL(string: url) else { return }
      let connection = PinnedConnection(expected: fingerprint.lowercased()) { [weak self] name, body in
        var payload = body
        payload["socketId"] = socketId
        if name == "onClose" { self?.remove(socketId) }
        self?.sendEvent(name, payload)
      }
      self.lock.lock()
      self.connections[socketId] = connection
      self.lock.unlock()
      connection.start(url: target, authorization: authorization)
    }

    Function("send") { (socketId: String, text: String) -> Bool in
      self.lock.lock()
      let connection = self.connections[socketId]
      self.lock.unlock()
      return connection?.send(text) ?? false
    }

    Function("close") { (socketId: String) in
      self.remove(socketId)?.close()
    }
  }

  @discardableResult
  private func remove(_ socketId: String) -> PinnedConnection? {
    lock.lock()
    defer { lock.unlock() }
    return connections.removeValue(forKey: socketId)
  }
}

final class PinnedConnection: NSObject, URLSessionWebSocketDelegate {
  private let expected: String?
  private let emit: (String, [String: Any]) -> Void
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?
  private var open = false
  private var finished = false
  private(set) var observed: String?
  private var pinMismatch = false

  init(expected: String?, emit: @escaping (String, [String: Any]) -> Void) {
    self.expected = expected
    self.emit = emit
  }

  func start(url: URL, authorization: String) {
    var request = URLRequest(url: url)
    request.setValue(authorization, forHTTPHeaderField: "Authorization")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.connectionProxyDictionary = [:]
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    let task = session.webSocketTask(with: request)
    self.session = session
    self.task = task
    task.resume()
  }

  func send(_ text: String) -> Bool {
    guard open, let task else { return false }
    task.send(.string(text)) { _ in }
    return true
  }

  func close() {
    finished = true
    task?.cancel(with: .normalClosure, reason: nil)
    session?.invalidateAndCancel()
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          let trust = challenge.protectionSpace.serverTrust,
          let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data)
    let fingerprint = digest.map { String(format: "%02x", $0) }.joined()
    observed = fingerprint
    if let expected, fingerprint == expected {
      // The pin replaces CA and host name checks: addresses change with the network.
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      pinMismatch = expected != nil
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    open = true
    emit("onOpen", [:])
    receive()
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    finish(code: closeCode.rawValue)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard error != nil, !finished else { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode
    let message: String
    if pinMismatch {
      message = "This host's certificate changed. Pair again by scanning its QR code."
    } else if status == 403 {
      message = "The host rejected this pairing token."
    } else {
      message = "Could not reach the desktop host."
    }
    emit("onError", ["message": message, "certificateMismatch": pinMismatch])
    finish(code: 1006)
  }

  private func receive() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(.string(let text)):
        self.emit("onMessage", ["data": text])
        self.receive()
      case .success:
        self.receive()
      case .failure:
        break
      }
    }
  }

  private func finish(code: Int) {
    guard !finished else { return }
    finished = true
    open = false
    session?.invalidateAndCancel()
    emit("onClose", ["code": code])
  }
}
