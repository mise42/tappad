//! One Host port: TLS for every peer, plain HTTP only for loopback tools.
//!
//! The Quickshell plugin and `tappad-host` CLI talk to `127.0.0.1` without TLS. Every other peer
//! must start a TLS handshake; a plaintext request from the LAN gets a short refusal and is closed,
//! so no credential or input is ever accepted in clear text over the network.

use std::{
    io,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use axum::{extract::connect_info::Connected, serve::IncomingStream};
use log::{debug, warn};
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::mpsc,
};
use tokio_rustls::{TlsAcceptor, rustls::ServerConfig, server::TlsStream};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const TLS_HANDSHAKE_RECORD: u8 = 0x16;
const PLAINTEXT_REFUSAL: &str =
    "TapPad Host requires an encrypted connection. Update the TapPad app.\n";

#[derive(Debug, Clone, Copy)]
pub struct PeerInfo {
    pub addr: SocketAddr,
}

pub enum HostStream {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

pub struct HostListener {
    accepted: mpsc::Receiver<(HostStream, PeerInfo)>,
    local_addr: SocketAddr,
}

#[derive(Debug, PartialEq, Eq)]
enum Route {
    Tls,
    Plain,
    Refuse,
}

fn route(first_byte: u8, peer: SocketAddr) -> Route {
    if first_byte == TLS_HANDSHAKE_RECORD {
        Route::Tls
    } else if peer.ip().is_loopback() {
        Route::Plain
    } else {
        Route::Refuse
    }
}

impl HostListener {
    /// Accepts in the background so one slow handshake cannot stall other clients.
    pub fn new(listener: TcpListener, config: Arc<ServerConfig>) -> io::Result<Self> {
        let local_addr = listener.local_addr()?;
        let (sender, accepted) = mpsc::channel(16);
        let acceptor = TlsAcceptor::from(config);
        tokio::spawn(async move {
            loop {
                let (stream, addr) = tokio::select! {
                    _ = sender.closed() => break,
                    result = listener.accept() => match result {
                        Ok(accepted) => accepted,
                        Err(error) => {
                            warn!("TapPad accept failed: {error}");
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            continue;
                        }
                    },
                };
                let sender = sender.clone();
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    match tokio::time::timeout(HANDSHAKE_TIMEOUT, classify(stream, addr, acceptor))
                        .await
                    {
                        Ok(Some(accepted)) => {
                            let _ = sender.send(accepted).await;
                        }
                        Ok(None) => {}
                        Err(_) => debug!("TLS handshake from {addr} timed out"),
                    }
                });
            }
        });
        Ok(Self {
            accepted,
            local_addr,
        })
    }
}

async fn classify(
    mut stream: TcpStream,
    addr: SocketAddr,
    acceptor: TlsAcceptor,
) -> Option<(HostStream, PeerInfo)> {
    let _ = stream.set_nodelay(true);
    let mut first = [0u8; 1];
    if stream.peek(&mut first).await.ok()? == 0 {
        return None;
    }
    match route(first[0], addr) {
        Route::Tls => match acceptor.accept(stream).await {
            Ok(tls) => Some((HostStream::Tls(Box::new(tls)), PeerInfo { addr })),
            Err(error) => {
                debug!("TLS handshake from {addr} failed: {error}");
                None
            }
        },
        Route::Plain => Some((HostStream::Plain(stream), PeerInfo { addr })),
        Route::Refuse => {
            let response = format!(
                "HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n\r\n{PLAINTEXT_REFUSAL}",
                PLAINTEXT_REFUSAL.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
            None
        }
    }
}

impl axum::serve::Listener for HostListener {
    type Io = HostStream;
    type Addr = PeerInfo;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        match self.accepted.recv().await {
            Some(accepted) => accepted,
            None => std::future::pending().await,
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        Ok(PeerInfo {
            addr: self.local_addr,
        })
    }
}

impl Connected<IncomingStream<'_, HostListener>> for PeerInfo {
    fn connect_info(stream: IncomingStream<'_, HostListener>) -> Self {
        *stream.remote_addr()
    }
}

impl AsyncRead for HostStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_read(cx, buf),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for HostStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_write(cx, buf),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_flush(cx),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_shutdown(cx),
            Self::Tls(stream) => Pin::new(stream.as_mut()).poll_shutdown(cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls::TlsIdentity;
    use axum::{Router, extract::ConnectInfo, routing::get};
    use tokio::io::AsyncReadExt;
    use tokio_rustls::{
        TlsConnector,
        rustls::{
            self, ClientConfig, DigitallySignedStruct, SignatureScheme,
            client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
            pki_types::{CertificateDer, ServerName, UnixTime},
        },
    };

    #[test]
    fn only_loopback_may_skip_tls() {
        let lan: SocketAddr = "192.168.1.20:5000".parse().unwrap();
        let local: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        assert_eq!(route(TLS_HANDSHAKE_RECORD, lan), Route::Tls);
        assert_eq!(route(b'G', lan), Route::Refuse);
        assert_eq!(route(b'G', local), Route::Plain);
        assert_eq!(route(TLS_HANDSHAKE_RECORD, local), Route::Tls);
    }

    /// Records the presented leaf so the test can compare it with the Host fingerprint.
    #[derive(Debug)]
    struct RecordingVerifier(std::sync::Mutex<Option<String>>);

    impl ServerCertVerifier for RecordingVerifier {
        fn verify_server_cert(
            &self,
            end_entity: &CertificateDer<'_>,
            _: &[CertificateDer<'_>],
            _: &ServerName<'_>,
            _: &[u8],
            _: UnixTime,
        ) -> Result<ServerCertVerified, rustls::Error> {
            *self.0.lock().unwrap() = Some(crate::tls::fingerprint(end_entity));
            Ok(ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls12_signature(
                message,
                cert,
                dss,
                &rustls::crypto::ring::default_provider().signature_verification_algorithms,
            )
        }
        fn verify_tls13_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls13_signature(
                message,
                cert,
                dss,
                &rustls::crypto::ring::default_provider().signature_verification_algorithms,
            )
        }
        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            rustls::crypto::ring::default_provider()
                .signature_verification_algorithms
                .supported_schemes()
        }
    }

    async fn request<S: AsyncRead + AsyncWrite + Unpin>(mut stream: S) -> String {
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.ok();
        response
    }

    #[tokio::test]
    async fn serves_tls_with_the_host_certificate_and_plain_http_on_loopback() {
        let dir = tempfile::tempdir().unwrap();
        let identity = TlsIdentity::load_or_create(dir.path(), &["localhost".into()]).unwrap();
        let tcp = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = tcp.local_addr().unwrap();
        let listener = HostListener::new(tcp, identity.server_config().unwrap()).unwrap();
        let app = Router::new().route(
            "/",
            get(|ConnectInfo(peer): ConnectInfo<PeerInfo>| async move {
                format!("peer={}", peer.addr.ip())
            }),
        );
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<PeerInfo>(),
            )
            .await
            .unwrap();
        });

        let plain = request(TcpStream::connect(addr).await.unwrap()).await;
        assert!(plain.ends_with("peer=127.0.0.1"), "{plain}");

        let verifier = Arc::new(RecordingVerifier(Default::default()));
        let config = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(verifier.clone())
            .with_no_client_auth();
        let tls = TlsConnector::from(Arc::new(config))
            .connect(
                ServerName::try_from("localhost").unwrap(),
                TcpStream::connect(addr).await.unwrap(),
            )
            .await
            .unwrap();
        let encrypted = request(tls).await;
        assert!(encrypted.ends_with("peer=127.0.0.1"), "{encrypted}");
        assert_eq!(
            verifier.0.lock().unwrap().as_deref(),
            Some(identity.fingerprint.as_str())
        );
    }
}
