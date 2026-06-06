use std::fs::OpenOptions;
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use tracing::{debug, error, info};

const EV_KEY: u16 = 0x01;
const EV_REL: u16 = 0x02;
const EV_SYN: u16 = 0x00;
const REL_X: u16 = 0x00;
const REL_Y: u16 = 0x01;
const REL_WHEEL: u16 = 0x08;
const BTN_LEFT: u16 = 0x110;
const BTN_RIGHT: u16 = 0x111;
const BTN_MIDDLE: u16 = 0x112;

// Verify InputEvent size at compile time
const _: () = assert!(std::mem::size_of::<InputEvent>() == 24);

const UINPUT_IOCTL_BASE: u8 = b'U';
const UI_SET_EVBIT: u64 = _ioc_write(UINPUT_IOCTL_BASE, 100, std::mem::size_of::<i32>() as u32);
const UI_SET_KEYBIT: u64 = _ioc_write(UINPUT_IOCTL_BASE, 101, std::mem::size_of::<i32>() as u32);
const UI_SET_RELBIT: u64 = _ioc_write(UINPUT_IOCTL_BASE, 102, std::mem::size_of::<i32>() as u32);
const UI_DEV_SETUP: u64 = _ioc_write(UINPUT_IOCTL_BASE, 3, std::mem::size_of::<UinputSetup>() as u32);

// Verify UinputSetup size at compile time
const _: () = assert!(std::mem::size_of::<UinputSetup>() == 92);
const UI_DEV_CREATE: u64 = _ioc(0, UINPUT_IOCTL_BASE, 1, 0);
const UI_DEV_DESTROY: u64 = _ioc(0, UINPUT_IOCTL_BASE, 2, 0);

const UINPUT_MAX_NAME_SIZE: usize = 80;
const BUS_VIRTUAL: u16 = 0x06;

#[repr(C)]
struct InputId {
    bustype: u16,
    vendor: u16,
    product: u16,
    version: u16,
}

#[repr(C)]
struct UinputSetup {
    id: InputId,
    name: [u8; UINPUT_MAX_NAME_SIZE],
    ff_effects_max: u32,
}

#[repr(C)]
struct InputEvent {
    time: libc::timeval,
    type_: u16,
    code: u16,
    value: i32,
}

const fn _ioc(dir: u8, type_: u8, nr: u8, size: u32) -> u64 {
    ((dir as u64) << 30) | ((type_ as u64) << 8) | ((nr as u64) << 0) | ((size as u64) << 16)
}

const fn _ioc_write(type_: u8, nr: u8, size: u32) -> u64 {
    _ioc(1, type_, nr, size)
}

fn key_code(name: &str) -> Option<u16> {
    match name {
        "Escape" => Some(1),
        "Digit1" => Some(2),
        "Digit2" => Some(3),
        "Digit3" => Some(4),
        "Digit4" => Some(5),
        "Digit5" => Some(6),
        "Digit6" => Some(7),
        "Digit7" => Some(8),
        "Digit8" => Some(9),
        "Digit9" => Some(10),
        "Digit0" => Some(11),
        "Minus" => Some(12),
        "Equal" => Some(13),
        "Backspace" => Some(14),
        "Tab" => Some(15),
        "KeyQ" => Some(16),
        "KeyW" => Some(17),
        "KeyE" => Some(18),
        "KeyR" => Some(19),
        "KeyT" => Some(20),
        "KeyY" => Some(21),
        "KeyU" => Some(22),
        "KeyI" => Some(23),
        "KeyO" => Some(24),
        "KeyP" => Some(25),
        "BracketLeft" => Some(26),
        "BracketRight" => Some(27),
        "Enter" => Some(28),
        "ControlLeft" => Some(29),
        "ControlRight" => Some(97),
        "KeyA" => Some(30),
        "KeyS" => Some(31),
        "KeyD" => Some(32),
        "KeyF" => Some(33),
        "KeyG" => Some(34),
        "KeyH" => Some(35),
        "KeyJ" => Some(36),
        "KeyK" => Some(37),
        "KeyL" => Some(38),
        "Semicolon" => Some(39),
        "Quote" => Some(40),
        "Backquote" => Some(41),
        "ShiftLeft" => Some(42),
        "Backslash" => Some(43),
        "KeyZ" => Some(44),
        "KeyX" => Some(45),
        "KeyC" => Some(46),
        "KeyV" => Some(47),
        "KeyB" => Some(48),
        "KeyN" => Some(49),
        "KeyM" => Some(50),
        "Comma" => Some(51),
        "Period" => Some(52),
        "Slash" => Some(53),
        "ShiftRight" => Some(54),
        "AltLeft" => Some(56),
        "AltRight" => Some(100),
        "Space" => Some(57),
        "CapsLock" => Some(58),
        "F1" => Some(59),
        "F2" => Some(60),
        "F3" => Some(61),
        "F4" => Some(62),
        "F5" => Some(63),
        "F6" => Some(64),
        "F7" => Some(65),
        "F8" => Some(66),
        "F9" => Some(67),
        "F10" => Some(68),
        "F11" => Some(87),
        "F12" => Some(88),
        "Home" => Some(102),
        "ArrowUp" => Some(103),
        "PageUp" => Some(104),
        "ArrowLeft" => Some(105),
        "ArrowRight" => Some(106),
        "End" => Some(107),
        "ArrowDown" => Some(108),
        "PageDown" => Some(109),
        "Insert" => Some(110),
        "Delete" => Some(111),
        "MetaLeft" => Some(125),
        "MetaRight" => Some(126),
        _ => None,
    }
}

fn ascii_key_code(ch: char) -> Option<u16> {
    match ch {
        '\n' => Some(28),
        '\t' => Some(15),
        ' ' => Some(57),
        '0' => Some(11),
        '1' => Some(2),
        '2' => Some(3),
        '3' => Some(4),
        '4' => Some(5),
        '5' => Some(6),
        '6' => Some(7),
        '7' => Some(8),
        '8' => Some(9),
        '9' => Some(10),
        'a' | 'A' => Some(30),
        'b' | 'B' => Some(48),
        'c' | 'C' => Some(46),
        'd' | 'D' => Some(32),
        'e' | 'E' => Some(18),
        'f' | 'F' => Some(33),
        'g' | 'G' => Some(34),
        'h' | 'H' => Some(35),
        'i' | 'I' => Some(23),
        'j' | 'J' => Some(36),
        'k' | 'K' => Some(37),
        'l' | 'L' => Some(38),
        'm' | 'M' => Some(50),
        'n' | 'N' => Some(49),
        'o' | 'O' => Some(24),
        'p' | 'P' => Some(25),
        'q' | 'Q' => Some(16),
        'r' | 'R' => Some(19),
        's' | 'S' => Some(31),
        't' | 'T' => Some(20),
        'u' | 'U' => Some(22),
        'v' | 'V' => Some(47),
        'w' | 'W' => Some(17),
        'x' | 'X' => Some(45),
        'y' | 'Y' => Some(21),
        'z' | 'Z' => Some(44),
        '-' | '_' => Some(12),
        '=' | '+' => Some(13),
        '[' | '{' => Some(26),
        ']' | '}' => Some(27),
        '\\' | '|' => Some(43),
        ';' | ':' => Some(39),
        '\'' | '"' => Some(40),
        '`' | '~' => Some(41),
        ',' | '<' => Some(51),
        '.' | '>' => Some(52),
        '/' | '?' => Some(53),
        '!' => Some(2),
        '@' => Some(3),
        '#' => Some(4),
        '$' => Some(5),
        '%' => Some(6),
        '^' => Some(7),
        '&' => Some(8),
        '*' => Some(9),
        '(' => Some(10),
        ')' => Some(11),
        _ => None,
    }
}

fn needs_shift(ch: char) -> bool {
    matches!(
        ch,
        '!' | '@'
            | '#'
            | '$'
            | '%'
            | '^'
            | '&'
            | '*'
            | '('
            | ')'
            | '_'
            | '+'
            | '{'
            | '}'
            | '|'
            | ':'
            | '"'
            | '<'
            | '>'
            | '?'
            | 'A'..='Z'
    )
}

pub struct UinputDevice {
    fd: std::fs::File,
}

fn check_ioctl(res: i32, name: &str) -> io::Result<()> {
    if res < 0 {
        let err = io::Error::last_os_error();
        error!("{} failed: {:?}", name, err);
        Err(err)
    } else {
        debug!("{} ok", name);
        Ok(())
    }
}

impl UinputDevice {
    pub fn new() -> io::Result<Self> {
        info!("Opening /dev/uinput...");
        let fd = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NONBLOCK)
            .open("/dev/uinput")?;
        info!("/dev/uinput opened");

        unsafe {
            let raw = fd.as_raw_fd();

            check_ioctl(libc::ioctl(raw, UI_SET_EVBIT, EV_KEY as i32), "UI_SET_EVBIT EV_KEY")?;
            check_ioctl(libc::ioctl(raw, UI_SET_EVBIT, EV_REL as i32), "UI_SET_EVBIT EV_REL")?;
            check_ioctl(libc::ioctl(raw, UI_SET_EVBIT, EV_SYN as i32), "UI_SET_EVBIT EV_SYN")?;

            for i in 0..256i32 {
                libc::ioctl(raw, UI_SET_KEYBIT, i);
            }
            check_ioctl(libc::ioctl(raw, UI_SET_KEYBIT, BTN_LEFT as i32), "UI_SET_KEYBIT BTN_LEFT")?;
            check_ioctl(libc::ioctl(raw, UI_SET_KEYBIT, BTN_RIGHT as i32), "UI_SET_KEYBIT BTN_RIGHT")?;
            check_ioctl(libc::ioctl(raw, UI_SET_KEYBIT, BTN_MIDDLE as i32), "UI_SET_KEYBIT BTN_MIDDLE")?;

            check_ioctl(libc::ioctl(raw, UI_SET_RELBIT, REL_X as i32), "UI_SET_RELBIT REL_X")?;
            check_ioctl(libc::ioctl(raw, UI_SET_RELBIT, REL_Y as i32), "UI_SET_RELBIT REL_Y")?;
            check_ioctl(libc::ioctl(raw, UI_SET_RELBIT, REL_WHEEL as i32), "UI_SET_RELBIT REL_WHEEL")?;

            let mut name = [0u8; UINPUT_MAX_NAME_SIZE];
            let bytes = b"omarchy-touchpad";
            name[..bytes.len()].copy_from_slice(bytes);

            let setup = UinputSetup {
                id: InputId {
                    bustype: BUS_VIRTUAL,
                    vendor: 0x1234,
                    product: 0x5678,
                    version: 1,
                },
                name,
                ff_effects_max: 0,
            };

            check_ioctl(libc::ioctl(raw, UI_DEV_SETUP, &setup), "UI_DEV_SETUP")?;
            check_ioctl(libc::ioctl(raw, UI_DEV_CREATE), "UI_DEV_CREATE")?;
        }

        info!("uinput device created, waiting 200ms...");
        std::thread::sleep(std::time::Duration::from_millis(200));
        info!("uinput device ready");
        Ok(Self { fd })
    }

    fn emit(&mut self, type_: u16, code: u16, value: i32) -> io::Result<()> {
        debug!("emit type={:04x} code={:04x} value={}", type_, code, value);
        let ev = InputEvent {
            time: libc::timeval {
                tv_sec: 0,
                tv_usec: 0,
            },
            type_,
            code,
            value,
        };
        let bytes = unsafe {
            std::slice::from_raw_parts(
                &ev as *const _ as *const u8,
                std::mem::size_of::<InputEvent>(),
            )
        };
        if let Err(e) = self.fd.write_all(bytes) {
            error!("write to uinput failed: {:?}", e);
            return Err(e);
        }
        Ok(())
    }

    fn syn(&mut self) -> io::Result<()> {
        self.emit(EV_SYN, 0, 0)
    }

    pub fn move_rel(&mut self, dx: i32, dy: i32) -> io::Result<()> {
        debug!("move_rel dx={} dy={}", dx, dy);
        self.emit(EV_REL, REL_X, dx)?;
        self.emit(EV_REL, REL_Y, dy)?;
        self.syn()
    }

    pub fn click(&mut self, button: &str) -> io::Result<()> {
        debug!("click button={}", button);
        let code = match button {
            "right" => BTN_RIGHT,
            "middle" => BTN_MIDDLE,
            _ => BTN_LEFT,
        };
        self.emit(EV_KEY, code, 1)?;
        self.syn()?;
        self.emit(EV_KEY, code, 0)?;
        self.syn()
    }

    pub fn key(&mut self, code_name: &str, down: bool) -> io::Result<()> {
        debug!("key code={} down={}", code_name, down);
        if let Some(code) = key_code(code_name) {
            self.emit(EV_KEY, code, if down { 1 } else { 0 })?;
            self.syn()?;
        }
        Ok(())
    }

    pub fn is_typeable(&self, ch: char) -> bool {
        ascii_key_code(ch).is_some()
    }

    pub fn type_text(&mut self, text: &str) -> io::Result<()> {
        info!("type_text: '{}' ({} chars)", text, text.chars().count());
        for ch in text.chars() {
            if let Some(code) = ascii_key_code(ch) {
                info!("type_text char '{}' -> keycode {}", ch, code);
                if needs_shift(ch) {
                    self.emit(EV_KEY, 42, 1)?;
                    self.syn()?;
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                self.emit(EV_KEY, code, 1)?;
                self.syn()?;
                // Brief hold so terminal recognizes the keystroke
                std::thread::sleep(std::time::Duration::from_millis(8));
                self.emit(EV_KEY, code, 0)?;
                self.syn()?;
                if needs_shift(ch) {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    self.emit(EV_KEY, 42, 0)?;
                    self.syn()?;
                }
                // Gap between characters
                std::thread::sleep(std::time::Duration::from_millis(12));
            }
        }
        Ok(())
    }

    pub fn scroll(&mut self, dy: i32) -> io::Result<()> {
        debug!("scroll dy={}", dy);
        self.emit(EV_REL, REL_WHEEL, dy)?;
        self.syn()
    }
}

impl Drop for UinputDevice {
    fn drop(&mut self) {
        unsafe {
            libc::ioctl(self.fd.as_raw_fd(), UI_DEV_DESTROY);
        }
    }
}
