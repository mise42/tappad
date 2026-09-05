//! Omarchy input injection adapter.

use serde::Serialize;
use std::io;

#[cfg(target_os = "linux")]
use enigo::{
    Axis, Button, Coordinate,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};

#[cfg(target_os = "linux")]
use crate::input_chord::chord_sequence;

#[cfg(target_os = "linux")]
use log::warn;

#[cfg(target_os = "linux")]
pub struct InputDevice {
    enigo: Enigo,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct InputCapabilityStatus {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'static str>,
}

impl InputCapabilityStatus {
    pub fn is_supported(&self) -> bool {
        self.state == "supported"
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct InputCapabilities {
    #[serde(rename = "pointerButton")]
    pub pointer_button: InputCapabilityStatus,
}

pub fn input_capabilities() -> InputCapabilities {
    #[cfg(target_os = "linux")]
    {
        InputCapabilities {
            pointer_button: InputCapabilityStatus {
                state: "supported",
                note: None,
            },
        }
    }

    #[cfg(not(target_os = "linux"))]
    {
        InputCapabilities {
            pointer_button: InputCapabilityStatus {
                state: "unsupported",
                note: Some("Pointer button hold is unavailable on this target backend."),
            },
        }
    }
}

#[cfg(target_os = "linux")]
impl InputDevice {
    pub fn new() -> io::Result<Self> {
        let enigo = Enigo::new(&platform_settings()).map_err(to_io_error)?;
        Ok(Self { enigo })
    }

    pub fn move_rel(&mut self, dx: i32, dy: i32) -> io::Result<()> {
        self.with_reconnect_on_stale_backend(|enigo| {
            enigo
                .move_mouse(dx, dy, Coordinate::Rel)
                .map_err(to_io_error)
        })
    }

    pub fn scroll(&mut self, dy: i32) -> io::Result<()> {
        if dy == 0 {
            return Ok(());
        }

        self.with_reconnect_on_stale_backend(|enigo| {
            enigo.scroll(dy, Axis::Vertical).map_err(to_io_error)
        })
    }

    pub fn click(&mut self, button: &str, click_count: u8) -> io::Result<()> {
        let button = pointer_button(button)?;

        for _ in 0..click_count.max(1) {
            self.with_reconnect_on_stale_backend(|enigo| {
                enigo.button(button, Click).map_err(to_io_error)
            })?;
        }
        Ok(())
    }

    pub fn button(&mut self, button: &str, down: bool) -> io::Result<()> {
        let button = pointer_button(button)?;
        self.with_reconnect_on_stale_backend(|enigo| {
            enigo
                .button(button, if down { Press } else { Release })
                .map_err(to_io_error)
        })
    }

    pub fn key(&mut self, code_name: &str, down: bool) -> io::Result<()> {
        let Some(key) = key_for_code(code_name) else {
            return Ok(());
        };

        self.with_reconnect_on_stale_backend(|enigo| {
            enigo
                .key(key, if down { Press } else { Release })
                .map_err(to_io_error)
        })
    }

    pub fn is_typeable(&self, ch: char) -> bool {
        ch.is_ascii()
    }

    pub fn type_text(&mut self, text: &str) -> io::Result<()> {
        self.with_reconnect_on_stale_backend(|enigo| enigo.text(text).map_err(to_io_error))
    }

    #[allow(dead_code)]
    pub fn tap(&mut self, code_name: &str) -> io::Result<()> {
        self.key(code_name, true)?;
        self.key(code_name, false)
    }

    #[allow(dead_code)]
    pub fn chord(&mut self, code_names: &[&str]) -> io::Result<()> {
        chord_sequence(code_names, |code_name, down| self.key(code_name, down))
    }

    fn with_reconnect_on_stale_backend(
        &mut self,
        operation: impl FnMut(&mut Enigo) -> io::Result<()>,
    ) -> io::Result<()> {
        run_with_reconnect_on_stale_backend(&mut self.enigo, operation, || {
            Enigo::new(&platform_settings()).map_err(to_io_error)
        })
    }
}

#[cfg(target_os = "linux")]
fn run_with_reconnect_on_stale_backend<T>(
    backend: &mut T,
    mut operation: impl FnMut(&mut T) -> io::Result<()>,
    mut reconnect: impl FnMut() -> io::Result<T>,
) -> io::Result<()> {
    match operation(backend) {
        Ok(()) => Ok(()),
        Err(error) if is_stale_input_backend_error(&error) => {
            warn!("input backend connection is stale after error ({error}); reconnecting");
            *backend = reconnect()?;
            operation(backend)
        }
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "linux")]
fn is_stale_input_backend_error(error: &io::Error) -> bool {
    let text = error.to_string();
    text.contains("could not flush Wayland queue") || text.contains("Broken pipe")
}

#[cfg(target_os = "linux")]
fn platform_settings() -> Settings {
    Settings::default()
}

#[cfg(not(target_os = "linux"))]
pub struct InputDevice;

#[cfg(not(target_os = "linux"))]
impl InputDevice {
    pub fn new() -> io::Result<Self> {
        Ok(Self)
    }

    pub fn move_rel(&mut self, _dx: i32, _dy: i32) -> io::Result<()> {
        Err(unsupported_input_error())
    }

    pub fn scroll(&mut self, _dy: i32) -> io::Result<()> {
        Err(unsupported_input_error())
    }

    pub fn click(&mut self, _button: &str, _click_count: u8) -> io::Result<()> {
        Err(unsupported_input_error())
    }

    pub fn button(&mut self, _button: &str, _down: bool) -> io::Result<()> {
        Err(unsupported_input_error())
    }

    pub fn key(&mut self, _code_name: &str, _down: bool) -> io::Result<()> {
        Err(unsupported_input_error())
    }

    pub fn is_typeable(&self, _ch: char) -> bool {
        false
    }

    pub fn type_text(&mut self, _text: &str) -> io::Result<()> {
        Err(unsupported_input_error())
    }

    pub fn tap(&mut self, _code_name: &str) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(not(target_os = "linux"))]
fn unsupported_input_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "input injection requires the Omarchy target backend",
    )
}

#[cfg(target_os = "linux")]
fn key_for_code(code: &str) -> Option<Key> {
    if let Some(letter) = code.strip_prefix("Key").and_then(single_ascii_char) {
        if letter.is_ascii_uppercase() {
            return Some(Key::Unicode(letter.to_ascii_lowercase()));
        }
    }

    if let Some(digit) = code.strip_prefix("Digit").and_then(single_ascii_char) {
        if digit.is_ascii_digit() {
            return Some(Key::Unicode(digit));
        }
    }

    match code {
        "Enter" => Some(Key::Return),
        "Escape" => Some(Key::Escape),
        "Backspace" => Some(Key::Backspace),
        "Tab" => Some(Key::Tab),
        "Space" => Some(Key::Space),
        "Delete" => Some(Key::Delete),
        "Insert" => Some(Key::Insert),
        "Home" => Some(Key::Home),
        "End" => Some(Key::End),
        "PageUp" => Some(Key::PageUp),
        "PageDown" => Some(Key::PageDown),
        "ArrowUp" => Some(Key::UpArrow),
        "ArrowDown" => Some(Key::DownArrow),
        "ArrowLeft" => Some(Key::LeftArrow),
        "ArrowRight" => Some(Key::RightArrow),
        "ShiftLeft" => Some(Key::LShift),
        "ShiftRight" => Some(Key::RShift),
        "ControlLeft" => Some(Key::LControl),
        "ControlRight" => Some(Key::RControl),
        "AltLeft" | "AltRight" => Some(Key::Alt),
        "MetaLeft" | "MetaRight" => Some(Key::Meta),
        "CapsLock" => Some(Key::CapsLock),
        "PrintScreen" => Some(Key::PrintScr),
        "F1" => Some(Key::F1),
        "F2" => Some(Key::F2),
        "F3" => Some(Key::F3),
        "F4" => Some(Key::F4),
        "F5" => Some(Key::F5),
        "F6" => Some(Key::F6),
        "F7" => Some(Key::F7),
        "F8" => Some(Key::F8),
        "F9" => Some(Key::F9),
        "F10" => Some(Key::F10),
        "F11" => Some(Key::F11),
        "F12" => Some(Key::F12),
        "MediaPrevTrack" => Some(Key::MediaPrevTrack),
        "MediaPlayPause" => Some(Key::MediaPlayPause),
        "MediaNextTrack" => Some(Key::MediaNextTrack),
        "VolumeDown" => Some(Key::VolumeDown),
        "VolumeMute" => Some(Key::VolumeMute),
        "VolumeUp" => Some(Key::VolumeUp),
        _ => None,
    }
}

#[cfg(target_os = "linux")]
fn pointer_button(button: &str) -> io::Result<Button> {
    match button {
        "left" => Ok(Button::Left),
        "right" => Ok(Button::Right),
        "middle" => Ok(Button::Middle),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown pointer button: {button}"),
        )),
    }
}

#[cfg(target_os = "linux")]
fn single_ascii_char(value: &str) -> Option<char> {
    let mut chars = value.chars();
    let ch = chars.next()?;
    if chars.next().is_none() && ch.is_ascii() {
        Some(ch)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn to_io_error(error: impl std::fmt::Debug) -> io::Error {
    io::Error::other(format!("{error:?}"))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{
        input_capabilities, is_stale_input_backend_error, pointer_button,
        run_with_reconnect_on_stale_backend,
    };
    use std::io;

    #[test]
    fn supported_platform_adapter_advertises_pointer_button_hold() {
        assert!(input_capabilities().pointer_button.is_supported());
    }

    #[test]
    fn platform_adapter_rejects_unknown_pointer_buttons() {
        let error = pointer_button("side").expect_err("unknown button should fail");
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn retries_once_after_stale_wayland_queue_error() {
        let mut backend = "stale".to_string();
        let mut attempts = 0;
        let mut reconnects = 0;

        run_with_reconnect_on_stale_backend(
            &mut backend,
            |backend| {
                attempts += 1;
                if attempts == 1 {
                    assert_eq!(backend, "stale");
                    Err(io::Error::other(
                        r#"Simulate("could not flush Wayland queue")"#,
                    ))
                } else {
                    assert_eq!(backend, "fresh");
                    Ok(())
                }
            },
            || {
                reconnects += 1;
                Ok("fresh".to_string())
            },
        )
        .expect("operation should succeed after reconnect");

        assert_eq!(attempts, 2);
        assert_eq!(reconnects, 1);
        assert_eq!(backend, "fresh");
    }

    #[test]
    fn does_not_retry_unrelated_input_errors() {
        let mut backend = "same".to_string();
        let mut attempts = 0;
        let mut reconnects = 0;

        let error = run_with_reconnect_on_stale_backend(
            &mut backend,
            |_| {
                attempts += 1;
                Err(io::Error::other("permission denied"))
            },
            || {
                reconnects += 1;
                Ok("fresh".to_string())
            },
        )
        .expect_err("unrelated errors should not reconnect");

        assert_eq!(error.to_string(), "permission denied");
        assert_eq!(attempts, 1);
        assert_eq!(reconnects, 0);
        assert_eq!(backend, "same");
    }

    #[test]
    fn recognizes_broken_pipe_as_stale_backend_error() {
        let error =
            io::Error::other(r#"Io(Os { code: 32, kind: BrokenPipe, message: "Broken pipe" })"#);

        assert!(is_stale_input_backend_error(&error));
    }
}
