//! JSON state consumed by the Omarchy Quickshell plugin.

use base64::{Engine, engine::general_purpose::STANDARD};
use qrcode::{QrCode, render::svg};
use serde::Serialize;
use std::collections::BTreeMap;

use crate::{
    actions::capability,
    diagnostics::{DiagnosticsSummary, diagnostics_summary},
    host_contract::{CapabilityStatus, HostContract, current_host_contract},
    input::InputCapabilities,
    settings::RuntimeSettings,
};

#[derive(Debug, Clone, Serialize)]
pub struct PairingLinks {
    #[serde(rename = "preferredUrl")]
    pub preferred_url: String,
    #[serde(rename = "qrCodeDataUrl")]
    pub qr_code_data_url: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
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
    pub protocol: ProtocolState,
    pub diagnostics: DiagnosticsSummary,
    pub contract: HostContract,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProtocolState {
    pub version: u16,
    #[serde(rename = "inputCapabilities")]
    pub input_capabilities: InputCapabilities,
}

pub fn host_surface_state(
    settings: &RuntimeSettings,
    backend_running: bool,
    backend_reason: Option<String>,
    include_pairing_token: bool,
    input_ready: bool,
    input_error: Option<String>,
) -> HostSurfaceState {
    let contract = current_host_contract();
    let diagnostics = diagnostics_summary(
        settings,
        backend_running,
        backend_reason.as_deref(),
        input_ready,
        input_error.as_deref(),
    );
    HostSurfaceState {
        pairing: pairing_links(settings, include_pairing_token),
        server_status: ServerStatus {
            host: settings.hostname.clone(),
            port: settings.port,
            bind_address: settings.bind_host.clone(),
            token_enabled: !settings.token.trim().is_empty(),
            running: backend_running,
            reason: backend_reason,
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
                Some("Managed by the tappad-host systemd user service."),
            ),
        },
        actions: contract.action_capabilities.clone(),
        protocol: ProtocolState {
            version: contract.protocol_version,
            input_capabilities: contract.input_capabilities.clone(),
        },
        diagnostics,
        contract,
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
    let preferred_url = lan_url.clone().unwrap_or_else(|| local_url.clone());
    PairingLinks {
        qr_code_data_url: qr_code_data_url(&preferred_url),
        preferred_url,
        lan_url,
        local_url,
        token: include_pairing_token.then(|| settings.token.clone()),
    }
}

fn qr_code_data_url(text: &str) -> String {
    let Ok(code) = QrCode::new(text.as_bytes()) else {
        return String::new();
    };
    let image = code
        .render::<svg::Color>()
        .min_dimensions(260, 260)
        .dark_color(svg::Color("#171917"))
        .light_color(svg::Color("#ffffff"))
        .build();

    format!("data:image/svg+xml;base64,{}", STANDARD.encode(image))
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
    use crate::{
        actions::action_capabilities, host_contract::HOST_CONTRACT_VERSION,
        protocol::PROTOCOL_VERSION,
    };

    fn test_settings() -> RuntimeSettings {
        RuntimeSettings {
            bind_host: "0.0.0.0".to_string(),
            port: 8765,
            token: "pair-token".to_string(),
            host_id: "host-id".to_string(),
            hostname: "desktop".to_string(),
            launch_at_login: true,
            lan_host: None,
        }
    }

    #[test]
    fn pairing_state_includes_pairing_token() {
        let state = host_surface_state(&test_settings(), true, None, true, true, None);

        assert_eq!(state.pairing.token.as_deref(), Some("pair-token"));
        assert_eq!(
            state.pairing.preferred_url,
            "http://tappad-host-id.local:8765/?token=pair-token"
        );
        assert!(
            state
                .pairing
                .qr_code_data_url
                .starts_with("data:image/svg+xml;base64,")
        );
        assert!(state.server_status.token_enabled);
        assert_eq!(state.protocol.version, PROTOCOL_VERSION);
        assert_eq!(state.contract.version, HOST_CONTRACT_VERSION);
        assert_eq!(state.contract.protocol_version, state.protocol.version);
        assert_eq!(state.contract.action_capabilities, state.actions);
        assert_eq!(
            state.contract.input_capabilities,
            state.protocol.input_capabilities
        );
        assert_eq!(
            state
                .protocol
                .input_capabilities
                .pointer_button
                .is_supported(),
            cfg!(target_os = "linux")
        );
    }

    #[test]
    fn http_state_is_sanitized() {
        let state = host_surface_state(&test_settings(), true, None, false, true, None);

        assert!(state.pairing.token.is_none());
        assert_eq!(
            state.pairing.preferred_url,
            "http://tappad-host-id.local:8765/"
        );
        assert!(state.server_status.token_enabled);
    }

    #[test]
    fn stopped_backend_exposes_reason() {
        let state = host_surface_state(
            &test_settings(),
            false,
            Some("port 8765 is already in use".to_string()),
            true,
            true,
            None,
        );

        assert!(!state.server_status.running);
        assert_eq!(
            state.server_status.reason.as_deref(),
            Some("port 8765 is already in use")
        );
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
