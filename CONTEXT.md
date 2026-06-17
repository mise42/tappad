# Mobile Input Surface — Domain Vocabulary

## What this project is

A mobile input surface for controlling a desktop machine from a phone or tablet. The mobile surface sends pointer, keyboard, text, paste, and desktop action intent to a target backend.

## Core language

**Mobile Input Surface**:
The browser-based control surface that turns a phone or tablet into an input peripheral for a desktop machine.
TapPad is a mobile input surface, not a remote desktop.

**Desktop Host Surface**:
The target-desktop interface that helps a user start TapPad, pair a mobile device, inspect connection status, grant permissions, and change local settings.
Each supported target backend has a desktop host surface; Linux requires a GUI desktop host surface rather than only a command-line process.

**Target Backend**:
The desktop-side backend that receives mobile input and applies it to the target desktop environment. Omarchy/Linux and macOS are different target backends.

**Platform Input Device**:
The target-backend capability that applies pointer, click, scroll, key, and typed-text input to the target desktop.

**Current Backend**:
The target backend that already proves the product experience today. For this project, the current backend is Omarchy/Linux.

**First Commercial Backend**:
The first target backend intended to prove paid product value. For this project, the first commercial backend is macOS; Omarchy/Linux remains an existing supported backend rather than the initial commercial wedge.

**First Buyer**:
A MacBook user working with an external display who wants a phone or tablet to become a temporary trackpad, keyboard, and control pad.

**Product Name**:
TapPad is the public product name.

**Use Scenario**:
A concrete situation where a first buyer reaches for TapPad, such as vibe coding on an external display, temporary trackpad use, text transfer, or presentation control. A use scenario is not a product category or product name.

**Desktop Action**:
An intentional action requested by the mobile input surface, such as taking a screenshot, changing workspace, or controlling media playback.

## Input paths

**Text Transfer**:
The user intent to send text created on the mobile input surface into the currently focused place on the target desktop.

There are **two distinct ways** text reaches the target window:

- **Type** — Sends text as keyboard input.
- **Paste** — Sends text through the target desktop's paste path.

These are not interchangeable. Both serve text transfer, but Type is for keyboard-like text entry; Paste is for clipboard-like text entry.

## Command path

There are **two ways** the frontend can trigger desktop actions:

- **Cmd** — Sends an intentional desktop action name, such as `screenshot` or `media.play_pause`.
- **Exec** — Sends a raw target-specific command as an escape hatch for ad-hoc automation.

## Modules

- **Protocol Router** — Classifies mobile input messages and routes them to the correct target backend capability.
- **Input Device** — Represents pointer, click, scroll, keyboard, and typed-text input on the target desktop.
- **Clipboard Gateway** — Represents clipboard-like text transfer on the target desktop.
- **Command Registry** — Maps desktop action names to target backend behavior.
- **Runtime Context** — The target desktop environment available to a backend while TapPad is running.
