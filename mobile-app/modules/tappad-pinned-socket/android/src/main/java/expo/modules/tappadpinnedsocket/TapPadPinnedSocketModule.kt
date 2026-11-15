package expo.modules.tappadpinnedsocket

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetSocketAddress
import java.net.Proxy
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * WebSocket to one TapPad Host, trusting only the leaf certificate with the paired SHA-256
 * fingerprint. Every connection gets its own trust manager; nothing changes global trust.
 */
class TapPadPinnedSocketModule : Module() {
  private class Connection(val client: OkHttpClient, val socket: WebSocket)

  private val connections = ConcurrentHashMap<String, Connection>()
  private val random = SecureRandom()

  override fun definition() = ModuleDefinition {
    Name("TapPadPinnedSocket")
    Events("onOpen", "onMessage", "onClose", "onError")

    Function("randomNonce") {
      val bytes = ByteArray(24)
      random.nextBytes(bytes)
      Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    // Reads the certificate a Host presents without sending anything over the connection. The
    // caller pins the result and must still verify the Host's token-bound proof before trusting it.
    AsyncFunction("probeFingerprint") { host: String, port: Int ->
      val trust = PinnedTrustManager(null)
      val socket = tlsContext(trust).socketFactory.createSocket() as SSLSocket
      socket.use {
        it.connect(InetSocketAddress(host, port), PROBE_TIMEOUT_MS)
        it.soTimeout = PROBE_TIMEOUT_MS
        it.startHandshake()
      }
      trust.observed ?: throw CertificateException("The host did not present a certificate.")
    }

    Function("connect") { socketId: String, url: String, fingerprint: String, authorization: String ->
      connect(socketId, url, fingerprint.lowercase(), authorization)
    }

    Function("send") { socketId: String, text: String ->
      connections[socketId]?.socket?.send(text) ?: false
    }

    Function("close") { socketId: String ->
      connections.remove(socketId)?.let {
        it.socket.close(1000, null)
        it.client.dispatcher.executorService.shutdown()
      }
      Unit
    }

    OnDestroy {
      connections.values.forEach { it.socket.cancel() }
      connections.clear()
    }
  }

  private fun connect(socketId: String, url: String, fingerprint: String, authorization: String) {
    val trust = PinnedTrustManager(fingerprint)
    val client = OkHttpClient.Builder()
      .sslSocketFactory(tlsContext(trust).socketFactory, trust)
      // The certificate pin is the trust anchor. Host names and LAN addresses change with the
      // network and are not identity, so they are not checked against the certificate.
      .hostnameVerifier { _, _ -> true }
      .proxy(Proxy.NO_PROXY)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.SECONDS)
      .writeTimeout(8, TimeUnit.SECONDS)
      .pingInterval(15, TimeUnit.SECONDS)
      .build()
    val request = Request.Builder().url(url).header("Authorization", authorization).build()
    val socket = client.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        sendEvent("onOpen", mapOf("socketId" to socketId))
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        sendEvent("onMessage", mapOf("socketId" to socketId, "data" to text))
      }

      override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        webSocket.close(code, null)
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        finish(socketId, code)
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        val mismatch = generateSequence(t) { it.cause }.any { it is PinMismatchException }
        val message = when {
          mismatch -> "This host's certificate changed. Pair again by scanning its QR code."
          response?.code == 403 -> "The host rejected this pairing token."
          else -> "Could not reach the desktop host."
        }
        sendEvent(
          "onError",
          mapOf("socketId" to socketId, "message" to message, "certificateMismatch" to mismatch),
        )
        finish(socketId, 1006)
      }
    })
    connections[socketId] = Connection(client, socket)
  }

  private fun finish(socketId: String, code: Int) {
    connections.remove(socketId)?.client?.dispatcher?.executorService?.shutdown()
    sendEvent("onClose", mapOf("socketId" to socketId, "code" to code))
  }

  private fun tlsContext(trust: X509TrustManager): SSLContext =
    SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), random) }

  private class PinMismatchException :
    CertificateException("TapPad Host certificate does not match the paired certificate.")

  /** Accepts only `expected`; with `expected == null` it records the leaf for a probe. */
  private class PinnedTrustManager(private val expected: String?) : X509TrustManager {
    @Volatile var observed: String? = null

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
      throw CertificateException("Client certificates are not used.")
    }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
      val leaf = chain.firstOrNull() ?: throw CertificateException("No server certificate.")
      val fingerprint = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
        .joinToString("") { "%02x".format(it) }
      observed = fingerprint
      if (expected != null && !MessageDigest.isEqual(fingerprint.toByteArray(), expected.toByteArray())) {
        throw PinMismatchException()
      }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
  }

  private companion object {
    const val PROBE_TIMEOUT_MS = 5_000
  }
}
