# Mobile Input Surface

## Purpose

The mobile input surface is the phone or tablet control UI for TapPad. It should present one consistent product experience across supported target backends.

## Action and media parity

Actions and media controls promoted into the action parity set are part of the cross-platform product baseline.

macOS, Windows, and Linux should implement the action parity set rather than relying on platform-specific hiding for baseline controls. Future controls may still be gated until they are promoted into the shared baseline.

Parity means user-result parity, not identical system commands. Each target backend may use the platform-native equivalent for an action as long as the user-facing outcome matches the shared action intent.

## Action Parity Set

The current cross-platform action parity set is:

- `screenrecord.screen`
- `screenrecord.window`
- `screenrecord.screen.audio`
- `screenrecord.stop`
- `open_recordings_folder`
- `screenshot`
- `close_window`
- `app_launcher`
- `nightlight.toggle`
- `lock_screen`
- `media.prev`
- `media.play_pause`
- `media.next`
- `media.volume_down`
- `media.mute`
- `media.volume_up`

## Deferred Actions

`screenrecord.screen.webcam` is not part of the initial macOS and Windows parity baseline. It may remain available on Linux/Omarchy and can be promoted into the shared baseline later.

Deferred actions should be hidden on unsupported target backends rather than shown as disabled controls.

## Recording Output

Screen recordings should be saved to a TapPad folder inside the platform's standard video directory:

- macOS: `~/Movies/TapPad`
- Windows: `%USERPROFILE%\Videos\TapPad`
- Linux: `~/Videos/TapPad`

`open_recordings_folder` opens this TapPad recording folder.

## Recording Semantics

`screenrecord.window` records the currently active window without showing a picker. If the target backend cannot identify or capture the active window, it may fall back to recording the current screen and should surface that fallback to the user.

`screenrecord.screen.audio` records the current screen with both system output audio and microphone input audio. If a target backend can only capture one audio source, it should surface that capability downgrade to the user.

Only one TapPad recording session may be active at a time. `screenrecord.stop` stops the current TapPad recording session; starting another recording while one is active should not create a second simultaneous recording session.

`screenshot` captures the current screen without showing a picker and uses the platform's default screenshot destination or screenshot mechanism.

`close_window` closes the currently active window using the platform-standard close-window behavior. It should not force-quit an application or close TapPad itself as a destructive fallback.

`app_launcher` opens the platform's search-style application launcher so the user can type an app or command name. Examples include Spotlight on macOS, Start/Search on Windows, and Walker on Omarchy/Linux.

`nightlight.toggle` toggles the platform's system-level night color or eye-comfort mode. It should not be implemented as a TapPad-specific screen filter.
