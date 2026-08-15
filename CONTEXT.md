# Mobile Input Surface — Domain Vocabulary

## What this project is

A mobile input surface for controlling a desktop machine from a phone or tablet. The mobile surface sends pointer, keyboard, text, paste, and desktop action intent to a target backend.

## Core language

**Mobile Input Surface**:
The control surface that turns a phone or tablet into an input peripheral for a desktop machine. It may be delivered through the host-served web UI or the native TapPad Mobile App.
TapPad is a mobile input surface, not a remote desktop.

**TapPad Mobile App**:
The native phone and tablet shell that discovers nearby Desktop Host Surfaces, retains Paired Device credentials, and presents the Mobile Input Surface.

**Desktop Host Surface**:
The target-desktop interface that helps a user start TapPad, pair a mobile device, inspect connection status, grant permissions, and change local settings.
Each supported target backend has a desktop host surface; Linux requires a GUI desktop host surface rather than only a command-line process.

**Target Backend**:
The desktop-side backend that receives mobile input and applies it to the target desktop environment. Omarchy/Linux and macOS are different target backends.

**Host Adapter**:
The target-specific implementation through which the single Desktop Host realizes the Host Contract on a Target Backend. Adding a Host Adapter extends platform support without creating another Desktop Host or mobile protocol.
_Avoid_: Host implementation, when referring to an adapter

**Supported Target Backends**:
The desktop platforms with a TapPad host surface and backend path today: macOS, Windows, and Linux/Omarchy.

**Platform Input Device**:
The target-backend capability that applies pointer, click, scroll, key, and typed-text input to the target desktop.

**Cross-Platform Beta**:
The current product posture for the desktop host: macOS, Windows, and Linux/Omarchy are all beta target backends for validating the same mobile input surface and desktop host contract.

**Commercial Wedge**:
The buyer and platform focus used to prove paid value first. macOS was the first commercial wedge, but it is no longer the whole product position now that Windows and Linux host surfaces also exist.

**macOS Host Path**:
TapPad uses the cross-platform Tauri Desktop Host on macOS. The previous native AppKit implementation is retained only as reference code. If an observed macOS limitation requires native system integration, add a narrow macOS adapter without recreating the complete Desktop Host.

**First Buyer**:
A desktop user working across a larger screen, temporary desk setup, presentation setup, or second-screen workflow who wants a phone or tablet to become a temporary trackpad, keyboard, text surface, and control pad.

**Product Name**:
TapPad is the public product name.

**Use Scenario**:
A concrete situation where a first buyer reaches for TapPad, such as vibe coding on an external display, temporary trackpad use, text transfer, or presentation control. A use scenario is not a product category or product name.

**Desktop Action**:
An intentional action requested by the mobile input surface, such as taking a screenshot, changing workspace, or controlling media playback.

**Host Contract**:
The stable, platform-neutral interface between a Mobile Input Surface and a Desktop Host Surface. Target backends may implement it differently, but they share the same message meanings, authorization boundary, capability vocabulary, and result semantics.

**Capability Advertisement**:
A Desktop Host Surface's runtime declaration of which capabilities from the shared Host Contract are supported, unavailable, or intentionally hidden by its current Target Backend. It describes implementation availability without creating a target-specific mobile protocol.

## Connection and trust

**Stable Host Name**:
The known local name a user opens to reach one Desktop Host Surface. It provides a route to a host; it is neither host discovery nor proof that the connecting device is trusted.

**Device Authorization**:
The first-use trust decision that allows a mobile device to control a Desktop Host Surface. Local-network reachability alone never grants authorization.

**Paired Device**:
A mobile device that has completed Device Authorization and retained its device credential for later automatic reconnection. Pairing lasts until the credential is revoked, forgotten, or replaced.

**Nearby Host Discovery**:
The native-app capability that lists Desktop Host Surfaces advertising TapPad on the current local network. Discovery supplies connection candidates; it does not authorize control.

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

- **Protocol Router** — Classifies mobile input messages and routes them to the correct target backend capability.
- **Input Device** — Represents pointer, click, scroll, keyboard, and typed-text input on the target desktop.
- **Clipboard Gateway** — Represents clipboard-like text transfer on the target desktop.
- **Command Registry** — Maps desktop action names to target backend behavior.
- **Runtime Context** — The target desktop environment available to a backend while TapPad is running.
