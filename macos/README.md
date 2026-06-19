# TapPad macOS Backend

Swift/AppKit backend for the TapPad mobile input surface.

## Run

```bash
cd macos
swift run TapPad
```

Then open:

```text
http://127.0.0.1:8765
```

From a phone or tablet on the same LAN, open the Mac's LAN address on port `8765`.
The app also opens a pairing window with a QR code and tokenized link.

## Environment

- `TAPPAD_MOBILE_ROOT` — optional path to the shared `mobile/` frontend

## Current Scope

- Pointer move, click, and scroll use CoreGraphics `CGEvent`.
- Key presses and typed text use CoreGraphics keyboard events.
- Paste uses AppKit `NSPasteboard`, then sends Command+V.
- A pairing window shows a QR code, LAN URL, `.local` backup URL, and Accessibility status.
- Raw shell-command messages are not part of the mobile protocol.
- Media commands are a first small registry and may move to deeper native APIs later.
- Screen recording is not implemented yet; use ScreenCaptureKit when this scope opens.

## Shape

The mobile Web UI and JSON protocol stay shared with the desktop host backend. macOS owns the native backend capabilities:

- `Input/` — pointer, scroll, key, and typed text
- `Clipboard/` — paste path
- `Commands/` — desktop actions
- `Server/` — HTTP/WebSocket transport
- `App/` — AppKit lifecycle and permission prompt
