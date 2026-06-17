use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs, io,
    net::Ipv4Addr,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize)]
pub struct PairingLinks {
    #[serde(rename = "preferredUrl")]
    pub preferred_url: String,
    #[serde(rename = "lanUrl")]
    pub lan_url: Option<String>,
    #[serde(rename = "localUrl")]
    pub local_url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub host: String,
    pub port: u16,
    #[serde(rename = "bindAddress")]
    pub bind_address: String,
    #[serde(rename = "tokenEnabled")]
    pub token_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityStatus {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadinessGroup {
    pub title: &'static str,
    pub items: Vec<ReadinessItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReadinessItem {
    pub label: &'static str,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SettingsSummary {
    pub port: u16,
    #[serde(rename = "tokenSummary")]
    pub token_summary: String,
    #[serde(rename = "launchAtLogin")]
    pub launch_at_login: CapabilityStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostSurfaceState {
    pub pairing: PairingLinks,
    #[serde(rename = "serverStatus")]
    pub server_status: ServerStatus,
    pub readiness: Vec<ReadinessGroup>,
    pub settings: SettingsSummary,
    pub actions: BTreeMap<String, CapabilityStatus>,
}

#[derive(Debug, Clone)]
pub struct RuntimeSettings {
    pub bind_host: String,
    pub port: u16,
    pub token: String,
    pub hostname: String,
}

impl RuntimeSettings {
    pub fn pairing_links(&self) -> PairingLinks {
        let local_url = control_url(&self.hostname, self.port, &self.token);
        let lan_url =
            preferred_lan_ipv4().map(|ip| control_url(&ip.to_string(), self.port, &self.token));
        PairingLinks {
            preferred_url: lan_url.clone().unwrap_or_else(|| local_url.clone()),
            lan_url,
            local_url,
            token: self.token.clone(),
        }
    }

    pub fn server_status(&self) -> ServerStatus {
        ServerStatus {
            host: self.hostname.clone(),
            port: self.port,
            bind_address: self.bind_host.clone(),
            token_enabled: !self.token.trim().is_empty(),
        }
    }
}

pub fn resolve_runtime_settings(token_store_dir: &Path) -> io::Result<RuntimeSettings> {
    let bind_host = std::env::var("TOUCHPAD_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("TOUCHPAD_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8765u16);
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "localhost".to_string());
    let token = resolve_token(token_store_dir)?;

    Ok(RuntimeSettings {
        bind_host,
        port,
        token,
        hostname,
    })
}

pub fn resolve_token(token_store_dir: &Path) -> io::Result<String> {
    if let Ok(token) = std::env::var("TOUCHPAD_TOKEN") {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let token_path = token_store_path(token_store_dir);
    if let Ok(token) = fs::read_to_string(&token_path) {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let token = generate_token();
    persist_token(token_store_dir, &token)?;
    Ok(token)
}

pub fn reset_token(token_store_dir: &Path) -> io::Result<String> {
    let token = generate_token();
    persist_token(token_store_dir, &token)?;
    Ok(token)
}

pub fn persist_token(token_store_dir: &Path, token: &str) -> io::Result<()> {
    fs::create_dir_all(token_store_dir)?;
    fs::write(token_store_path(token_store_dir), format!("{token}\n"))
}

pub fn host_surface_state(settings: &RuntimeSettings) -> HostSurfaceState {
    let actions = action_capabilities();
    HostSurfaceState {
        pairing: settings.pairing_links(),
        server_status: settings.server_status(),
        readiness: readiness_groups(),
        settings: SettingsSummary {
            port: settings.port,
            token_summary: "Token saved on this PC".to_string(),
            launch_at_login: CapabilityStatus {
                state: "manual",
                note: Some("Launch at login is still manual in the Windows beta.".to_string()),
            },
        },
        actions,
    }
}

pub fn action_capabilities() -> BTreeMap<String, CapabilityStatus> {
    [
        ("screenrecord.screen", capability("downgraded", Some("Windows beta does not save recordings into Videos\\TapPad yet. Use Xbox Game Bar capture on the PC for now."))),
        ("screenrecord.window", capability("downgraded", Some("Windows beta does not ship dedicated active-window capture yet. Use Xbox Game Bar on the PC for now."))),
        ("screenrecord.screen.audio", capability("downgraded", Some("Windows beta does not ship TapPad-managed desktop-plus-mic capture yet. Use Xbox Game Bar audio capture on the PC for now."))),
        ("screenrecord.stop", capability("downgraded", Some("Stop recording from Xbox Game Bar on the PC until TapPad-managed capture lands."))),
        ("screenrecord.screen.webcam", capability("hidden", None)),
        ("open_recordings_folder", capability("supported", None)),
        ("screenshot", capability("supported", None)),
        ("close_window", capability("supported", None)),
        ("app_launcher", capability("supported", None)),
        ("nightlight.toggle", capability("downgraded", Some("Windows beta opens Night light settings instead of toggling immediately."))),
        ("lock_screen", capability("supported", None)),
        ("media.prev", capability("supported", None)),
        ("media.play_pause", capability("supported", None)),
        ("media.next", capability("supported", None)),
        ("media.volume_down", capability("supported", None)),
        ("media.mute", capability("supported", None)),
        ("media.volume_up", capability("supported", None)),
    ]
    .into_iter()
    .map(|(name, status)| (name.to_string(), status))
    .collect()
}

pub fn render_mobile_index(html: &str, actions: &BTreeMap<String, CapabilityStatus>) -> String {
    let manifest = serde_json::to_string(actions).unwrap_or_else(|_| "{}".to_string());
    let script = format!("<script>window.__TAPPAD_ACTIONS__ = {manifest};</script>");
    html.replace(
        r#"<script src="/app.js?v11"></script>"#,
        &format!("{script}\n    <script src=\"/app.js?v11\"></script>"),
    )
}

fn capability(state: &'static str, note: Option<&str>) -> CapabilityStatus {
    CapabilityStatus {
        state,
        note: note.map(ToString::to_string),
    }
}

fn readiness_groups() -> Vec<ReadinessGroup> {
    vec![
        ReadinessGroup {
            title: "Core input readiness",
            items: vec![
                readiness("Pointer", "ready", None),
                readiness("Keyboard", "ready", None),
                readiness("Text transfer", "ready", None),
                readiness("Paste", "ready", None),
            ],
        },
        ReadinessGroup {
            title: "Action readiness",
            items: vec![
                readiness("Screenshot", "ready", None),
                readiness(
                    "Recording",
                    "degraded",
                    Some("Use Xbox Game Bar until TapPad-managed recording ships on Windows."),
                ),
                readiness(
                    "Audio capture",
                    "degraded",
                    Some("Desktop-plus-mic capture is still handled outside TapPad on Windows."),
                ),
                readiness("Window control", "ready", None),
                readiness(
                    "Night Light",
                    "degraded",
                    Some(
                        "TapPad opens Night light settings instead of toggling immediately in the Windows beta.",
                    ),
                ),
                readiness("Media control", "ready", None),
            ],
        },
    ]
}

fn readiness(label: &'static str, state: &'static str, note: Option<&str>) -> ReadinessItem {
    ReadinessItem {
        label,
        state,
        note: note.map(ToString::to_string),
    }
}

fn control_url(host: &str, port: u16, token: &str) -> String {
    format!("http://{host}:{port}/?token={token}")
}

fn token_store_path(dir: &Path) -> PathBuf {
    dir.join("pairing-token.txt")
}

fn preferred_lan_ipv4() -> Option<Ipv4Addr> {
    local_ip_address::local_ip().ok().and_then(|ip| match ip {
        std::net::IpAddr::V4(v4) if !v4.is_loopback() => Some(v4),
        _ => None,
    })
}

fn generate_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let bytes = nanos.to_be_bytes();
    base64_url(bytes)
}

fn base64_url(bytes: [u8; 16]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::new();
    let mut value = 0u32;
    let mut bits = 0u8;

    for byte in bytes {
        value = (value << 8) | u32::from(byte);
        bits += 8;
        while bits >= 6 {
            bits -= 6;
            let index = ((value >> bits) & 0x3f) as usize;
            output.push(ALPHABET[index] as char);
        }
    }

    if bits > 0 {
        let index = ((value << (6 - bits)) & 0x3f) as usize;
        output.push(ALPHABET[index] as char);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_index_injects_windows_action_manifest() {
        let html = r#"<html><body><script src="/app.js?v11"></script></body></html>"#;
        let rendered = render_mobile_index(html, &action_capabilities());

        assert!(rendered.contains("window.__TAPPAD_ACTIONS__"));
        assert!(rendered.contains("screenrecord.screen.webcam"));
        assert!(rendered.contains("\"state\":\"hidden\""));
    }

    #[test]
    fn token_is_persisted_when_missing() {
        let dir = tempfile::tempdir().expect("tempdir");

        let token = resolve_token(dir.path()).expect("token");

        assert!(!token.is_empty());
        let stored =
            fs::read_to_string(dir.path().join("pairing-token.txt")).expect("stored token");
        assert_eq!(stored.trim(), token);
    }
}
