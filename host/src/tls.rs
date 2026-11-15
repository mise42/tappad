//! Host TLS identity and the token-to-certificate binding used by the native app.
//!
//! The Host serves LAN clients only over TLS with a self-signed certificate. Its trust anchor is
//! the SHA-256 fingerprint of that leaf certificate, carried in the pairing QR code. A client that
//! only knows the pairing token (manual entry, or a pairing saved before TLS) proves the token
//! bound to the certificate it actually observed, and the Host answers with its own bound proof.
//! A man in the middle presents another certificate, so it can neither reuse the client's proof
//! nor produce the Host's.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use ring::{digest, hmac};
use tokio_rustls::rustls::{
    ServerConfig,
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
};

const CERT_FILE: &str = "cert.der";
const KEY_FILE: &str = "key.der";
const CLIENT_PROOF_LABEL: &str = "tappad-client-v1";
const HOST_PROOF_LABEL: &str = "tappad-host-v1";
pub const BINDING_SCHEME: &str = "TapPad-Binding";

pub struct TlsIdentity {
    cert: Vec<u8>,
    key: Vec<u8>,
    pub fingerprint: String,
}

pub fn tls_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("tls")
}

impl TlsIdentity {
    /// Loads the Host certificate, creating one for `names` on first use.
    pub fn load_or_create(dir: &Path, names: &[String]) -> io::Result<Self> {
        match Self::load(dir) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Self::create(dir, names)?;
                Self::load(dir)
            }
            result => result,
        }
    }

    pub fn load(dir: &Path) -> io::Result<Self> {
        let cert = fs::read(dir.join(CERT_FILE))?;
        let key = fs::read(dir.join(KEY_FILE))?;
        Ok(Self {
            fingerprint: fingerprint(&cert),
            cert,
            key,
        })
    }

    /// Deletes the certificate so the next Host start creates a new identity.
    pub fn remove(dir: &Path) -> io::Result<()> {
        for file in [CERT_FILE, KEY_FILE] {
            match fs::remove_file(dir.join(file)) {
                Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
                _ => {}
            }
        }
        Ok(())
    }

    fn create(dir: &Path, names: &[String]) -> io::Result<()> {
        let invalid = |error: rcgen::Error| io::Error::new(io::ErrorKind::InvalidData, error);
        let key = rcgen::KeyPair::generate().map_err(invalid)?;
        let mut params = rcgen::CertificateParams::new(names.to_vec()).map_err(invalid)?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "TapPad Host");
        let year = 1970 + (now_secs() / 31_556_952) as i32;
        params.not_before = rcgen::date_time_ymd(year - 1, 1, 1);
        params.not_after = rcgen::date_time_ymd(year + 20, 1, 1);
        let cert = params.self_signed(&key).map_err(invalid)?;

        create_private_dir(dir)?;
        // Write the key first: a cert without its key fails loudly instead of serving another key.
        write_private(&dir.join(KEY_FILE), &key.serialize_der())?;
        write_private(&dir.join(CERT_FILE), cert.der())
    }

    pub fn server_config(&self) -> io::Result<Arc<ServerConfig>> {
        let mut config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(self.cert.clone())],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.key.clone())),
            )
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        Ok(Arc::new(config))
    }
}

/// Lowercase hex SHA-256 of a DER certificate.
pub fn fingerprint(der: &[u8]) -> String {
    hex(digest::digest(&digest::SHA256, der).as_ref())
}

/// Parses `Authorization: TapPad-Binding <nonce>.<proof>`.
pub fn parse_binding(header: &str) -> Option<(&str, &str)> {
    let value = header.strip_prefix(BINDING_SCHEME)?.strip_prefix(' ')?;
    let (nonce, proof) = value.split_once('.')?;
    let nonce_valid = (16..=128).contains(&nonce.len())
        && nonce
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    (nonce_valid && proof.len() == 64).then_some((nonce, proof))
}

pub fn verify_client_proof(token: &str, fingerprint: &str, nonce: &str, proof: &str) -> bool {
    let Some(proof) = unhex(proof) else {
        return false;
    };
    hmac::verify(
        &hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes()),
        binding_message(CLIENT_PROOF_LABEL, fingerprint, nonce).as_bytes(),
        &proof,
    )
    .is_ok()
}

pub fn host_proof(token: &str, fingerprint: &str, nonce: &str) -> String {
    bound_proof(HOST_PROOF_LABEL, token, fingerprint, nonce)
}

#[cfg(test)]
pub fn client_proof(token: &str, fingerprint: &str, nonce: &str) -> String {
    bound_proof(CLIENT_PROOF_LABEL, token, fingerprint, nonce)
}

fn bound_proof(label: &str, token: &str, fingerprint: &str, nonce: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes());
    hex(hmac::sign(&key, binding_message(label, fingerprint, nonce).as_bytes()).as_ref())
}

fn binding_message(label: &str, fingerprint: &str, nonce: &str) -> String {
    format!("{label}\n{fingerprint}\n{nonce}")
}

/// Compares secrets without an early exit on the first differing byte.
pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(text.get(index..index + 2)?, 16).ok())
        .collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let temporary = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FINGERPRINT: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn binding_proofs_match_the_shared_fixture() {
        // The native Android and iOS modules compute the same HMACs; this fixture pins the format.
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/native-host.json")).unwrap();
        let binding = &fixture["binding"];
        let (token, fp, nonce) = (
            binding["token"].as_str().unwrap(),
            binding["fingerprint"].as_str().unwrap(),
            binding["nonce"].as_str().unwrap(),
        );
        assert_eq!(client_proof(token, fp, nonce), binding["clientProof"]);
        assert_eq!(host_proof(token, fp, nonce), binding["hostProof"]);
        assert!(verify_client_proof(
            token,
            fp,
            nonce,
            binding["clientProof"].as_str().unwrap()
        ));
    }

    #[test]
    fn client_proof_is_bound_to_token_certificate_and_nonce() {
        let nonce = "AAAAAAAAAAAAAAAAAAAAAA";
        let proof = client_proof("token", FINGERPRINT, nonce);
        assert!(verify_client_proof("token", FINGERPRINT, nonce, &proof));
        assert!(!verify_client_proof("other", FINGERPRINT, nonce, &proof));
        let other_certificate = FINGERPRINT.replace('0', "f");
        assert!(!verify_client_proof(
            "token",
            &other_certificate,
            nonce,
            &proof
        ));
        assert!(!verify_client_proof(
            "token",
            FINGERPRINT,
            "BBBBBBBBBBBBBBBBBBBBBB",
            &proof
        ));
        // The Host's answer is not a valid client proof, so it cannot be reflected back.
        let reflected = host_proof("token", FINGERPRINT, nonce);
        assert!(!verify_client_proof(
            "token",
            FINGERPRINT,
            nonce,
            &reflected
        ));
    }

    #[test]
    fn binding_header_is_strictly_parsed() {
        let proof = "a".repeat(64);
        let nonce = "AAAAAAAAAAAAAAAAAAAAAA";
        assert_eq!(
            parse_binding(&format!("TapPad-Binding {nonce}.{proof}")),
            Some((nonce, proof.as_str()))
        );
        assert!(parse_binding(&format!("Bearer {nonce}.{proof}")).is_none());
        assert!(parse_binding(&format!("TapPad-Binding short.{proof}")).is_none());
        assert!(parse_binding(&format!("TapPad-Binding {nonce}.{}", &proof[1..])).is_none());
        assert!(parse_binding(&format!("TapPad-Binding {nonce}!.{proof}")).is_none());
    }

    #[test]
    fn identity_is_created_once_with_private_files() {
        let dir = tempfile::tempdir().unwrap();
        let tls = tls_dir(dir.path());
        let names = vec!["localhost".to_string(), "127.0.0.1".to_string()];

        let created = TlsIdentity::load_or_create(&tls, &names).unwrap();
        let loaded = TlsIdentity::load_or_create(&tls, &names).unwrap();

        assert_eq!(created.fingerprint, loaded.fingerprint);
        assert_eq!(created.fingerprint.len(), 64);
        assert!(created.server_config().is_ok());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(tls.join(KEY_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }

        TlsIdentity::remove(&tls).unwrap();
        let renewed = TlsIdentity::load_or_create(&tls, &names).unwrap();
        assert_ne!(renewed.fingerprint, created.fingerprint);
    }

    #[test]
    fn constant_time_eq_compares_whole_values() {
        assert!(constant_time_eq(b"token", b"token"));
        assert!(!constant_time_eq(b"token", b"tokem"));
        assert!(!constant_time_eq(b"token", b"token2"));
    }
}
