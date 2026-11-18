//! Named Omarchy desktop actions exposed through the Host Contract.

use std::{collections::BTreeMap, fmt, future::Future, pin::Pin, sync::Arc};

use crate::host_contract::{ACTION_IDS, CapabilityStatus};

#[cfg(target_os = "linux")]
mod linux;

#[cfg(not(target_os = "linux"))]
struct UnsupportedActionAdapter;

#[cfg(not(target_os = "linux"))]
impl DesktopActionAdapter for UnsupportedActionAdapter {
    fn platform_name(&self) -> &'static str {
        "Non-Omarchy"
    }

    fn capability(&self, _action: &str) -> CapabilityStatus {
        capability(
            "unavailable",
            Some("Desktop Actions require the Omarchy target backend."),
        )
    }

    fn execute<'a>(&'a self, action: &'a str) -> ActionFuture<'a> {
        Box::pin(async move {
            Err(ActionError::unavailable(
                "Non-Omarchy",
                action,
                "Desktop Actions require the Omarchy target backend.",
            ))
        })
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

pub(crate) type ActionFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), ActionError>> + Send + 'a>>;

pub(crate) trait DesktopActionAdapter: Send + Sync {
    fn platform_name(&self) -> &'static str;
    fn capability(&self, action: &str) -> CapabilityStatus;
    fn execute<'a>(&'a self, action: &'a str) -> ActionFuture<'a>;
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
        let capabilities = ACTION_IDS
            .iter()
            .map(|action| ((*action).to_string(), self.adapter.capability(action)))
            .collect::<BTreeMap<_, _>>();
        debug_assert!(
            capabilities
                .values()
                .all(|capability| crate::host_contract::CAPABILITY_STATES
                    .contains(&capability.state))
        );
        capabilities
    }

    pub async fn run(&self, action: &str) -> Result<(), ActionError> {
        self.validate(action)?;
        self.adapter.execute(action).await
    }

    pub(crate) fn validate(&self, action: &str) -> Result<(), ActionError> {
        if !ACTION_IDS.contains(&action) {
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

    #[cfg(not(target_os = "linux"))]
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

    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
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

#[cfg(target_os = "linux")]
pub(super) async fn run_shell_command(
    platform: &'static str,
    action: &str,
    command: &str,
) -> Result<(), ActionError> {
    let output = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .await
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_contract::CAPABILITY_STATES;

    struct StubAdapter {
        state: &'static str,
        note: Option<&'static str>,
    }

    fn assert_adapter_contract(adapter: Arc<dyn DesktopActionAdapter>) {
        let actions = DesktopActions::new(adapter);
        let capabilities = actions.capabilities();

        assert_eq!(capabilities.len(), ACTION_IDS.len());
        for action in ACTION_IDS {
            let capability = capabilities
                .get(*action)
                .unwrap_or_else(|| panic!("adapter omitted {action}"));
            assert!(
                CAPABILITY_STATES.contains(&capability.state),
                "{action} has unknown state {}",
                capability.state
            );
        }
    }

    #[test]
    fn every_target_adapter_satisfies_the_shared_capability_catalog() {
        #[cfg(target_os = "linux")]
        assert_adapter_contract(Arc::new(linux::LinuxActionAdapter));

        #[cfg(not(target_os = "linux"))]
        assert_adapter_contract(Arc::new(UnsupportedActionAdapter));
    }

    impl DesktopActionAdapter for StubAdapter {
        fn platform_name(&self) -> &'static str {
            "Test"
        }

        fn capability(&self, _action: &str) -> CapabilityStatus {
            capability(self.state, self.note)
        }

        fn execute<'a>(&'a self, _action: &'a str) -> ActionFuture<'a> {
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn every_registered_action_has_a_platform_capability() {
        let capabilities = action_capabilities();

        for action in ACTION_IDS {
            assert!(capabilities.contains_key(*action), "missing {action}");
        }
        assert_eq!(capabilities.len(), ACTION_IDS.len());
        assert!(!capabilities.contains_key("raw-shell"));
    }

    #[test]
    fn workspace_actions_are_part_of_the_shared_contract() {
        let capabilities = action_capabilities();

        for action in ACTION_IDS
            .iter()
            .filter(|action| action.starts_with("workspace."))
        {
            assert!(capabilities.contains_key(*action), "missing {action}");
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
    fn shared_workspace_actions_are_valid_when_the_adapter_supports_them() {
        let actions = DesktopActions::new(Arc::new(StubAdapter {
            state: "supported",
            note: None,
        }));

        assert_eq!(actions.validate("workspace.1"), Ok(()));
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
