use crate::commands::CommandRegistry;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct PairingLinks {
    #[serde(rename = "preferredUrl")]
    pub preferred_url: String,
    #[serde(rename = "localUrl")]
    pub local_url: String,
    pub token: Option<String>,
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
    pub token: Option<String>,
    pub hostname: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalHostSettings {
    port: u16,
    token: Option<String>,
}

impl RuntimeSettings {
    pub fn from_env() -> Self {
        let local_settings = read_local_host_settings(&local_settings_path());
        Self::from_sources(
            std::env::var("TOUCHPAD_HOST").ok(),
            std::env::var("TOUCHPAD_PORT").ok(),
            std::env::var("TOUCHPAD_TOKEN").ok(),
            local_settings,
            crate::get_hostname(),
        )
    }

    fn from_sources(
        env_host: Option<String>,
        env_port: Option<String>,
        env_token: Option<String>,
        local_settings: Option<LocalHostSettings>,
        hostname: String,
    ) -> Self {
        let bind_host = env_host.unwrap_or_else(|| "0.0.0.0".to_string());
        let port = env_port
            .and_then(|value| value.parse().ok())
            .or_else(|| local_settings.as_ref().map(|settings| settings.port))
            .unwrap_or(8765u16);
        let token = env_token
            .or_else(|| local_settings.and_then(|settings| settings.token))
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        Self {
            bind_host,
            port,
            token,
            hostname,
        }
    }

    pub fn pairing_links(&self) -> PairingLinks {
        let token_suffix = self
            .token
            .as_deref()
            .map(|token| format!("?token={token}"))
            .unwrap_or_default();
        let local_url = format!("http://{}:{}{}", self.hostname, self.port, token_suffix);

        PairingLinks {
            preferred_url: local_url.clone(),
            local_url,
            token: self.token.clone(),
        }
    }

    pub fn server_status(&self) -> ServerStatus {
        ServerStatus {
            host: self.hostname.clone(),
            port: self.port,
            bind_address: self.bind_host.clone(),
            token_enabled: self.token.is_some(),
        }
    }
}

fn local_settings_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".config")
        .join("tappad")
        .join("linux-host-settings.json")
}

fn read_local_host_settings(path: &Path) -> Option<LocalHostSettings> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn host_surface_state(
    settings: &RuntimeSettings,
    commands: &CommandRegistry,
) -> HostSurfaceState {
    HostSurfaceState {
        pairing: settings.pairing_links(),
        server_status: settings.server_status(),
        readiness: readiness_groups(),
        settings: SettingsSummary {
            port: settings.port,
            token_summary: if settings.token.is_some() {
                "Pairing token configured".to_string()
            } else {
                "No pairing token configured".to_string()
            },
            launch_at_login: CapabilityStatus {
                state: "manual",
                note: Some(
                    "Install the systemd user service to launch TapPad at login.".to_string(),
                ),
            },
        },
        actions: action_capabilities(commands),
    }
}

pub fn action_capabilities(commands: &CommandRegistry) -> BTreeMap<String, CapabilityStatus> {
    commands
        .actions()
        .map(|action| {
            let status = match action {
                "screenrecord.screen.webcam" => capability(
                    "deferred",
                    Some("Visible on Linux/Omarchy when webcam tooling and a free video device are available."),
                ),
                _ => capability("supported", None),
            };
            (action.to_string(), status)
        })
        .collect()
}

pub fn render_mobile_index(html: &str, actions: &BTreeMap<String, CapabilityStatus>) -> String {
    let manifest = serde_json::to_string(actions).unwrap_or_else(|_| "{}".to_string());
    let script = format!("<script>window.__TAPPAD_ACTIONS__ = {manifest};</script>");
    html.replace("</head>", &format!("{script}\n</head>"))
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
                readiness("Recording", "ready", None),
                readiness("Audio capture", "ready", None),
                readiness("Window control", "ready", None),
                readiness("Night Light", "ready", None),
                readiness("Media control", "ready", None),
            ],
        },
        ReadinessGroup {
            title: "Deferred action readiness",
            items: vec![readiness(
                "Webcam recording",
                "deferred",
                Some("Requires v4l2, ffplay, and an available webcam device."),
            )],
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn host_surface_reports_linux_action_parity_and_deferred_webcam() {
        let commands = CommandRegistry::new();
        let settings = RuntimeSettings {
            bind_host: "0.0.0.0".to_string(),
            port: 8765,
            token: Some("test-token".to_string()),
            hostname: "omarchy".to_string(),
        };

        let state = host_surface_state(&settings, &commands);

        assert_eq!(
            state.pairing.preferred_url,
            "http://omarchy:8765?token=test-token"
        );
        assert_eq!(state.server_status.host, "omarchy");
        assert!(state.server_status.token_enabled);
        assert_eq!(state.actions["screenrecord.screen"].state, "supported");
        assert_eq!(
            state.actions["screenrecord.screen.audio"].state,
            "supported"
        );
        assert_eq!(
            state.actions["screenrecord.screen.webcam"].state,
            "deferred"
        );
        assert!(
            state
                .readiness
                .iter()
                .any(|group| group.title == "Deferred action readiness")
        );
    }

    #[test]
    fn mobile_index_injects_linux_action_manifest() {
        let html = r#"<html><head><script src="/app.js"></script></head><body></body></html>"#;
        let rendered = render_mobile_index(html, &action_capabilities(&CommandRegistry::new()));

        assert!(rendered.contains("window.__TAPPAD_ACTIONS__"));
        assert!(rendered.contains("screenrecord.screen.webcam"));
        assert!(rendered.contains("\"state\":\"deferred\""));
        assert!(rendered.contains(r#"<script src="/app.js"></script>"#));
    }

    #[test]
    fn runtime_settings_use_saved_gui_settings_when_env_is_absent() {
        let settings = RuntimeSettings::from_sources(
            None,
            None,
            None,
            Some(LocalHostSettings {
                port: 9876,
                token: Some("saved-token".to_string()),
            }),
            "omarchy".to_string(),
        );

        assert_eq!(settings.bind_host, "0.0.0.0");
        assert_eq!(settings.port, 9876);
        assert_eq!(settings.token.as_deref(), Some("saved-token"));
        assert_eq!(
            settings.pairing_links().preferred_url,
            "http://omarchy:9876?token=saved-token"
        );
    }

    #[test]
    fn environment_still_overrides_saved_gui_settings() {
        let settings = RuntimeSettings::from_sources(
            Some("127.0.0.1".to_string()),
            Some("8766".to_string()),
            Some("env-token".to_string()),
            Some(LocalHostSettings {
                port: 9876,
                token: Some("saved-token".to_string()),
            }),
            "omarchy".to_string(),
        );

        assert_eq!(settings.bind_host, "127.0.0.1");
        assert_eq!(settings.port, 8766);
        assert_eq!(settings.token.as_deref(), Some("env-token"));
    }

    #[test]
    fn runtime_reads_the_same_linux_host_settings_file_as_the_gui() {
        let path = PathBuf::from(std::env::temp_dir()).join(format!(
            "tappad-runtime-host-settings-{}.json",
            std::process::id()
        ));
        std::fs::write(
            &path,
            r#"{"hostStateUrl":"http://127.0.0.1:9999/api/host-state","port":9999,"token":"file-token","launchAtLogin":true}"#,
        )
        .expect("write settings");

        let settings = read_local_host_settings(&path).expect("read settings");
        let _ = std::fs::remove_file(path);

        assert_eq!(settings.port, 9999);
        assert_eq!(settings.token.as_deref(), Some("file-token"));
    }
}
