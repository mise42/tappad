use std::{
    fs, io,
    net::{IpAddr, Ipv4Addr},
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    pub bind_host: String,
    pub port: u16,
    pub token: String,
    pub hostname: String,
    pub launch_at_login: bool,
    #[serde(skip)]
    pub lan_host: Option<Ipv4Addr>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub port: u16,
    pub token: String,
    pub launch_at_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    port: u16,
    token: String,
    launch_at_login: bool,
}

impl RuntimeSettings {
    pub fn from_store(data_dir: &Path, launch_at_login: bool) -> io::Result<Self> {
        let stored = read_stored_settings(data_dir)?;
        Ok(Self {
            bind_host: "0.0.0.0".to_string(),
            port: stored.port,
            token: stored.token,
            hostname: hostname(),
            launch_at_login,
            lan_host: preferred_lan_ipv4(),
        })
    }

    pub fn with_update(&self, update: SettingsUpdate) -> io::Result<Self> {
        validate_port(update.port)?;
        let token = normalize_token(update.token)?;
        Ok(Self {
            bind_host: "0.0.0.0".to_string(),
            port: update.port,
            token,
            hostname: self.hostname.clone(),
            launch_at_login: update.launch_at_login,
            lan_host: self.lan_host,
        })
    }

    pub fn with_new_token(&self) -> Self {
        Self {
            token: generate_pairing_token(),
            ..self.clone()
        }
    }

    pub fn local_url(&self, include_token: bool) -> String {
        control_url(
            &self.hostname,
            self.port,
            include_token.then_some(&self.token),
        )
    }

    pub fn lan_url(&self, include_token: bool) -> Option<String> {
        self.lan_host.map(|host| {
            control_url(
                &host.to_string(),
                self.port,
                include_token.then_some(&self.token),
            )
        })
    }
}

pub fn persist_settings(data_dir: &Path, settings: &RuntimeSettings) -> io::Result<()> {
    fs::create_dir_all(data_dir)?;
    let stored = StoredSettings {
        port: settings.port,
        token: settings.token.clone(),
        launch_at_login: settings.launch_at_login,
    };
    let text = serde_json::to_string_pretty(&stored)?;
    fs::write(settings_path(data_dir), text)
}

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

fn read_stored_settings(data_dir: &Path) -> io::Result<StoredSettings> {
    let path = settings_path(data_dir);
    if let Ok(text) = fs::read_to_string(&path) {
        if let Ok(settings) = serde_json::from_str::<StoredSettings>(&text) {
            let token = normalize_token(settings.token)?;
            validate_port(settings.port)?;
            return Ok(StoredSettings { token, ..settings });
        }
    }

    let settings = StoredSettings {
        port: 8765,
        token: generate_pairing_token(),
        launch_at_login: false,
    };
    fs::create_dir_all(data_dir)?;
    fs::write(&path, serde_json::to_string_pretty(&settings)?)?;
    Ok(settings)
}

fn validate_port(port: u16) -> io::Result<()> {
    if port == 0 {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Port must be between 1 and 65535.",
        ))
    } else {
        Ok(())
    }
}

fn normalize_token(token: String) -> io::Result<String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Pairing token is required.",
        ))
    } else {
        Ok(token)
    }
}

fn control_url(host: &str, port: u16, token: Option<&String>) -> String {
    let suffix = token
        .map(|token| format!("?token={token}"))
        .unwrap_or_default();
    format!("http://{host}:{port}/{suffix}")
}

fn preferred_lan_ipv4() -> Option<Ipv4Addr> {
    local_ip_address::local_ip().ok().and_then(|ip| match ip {
        IpAddr::V4(v4) if !v4.is_loopback() => Some(v4),
        _ => None,
    })
}

fn hostname() -> String {
    if let Ok(name) = std::env::var("COMPUTERNAME") {
        let name = name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }

    if let Ok(name) = std::env::var("HOSTNAME") {
        let name = name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }

    #[cfg(target_os = "linux")]
    if let Ok(hostname) = fs::read_to_string("/proc/sys/kernel/hostname") {
        let hostname = hostname.trim();
        if !hostname.is_empty() {
            return hostname.to_string();
        }
    }

    "localhost".to_string()
}

pub fn generate_pairing_token() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("failed to generate pairing token");
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_token_is_mandatory_and_url_safe() {
        let token = generate_pairing_token();

        assert_eq!(token.len(), 22);
        assert!(
            token
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
        );
    }

    #[test]
    fn settings_are_created_when_missing() {
        let dir = tempfile::tempdir().expect("tempdir");

        let settings = RuntimeSettings::from_store(dir.path(), false).expect("settings");

        assert_eq!(settings.port, 8765);
        assert!(!settings.token.is_empty());
        assert!(settings_path(dir.path()).exists());
    }

    #[test]
    fn empty_token_update_is_rejected() {
        let settings = RuntimeSettings {
            bind_host: "0.0.0.0".to_string(),
            port: 8765,
            token: "token".to_string(),
            hostname: "host".to_string(),
            launch_at_login: false,
            lan_host: None,
        };

        assert!(
            settings
                .with_update(SettingsUpdate {
                    port: 8766,
                    token: " ".to_string(),
                    launch_at_login: false,
                })
                .is_err()
        );
    }
}
