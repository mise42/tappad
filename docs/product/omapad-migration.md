# OmaPad migration

## Target shape

OmaPad has three maintained modules:

- **OmaPad Host** — the headless Rust process that owns local networking,
  Device Authorization, input injection, discovery, and Desktop Actions;
- **OmaPad Shell Surface** — the Omarchy Quickshell interface for lifecycle,
  readiness, settings, and pairing; and
- **Mobile Input Surface** — the maintained native Expo app, with discovery, QR pairing, SecureStore, and authorization; the browser is a secondary fallback.

The Host Contract is the stable interface between the Mobile Input Surface and
the Host. The Shell Surface uses a separate, narrow local command interface.

## Migration phases

### 1. Retire the native macOS client

- Remove the complete AppKit implementation under `macos/`.
- Remove its build scripts, package manifest, resources, and generated local
  build artifacts.
- Keep historical ADRs intact and mark the active Omarchy ADR as the current
  decision.

Exit condition: no maintained source, workflow, package, or test requires the
native macOS client.

### 2. Finish the Omarchy-only architecture cleanup

- Keep `host/`, `omarchy-plugin/`, `mobile/`, and reversible packaging.
- Remove the Tauri Desktop Host, cross-platform desktop packaging from the maintained tree. Preserve the Expo native mobile app.
- Make the Quickshell Surface the only maintained desktop interface.

Exit condition: the repository test and release paths cover current Omarchy
without macOS, Windows, or generic-Linux desktop release jobs. Native Android/iOS app development and verification remain in scope.

### 3. Change the public product name

- Replace current human-facing `TapPad` copy with `OmaPad` in the README,
  website, Shell Surface, native mobile UI, browser fallback, documentation, and contribution files.
- Rename screenshots and other maintained assets when their filenames are part
  of public output.
- Preserve the old name inside historical ADR text where changing it would
  rewrite history.

Exit condition: a new Community User sees OmaPad consistently while legacy
installed commands remain explicitly labelled as transitional.

### 4. Cut over installed identity atomically

Change these identifiers together:

- `tappad-host` to `omapad-host`;
- `tappad-host.service` to `omapad-host.service`;
- Omarchy plugin id and local command names;
- `_tappad._tcp.local.` and `tappad-<host-id>.local` to OmaPad equivalents;
- `~/.config/tappad` to `~/.config/omapad`;
- Cargo/package metadata, release artifact names, and download manifest keys.

The installer must detect a legacy installation, stop it, migrate persistent
settings only when safe, and prevent both services from running concurrently.
The uninstaller must remove both current and legacy service/plugin identifiers
without deleting unrelated user data.

Exit condition: a clean install, a legacy upgrade, and an uninstall all leave
exactly one known state, with no duplicate discovery records or services.

### 5. Rename external project surfaces and release

- Rename the GitHub repository and update source links after the local tree is
  internally consistent.
- Update the public site and download storage/configuration in one release pass.
- Publish only after the current-Omarchy acceptance flow covers install, pairing,
  pointer and keyboard input, Desktop Actions, restart, upgrade, and removal.

Exit condition: source, installation, discovery, website, and release artifacts
all present OmaPad, and the tested Omarchy version is recorded.

## Compatibility rule

This is an early open-source rename, so indefinite compatibility aliases are
not required. One release must nevertheless understand enough legacy TapPad
state to perform a safe upgrade or complete removal. After that release, the
legacy code path can be removed explicitly.
