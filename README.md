# TapPad

TapPad is a browser-based mobile input surface. It serves a small mobile web UI
that can turn a phone or tablet into a pointer, keyboard, and paste bridge.

The current macOS backend is a native AppKit app. The Linux/Omarchy backend is a
Rust server that sends input through `uinput`.

## macOS

```bash
cd ~/Work/personal/tappad/macos/TapPad
./scripts/build_app.sh
open .dist/TapPad.app
```

TapPad runs as a menu bar app. Use the menu to open Settings, show the pairing
QR code, copy the pairing link, or check Accessibility permission.

For development:

```bash
cd ~/Work/personal/tappad/macos/TapPad
swift run TapPad
```

## Linux / Omarchy

```bash
cd ~/Work/personal/tappad
cargo run --release
```

For a shared Tailnet or LAN, set an explicit token:

```bash
TOUCHPAD_TOKEN='change-me' cargo run --release
```

Then open:

```text
http://100.113.201.90:8765/?token=change-me
```

## Controls

- One finger move: pointer movement
- Single tap: left click
- Double tap: normal double click
- Long press: right click
- Two finger drag: scroll
- Text box: writes text through paste injection
- Shortcut buttons: Cmd/Super, Esc, Tab, Enter, Backspace, arrows, and common modifiers

## Linux Requirements

- `ydotool` installed
- `ydotool.service` running as the user
- `/dev/uinput` writable by the user

Checked on `omarchy`:

```text
ydotool 1.0.4-2
ydotool.service active
/run/user/1000/.ydotool_socket
```
