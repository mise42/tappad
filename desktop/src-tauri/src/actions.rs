use std::{collections::BTreeMap, fmt, future::Future, pin::Pin, sync::Arc};

use serde::Serialize;
use tokio::sync::Mutex;

use crate::input::InputDevice;

#[cfg(target_os = "linux")]
mod codex;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(any(target_os = "macos", test))]
mod macos;
#[cfg(any(target_os = "windows", test))]
mod windows;

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityStatus {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<&'static str>,
    #[serde(rename = "reasonCode", skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<String>,
}

impl CapabilityStatus {
    fn is_runnable(&self) -> bool {
        matches!(self.state, "supported" | "deferred")
    }
}

pub const UI_ACTION_IDS: &[&str] = &[
    "screenrecord.screen",
    "screenrecord.window",
    "screenrecord.screen.audio",
    "screenrecord.screen.webcam",
    "screenrecord.stop",
    "open_recordings_folder",
    "screenshot",
    "close_window",
    "app_launcher",
    "lock_screen",
    "media.prev",
    "media.play_pause",
    "media.next",
    "media.volume_down",
    "media.mute",
    "media.volume_up",
];

pub const ACTION_IDS: &[&str] = &[
    "screenrecord.screen",
    "screenrecord.window",
    "screenrecord.screen.audio",
    "screenrecord.screen.webcam",
    "screenrecord.stop",
    "open_recordings_folder",
    "screenshot",
    "close_window",
    "app_launcher",
    "lock_screen",
    "media.prev",
    "media.play_pause",
    "media.next",
    "media.volume_down",
    "media.mute",
    "media.volume_up",
    "codex.voice.start",
    "codex.voice.start_foreground",
    "codex.voice.end",
    "codex.voice.toggle_microphone",
];

pub const OMARCHY_ACTION_IDS: &[&str] = &[
    "workspace.previous",
    "workspace.former",
    "workspace.next",
    "workspace.1",
    "workspace.2",
    "workspace.3",
    "workspace.4",
    "workspace.5",
];

pub fn reports_execution_result(action: &str) -> bool {
    matches!(
        action,
        "codex.voice.start"
            | "codex.voice.start_foreground"
            | "codex.voice.end"
            | "codex.voice.toggle_microphone"
    )
}

pub fn execution_success_message(action: &str) -> Option<&'static str> {
    match action {
        "codex.voice.start" => Some(
            "The Host dispatched Codex's configured voice hotkey. Voice session status is not confirmed.",
        ),
        "codex.voice.start_foreground" => Some(
            "The Host sent Codex's effective foreground Voice Chat shortcut while Codex was foreground. Voice session status is not confirmed.",
        ),
        "codex.voice.end" => Some(
            "The Host sent Codex's configured End Voice Chat shortcut while Codex was foreground. Voice session status is not confirmed.",
        ),
        "codex.voice.toggle_microphone" => Some(
            "The Host sent Codex's configured microphone shortcut while Codex was foreground. Microphone state is not confirmed.",
        ),
        _ => None,
    }
}

pub(crate) type ActionFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), ActionError>> + Send + 'a>>;

pub(crate) trait DesktopActionAdapter: Send + Sync {
    fn platform_name(&self) -> &'static str;
    fn additional_action_ids(&self) -> &'static [&'static str] {
        &[]
    }
    fn capability(&self, action: &str) -> CapabilityStatus;
    fn execute<'a>(&'a self, input: Arc<Mutex<InputDevice>>, action: &'a str) -> ActionFuture<'a>;
}

pub(crate) struct DesktopActions {
    adapter: Arc<dyn DesktopActionAdapter>,
}

impl DesktopActions {
    fn new(adapter: Arc<dyn DesktopActionAdapter>) -> Self {
        Self { adapter }
    }

    pub fn capabilities(&self) -> BTreeMap<String, CapabilityStatus> {
        debug_assert!(
            UI_ACTION_IDS
                .iter()
                .all(|action| ACTION_IDS.contains(action))
        );
        ACTION_IDS
            .iter()
            .chain(self.adapter.additional_action_ids())
            .map(|action| ((*action).to_string(), self.adapter.capability(action)))
            .collect()
    }

    pub async fn run(
        &self,
        input: Arc<Mutex<InputDevice>>,
        action: &str,
    ) -> Result<(), ActionError> {
        self.validate(action)?;
        self.adapter.execute(input, action).await
    }

    pub(crate) fn validate(&self, action: &str) -> Result<(), ActionError> {
        if !ACTION_IDS.contains(&action) && !self.adapter.additional_action_ids().contains(&action)
        {
            return Err(ActionError::unknown(action));
        }

        let capability = self.adapter.capability(action);
        if capability.is_runnable() {
            return Ok(());
        }

        let reason = capability
            .note
            .unwrap_or_else(|| format!("capability is {}", capability.state));
        Err(ActionError::unavailable(
            self.adapter.platform_name(),
            action,
            reason,
        ))
    }
}

pub(crate) fn platform_actions() -> DesktopActions {
    #[cfg(target_os = "linux")]
    {
        DesktopActions::new(Arc::new(linux::LinuxActionAdapter))
    }

    #[cfg(target_os = "macos")]
    {
        DesktopActions::new(Arc::new(macos::MacOsActionAdapter))
    }

    #[cfg(target_os = "windows")]
    {
        DesktopActions::new(Arc::new(windows::WindowsActionAdapter))
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        DesktopActions::new(Arc::new(UnsupportedActionAdapter))
    }
}

pub fn action_capabilities() -> BTreeMap<String, CapabilityStatus> {
    platform_actions().capabilities()
}

pub fn capability(state: &'static str, note: Option<&str>) -> CapabilityStatus {
    CapabilityStatus {
        state,
        note: note.map(ToString::to_string),
        scope: None,
        reason_code: None,
        binding: None,
    }
}

pub fn scoped_capability(
    state: &'static str,
    note: impl Into<String>,
    scope: &'static str,
    reason_code: Option<&'static str>,
) -> CapabilityStatus {
    CapabilityStatus {
        state,
        note: Some(note.into()),
        scope: Some(scope),
        reason_code,
        binding: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ActionError {
    Unknown {
        action: String,
    },
    Unavailable {
        platform: &'static str,
        action: String,
        reason: String,
    },
    Failed {
        platform: &'static str,
        action: String,
        detail: String,
    },
}

impl ActionError {
    pub(super) fn unknown(action: &str) -> Self {
        Self::Unknown {
            action: action.to_string(),
        }
    }

    pub(super) fn unavailable(
        platform: &'static str,
        action: &str,
        reason: impl Into<String>,
    ) -> Self {
        Self::Unavailable {
            platform,
            action: action.to_string(),
            reason: reason.into(),
        }
    }

    pub(super) fn failed(platform: &'static str, action: &str, detail: impl fmt::Display) -> Self {
        Self::Failed {
            platform,
            action: action.to_string(),
            detail: detail.to_string(),
        }
    }
}

impl fmt::Display for ActionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown { action } => write!(formatter, "unknown desktop action: {action}"),
            Self::Unavailable {
                platform,
                action,
                reason,
            } => write!(
                formatter,
                "{platform} desktop action {action} is unavailable: {reason}"
            ),
            Self::Failed {
                platform,
                action,
                detail,
            } => write!(
                formatter,
                "{platform} desktop action {action} failed: {detail}"
            ),
        }
    }
}

impl std::error::Error for ActionError {}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub(super) async fn run_shell_command(
    platform: &'static str,
    action: &str,
    command: &str,
) -> Result<(), ActionError> {
    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .arg("/C")
            .arg(command)
            .output()
            .await
    } else {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .output()
            .await
    }
    .map_err(|error| ActionError::failed(platform, action, error))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stderr.is_empty() {
        format!("command exited with {}", output.status)
    } else {
        stderr
    };
    Err(ActionError::failed(platform, action, detail))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
struct UnsupportedActionAdapter;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
impl DesktopActionAdapter for UnsupportedActionAdapter {
    fn platform_name(&self) -> &'static str {
        "Unsupported platform"
    }

    fn capability(&self, _action: &str) -> CapabilityStatus {
        capability(
            "deferred",
            Some("The unified Tauri host ships for Linux, macOS, and Windows."),
        )
    }

    fn execute<'a>(&'a self, _input: Arc<Mutex<InputDevice>>, action: &'a str) -> ActionFuture<'a> {
        Box::pin(async move {
            Err(ActionError::unavailable(
                self.platform_name(),
                action,
                "TapPad desktop actions require Linux, macOS, or Windows",
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubAdapter {
        state: &'static str,
        note: Option<&'static str>,
    }

    impl DesktopActionAdapter for StubAdapter {
        fn platform_name(&self) -> &'static str {
            "Test"
        }

        fn capability(&self, _action: &str) -> CapabilityStatus {
            capability(self.state, self.note)
        }

        fn execute<'a>(
            &'a self,
            _input: Arc<Mutex<InputDevice>>,
            _action: &'a str,
        ) -> ActionFuture<'a> {
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn every_registered_action_has_a_platform_capability() {
        let capabilities = action_capabilities();

        for action in ACTION_IDS {
            assert!(capabilities.contains_key(*action), "missing {action}");
        }
        #[cfg(target_os = "linux")]
        assert_eq!(
            capabilities.len(),
            ACTION_IDS.len() + OMARCHY_ACTION_IDS.len()
        );
        #[cfg(not(target_os = "linux"))]
        assert_eq!(capabilities.len(), ACTION_IDS.len());
        assert!(!capabilities.contains_key("raw-shell"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn omarchy_workspace_actions_are_advertised_as_supported() {
        let capabilities = action_capabilities();

        for action in OMARCHY_ACTION_IDS {
            assert_eq!(
                capabilities.get(*action).map(|capability| capability.state),
                Some("supported"),
                "missing supported capability for {action}"
            );
        }
    }

    #[test]
    fn current_ui_actions_remain_a_compatible_registry_subset() {
        for action in UI_ACTION_IDS {
            assert!(
                ACTION_IDS.contains(action),
                "UI action {action} is unregistered"
            );
        }
        assert_eq!(
            ACTION_IDS
                .iter()
                .filter(|action| action.starts_with("codex.voice."))
                .count(),
            4
        );
    }

    #[test]
    fn every_codex_voice_action_reports_dispatch_completion_without_claiming_state() {
        for action in [
            "codex.voice.start",
            "codex.voice.start_foreground",
            "codex.voice.end",
            "codex.voice.toggle_microphone",
        ] {
            assert!(reports_execution_result(action));
            let message = execution_success_message(action).expect("Codex dispatch copy");
            assert!(message.contains("Host"));
            assert!(message.contains("not confirmed"));
        }
        assert!(!reports_execution_result("media.mute"));
        assert_eq!(execution_success_message("media.mute"), None);
    }

    #[test]
    fn capability_metadata_is_additive_for_existing_clients() {
        let legacy = serde_json::to_value(capability("supported", None)).expect("serialize");
        assert_eq!(legacy, serde_json::json!({ "state": "supported" }));

        let scoped = serde_json::to_value(scoped_capability(
            "unavailable",
            "app-only",
            "app",
            Some("codex_app_scope_only"),
        ))
        .expect("serialize");
        assert_eq!(
            scoped,
            serde_json::json!({
                "state": "unavailable",
                "note": "app-only",
                "scope": "app",
                "reasonCode": "codex_app_scope_only"
            })
        );

        let mut bound = scoped_capability("supported", "configured", "os-global", None);
        bound.binding = Some("Command+F3".to_string());
        assert_eq!(
            serde_json::to_value(bound).expect("serialize bound capability"),
            serde_json::json!({
                "state": "supported",
                "note": "configured",
                "scope": "os-global",
                "binding": "Command+F3"
            })
        );
    }

    #[test]
    fn unknown_actions_fail_before_reaching_the_adapter() {
        let actions = DesktopActions::new(Arc::new(StubAdapter {
            state: "supported",
            note: None,
        }));

        assert_eq!(
            actions.validate("raw-shell"),
            Err(ActionError::Unknown {
                action: "raw-shell".to_string(),
            })
        );
    }

    #[test]
    fn platform_specific_actions_require_adapter_advertisement() {
        let actions = DesktopActions::new(Arc::new(StubAdapter {
            state: "supported",
            note: None,
        }));

        assert_eq!(
            actions.validate("workspace.1"),
            Err(ActionError::Unknown {
                action: "workspace.1".to_string(),
            })
        );
    }

    #[test]
    fn non_runnable_capability_explains_the_failure() {
        let actions = DesktopActions::new(Arc::new(StubAdapter {
            state: "hidden",
            note: Some("not implemented by this adapter"),
        }));

        assert_eq!(
            actions.validate("screenrecord.screen"),
            Err(ActionError::Unavailable {
                platform: "Test",
                action: "screenrecord.screen".to_string(),
                reason: "not implemented by this adapter".to_string(),
            })
        );
    }
}
