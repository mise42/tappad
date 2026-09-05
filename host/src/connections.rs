use serde::Serialize;
use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSummary {
    pub id: String,
    pub name: String,
    pub connected_at: u64,
    pub last_input_at: Option<u64>,
    pub input_messages: u64,
    #[serde(skip)]
    pub disconnect: CancellationToken,
}

#[derive(Default)]
pub struct Connections {
    pub clients: BTreeMap<String, ClientSummary>,
    pub rejected_pairings: u64,
    pub last_rejected_at: Option<u64>,
}
impl Connections {
    pub fn add(&mut self, id: String) -> CancellationToken {
        let disconnect = CancellationToken::new();
        self.clients.insert(
            id.clone(),
            ClientSummary {
                id,
                name: "Unnamed client".into(),
                connected_at: now_ms(),
                last_input_at: None,
                input_messages: 0,
                disconnect: disconnect.clone(),
            },
        );
        disconnect
    }
    pub fn identify(&mut self, id: &str, name: &str) {
        if let Some(client) = self.clients.get_mut(id) {
            let name: String = name.chars().filter(|c| !c.is_control()).take(64).collect();
            if !name.trim().is_empty() {
                client.name = name.trim().to_owned();
            }
        }
    }
    pub fn input(&mut self, id: &str) {
        if let Some(client) = self.clients.get_mut(id) {
            client.input_messages += 1;
            client.last_input_at = Some(now_ms());
        }
    }
    pub fn reject(&mut self) {
        self.rejected_pairings += 1;
        self.last_rejected_at = Some(now_ms());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tracks_real_connections_and_disconnect_does_not_forget_identity() {
        let mut state = Connections::default();
        let cancel = state.add("client-1".into());
        state.identify("client-1", "Phone\nname");
        state.input("client-1");
        assert_eq!(state.clients["client-1"].name, "Phonename");
        assert_eq!(state.clients["client-1"].input_messages, 1);
        cancel.cancel();
        assert!(state.clients["client-1"].disconnect.is_cancelled());
        let json = serde_json::to_string(&state.clients["client-1"]).unwrap();
        assert!(!json.contains("disconnect"));
        assert!(!json.contains("token"));
    }
}
