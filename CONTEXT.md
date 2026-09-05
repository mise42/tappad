# Mobile Input Surface — Domain Vocabulary

## What this project is

A mobile input surface for controlling an Omarchy machine from a phone or tablet. The mobile surface sends pointer, keyboard, text, paste, and Desktop Action intent to the TapPad Host.

## Core language

**Mobile Input Surface**:
The browser control surface that turns a phone or tablet into an input peripheral for an Omarchy machine. It is served by the TapPad Host.
TapPad is a mobile input surface, not a remote desktop.

**TapPad Host**:
The headless Rust process that receives mobile input and applies it to Omarchy. It owns Device Authorization, the Host Contract, local networking, discovery, settings, input injection, and Desktop Actions.

**TapPad Shell Surface**:
The Omarchy Quickshell interface that helps a Community User start or stop the TapPad Host, pair a mobile device, and inspect readiness. It does not implement input injection or expose pairing credentials through shell IPC.

**Target Backend**:
The desktop environment controlled by the TapPad Host. Omarchy is TapPad's Target Backend.

**Supported Target Backends**:
The desktop environments covered by the maintained product promise and acceptance flow. Current Omarchy is the only Supported Target Backend.

**Platform Input Device**:
The target-backend capability that applies pointer, click, scroll, key, and typed-text input to the target desktop.

**Omarchy-native**:
The project's open-source posture: integrate with the current Omarchy Shell, commands, lifecycle, and conventions without maintaining cross-platform UI or release abstractions.

**Community User**:
A person using, testing, reporting on, or contributing to TapPad. Community Users are not customers and the project does not promise commercial support or platform parity.

**Product Name**:
OmaPad is the public product name. `TapPad` remains only as a legacy identifier
during the repository and installed-state migration described in
`docs/product/omapad-migration.md`.

**Use Scenario**:
A concrete situation where a Community User reaches for TapPad, such as controlling an Omarchy machine from a phone, vibe coding on an external display, temporary trackpad use, text transfer, or presentation control. A use scenario is not a product category or product name.

**Desktop Action**:
An intentional action requested by the mobile input surface, such as taking a screenshot, changing workspace, or controlling media playback.

**Host Contract**:
The stable interface between the Mobile Input Surface and the TapPad Host. It defines message meanings, Device Authorization, capability vocabulary, and result semantics.

**Capability Advertisement**:
The TapPad Host's runtime declaration of capabilities available in the current Omarchy environment.

## Connection and trust

**Stable Host Name**:
The known local name a user opens to reach one TapPad Host. It provides a route to a host; it is neither discovery nor proof that the connecting device is trusted.

**Device Authorization**:
The first-use trust decision that allows a mobile device to control a TapPad Host. Local-network reachability alone never grants authorization.

**Paired Device**:
A mobile device that has completed Device Authorization and retained its device credential for later automatic reconnection. Pairing lasts until the credential is revoked, forgotten, or replaced.

## Input paths

**Text Transfer**:
The user intent to send text created on the mobile input surface into the currently focused place on the target desktop.

There are **two distinct ways** text reaches the target window:

- **Type** — Sends text as keyboard input.
- **Paste** — Sends text through the target desktop's paste path.

These are not interchangeable. Both serve text transfer, but Type is for keyboard-like text entry; Paste is for clipboard-like text entry.

## Desktop Action path

The frontend triggers desktop actions through named action ids:

- **Cmd** — Sends an intentional desktop action name, such as `screenshot` or `media.play_pause`.

Raw target-specific shell-command messages are outside the product protocol.

## Modules

- **TapPad Host** — Owns the local server, trust state, lifecycle of input handling, and the Host Contract.
- **TapPad Shell Surface** — Presents TapPad inside Omarchy Quickshell through a narrow local command/IPC interface.
- **Protocol Router** — Classifies mobile input messages and routes them to the correct Omarchy capability.
- **Input Device** — Represents pointer, click, scroll, keyboard, and typed-text input on the target desktop.
- **Clipboard Gateway** — Represents clipboard-like text transfer on the target desktop.
- **Command Registry** — Maps desktop action names to target backend behavior.
- **Runtime Context** — The target desktop environment available to a backend while TapPad is running.
