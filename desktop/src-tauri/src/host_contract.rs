use std::collections::BTreeMap;

use serde::Serialize;

use crate::{
    actions::action_capabilities,
    input::{InputCapabilities, input_capabilities},
    protocol::PROTOCOL_VERSION,
};

pub const HOST_CONTRACT_VERSION: u16 = 1;
pub const CAPABILITY_STATES: &[&str] = &[
    "supported",
    "downgraded",
    "deferred",
    "hidden",
    "unavailable",
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
    "workspace.previous",
    "workspace.former",
    "workspace.next",
    "workspace.1",
    "workspace.2",
    "workspace.3",
    "workspace.4",
    "workspace.5",
    "codex.voice.start",
    "codex.voice.start_foreground",
    "codex.voice.end",
    "codex.voice.toggle_microphone",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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
    pub(crate) fn is_runnable(&self) -> bool {
        matches!(self.state, "supported" | "deferred")
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct HostContract {
    pub version: u16,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u16,
    #[serde(rename = "inputCapabilities")]
    pub input_capabilities: InputCapabilities,
    #[serde(rename = "actionCapabilities")]
    pub action_capabilities: BTreeMap<String, CapabilityStatus>,
}

pub fn current_host_contract() -> HostContract {
    HostContract {
        version: HOST_CONTRACT_VERSION,
        protocol_version: PROTOCOL_VERSION,
        input_capabilities: input_capabilities(),
        action_capabilities: action_capabilities(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_action_catalog_has_no_duplicates_or_raw_shell_escape() {
        let unique = ACTION_IDS
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), ACTION_IDS.len());
        assert!(!unique.contains("raw-shell"));
    }

    #[test]
    fn current_contract_advertises_every_shared_action() {
        let contract = current_host_contract();

        assert_eq!(contract.version, HOST_CONTRACT_VERSION);
        assert_eq!(contract.protocol_version, PROTOCOL_VERSION);
        assert_eq!(contract.action_capabilities.len(), ACTION_IDS.len());
        for action in ACTION_IDS {
            assert!(
                contract.action_capabilities.contains_key(*action),
                "missing capability advertisement for {action}"
            );
        }
        for (action, capability) in contract.action_capabilities {
            assert!(
                CAPABILITY_STATES.contains(&capability.state),
                "{action} has unknown capability state {}",
                capability.state
            );
        }
    }
}
