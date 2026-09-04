//! Local-network discovery for TapPad clients.

use mdns_sd::{ServiceDaemon, ServiceInfo};

use crate::settings::RuntimeSettings;

pub const SERVICE_TYPE: &str = "_tappad._tcp.local.";

pub fn publish(
    settings: &RuntimeSettings,
) -> Result<ServiceDaemon, Box<dyn std::error::Error + Send + Sync>> {
    let mdns_hostname = settings.mdns_hostname();
    let lan_ipv4 = settings.lan_host.map(|host| host.to_string());
    let mut properties = vec![
        ("id", settings.host_id.as_str()),
        ("name", settings.hostname.as_str()),
        ("host", mdns_hostname.as_str()),
        ("path", "/"),
        ("auth", "token"),
        ("version", "1"),
    ];
    if let Some(lan_ipv4) = lan_ipv4.as_deref() {
        properties.push(("ipv4", lan_ipv4));
    }
    let service = ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name(&settings.hostname),
        &mdns_hostname,
        (),
        settings.port,
        properties.as_slice(),
    )?
    .enable_addr_auto();
    let daemon = ServiceDaemon::new()?;
    daemon.register(service)?;
    Ok(daemon)
}

fn instance_name(hostname: &str) -> String {
    let hostname = hostname.trim().trim_end_matches('.');
    let hostname = hostname.strip_suffix(".local").unwrap_or(hostname);
    let name = format!("TapPad on {hostname}");
    let mut end = name.len().min(63);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    name[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_name_is_bounded_for_dns_sd() {
        let name = instance_name(&"x".repeat(100));

        assert_eq!(name.chars().count(), 63);
        assert!(name.starts_with("TapPad on "));
    }

    #[test]
    fn instance_name_hides_the_local_suffix() {
        assert_eq!(
            instance_name("mise-omarchy.local."),
            "TapPad on mise-omarchy"
        );
    }

    #[test]
    fn instance_name_is_bounded_by_bytes_without_splitting_utf8() {
        let name = instance_name(&"主机".repeat(40));

        assert!(name.len() <= 63);
        assert!(name.starts_with("TapPad on "));
    }
}
