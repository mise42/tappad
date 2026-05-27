# Omarchy Touchpad

Browser touchpad for `omarchy`. It serves a small mobile web UI and sends input
events to Hyprland through `ydotoold`. The server is a zero-dependency Node.js
app.

## Run

```bash
cd ~/Work/personal/omarchy-touchpad
npm start
```

Open from an iPad or phone on the same LAN/Tailnet:

```text
http://100.113.201.90:8765
```

For a shared Tailnet, use a token:

```bash
TOUCHPAD_TOKEN='change-me' npm start
```

Then open:

```text
http://100.113.201.90:8765/?token=change-me
```

## Controls

- One finger move: pointer movement
- Single tap: left click
- Double tap: right click
- Two finger drag: scroll
- Text box: writes text to the Omarchy clipboard, then sends Ctrl+V
- Shortcut buttons: Super is always visible; Esc, Tab, Enter, Backspace, and arrow keys are in the expandable key area

## Requirements

- `ydotool` installed
- `ydotool.service` running as the user
- `/dev/uinput` writable by the user

Checked on `omarchy`:

```text
ydotool 1.0.4-2
ydotool.service active
/run/user/1000/.ydotool_socket
```
