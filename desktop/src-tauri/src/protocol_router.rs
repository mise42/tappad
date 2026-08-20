use std::time::{Duration, Instant};

use crate::protocol::ClientMessage;

#[derive(Debug, Clone, PartialEq)]
pub enum BackendEffect {
    Move { dx: i32, dy: i32 },
    Wheel { dy: i32 },
    Click { button: String, click_count: u8 },
    PointerButton { button: String, down: bool },
    Key { code: String, down: bool },
    Text { value: String },
    Paste { value: String },
    Cmd { action: String },
    Authorize { password: String },
}

#[derive(Debug)]
pub struct ProtocolRouter {
    active_client: ActiveClientTracker,
}

impl ProtocolRouter {
    pub fn new() -> Self {
        Self {
            active_client: ActiveClientTracker::new(Duration::from_secs(2)),
        }
    }

    pub fn route(&mut self, client_id: &str, message: ClientMessage) -> Option<BackendEffect> {
        self.route_at(client_id, message, Instant::now())
    }

    fn route_at(
        &mut self,
        client_id: &str,
        message: ClientMessage,
        now: Instant,
    ) -> Option<BackendEffect> {
        if message.is_motion() && !self.active_client.accepts(client_id, now) {
            return None;
        }

        Some(match message {
            ClientMessage::Move { dx, dy } => BackendEffect::Move {
                dx: dx.round() as i32,
                dy: dy.round() as i32,
            },
            ClientMessage::Wheel { dy } => BackendEffect::Wheel {
                dy: dy.round() as i32,
            },
            ClientMessage::Click {
                button,
                click_count,
            } => BackendEffect::Click {
                button,
                click_count,
            },
            ClientMessage::PointerButton { button, down } => {
                BackendEffect::PointerButton { button, down }
            }
            ClientMessage::Key { code, down } => BackendEffect::Key { code, down },
            ClientMessage::Text { value } => BackendEffect::Text { value },
            ClientMessage::Paste { value } => BackendEffect::Paste { value },
            ClientMessage::Cmd { action } => BackendEffect::Cmd { action },
            ClientMessage::Authorize { password } => BackendEffect::Authorize { password },
        })
    }
}

#[derive(Debug)]
struct ActiveClientTracker {
    current: Option<(String, Instant)>,
    timeout: Duration,
}

impl ActiveClientTracker {
    fn new(timeout: Duration) -> Self {
        Self {
            current: None,
            timeout,
        }
    }

    fn accepts(&mut self, client_id: &str, now: Instant) -> bool {
        match &self.current {
            Some((current, _)) if current == client_id => {
                self.current = Some((client_id.to_string(), now));
                true
            }
            Some((_, since)) if now.duration_since(*since) <= self.timeout => false,
            _ => {
                self.current = Some((client_id.to_string(), now));
                true
            }
        }
    }
}

trait MotionMessage {
    fn is_motion(&self) -> bool;
}

impl MotionMessage for ClientMessage {
    fn is_motion(&self) -> bool {
        matches!(
            self,
            ClientMessage::Move { .. } | ClientMessage::Wheel { .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_pointer_motion_to_backend_effects() {
        let mut router = ProtocolRouter::new();

        assert_eq!(
            router.route("client-a", ClientMessage::Move { dx: 1.4, dy: -2.6 }),
            Some(BackendEffect::Move { dx: 1, dy: -3 })
        );
        assert_eq!(
            router.route("client-a", ClientMessage::Wheel { dy: 3.6 }),
            Some(BackendEffect::Wheel { dy: 4 })
        );
    }

    #[test]
    fn suppresses_motion_from_second_client_until_timeout() {
        let mut router = ProtocolRouter::new();
        let start = Instant::now();

        assert_eq!(
            router.route_at("client-a", ClientMessage::Move { dx: 1.0, dy: 1.0 }, start),
            Some(BackendEffect::Move { dx: 1, dy: 1 })
        );
        assert_eq!(
            router.route_at(
                "client-b",
                ClientMessage::Move { dx: 2.0, dy: 2.0 },
                start + Duration::from_millis(500)
            ),
            None
        );
        assert_eq!(
            router.route_at(
                "client-b",
                ClientMessage::Move { dx: 2.0, dy: 2.0 },
                start + Duration::from_secs(3)
            ),
            Some(BackendEffect::Move { dx: 2, dy: 2 })
        );
    }

    #[test]
    fn allows_non_motion_from_any_client() {
        let mut router = ProtocolRouter::new();
        let start = Instant::now();

        let _ = router.route_at("client-a", ClientMessage::Move { dx: 1.0, dy: 1.0 }, start);

        assert_eq!(
            router.route_at(
                "client-b",
                ClientMessage::Click {
                    button: "left".to_string(),
                    click_count: 1,
                },
                start + Duration::from_millis(500)
            ),
            Some(BackendEffect::Click {
                button: "left".to_string(),
                click_count: 1,
            })
        );
    }

    #[test]
    fn routes_pointer_button_state_without_changing_click_semantics() {
        let mut router = ProtocolRouter::new();

        assert_eq!(
            router.route(
                "client-a",
                ClientMessage::PointerButton {
                    button: "left".to_string(),
                    down: true,
                },
            ),
            Some(BackendEffect::PointerButton {
                button: "left".to_string(),
                down: true,
            })
        );
    }

    #[test]
    fn routes_authorization_through_its_dedicated_effect() {
        let mut router = ProtocolRouter::new();

        assert_eq!(
            router.route(
                "client-a",
                ClientMessage::Authorize {
                    password: "ascii only".to_string(),
                },
            ),
            Some(BackendEffect::Authorize {
                password: "ascii only".to_string(),
            })
        );
    }
}
