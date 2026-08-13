# TapPad

TapPad is a browser-based Mobile Input Surface. It turns a phone or tablet into
a pointer, keyboard, paste bridge, and Desktop Action pad for a nearby desktop.

The shared mobile web UI lives in `mobile/`.

## Legacy native macOS reference

The previous native AppKit Desktop Host is retained as reference code. It is not
an active product or release path; macOS uses the Tauri Desktop Host below.

```bash
cd ~/Work/personal/tappad/macos
./scripts/build_app.sh
open .dist/TapPad.app
```

The packaging script can still create `.dist/TapPad-mac.zip` for local
inspection, but that archive is not part of the active public download flow.

To run the legacy implementation for reference or debugging:

```bash
cd ~/Work/personal/tappad/macos
swift run TapPad
```

## Tauri Desktop Host

Linux, macOS, and Windows share one active Tauri Desktop Host Surface and one
Rust backend. A narrow macOS-specific adapter may be added later if a verified
system-integration limitation requires it.

```bash
cd ~/Work/personal/tappad/desktop
pnpm install
pnpm run dev
```

The Tauri app owns the backend lifecycle, pairing token, local settings,
launch-at-login preference, and the Desktop Host Surface. Settings are stored in
the Tauri app local data directory. Saving the port or token hot-restarts the
backend only after the new listener binds successfully.

The local backend serves:

- Mobile Input Surface: `http://<host>:<port>/?token=<pairing-token>`
- Sanitized host state: `http://<host>:<port>/api/host-state`
- Token-gated WebSocket: `ws://<host>:<port>/ws?token=<pairing-token>`

## Controls

- One finger move: pointer movement
- Single tap: left click
- Double tap: normal double click
- Long press: right click
- Two finger drag: scroll
- Text box: text transfer
- Shortcut buttons: Cmd/Super, Esc, Tab, Enter, Backspace, arrows, and common modifiers

## Desktop Actions

The mobile protocol accepts named Desktop Action ids through `cmd` messages.
Arbitrary shell-command messages are not part of the product protocol.

Linux/Omarchy actions include screenshot, screen recording, media controls,
window close, launcher, and lock. Windows exposes the same action
ids with explicit downgraded states where native capture work has not shipped.
