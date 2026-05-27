use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "move")]
    Move { dx: f64, dy: f64 },
    #[serde(rename = "wheel")]
    Wheel { dy: f64 },
    #[serde(rename = "click")]
    Click { button: String },
    #[serde(rename = "key")]
    Key { code: String, #[serde(default)] down: bool },
    #[serde(rename = "text")]
    Text { value: String },
    #[serde(rename = "paste")]
    Paste { value: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerMessage {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    pub host: String,
    pub time: u64,
}

impl ServerMessage {
    pub fn ready(host: String) -> Self {
        Self {
            msg_type: "ready",
            host,
            time: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        }
    }
}
