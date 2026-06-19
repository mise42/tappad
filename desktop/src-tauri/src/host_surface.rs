use serde::Serialize;
use std::collections::BTreeMap;

use crate::{
    actions::{CapabilityStatus, action_capabilities, capability},
    settings::RuntimeSettings,
};

#[derive(Debug, Clone, Serialize)]
pub struct PairingLinks {
    #[serde(rename = "preferredUrl")]
    pub preferred_url: String,
    #[serde(rename = "lanUrl")]
    pub lan_url: Option<String>,
    #[serde(rename = "localUrl")]
    pub local_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
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
    pub running: bool,
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

pub fn host_surface_state(
    settings: &RuntimeSettings,
    backend_running: bool,
    include_pairing_token: bool,
) -> HostSurfaceState {
    HostSurfaceState {
        pairing: pairing_links(settings, include_pairing_token),
        server_status: ServerStatus {
            host: settings.hostname.clone(),
            port: settings.port,
            bind_address: settings.bind_host.clone(),
            token_enabled: !settings.token.trim().is_empty(),
            running: backend_running,
        },
        readiness: readiness_groups(),
        settings: SettingsSummary {
            port: settings.port,
            token_summary: "Pairing token saved locally".to_string(),
            launch_at_login: capability(
                if settings.launch_at_login {
                    "enabled"
                } else {
                    "disabled"
                },
                Some("Managed by the Tauri autostart plugin."),
            ),
        },
        actions: action_capabilities(),
    }
}

pub fn render_mobile_index(html: &str, actions: &BTreeMap<String, CapabilityStatus>) -> String {
    let manifest = serde_json::to_string(actions).unwrap_or_else(|_| "{}".to_string());
    let script = format!("<script>window.__TAPPAD_ACTIONS__ = {manifest};</script>");
    html.replace("</head>", &format!("{script}\n</head>"))
}

fn pairing_links(settings: &RuntimeSettings, include_pairing_token: bool) -> PairingLinks {
    let local_url = settings.local_url(include_pairing_token);
    let lan_url = settings.lan_url(include_pairing_token);
    PairingLinks {
        preferred_url: lan_url.clone().unwrap_or_else(|| local_url.clone()),
        lan_url,
        local_url,
        token: include_pairing_token.then(|| settings.token.clone()),
    }
}

fn readiness_groups() -> Vec<ReadinessGroup> {
    #[cfg(target_os = "linux")]
    {
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

    #[cfg(target_os = "windows")]
    {
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
                        Some(
                            "Desktop-plus-mic capture is still handled outside TapPad on Windows.",
                        ),
                    ),
                    readiness("Window control", "ready", None),
                    readiness(
                        "Night Light",
                        "degraded",
                        Some("TapPad opens Night light settings instead of toggling immediately."),
                    ),
                    readiness("Media control", "ready", None),
                ],
            },
        ]
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        vec![ReadinessGroup {
            title: "Desktop host readiness",
            items: vec![readiness(
                "Unified Tauri host",
                "deferred",
                Some(
                    "This host surface targets Linux and Windows; macOS keeps the native host surface.",
                ),
            )],
        }]
    }
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

    fn test_settings() -> RuntimeSettings {
        RuntimeSettings {
            bind_host: "0.0.0.0".to_string(),
            port: 8765,
            token: "pair-token".to_string(),
            hostname: "desktop".to_string(),
            launch_at_login: true,
            lan_host: None,
        }
    }

    #[test]
    fn tauri_state_includes_pairing_token() {
        let state = host_surface_state(&test_settings(), true, true);

        assert_eq!(state.pairing.token.as_deref(), Some("pair-token"));
        assert_eq!(
            state.pairing.preferred_url,
            "http://desktop:8765/?token=pair-token"
        );
        assert!(state.server_status.token_enabled);
    }

    #[test]
    fn http_state_is_sanitized() {
        let state = host_surface_state(&test_settings(), true, false);

        assert!(state.pairing.token.is_none());
        assert_eq!(state.pairing.preferred_url, "http://desktop:8765/");
        assert!(state.server_status.token_enabled);
    }

    #[test]
    fn mobile_index_injects_action_manifest() {
        let rendered = render_mobile_index(
            r#"<html><head><script src="/app.js"></script></head></html>"#,
            &action_capabilities(),
        );

        assert!(rendered.contains("window.__TAPPAD_ACTIONS__"));
        assert!(rendered.contains("screenrecord.screen"));
        assert!(rendered.contains(r#"<script src="/app.js"></script>"#));
    }
}
