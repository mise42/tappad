use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    process::Command,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{input::InputDevice, settings::RuntimeSettings};

const PRODUCT_SUPPORTED: &str = "supported";
const PRODUCT_DEGRADED: &str = "degraded";
const PRODUCT_UNSUPPORTED: &str = "unsupported";

const RUNTIME_READY: &str = "ready";
const RUNTIME_MISSING_DEPENDENCY: &str = "missing_dependency";
const RUNTIME_PERMISSION_NEEDED: &str = "permission_needed";
const RUNTIME_FAILED: &str = "failed";
const RUNTIME_UNKNOWN: &str = "unknown";

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsSummary {
    #[serde(rename = "copyText")]
    pub copy_text: String,
    pub capabilities: Vec<DiagnosticCapability>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticCapability {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    #[serde(rename = "productStatus")]
    pub product_status: &'static str,
    #[serde(rename = "runtimeStatus")]
    pub runtime_status: &'static str,
    pub evidence: Vec<String>,
    #[serde(rename = "lastAttemptAt", skip_serializing_if = "Option::is_none")]
    pub last_attempt_at: Option<String>,
    #[serde(rename = "lastSuccessAt", skip_serializing_if = "Option::is_none")]
    pub last_success_at: Option<String>,
    #[serde(rename = "lastFailureAt", skip_serializing_if = "Option::is_none")]
    pub last_failure_at: Option<String>,
    #[serde(rename = "lastFailureSummary", skip_serializing_if = "Option::is_none")]
    pub last_failure_summary: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct AttemptMetadata {
    last_attempt_at: Option<String>,
    last_success_at: Option<String>,
    last_failure_at: Option<String>,
    last_failure_summary: Option<String>,
}

static ATTEMPTS: OnceLock<Mutex<BTreeMap<String, AttemptMetadata>>> = OnceLock::new();

pub fn diagnostics_summary(
    settings: &RuntimeSettings,
    backend_running: bool,
    backend_reason: Option<&str>,
    input_ready: bool,
    input_error: Option<&str>,
) -> DiagnosticsSummary {
    let capabilities = diagnostics_capabilities(
        settings,
        backend_running,
        backend_reason,
        input_ready,
        input_error,
    );
    let copy_text = copy_summary(&capabilities);
    DiagnosticsSummary {
        copy_text,
        capabilities,
    }
}

pub fn record_action_attempt(action: &str) {
    mutate_attempt(action, |attempt| {
        attempt.last_attempt_at = Some(now_timestamp());
    });
}

pub fn record_action_success(action: &str) {
    mutate_attempt(action, |attempt| {
        attempt.last_success_at = Some(now_timestamp());
    });
}

pub fn record_action_failure(action: &str, error: &str) {
    mutate_attempt(action, |attempt| {
        let now = now_timestamp();
        attempt.last_failure_at = Some(now);
        attempt.last_failure_summary = Some(sanitize_failure_summary(error));
    });
}

fn diagnostics_capabilities(
    settings: &RuntimeSettings,
    backend_running: bool,
    backend_reason: Option<&str>,
    input_ready: bool,
    input_error: Option<&str>,
) -> Vec<DiagnosticCapability> {
    #[cfg(target_os = "linux")]
    {
        linux_capabilities(
            settings,
            backend_running,
            backend_reason,
            input_ready,
            input_error,
        )
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = settings;
        let _ = backend_running;
        let _ = backend_reason;
        let _ = input_ready;
        let _ = input_error;
        Vec::new()
    }
}

#[cfg(target_os = "linux")]
fn linux_capabilities(
    settings: &RuntimeSettings,
    backend_running: bool,
    backend_reason: Option<&str>,
    input_ready: bool,
    input_error: Option<&str>,
) -> Vec<DiagnosticCapability> {
    let input_status = if input_ready {
        RuntimeEvidence::ready("InputDevice::new() succeeded")
    } else {
        RuntimeEvidence::failed(input_error.unwrap_or("InputDevice::new() failed"))
    };
    let lan_status = settings
        .lan_host
        .map(|host| RuntimeEvidence::ready(format!("LAN IPv4 discovered: {host}")))
        .unwrap_or_else(|| RuntimeEvidence::unknown("no non-loopback LAN IPv4 discovered"));
    let server_status = if backend_running {
        RuntimeEvidence::ready(format!(
            "backend server listening on {}:{}",
            settings.bind_host, settings.port
        ))
    } else {
        RuntimeEvidence::failed(backend_reason.unwrap_or("backend server is not running"))
    };

    vec![
        capability(
            "backend_server",
            "Backend server",
            "Pairing and server",
            PRODUCT_SUPPORTED,
            server_status,
        ),
        capability(
            "lan_pairing_url",
            "LAN pairing URL",
            "Pairing and server",
            PRODUCT_SUPPORTED,
            lan_status,
        ),
        capability(
            "token_gated_websocket",
            "Token-gated WebSocket",
            "Pairing and server",
            PRODUCT_SUPPORTED,
            if settings.token.trim().is_empty() {
                RuntimeEvidence::failed("pairing token is empty")
            } else {
                RuntimeEvidence::ready("pairing token is configured")
            },
        ),
        capability(
            "pointer_move",
            "Pointer move",
            "Core input",
            PRODUCT_SUPPORTED,
            input_status.clone(),
        ),
        capability(
            "click",
            "Click",
            "Core input",
            PRODUCT_SUPPORTED,
            input_status.clone(),
        ),
        capability(
            "scroll",
            "Scroll",
            "Core input",
            PRODUCT_SUPPORTED,
            input_status.clone(),
        ),
        capability(
            "keyboard_key",
            "Keyboard key",
            "Core input",
            PRODUCT_SUPPORTED,
            input_status.clone(),
        ),
        capability(
            "type_text",
            "Type text",
            "Core input",
            PRODUCT_DEGRADED,
            input_status
                .with_evidence("Linux direct typing is ASCII-oriented; paste covers richer text"),
        ),
        capability(
            "paste_text",
            "Paste text",
            "Text transfer",
            PRODUCT_SUPPORTED,
            command_status("wl-copy"),
        ),
        capability(
            "screenshot",
            "Screenshot",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            all_commands_status(&["omarchy"]),
        ),
        capability(
            "screenrecord.screen",
            "Screen recording",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            all_commands_status(&["gpu-screen-recorder", "hyprctl", "jq"]),
        ),
        capability(
            "screenrecord.window",
            "Window recording",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            all_commands_status(&["gpu-screen-recorder", "hyprctl", "jq"]),
        ),
        capability(
            "screenrecord.screen.audio",
            "Screen recording with audio",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            all_commands_status(&["gpu-screen-recorder", "hyprctl", "jq"]),
        ),
        capability(
            "screenrecord.stop",
            "Stop recording",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            all_commands_status(&[
                "omarchy",
                "gpu-screen-recorder",
                "ffmpeg",
                "ffprobe",
                "waybar",
                "notify-send",
            ]),
        ),
        capability(
            "open_recordings_folder",
            "Open recordings folder",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("xdg-open"),
        ),
        capability(
            "close_window",
            "Close window",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("hyprctl"),
        ),
        capability(
            "app_launcher",
            "App launcher",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("walker"),
        ),
        capability(
            "lock_screen",
            "Lock screen",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("omarchy"),
        ),
        capability(
            "media.prev",
            "Previous media",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("playerctl"),
        ),
        capability(
            "media.play_pause",
            "Play/pause media",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("playerctl"),
        ),
        capability(
            "media.next",
            "Next media",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("playerctl"),
        ),
        capability(
            "media.volume_down",
            "Volume down",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("wpctl"),
        ),
        capability(
            "media.mute",
            "Mute volume",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("wpctl"),
        ),
        capability(
            "media.volume_up",
            "Volume up",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            command_status("wpctl"),
        ),
        capability(
            "screenrecord.screen.webcam",
            "Webcam recording",
            "Desktop actions",
            PRODUCT_SUPPORTED,
            webcam_recording_status(),
        ),
        capability(
            "tray_availability",
            "Tray availability",
            "Host surface runtime",
            PRODUCT_SUPPORTED,
            RuntimeEvidence::unknown("tray availability is reported through runtime logs"),
        ),
        capability(
            "launch_at_login",
            "Launch at login",
            "Host surface runtime",
            PRODUCT_SUPPORTED,
            if settings.launch_at_login {
                RuntimeEvidence::ready("launch at login is enabled")
            } else {
                RuntimeEvidence::ready("launch at login is disabled")
            },
        ),
        capability(
            "settings_persistence",
            "Settings persistence",
            "Host surface runtime",
            PRODUCT_SUPPORTED,
            RuntimeEvidence::ready("settings loaded from the app data directory"),
        ),
        capability(
            "unsupported_placeholder",
            "Unsupported placeholder",
            "Hidden",
            PRODUCT_UNSUPPORTED,
            RuntimeEvidence::unknown("hidden from normal diagnostics"),
        ),
    ]
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone)]
struct RuntimeEvidence {
    status: &'static str,
    evidence: Vec<String>,
}

#[cfg(target_os = "linux")]
#[derive(Debug, Clone)]
struct CommandChecks {
    all_found: bool,
    evidence: Vec<String>,
}

#[cfg(target_os = "linux")]
impl RuntimeEvidence {
    fn ready(evidence: impl Into<String>) -> Self {
        Self {
            status: RUNTIME_READY,
            evidence: vec![evidence.into()],
        }
    }

    fn failed(evidence: impl Into<String>) -> Self {
        Self {
            status: RUNTIME_FAILED,
            evidence: vec![evidence.into()],
        }
    }

    fn unknown(evidence: impl Into<String>) -> Self {
        Self {
            status: RUNTIME_UNKNOWN,
            evidence: vec![evidence.into()],
        }
    }

    fn with_evidence(mut self, evidence: impl Into<String>) -> Self {
        self.evidence.push(evidence.into());
        self
    }
}

#[cfg(target_os = "linux")]
fn command_status(command: &str) -> RuntimeEvidence {
    command_checks(&[command]).into_runtime()
}

#[cfg(target_os = "linux")]
fn all_commands_status(commands: &[&str]) -> RuntimeEvidence {
    command_checks(commands).into_runtime()
}

#[cfg(target_os = "linux")]
impl CommandChecks {
    fn into_runtime(self) -> RuntimeEvidence {
        RuntimeEvidence {
            status: if self.all_found {
                RUNTIME_READY
            } else {
                RUNTIME_MISSING_DEPENDENCY
            },
            evidence: self.evidence,
        }
    }
}

#[cfg(target_os = "linux")]
fn command_checks(commands: &[&str]) -> CommandChecks {
    let mut all_found = true;
    let mut evidence = Vec::new();
    for command in commands {
        if command_exists(command) {
            evidence.push(format!("found command: {command}"));
        } else {
            all_found = false;
            evidence.push(format!("missing command: {command}"));
        }
    }
    CommandChecks {
        all_found,
        evidence,
    }
}

#[cfg(target_os = "linux")]
fn webcam_status() -> RuntimeEvidence {
    let command_checks = command_checks(&["v4l2-ctl", "ffplay", "lsof"]);
    let mut evidence = command_checks.evidence;
    let has_video_device = has_video_device();
    if has_video_device {
        evidence.push("found device: /dev/video*".to_string());
    } else {
        evidence.push("missing device: /dev/video*".to_string());
    }
    RuntimeEvidence {
        status: if command_checks.all_found && has_video_device {
            RUNTIME_READY
        } else {
            RUNTIME_MISSING_DEPENDENCY
        },
        evidence,
    }
}

#[cfg(target_os = "linux")]
fn webcam_recording_status() -> RuntimeEvidence {
    let recording_checks = command_checks(&["gpu-screen-recorder", "hyprctl", "jq"]);
    let webcam_status = webcam_status();
    let mut evidence = recording_checks.evidence;
    evidence.extend(webcam_status.evidence);
    RuntimeEvidence {
        status: if recording_checks.all_found && webcam_status.status == RUNTIME_READY {
            RUNTIME_READY
        } else {
            RUNTIME_MISSING_DEPENDENCY
        },
        evidence,
    }
}

#[cfg(target_os = "linux")]
fn command_exists(command: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {command} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn has_video_device() -> bool {
    fs::read_dir(Path::new("/dev"))
        .map(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                entry
                    .file_name()
                    .to_str()
                    .map(|name| name.starts_with("video"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn capability(
    id: &'static str,
    label: &'static str,
    group: &'static str,
    product_status: &'static str,
    runtime: RuntimeEvidence,
) -> DiagnosticCapability {
    debug_assert!(is_valid_runtime_status(runtime.status));
    let attempt = attempt_for(id);
    DiagnosticCapability {
        id,
        label,
        group,
        product_status,
        runtime_status: runtime.status,
        evidence: runtime.evidence,
        last_attempt_at: attempt.last_attempt_at,
        last_success_at: attempt.last_success_at,
        last_failure_at: attempt.last_failure_at,
        last_failure_summary: attempt.last_failure_summary,
    }
}

fn is_valid_runtime_status(status: &str) -> bool {
    matches!(
        status,
        RUNTIME_READY
            | RUNTIME_MISSING_DEPENDENCY
            | RUNTIME_PERMISSION_NEEDED
            | RUNTIME_FAILED
            | RUNTIME_UNKNOWN
    )
}

fn mutate_attempt(id: &str, update: impl FnOnce(&mut AttemptMetadata)) {
    let attempts = ATTEMPTS.get_or_init(|| Mutex::new(BTreeMap::new()));
    let Ok(mut attempts) = attempts.lock() else {
        return;
    };
    update(attempts.entry(id.to_string()).or_default());
}

fn attempt_for(id: &str) -> AttemptMetadata {
    ATTEMPTS
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .ok()
        .and_then(|attempts| attempts.get(id).cloned())
        .unwrap_or_default()
}

fn copy_summary(capabilities: &[DiagnosticCapability]) -> String {
    let mut lines = vec!["TapPad local diagnostics".to_string()];
    for capability in capabilities
        .iter()
        .filter(|capability| capability.product_status != PRODUCT_UNSUPPORTED)
    {
        lines.push(format!(
            "- {} [{}]: runtime={}, product={}",
            capability.label,
            capability.group,
            capability.runtime_status,
            capability.product_status
        ));
        for evidence in &capability.evidence {
            lines.push(format!("  evidence: {evidence}"));
        }
        if let Some(at) = &capability.last_attempt_at {
            lines.push(format!("  lastAttemptAt: {at}"));
        }
        if let Some(at) = &capability.last_success_at {
            lines.push(format!("  lastSuccessAt: {at}"));
        }
        if let Some(at) = &capability.last_failure_at {
            lines.push(format!("  lastFailureAt: {at}"));
        }
        if let Some(summary) = &capability.last_failure_summary {
            lines.push(format!("  lastFailureSummary: {summary}"));
        }
    }
    lines.join("\n")
}

fn sanitize_failure_summary(error: &str) -> String {
    let mut sanitized = error
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("command failed")
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>();
    if sanitized.len() > 180 {
        let mut limit = 180;
        while limit > 0 && !sanitized.is_char_boundary(limit) {
            limit -= 1;
        }
        sanitized.truncate(limit);
        sanitized.push_str("...");
    }
    sanitized
}

fn now_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    seconds.to_string()
}

pub fn input_device_probe() -> (bool, Option<String>) {
    match InputDevice::new() {
        Ok(_) => (true, None),
        Err(error) => (false, Some(sanitize_failure_summary(&error.to_string()))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_summary_is_bounded_and_single_line() {
        let summary = sanitize_failure_summary(&format!("{}\nsecret", "x".repeat(220)));

        assert!(summary.len() <= 183);
        assert!(!summary.contains('\n'));
    }

    #[test]
    fn failure_summary_truncates_on_utf8_char_boundary() {
        let summary = sanitize_failure_summary(&"界".repeat(80));

        assert!(summary.len() <= 183);
        assert!(summary.ends_with("..."));
        assert!(summary.is_char_boundary(summary.len()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn command_checks_tracks_missing_status_without_parsing_evidence() {
        let checks = command_checks(&["definitely-not-a-tappad-command"]);

        assert!(!checks.all_found);
        assert_eq!(checks.into_runtime().status, RUNTIME_MISSING_DEPENDENCY);
    }

    #[test]
    fn copy_summary_hides_unsupported_capabilities() {
        let summary = copy_summary(&[DiagnosticCapability {
            id: "hidden",
            label: "Hidden",
            group: "Hidden",
            product_status: PRODUCT_UNSUPPORTED,
            runtime_status: RUNTIME_UNKNOWN,
            evidence: vec!["hidden from normal diagnostics".to_string()],
            last_attempt_at: None,
            last_success_at: None,
            last_failure_at: None,
            last_failure_summary: None,
        }]);

        assert!(!summary.contains("Hidden ["));
    }

    #[test]
    fn runtime_status_constants_match_issue_contract() {
        assert_eq!(RUNTIME_READY, "ready");
        assert_eq!(RUNTIME_MISSING_DEPENDENCY, "missing_dependency");
        assert_eq!(RUNTIME_PERMISSION_NEEDED, "permission_needed");
        assert_eq!(RUNTIME_FAILED, "failed");
        assert_eq!(RUNTIME_UNKNOWN, "unknown");
    }
}
