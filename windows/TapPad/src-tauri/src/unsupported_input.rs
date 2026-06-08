use std::io;

pub struct InputDevice;

impl InputDevice {
    pub fn new() -> io::Result<Self> {
        Err(io::Error::other(
            "TapPad Tauri backend currently targets Windows only",
        ))
    }

    pub fn move_rel(&mut self, _dx: i32, _dy: i32) -> io::Result<()> {
        Ok(())
    }

    pub fn scroll(&mut self, _dy: i32) -> io::Result<()> {
        Ok(())
    }

    pub fn click(&mut self, _button: &str, _click_count: u8) -> io::Result<()> {
        Ok(())
    }

    pub fn key(&mut self, _code_name: &str, _down: bool) -> io::Result<()> {
        Ok(())
    }

    pub fn type_text(&mut self, _text: &str) -> io::Result<()> {
        Ok(())
    }
}
