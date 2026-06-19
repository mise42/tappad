use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinuxHostSettings {
    host_state_url: String,
    port: u16,
    token: Option<String>,
    launch_at_login: bool,
}

impl Default for LinuxHostSettings {
    fn default() -> Self {
        Self {
            host_state_url: "http://127.0.0.1:8765/api/host-state".to_string(),
            port: 8765,
            token: None,
            launch_at_login: false,
        }
    }
}

impl LinuxHostSettings {
    fn with_host_state_url(mut self) -> Self {
        self.host_state_url = format!("http://127.0.0.1:{}/api/host-state", self.port);
        self
    }
}

#[derive(Debug)]
struct SettingsStore {
    path: PathBuf,
    settings: Mutex<LinuxHostSettings>,
}

#[tauri::command]
fn get_local_settings(store: State<'_, SettingsStore>) -> LinuxHostSettings {
    store
        .settings
        .lock()
        .expect("settings lock poisoned")
        .clone()
}

#[tauri::command]
fn save_local_settings(
    port: u16,
    token: Option<String>,
    launch_at_login: bool,
    store: State<'_, SettingsStore>,
) -> Result<LinuxHostSettings, String> {
    if port == 0 {
        return Err("Port must be between 1 and 65535.".to_string());
    }

    let token = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let next = LinuxHostSettings {
        port,
        token,
        launch_at_login,
        ..LinuxHostSettings::default()
    }
    .with_host_state_url();

    write_settings(&store.path, &next)?;
    *store.settings.lock().expect("settings lock poisoned") = next.clone();
    Ok(next)
}

#[tauri::command]
fn reset_pairing_token(store: State<'_, SettingsStore>) -> LinuxHostSettings {
    let generated = generate_pairing_token();
    let mut settings = store.settings.lock().expect("settings lock poisoned");
    settings.token = Some(generated);
    let _ = write_settings(&store.path, &settings);
    settings.clone()
}

#[tauri::command]
fn load_host_state(
    url: Option<String>,
    store: State<'_, SettingsStore>,
) -> Result<serde_json::Value, String> {
    let endpoint = host_state_endpoint(url, &store)?;
    let state = fetch_host_state(&endpoint)?;
    remember_host_state_endpoint(endpoint, &store);
    Ok(state)
}

fn main() {
    let settings_path = settings_path();
    let settings = read_settings(&settings_path).unwrap_or_default();

    tauri::Builder::default()
        .manage(SettingsStore {
            path: settings_path,
            settings: Mutex::new(settings),
        })
        .invoke_handler(tauri::generate_handler![
            get_local_settings,
            save_local_settings,
            reset_pairing_token,
            load_host_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TapPad Linux host surface");
}

fn generate_pairing_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("tappad-{nanos:x}")
}

fn settings_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".config")
        .join("tappad")
        .join("linux-host-settings.json")
}

fn read_settings(path: &PathBuf) -> Option<LinuxHostSettings> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_settings(path: &PathBuf, settings: &LinuxHostSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create settings directory: {error}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to encode settings: {error}"))?;
    fs::write(path, text).map_err(|error| format!("Failed to save settings: {error}"))
}

fn fetch_host_state(url: &str) -> Result<serde_json::Value, String> {
    let (host, port, path) = parse_local_http_url(url)?;
    let mut stream = TcpStream::connect((host.as_str(), port))
        .map_err(|error| format!("Linux runtime unavailable: {error}"))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Failed to request host state: {error}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| format!("Failed to read host state: {error}"))?;

    let (headers, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Linux runtime returned an invalid HTTP response.".to_string())?;
    let status_line = headers.lines().next().unwrap_or_default();
    if !status_line.contains(" 200 ") {
        return Err(format!("Linux runtime returned {status_line}."));
    }

    serde_json::from_str(body).map_err(|error| format!("Invalid host-state JSON: {error}"))
}

fn host_state_endpoint(
    requested_url: Option<String>,
    store: &SettingsStore,
) -> Result<String, String> {
    let endpoint = requested_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            store
                .settings
                .lock()
                .expect("settings lock poisoned")
                .host_state_url
                .clone()
        });
    parse_local_http_url(&endpoint)?;
    Ok(endpoint)
}

fn remember_host_state_endpoint(endpoint: String, store: &SettingsStore) {
    let mut settings = store.settings.lock().expect("settings lock poisoned");
    if settings.host_state_url == endpoint {
        return;
    }

    settings.host_state_url = endpoint;
    let _ = write_settings(&store.path, &settings);
}

fn parse_local_http_url(url: &str) -> Result<(String, u16, String), String> {
    let rest = url
        .strip_prefix("http://")
        .ok_or_else(|| "Host-state endpoint must use http://.".to_string())?;
    let (authority, path) = rest.split_once('/').unwrap_or((rest, "api/host-state"));
    let (host, port) = authority
        .rsplit_once(':')
        .ok_or_else(|| "Host-state endpoint must include a port.".to_string())?;
    if host != "127.0.0.1" && host != "localhost" {
        return Err("Host-state endpoint must stay on localhost.".to_string());
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| "Host-state endpoint port is invalid.".to_string())?;
    Ok((host.to_string(), port, format!("/{path}")))
}

#[cfg(test)]
mod tests {
    use super::{
        LinuxHostSettings, SettingsStore, host_state_endpoint, parse_local_http_url, read_settings,
        write_settings,
    };
    use std::path::PathBuf;
    use std::sync::Mutex;

    #[test]
    fn saved_settings_drive_the_local_host_state_endpoint() {
        let settings = LinuxHostSettings {
            port: 9876,
            token: Some("pair".to_string()),
            launch_at_login: true,
            ..LinuxHostSettings::default()
        }
        .with_host_state_url();

        assert_eq!(
            settings.host_state_url,
            "http://127.0.0.1:9876/api/host-state"
        );
        assert_eq!(settings.token.as_deref(), Some("pair"));
        assert!(settings.launch_at_login);
    }

    #[test]
    fn host_state_bridge_only_reads_local_http_endpoints() {
        assert_eq!(
            parse_local_http_url("http://127.0.0.1:8765/api/host-state").expect("local URL"),
            ("127.0.0.1".to_string(), 8765, "/api/host-state".to_string())
        );
        assert!(parse_local_http_url("https://127.0.0.1:8765/api/host-state").is_err());
        assert!(parse_local_http_url("http://example.com:8765/api/host-state").is_err());
    }

    #[test]
    fn local_settings_persist_between_host_surface_runs() {
        let path = PathBuf::from(std::env::temp_dir()).join(format!(
            "tappad-linux-host-settings-{}.json",
            std::process::id()
        ));
        let settings = LinuxHostSettings {
            port: 9777,
            token: Some("saved".to_string()),
            launch_at_login: true,
            ..LinuxHostSettings::default()
        }
        .with_host_state_url();

        write_settings(&path, &settings).expect("write settings");
        let loaded = read_settings(&path).expect("read settings");
        let _ = std::fs::remove_file(path);

        assert_eq!(loaded.port, 9777);
        assert_eq!(loaded.token.as_deref(), Some("saved"));
        assert!(loaded.launch_at_login);
    }

    #[test]
    fn retry_endpoint_overrides_persisted_host_state_url_for_tauri_loads() {
        let store = SettingsStore {
            path: PathBuf::from(std::env::temp_dir()).join("unused-tappad-settings.json"),
            settings: Mutex::new(LinuxHostSettings::default()),
        };

        assert_eq!(
            host_state_endpoint(
                Some("http://127.0.0.1:9876/api/host-state".to_string()),
                &store
            )
            .expect("retry URL"),
            "http://127.0.0.1:9876/api/host-state"
        );
        assert!(
            host_state_endpoint(
                Some("http://example.com:9876/api/host-state".to_string()),
                &store
            )
            .is_err()
        );
    }
}
