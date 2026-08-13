# Codex Voice Desktop Actions

Codex voice controls use named Desktop Actions. Clients send only the action id;
the Desktop Host owns capability discovery and target-specific execution.

| Action id | Intended result | Audited Linux scope | Current availability |
| --- | --- | --- | --- |
| `codex.voice.start` | Dispatch Codex's configured Voice Chat hotkey | `os-global` | Supported only while Codex desktop is installed, running, and has a readable, safely dispatchable `realtimeVoice` binding |
| `codex.voice.start_foreground` | Send Codex's app-scoped Toggle Voice Chat shortcut | `app` | Supported only when the installed `composer.startVoiceMode` command metadata is safely readable and Codex is strongly verified as foreground |
| `codex.voice.end` | Send Codex's configured End Voice Chat shortcut | `app` | Supported only while the foreground Hyprland window is strongly verified as the installed Codex app |
| `codex.voice.toggle_microphone` | Send Codex's configured microphone shortcut | `app` | Supported only while the foreground Hyprland window is strongly verified as the installed Codex app |

The Linux adapter reads the current Codex keybinding instead of assuming a key
chord. A successful `codex.voice.start` action means TapPad dispatched that
configured chord. It does not prove that Codex started a voice session because
Codex does not currently expose a session-state acknowledgement to TapPad.
The Host exposes the resolved chord as additive `binding` metadata so the native
mobile UI can display what will be sent without hardcoding a key.
For this action the Host sends an `actionResult` only after input dispatch
returns. The mobile surface shows “hotkey sent” only for that acknowledgement;
a transport send alone is shown as pending, and a dispatch error is surfaced.

`codex.voice.end` and `codex.voice.toggle_microphone` remain app-scoped. The
Linux adapter reads their current Codex keybindings and advertises them as
supported only when `hyprctl activewindow -j` reports Codex for both `class`
and `initialClass`, and the active PID's executable resolves to a supported
installed Codex executable. The adapter repeats that identity check immediately
before dispatch. It never focuses or restores Codex. A successful result means
only that the configured app shortcut was sent; it does not confirm that a
session ended or microphone state changed.

`codex.voice.start_foreground` is separate from the OS-global Start action. The
Host verifies from the installed Codex ASAR command registry that
`composer.startVoiceMode` is app-scoped. Its effective binding follows Codex's
own precedence: a unique user keybinding override wins; otherwise the unique
Linux/default binding is read from the installed command metadata. The Host
does not hardcode that default. Malformed, missing, ambiguous, or scope-mismatched
metadata makes the capability unavailable. Foreground identity and final
pre-dispatch rechecks are identical to End and Mute. Success means only that the
effective shortcut was sent, not that voice chat started.

Other unavailable conditions use stable reason codes so a future client can
explain the boundary without parsing prose:

- `codex_not_installed`
- `codex_not_running`
- `codex_home_unavailable`
- `codex_bindings_unreadable`
- `codex_bindings_invalid`
- `codex_global_binding_missing`
- `codex_global_binding_ambiguous`
- `codex_global_binding_unsupported`
- `codex_runtime_unreadable`
- `codex_platform_not_verified`
- `codex_app_binding_missing`
- `codex_app_binding_ambiguous`
- `codex_app_binding_unsupported`
- `codex_app_metadata_unreadable`
- `codex_app_metadata_ambiguous`
- `codex_app_command_missing`
- `codex_app_command_ambiguous`
- `codex_app_command_scope_mismatch`
- `codex_not_foreground`
- `codex_foreground_unreadable`
- `codex_foreground_identity_mismatch`

No action accepts a raw shell command from a client. Execution remains inside
the Command Registry and platform adapter boundary.

The native Actions panel renders compact Start, Start here, End, and Mute
buttons when the Host advertises Codex voice capabilities. Start retains its
OS-global gate. Start here, End, and Mute are enabled only for supported
app-scoped capabilities; otherwise they stay visible with a short disabled
label. While Actions is visible, the app
refreshes capabilities so foreground changes are reflected without reconnecting.
Platforms that advertise only the unverified `unknown` scope keep the existing
Actions UI and omit this Linux-specific control group.
The mobile surface refreshes the Host manifest when its WebSocket becomes ready,
so reconnecting can pick up a newly started Codex process or a changed binding.
