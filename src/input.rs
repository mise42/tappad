#[cfg(target_os = "linux")]
pub use crate::uinput::UinputDevice as InputDevice;

#[cfg(target_os = "windows")]
pub use crate::enigo_input::EnigoInputDevice as InputDevice;

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub struct InputDevice;

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
impl InputDevice {
    pub fn new() -> std::io::Result<Self> {
        Err(std::io::Error::other(
            "Rust backend only supports Linux and Windows; use macos/TapPad for macOS",
        ))
    }

    pub fn move_rel(&mut self, _dx: i32, _dy: i32) -> std::io::Result<()> {
        Ok(())
    }

    pub fn scroll(&mut self, _dy: i32) -> std::io::Result<()> {
        Ok(())
    }

    pub fn click(&mut self, _button: &str, _click_count: u8) -> std::io::Result<()> {
        Ok(())
    }

    pub fn key(&mut self, _code_name: &str, _down: bool) -> std::io::Result<()> {
        Ok(())
    }

    pub fn is_typeable(&self, _ch: char) -> bool {
        false
    }

    pub fn type_text(&mut self, _text: &str) -> std::io::Result<()> {
        Ok(())
    }
}
