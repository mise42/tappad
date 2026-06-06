# Omarchy Touchpad — Domain Vocabulary

## What this project is

A browser-based remote touchpad for Omarchy (Hyprland on Arch Linux). It serves a mobile web UI that sends input events (pointer movement, clicks, scroll, keyboard) and automation commands to a Linux desktop via the `uinput` subsystem and shell execution.

## Input paths

There are **two distinct ways** text reaches the target window:

- **Type** (`device.type(text)`) — Simulates individual keystrokes via `uinput`. Works in any window that accepts keyboard input, including terminals. No dependency on clipboard or focus.
- **Paste** (`gateway.paste(text)`) — Writes text to the Wayland clipboard via `wl-copy`, then simulates `Ctrl+V` via `uinput`. Only works in GUI applications that support clipboard paste. Depends on the target window having focus.

These are not interchangeable. The frontend sends `{ type: "text" }` for typing and `{ type: "paste" }` for pasting. The backend must route each to the correct path.

## Command path

There are **two ways** the frontend can trigger desktop actions:

- **Cmd** (`{ type: "cmd", action: "screenshot" }`) — Sends an intentional action name. The backend's **Command Registry** maps generic action names to platform-specific shell commands (e.g., `screenshot` → `omarchy capture screenshot`). This is portable across platforms — only the registry entries change.
- **Exec** (`{ type: "exec", command: "..." }`) — Sends a raw shell command string directly. An escape hatch for ad-hoc automation. Tightly coupled to the target OS.

## Modules

- **Protocol Router** — Parses WebSocket frames, classifies input events and commands, and routes them to the Input Device, Clipboard Gateway, or Command Registry.
- **Input Device** — Abstracts `uinput` event generation. Interface: `move(dx,dy)`, `click(button)`, `key(code,down)`, `type(text)`, `scroll(dy)`. Adapters implement the binary protocol (UinputAdapter) or record for tests (TestAdapter).
- **Clipboard Gateway** — Orchestrates clipboard copy + paste shortcut. Owns the async queue, `wl-copy` spawn, delay, and `Ctrl+V` sequence.
- **Command Registry** — Maps generic action names (e.g., `screenshot`, `workspace.3`, `media.play_pause`) to platform-specific shell commands. Hardcoded per platform; the frontend sends intentional names, not OS commands.
- **Runtime Context** — Frozen desktop environment (Wayland display, Hyprland session) resolved once at startup. Passed to modules that need it.
