# Desktop Host Surface

## Purpose

The desktop host surface gives each target desktop a consistent way to start TapPad, pair a mobile device, inspect local readiness, and adjust local runtime settings.

TapPad should feel like one product across macOS, Windows, and Linux even when each target backend uses different platform APIs.

## Platform posture

- macOS keeps a native host surface.
- Windows and Linux may share a Tauri host surface.
- Linux requires a GUI host surface rather than only a command-line runtime.

## Minimum common contract

Every desktop host surface should provide these areas:

- **Pairing**: QR code, primary pairing link, fallback pairing link, copy link, and open local web UI.
- **Server Status**: running state, port, bind address, LAN-reachable address, and token state.
- **Readiness**: platform permissions or dependencies needed before pointer, keyboard, text transfer, paste, and desktop actions can work.
- **Settings**: port, token, launch at login, and reset pairing token.

## Readiness Scope

Readiness should be shown in layers:

- **Core input readiness**: pointer, keyboard, text transfer, and paste.
- **Action readiness**: screenshot, recording, audio capture, window control, night color, and media control.
- **Deferred action readiness**: only shown for deferred actions that are visible on the current target backend, such as webcam recording on Linux/Omarchy.

## Boundary

The desktop host surface is not the mobile control UI. Actions and media controls remain part of the mobile input surface, but the mobile input surface should only expose desktop actions that the current target backend can actually handle.
