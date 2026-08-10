# Desktop Host Surface

## Purpose

The desktop host surface gives each target desktop a consistent way to start TapPad, pair a mobile device, inspect local readiness, and adjust local runtime settings.

TapPad should feel like one product across macOS, Windows, and Linux even when each target backend uses different platform APIs.

## Platform posture

- macOS, Windows, and Linux share the Tauri host surface.
- The previous native AppKit macOS host is reference code, not an active product path.
- A macOS-specific adapter should be added only for a verified native capability gap and should not duplicate the complete host.
- Linux requires a GUI host surface rather than only a command-line runtime.
- Linux launch-at-login, backend lifecycle, and local-name publication should be owned by the Tauri host surface, not by a separate systemd service or fallback path.

## Default local connection journey

The preferred Omarchy/Linux journey is:

1. The Tauri Desktop Host starts at login and remains available in the background.
2. While its backend is available, the host publishes a collision-resistant `tappad-<host-id>.local` alias and the `_tappad._tcp.local` DNS-SD service on the local network. The operating system remains the owner of its conventional `<hostname>.local` name.
3. A browser user opens the host-specific TapPad alias, such as `http://tappad-a1b2c3d4.local:8765`; the TapPad Mobile App discovers the same endpoint from DNS-SD and presents the friendly computer name instead of the alias.
4. The phone operating system resolves the known local name to the host's current LAN address.
5. The Desktop Host learns about the mobile device only when the browser connects.
6. On first use, the user authorizes the device with a short PIN, desktop confirmation, or another one-time approval. The approved device receives a persistent device credential.
7. Later visits reconnect automatically while that credential remains valid.

The intended experience is therefore `select nearby host or open the TapPad .local alias -> authorize once -> reconnect automatically`.

This is stable name resolution, not browser-driven service discovery. An ordinary web page cannot enumerate `_tappad._tcp.local` or present a list of nearby TapPad hosts. The TapPad Mobile App browses that service record and presents the nearby-host list.

mDNS supplies an address route only. It does not authorize a mobile device. The operating system owns the conventional machine `hostname.local`; TapPad's embedded responder owns its separate `tappad-<host-id>.local` alias, while the user-friendly TapPad label belongs to the DNS-SD service instance. QR remains a fallback for `.local` resolution failure, local-name conflict, or fast first-time pairing; it is not required in the normal journey.

## Minimum common contract

Every desktop host surface should provide these areas:

- **Access and pairing**: host-specific `.local` address, first-use device authorization, remembered-device state, QR fallback, copy link, and open local web UI.
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
