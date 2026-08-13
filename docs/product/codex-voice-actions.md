# Codex Voice Desktop Actions

Codex voice controls use named Desktop Actions. Clients send only the action id;
the Desktop Host owns capability discovery and target-specific execution.

| Action id | Intended result | Audited Linux scope | Current availability |
| --- | --- | --- | --- |
| `codex.voice.start` | Dispatch Codex's configured Voice Chat hotkey | `os-global` | Supported only while Codex desktop is installed, running, and has a readable, safely dispatchable `realtimeVoice` binding |
| `codex.voice.end` | End the active Voice Chat | `app` | Unavailable for background control |
| `codex.voice.toggle_microphone` | Mute or unmute the Voice Chat microphone | `app` | Unavailable for background control |

The Linux adapter reads the current Codex keybinding instead of assuming a key
chord. A successful `codex.voice.start` action means TapPad dispatched that
configured chord. It does not prove that Codex started a voice session because
Codex does not currently expose a session-state acknowledgement to TapPad.

`codex.voice.end` and `codex.voice.toggle_microphone` remain visible in the Host
capability manifest with `state: unavailable`, `scope: app`, and
`reasonCode: codex_app_scope_only`. The Host must not focus Codex, inject the
app-only shortcuts, or claim those actions work globally.

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

No action accepts a raw shell command from a client. Execution remains inside
the Command Registry and platform adapter boundary.
