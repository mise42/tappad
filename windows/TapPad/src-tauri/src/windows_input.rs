use std::io;

use enigo::{
    Axis, Button, Coordinate,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};

pub struct InputDevice {
    enigo: Enigo,
}

impl InputDevice {
    pub fn new() -> io::Result<Self> {
        let _ = enigo::set_dpi_awareness();
        let enigo = Enigo::new(&Settings::default()).map_err(to_io_error)?;
        Ok(Self { enigo })
    }

    pub fn move_rel(&mut self, dx: i32, dy: i32) -> io::Result<()> {
        self.enigo
            .move_mouse(dx, dy, Coordinate::Rel)
            .map_err(to_io_error)
    }

    pub fn scroll(&mut self, dy: i32) -> io::Result<()> {
        if dy == 0 {
            return Ok(());
        }

        self.enigo.scroll(dy, Axis::Vertical).map_err(to_io_error)
    }

    pub fn click(&mut self, button: &str, click_count: u8) -> io::Result<()> {
        let button = match button {
            "right" => Button::Right,
            "middle" => Button::Middle,
            _ => Button::Left,
        };

        for _ in 0..click_count.max(1) {
            self.enigo.button(button, Click).map_err(to_io_error)?;
        }
        Ok(())
    }

    pub fn key(&mut self, code_name: &str, down: bool) -> io::Result<()> {
        let Some(key) = key_for_code(code_name) else {
            return Ok(());
        };

        self.enigo
            .key(key, if down { Press } else { Release })
            .map_err(to_io_error)
    }

    pub fn type_text(&mut self, text: &str) -> io::Result<()> {
        self.enigo.text(text).map_err(to_io_error)
    }
}

fn key_for_code(code: &str) -> Option<Key> {
    match code {
        "KeyA" => Some(Key::A),
        "KeyB" => Some(Key::B),
        "KeyC" => Some(Key::C),
        "KeyD" => Some(Key::D),
        "KeyE" => Some(Key::E),
        "KeyF" => Some(Key::F),
        "KeyG" => Some(Key::G),
        "KeyH" => Some(Key::H),
        "KeyI" => Some(Key::I),
        "KeyJ" => Some(Key::J),
        "KeyK" => Some(Key::K),
        "KeyL" => Some(Key::L),
        "KeyM" => Some(Key::M),
        "KeyN" => Some(Key::N),
        "KeyO" => Some(Key::O),
        "KeyP" => Some(Key::P),
        "KeyQ" => Some(Key::Q),
        "KeyR" => Some(Key::R),
        "KeyS" => Some(Key::S),
        "KeyT" => Some(Key::T),
        "KeyU" => Some(Key::U),
        "KeyV" => Some(Key::V),
        "KeyW" => Some(Key::W),
        "KeyX" => Some(Key::X),
        "KeyY" => Some(Key::Y),
        "KeyZ" => Some(Key::Z),
        "Digit0" => Some(Key::Num0),
        "Digit1" => Some(Key::Num1),
        "Digit2" => Some(Key::Num2),
        "Digit3" => Some(Key::Num3),
        "Digit4" => Some(Key::Num4),
        "Digit5" => Some(Key::Num5),
        "Digit6" => Some(Key::Num6),
        "Digit7" => Some(Key::Num7),
        "Digit8" => Some(Key::Num8),
        "Digit9" => Some(Key::Num9),
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
        _ => None,
    }
}

fn to_io_error(error: impl std::fmt::Debug) -> io::Error {
    io::Error::other(format!("{error:?}"))
}
