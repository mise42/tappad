//! Host settings and pairing credential persistence.

use std::{
    fs, io,
    net::{IpAddr, Ipv4Addr},
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use crate::tls::{TlsIdentity, tls_dir};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSettings {
    pub bind_host: String,
    pub port: u16,
    pub token: String,
    pub host_id: String,
    pub hostname: String,
    pub launch_at_login: bool,
    #[serde(skip)]
    pub lan_host: Option<Ipv4Addr>,
    /// SHA-256 of the Host TLS certificate; the pairing QR code carries it.
    #[serde(skip)]
    pub tls_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    port: u16,
    token: String,
    #[serde(default)]
    host_id: String,
}

impl RuntimeSettings {
    pub fn from_store(data_dir: &Path, launch_at_login: bool) -> io::Result<Self> {
        let stored = read_stored_settings(data_dir)?;
        let mut settings = Self {
            bind_host: "0.0.0.0".to_string(),
            port: stored.port,
            token: stored.token,
            host_id: stored.host_id,
            hostname: hostname(),
            launch_at_login,
            lan_host: preferred_lan_ipv4(),
            tls_fingerprint: String::new(),
        };
        // Clients pin the fingerprint, not a name, so the certificate survives address changes.
        let mut names = vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
            settings.mdns_hostname().trim_end_matches('.').to_string(),
        ];
        names.extend(settings.lan_host.map(|host| host.to_string()));
        settings.tls_fingerprint =
            TlsIdentity::load_or_create(&tls_dir(data_dir), &names)?.fingerprint;
        Ok(settings)
    }

    pub fn with_new_token(&self) -> Self {
        Self {
            token: generate_pairing_token(),
            ..self.clone()
        }
    }

    pub fn local_url(&self, include_token: bool) -> String {
        self.control_url(self.mdns_hostname().trim_end_matches('.'), include_token)
    }

    pub fn mdns_hostname(&self) -> String {
        let short_id: String = self
            .host_id
            .chars()
            .take(8)
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '-' {
                    ch.to_ascii_lowercase()
                } else {
                    'x'
                }
            })
            .collect();
        let short_id = if short_id.ends_with('-') {
            format!("{short_id}x")
        } else if short_id.is_empty() {
            "unknown".to_string()
        } else {
            short_id
        };
        format!("tappad-{short_id}.local.")
    }

    pub fn lan_url(&self, include_token: bool) -> Option<String> {
        self.lan_host
            .map(|host| self.control_url(&host.to_string(), include_token))
    }

    /// Pairing credentials go in the fragment, which browsers never send to the Host.
    fn control_url(&self, host: &str, include_token: bool) -> String {
        let fragment = if include_token {
            format!("#token={}&fp={}", self.token, self.tls_fingerprint)
        } else {
            String::new()
        };
        format!("https://{host}:{}/{fragment}", self.port)
    }
}

pub fn persist_settings(data_dir: &Path, settings: &RuntimeSettings) -> io::Result<()> {
    fs::create_dir_all(data_dir)?;
    let stored = StoredSettings {
        port: settings.port,
        token: settings.token.clone(),
        host_id: settings.host_id.clone(),
    };
    let text = serde_json::to_string_pretty(&stored)?;
    write_private(&settings_path(data_dir), &text)
}

pub fn settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

/// Writes the settings file, which holds the pairing token, readable only by its owner.
fn write_private(path: &Path, text: &str) -> io::Result<()> {
    use std::{
        io::Write,
        os::unix::fs::{OpenOptionsExt, PermissionsExt},
    };
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    // `mode` applies only on creation; tighten a file an older Host left world-readable.
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(text.as_bytes())
}

fn read_stored_settings(data_dir: &Path) -> io::Result<StoredSettings> {
    let path = settings_path(data_dir);
    match fs::read_to_string(&path) {
        Ok(text) => {
            let mut settings = serde_json::from_str::<StoredSettings>(&text)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
            if settings.host_id.trim().is_empty() {
                settings.host_id = generate_host_id();
                write_private(&path, &serde_json::to_string_pretty(&settings)?)?;
            }
            let token = normalize_token(settings.token)?;
            validate_port(settings.port)?;
            Ok(StoredSettings { token, ..settings })
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let settings = StoredSettings {
                port: 8765,
                token: generate_pairing_token(),
                host_id: generate_host_id(),
            };
            fs::create_dir_all(data_dir)?;
            write_private(&path, &serde_json::to_string_pretty(&settings)?)?;
            Ok(settings)
        }
        Err(error) => Err(error),
    }
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

#[cfg(not(target_os = "linux"))]
fn preferred_lan_ipv4() -> Option<Ipv4Addr> {
    local_ip_address::local_ip().ok().and_then(|ip| match ip {
        IpAddr::V4(v4) if !v4.is_loopback() => Some(v4),
        _ => None,
    })
}

#[cfg(target_os = "linux")]
fn preferred_lan_ipv4() -> Option<Ipv4Addr> {
    let interfaces = local_ip_address::list_afinet_netifas().ok()?;
    let routes = fs::read_to_string("/proc/net/route").unwrap_or_default();
    select_lan_ipv4(&interfaces, &routes, |name| {
        has_active_lan_uplink(&Path::new("/sys/class/net").join(name), 0)
    })
}

#[cfg(any(target_os = "linux", test))]
fn select_lan_ipv4(
    interfaces: &[(String, IpAddr)],
    routes: &str,
    is_usable: impl Fn(&str) -> bool,
) -> Option<Ipv4Addr> {
    // Address enumeration can put a disconnected Docker bridge first. Prefer
    // the lowest-metric default route among interfaces with an active LAN uplink.
    let default_routes: Vec<_> = routes
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 8 || fields[1] != "00000000" || fields[7] != "00000000" {
                return None;
            }
            let flags = u32::from_str_radix(fields[3], 16).ok()?;
            if flags & 0x1 == 0 || flags & 0x200 != 0 {
                return None; // RTF_UP is required; RTF_REJECT is unusable.
            }
            Some((fields[0], fields[6].parse::<u32>().ok()?))
        })
        .collect();

    interfaces
        .iter()
        .filter_map(|(name, ip)| {
            let IpAddr::V4(ip) = ip else { return None };
            if ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || !is_usable(name)
            {
                return None;
            }
            let metric = default_routes
                .iter()
                .filter(|(interface, _)| *interface == name)
                .map(|(_, metric)| *metric)
                .min();
            Some((metric, name.as_str(), *ip))
        })
        // If no default route exists, an active LAN still supports local pairing.
        // Stable ordering avoids depending on kernel address enumeration order.
        .min_by_key(|(metric, name, ip)| (metric.is_none(), *metric, *name, ip.octets()))
        .map(|(_, _, ip)| ip)
}

#[cfg(any(target_os = "linux", test))]
fn has_active_lan_uplink(interface: &Path, depth: u8) -> bool {
    if depth > 8 {
        return false;
    }
    let flags = fs::read_to_string(interface.join("flags"))
        .ok()
        .and_then(|flags| u32::from_str_radix(flags.trim().trim_start_matches("0x"), 16).ok())
        .unwrap_or_default();
    let state = fs::read_to_string(interface.join("operstate")).unwrap_or_default();
    let active = state.trim() == "up"
        || (state.trim() == "unknown"
            && fs::read_to_string(interface.join("carrier"))
                .is_ok_and(|carrier| carrier.trim() == "1"));
    if flags & 0x1 == 0 || !active {
        return false;
    }
    if interface.join("device").exists() {
        return true;
    }
    // Follow real uplinks for LAN bridges, VLANs and bonds. Container bridges,
    // veth devices and VPN tunnels have no underlying hardware LAN interface.
    fs::read_dir(interface).is_ok_and(|entries| {
        entries.filter_map(Result::ok).any(|entry| {
            entry.file_name().to_string_lossy().starts_with("lower_")
                && has_active_lan_uplink(&entry.path(), depth + 1)
        })
    })
}

fn hostname() -> String {
    if let Ok(name) = hostname::get() {
        let name = name.to_string_lossy();
        let name = name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
    }

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

fn generate_host_id() -> String {
    let mut bytes = [0u8; 12];
    getrandom::getrandom(&mut bytes).expect("failed to generate host id");
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interface(name: &str, address: &str) -> (String, IpAddr) {
        (name.to_string(), address.parse().expect("IP address"))
    }

    #[test]
    fn lan_address_ignores_down_bridge_and_active_virtual_interfaces() {
        let interfaces = vec![
            interface("br-container", "172.31.0.1"),
            interface("docker0", "172.17.0.1"),
            interface("tailscale0", "100.113.201.90"),
            interface("enp6s0", "192.168.100.126"),
        ];
        let routes = "tailscale0 00000000 00000000 0001 0 0 0 00000000\n\
                      enp6s0 00000000 0164A8C0 0003 0 0 100 00000000";

        assert_eq!(
            select_lan_ipv4(&interfaces, routes, |name| name == "enp6s0"),
            Some("192.168.100.126".parse().unwrap())
        );
    }

    #[test]
    fn lan_address_prefers_lowest_metric_active_default_route() {
        let interfaces = vec![
            interface("wlan0", "192.168.2.20"),
            interface("eth0", "192.168.1.20"),
        ];
        let routes = "wlan0 00000000 0102A8C0 0003 0 0 600 00000000\n\
                      eth0 00000000 0101A8C0 0003 0 0 100 00000000";

        assert_eq!(
            select_lan_ipv4(&interfaces, routes, |_| true),
            Some("192.168.1.20".parse().unwrap())
        );
        assert_eq!(
            select_lan_ipv4(&interfaces, routes, |name| name == "wlan0"),
            Some("192.168.2.20".parse().unwrap())
        );
    }

    #[test]
    fn lan_address_allows_real_172_lan_without_default_route() {
        let interfaces = vec![interface("eth0", "172.20.10.5")];
        assert_eq!(
            select_lan_ipv4(&interfaces, "", |_| true),
            Some("172.20.10.5".parse().unwrap())
        );
        assert_eq!(select_lan_ipv4(&interfaces, "", |_| false), None);
    }

    #[test]
    fn lan_address_ignores_unusable_addresses_and_routes() {
        let interfaces = vec![
            interface("eth0", "127.0.0.1"),
            interface("eth0", "0.0.0.0"),
            interface("eth0", "169.254.1.2"),
            interface("eth0", "224.0.0.251"),
            interface("eth0", "255.255.255.255"),
            interface("eth0", "::1"),
        ];
        assert_eq!(select_lan_ipv4(&interfaces, "", |_| true), None);

        let interfaces = vec![
            interface("eth0", "192.168.1.20"),
            interface("wlan0", "192.168.2.20"),
        ];
        let routes = "malformed\n\
                      eth0 00000000 0101A8C0 0002 0 0 0 00000000\n\
                      eth0 00000000 0101A8C0 0201 0 0 0 00000000\n\
                      eth0 00000000 0101A8C0 0003 0 0 bad 00000000\n\
                      wlan0 00000000 0102A8C0 0003 0 0 600 00000000";
        assert_eq!(
            select_lan_ipv4(&interfaces, routes, |_| true),
            Some("192.168.2.20".parse().unwrap())
        );
    }

    #[test]
    fn lan_uplink_requires_active_hardware_but_allows_lan_bridges() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bridge = dir.path().join("bridge");
        fs::create_dir(&bridge).unwrap();
        fs::write(bridge.join("flags"), "0x1003\n").unwrap();
        fs::write(bridge.join("operstate"), "up\n").unwrap();
        assert!(!has_active_lan_uplink(&bridge, 0));

        let uplink = bridge.join("lower_eth0");
        fs::create_dir_all(uplink.join("device")).unwrap();
        fs::write(uplink.join("flags"), "0x1003\n").unwrap();
        fs::write(uplink.join("operstate"), "up\n").unwrap();
        assert!(has_active_lan_uplink(&bridge, 0));
        fs::write(uplink.join("operstate"), "down\n").unwrap();
        assert!(!has_active_lan_uplink(&bridge, 0));
        fs::write(uplink.join("operstate"), "up\n").unwrap();
        fs::write(bridge.join("operstate"), "down\n").unwrap();
        assert!(!has_active_lan_uplink(&bridge, 0));
    }

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
        assert!(!settings.host_id.is_empty());
        let mode = fs::metadata(settings_path(dir.path()))
            .expect("settings metadata")
            .permissions();
        assert_eq!(
            std::os::unix::fs::PermissionsExt::mode(&mode) & 0o777,
            0o600
        );
    }

    #[test]
    fn corrupt_settings_are_reported_without_overwrite() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = settings_path(dir.path());
        fs::write(&path, "{bad json").expect("write settings");

        let error = RuntimeSettings::from_store(dir.path(), false).expect_err("invalid settings");

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(
            fs::read_to_string(&path).expect("settings text"),
            "{bad json"
        );
    }

    #[test]
    fn older_settings_gain_a_stable_host_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = settings_path(dir.path());
        fs::write(
            &path,
            r#"{"port":8765,"token":"token","launchAtLogin":false}"#,
        )
        .expect("write settings");

        let settings = RuntimeSettings::from_store(dir.path(), false).expect("settings");

        assert!(!settings.host_id.is_empty());
        let migrated = fs::read_to_string(&path).expect("migrated settings");
        assert!(migrated.contains(r#""hostId""#));
    }

    #[test]
    fn mdns_hostname_uses_the_stable_host_id() {
        let settings = RuntimeSettings {
            bind_host: "0.0.0.0".to_string(),
            port: 8765,
            token: "token".to_string(),
            host_id: "host-id".to_string(),
            hostname: "Mise Omarchy.local".to_string(),
            launch_at_login: false,
            lan_host: None,
            tls_fingerprint: "ab".repeat(32),
        };

        assert_eq!(settings.mdns_hostname(), "tappad-host-id.local.");
        assert_eq!(
            settings.local_url(false),
            "https://tappad-host-id.local:8765/"
        );
    }

    #[test]
    fn mdns_hostname_is_a_valid_dns_label_for_legacy_ids() {
        let mut settings = RuntimeSettings {
            bind_host: "0.0.0.0".to_string(),
            port: 8765,
            token: "token".to_string(),
            host_id: "AB_12--_legacy".to_string(),
            hostname: "host".to_string(),
            launch_at_login: false,
            lan_host: None,
            tls_fingerprint: "ab".repeat(32),
        };

        assert_eq!(settings.mdns_hostname(), "tappad-abx12--x.local.");
        settings.host_id = "ABCDEF--".to_string();
        assert_eq!(settings.mdns_hostname(), "tappad-abcdef--x.local.");
    }
}
