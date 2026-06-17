use crate::commands::CommandRegistry;
use serde::Serialize;
use std::collections::BTreeMap;

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

impl RuntimeSettings {
    pub fn from_env() -> Self {
        let bind_host = std::env::var("TOUCHPAD_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port = std::env::var("TOUCHPAD_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(8765u16);
        let token = std::env::var("TOUCHPAD_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        Self {
            bind_host,
            port,
            token,
            hostname: crate::get_hostname(),
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
                "Token provided by TOUCHPAD_TOKEN".to_string()
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
}
