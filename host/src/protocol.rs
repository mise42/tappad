//! Browser-to-Host protocol messages.

use serde::{Deserialize, Serialize};

use crate::{host_contract::HostContract, input::InputCapabilities};

pub const PROTOCOL_VERSION: u16 = 2;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "move")]
    Move { dx: f64, dy: f64 },
    #[serde(rename = "wheel")]
    Wheel { dy: f64 },
    #[serde(rename = "click")]
    Click {
        button: String,
        #[serde(default = "default_click_count", rename = "clickCount")]
        click_count: u8,
    },
    #[serde(rename = "pointerButton")]
    PointerButton { button: String, down: bool },
    #[serde(rename = "key")]
    Key {
        code: String,
        #[serde(default)]
        down: bool,
    },
    #[serde(rename = "text")]
    Text { value: String },
    #[serde(rename = "paste")]
    Paste { value: String },
    #[serde(rename = "cmd")]
    Cmd { action: String },
    #[serde(rename = "authorize")]
    Authorize { password: String },
}

fn default_click_count() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "ready")]
    Ready {
        host: String,
        time: u64,
        #[serde(rename = "protocolVersion")]
        protocol_version: u16,
        #[serde(rename = "inputCapabilities")]
        input_capabilities: InputCapabilities,
        contract: HostContract,
    },
    #[serde(rename = "error")]
    Error { code: &'static str, message: String },
    #[serde(rename = "actionResult")]
    ActionResult {
        action: String,
        status: &'static str,
        message: String,
    },
    #[serde(rename = "authorizationResult")]
    AuthorizationResult {
        status: &'static str,
        message: String,
    },
}

impl ServerMessage {
    pub fn ready(host: String, contract: HostContract) -> Self {
        Self::Ready {
            host,
            time: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            protocol_version: contract.protocol_version,
            input_capabilities: contract.input_capabilities.clone(),
            contract,
        }
    }

    pub fn error(code: &'static str, message: impl Into<String>) -> Self {
        Self::Error {
            code,
            message: message.into(),
        }
    }

    pub fn action_result(
        action: impl Into<String>,
        status: &'static str,
        message: impl Into<String>,
    ) -> Self {
        Self::ActionResult {
            action: action.into(),
            status,
            message: message.into(),
        }
    }

    pub fn authorization_result(status: &'static str, message: impl Into<String>) -> Self {
        Self::AuthorizationResult {
            status,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_contract::{HOST_CONTRACT_VERSION, current_host_contract};

    #[test]
    fn ready_advertises_protocol_and_input_capabilities() {
        let contract = current_host_contract();
        let expected_workspace_state = contract.action_capabilities["workspace.1"].state;
        let value = serde_json::to_value(ServerMessage::ready("host".to_string(), contract))
            .expect("ready JSON");

        assert_eq!(value["type"], "ready");
        assert_eq!(value["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(value["contract"]["version"], HOST_CONTRACT_VERSION);
        assert_eq!(value["contract"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(
            value["inputCapabilities"]["pointerButton"]["state"],
            if cfg!(target_os = "linux") {
                "supported"
            } else {
                "unsupported"
            }
        );
        assert_eq!(
            value["contract"]["actionCapabilities"]["workspace.1"]["state"],
            expected_workspace_state
        );
    }

    #[test]
    fn unknown_message_types_are_rejected_instead_of_coerced() {
        let error = serde_json::from_str::<ClientMessage>(r#"{"type":"pointerMystery"}"#)
            .expect_err("unknown message must fail");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn action_result_is_additive_and_names_the_completed_action() {
        let value = serde_json::to_value(ServerMessage::action_result(
            "codex.voice.start",
            "sent",
            "Configured hotkey dispatched.",
        ))
        .expect("action result JSON");

        assert_eq!(
            value,
            serde_json::json!({
                "type": "actionResult",
                "action": "codex.voice.start",
                "status": "sent",
                "message": "Configured hotkey dispatched."
            })
        );
    }

    #[test]
    fn authorization_result_reports_submission_without_claiming_success() {
        let value = serde_json::to_value(ServerMessage::authorization_result(
            "submitted",
            "Authorization input was submitted.",
        ))
        .expect("authorization result JSON");

        assert_eq!(value["type"], "authorizationResult");
        assert_eq!(value["status"], "submitted");
        assert!(value.get("success").is_none());
    }
}
