use serde::Serialize;

const POLKIT_LAYER_NAMESPACE: &str = "omarchy-polkit";
pub const PASSWORD_LIMIT_BYTES: usize = 1_024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationState {
    pub supported: bool,
    pub request_active: bool,
}

impl AuthorizationState {
    pub const fn unavailable() -> Self {
        Self {
            supported: false,
            request_active: false,
        }
    }
}

pub fn valid_password(password: &str) -> bool {
    !password.is_empty()
        && password.len() <= PASSWORD_LIMIT_BYTES
        && password
            .bytes()
            .all(|byte| byte.is_ascii_graphic() || byte == b' ')
}

#[cfg(target_os = "linux")]
pub async fn current_state() -> AuthorizationState {
    use tokio::{
        process::Command,
        time::{Duration, timeout},
    };

    let output = timeout(
        Duration::from_millis(750),
        Command::new("hyprctl").args(["layers", "-j"]).output(),
    )
    .await;

    let Ok(Ok(output)) = output else {
        return AuthorizationState::unavailable();
    };
    if !output.status.success() {
        return AuthorizationState::unavailable();
    }

    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return AuthorizationState::unavailable();
    };
    let request_active = contains_polkit_layer(&value);
    AuthorizationState {
        supported: true,
        request_active,
    }
}

#[cfg(not(target_os = "linux"))]
pub async fn current_state() -> AuthorizationState {
    AuthorizationState::unavailable()
}

fn contains_polkit_layer(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(fields) => {
            fields.get("namespace").and_then(serde_json::Value::as_str)
                == Some(POLKIT_LAYER_NAMESPACE)
                || fields.values().any(contains_polkit_layer)
        }
        serde_json::Value::Array(values) => values.iter().any(contains_polkit_layer),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_bounded_non_empty_ascii_passwords() {
        assert!(valid_password("correct horse battery staple"));
        assert!(!valid_password(""));
        assert!(!valid_password("密码"));
        assert!(!valid_password("password\n"));
        assert!(!valid_password(&"a".repeat(PASSWORD_LIMIT_BYTES + 1)));
    }

    #[test]
    fn detects_only_the_live_omarchy_polkit_layer() {
        let active = serde_json::json!({
            "DP-1": {"levels": {"3": [{"namespace": "omarchy-polkit"}]}}
        });
        let idle = serde_json::json!({
            "DP-1": {"levels": {"2": [{"namespace": "omarchy-bar"}]}}
        });

        assert!(contains_polkit_layer(&active));
        assert!(!contains_polkit_layer(&idle));
    }
}
