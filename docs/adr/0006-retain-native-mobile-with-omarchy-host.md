# ADR 0006: Retain native mobile with the Omarchy Host

## Status

Accepted

## Decision

Keep the headless Rust Host and Quickshell desktop surface adopted by ADR 0004.
Restore and maintain the Expo native phone/tablet app. Restricting the desktop
target to Omarchy does not remove Android/iOS as controller platforms.

Native DNS-SD discovery, QR pairing, credential verification and SecureStore,
native input controls, one-click Polkit submission, password replacement/retry,
and the separate Android development client are product requirements.

The browser surface is a secondary fallback, not the native app's replacement.
The browser-only authorization implementation introduced during integration is
removed. The shared Host protocol remains available to the native client.

## Consequences

- `host/`, `omarchy-plugin/`, and `mobile-app/` are maintained together.
- Tauri, AppKit, and Windows desktop implementations remain retired.
- Preserve the existing mobile identifiers and secure storage keys so installed
  clients can keep their pairings; any OmaPad identity change needs a separate
  migration covering both desktop and mobile state.
- CI runs native tests and type checking alongside Rust and contract checks.
- Real phone discovery, pairing and authorization remain deployment acceptance
  requirements. Unit tests alone do not prove a deployed phone-to-Host chain.
