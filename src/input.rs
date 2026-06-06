#[cfg(target_os = "linux")]
pub use crate::uinput::UinputDevice as InputDevice;

#[cfg(not(target_os = "linux"))]
pub struct InputDevice;

#[cfg(not(target_os = "linux"))]
impl InputDevice {
    pub fn new() -> std::io::Result<Self> {
        Err(std::io::Error::other(
            "Rust backend only supports Linux; use macos/TapPad for macOS",
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
