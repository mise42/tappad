# Omarchy Touchpad — Domain Vocabulary

## What this project is

A browser-based remote touchpad for Omarchy (Hyprland on Arch Linux). It serves a mobile web UI that sends input events (pointer movement, clicks, scroll, keyboard) to a Linux desktop via the `uinput` subsystem.

## Input paths

There are **two distinct ways** text reaches the target window:

- **Type** (`device.type(text)`) — Simulates individual keystrokes via `uinput`. Works in any window that accepts keyboard input, including terminals. No dependency on clipboard or focus.
- **Paste** (`gateway.paste(text)`) — Writes text to the Wayland clipboard via `wl-copy`, then simulates `Ctrl+V` via `uinput`. Only works in GUI applications that support clipboard paste. Depends on the target window having focus.

These are not interchangeable. The frontend sends `{ type: "text" }` for typing and `{ type: "paste" }` for pasting. The backend must route each to the correct path.

## Modules

- **Protocol Router** — Parses WebSocket frames, classifies input events, and routes them to the Input Device or Clipboard Gateway.
- **Input Device** — Abstracts `uinput` event generation. Interface: `move(dx,dy)`, `click(button)`, `key(code,down)`, `type(text)`, `scroll(dy)`. Adapters implement the binary protocol (UinputAdapter) or record for tests (TestAdapter).
- **Clipboard Gateway** — Orchestrates clipboard copy + paste shortcut. Owns the async queue, `wl-copy` spawn, delay, and `Ctrl+V` sequence.
- **Runtime Context** — Frozen desktop environment (Wayland display, Hyprland session) resolved once at startup. Passed to modules that need it.
