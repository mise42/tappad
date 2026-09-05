# Contributing to TapPad

TapPad is an open-source, Omarchy-native Mobile Input Surface. Contributions
should improve a real use scenario on current Omarchy or simplify the maintained
architecture.

## Before starting

1. Search the existing [issues](https://github.com/miselabs/tappad/issues).
2. Open an issue for behavior changes, Desktop Actions, Host Contract changes,
   Device Authorization, or Quickshell integration.
3. Include the Omarchy version and the user-visible outcome.

Small fixes, tests, and documentation corrections may go directly to a pull
request.

## Maintained architecture

The headless TapPad Host lives in `host/`. Do not add macOS, Windows,
generic-Linux, AppKit, or Tauri desktop features. Keep desktop UI in the Omarchy
Quickshell plugin and the primary phone UI in the native Expo `mobile-app/`.
Native discovery, QR pairing, SecureStore, authorization, and Android dev-client support are maintained requirements. The browser surface is a secondary fallback.

Current checks are:

```bash
pnpm install --frozen-lockfile
pnpm test
cargo test --manifest-path host/Cargo.toml
```

The maintained acceptance flow runs on current Omarchy.

## Design rules

- Keep TapPad a Mobile Input Surface, not a remote desktop.
- Keep mobile input traffic local to the Community User's network.
- Keep input injection, networking, Device Authorization, and concurrency in
  the headless Rust Host rather than the Quickshell process.
- Keep the Quickshell-to-Host command interface small and avoid reading private
  settings files directly from QML.
- Never accept raw shell commands from the Mobile Input Surface. Add a named,
  reviewed Desktop Action instead.
- Do not expose pairing credentials in logs, process arguments, screenshots, or
  telemetry.

## Pull requests

Include the use scenario, Omarchy version, verification commands, end-to-end
result, and screenshots for visible Shell or Mobile Input Surface changes.

By contributing, you agree that your contribution is licensed under the MIT
License used by this repository.
