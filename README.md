# TapPad

TapPad is an open-source, **Omarchy-native Mobile Input Surface**. It turns a
phone or tablet into a local trackpad, keyboard, text-transfer surface, and
Desktop Action pad for an Omarchy computer.

TapPad is an independent community project. It is not affiliated with or
endorsed by Omarchy or the Omacom Foundation.

## What it does

- Pointer movement, click, drag, and scroll from a touch screen
- Keyboard shortcuts and text transfer
- Local-network access with persistent Device Authorization
- Omarchy actions for workspaces, screenshots, screen recording, media, window
  control, Walker, and lock
- A native Expo phone/tablet app with nearby Host discovery, QR pairing, secure credential storage, and one-click Omarchy authorization
- A Host-served browser surface as a secondary fallback

Input stays between the phone or tablet and the Omarchy machine on the local
network. TapPad is not a remote desktop or cloud relay.

## Omarchy architecture

TapPad has three maintained runtime modules:

1. **TapPad Host** — a small headless Rust process that owns input injection,
   the LAN WebSocket, Device Authorization, mDNS, settings, and named Desktop
   Actions.
2. **TapPad Shell Surface** — an Omarchy Quickshell plugin that owns status,
   readiness, pairing, and lifecycle controls.

3. **TapPad Mobile App** — the native Expo client for discovery, pairing, secure storage, input, and authorization.

The Host Contract remains the interface between the native Mobile Input
Surface and the TapPad Host. Quickshell replaces the former desktop window and
tray; it does not absorb the network server or input backend into the
long-running Omarchy Shell process.

## Repository layout

The Rust Host lives in `host/`; the Quickshell plugin lives in
`omarchy-plugin/`; the native phone UI lives in `mobile-app/`. The secondary browser surface lives in `mobile/`. The previous Tauri, native macOS, and Windows desktop implementations have been removed; Expo is maintained.

The only supported desktop target is current Omarchy. The native mobile client retains Android and iOS support; see [mobile-app/README.md](mobile-app/README.md) for development builds.

## Install on Omarchy

Download and extract the Omarchy release, then run:

```bash
./install.sh
```

This installs the headless Host as a systemd user service and enables the
TapPad Quickshell widget. Run `./uninstall.sh` from the extracted release to
remove the service, binary, and plugin; pairing settings are intentionally kept.

## Development

Current checks:

```bash
pnpm install --frozen-lockfile
pnpm test
cargo test --manifest-path host/Cargo.toml
omarchy plugin validate ./omarchy-plugin
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing behavior or protocol
changes. Security issues should follow [SECURITY.md](SECURITY.md).

## Community direction

TapPad is maintained as a community contribution, not as a paid product. The
project tests and documents one supported environment: current Omarchy. New
work should simplify that path instead of preserving speculative portability.

## License

TapPad is released under the [MIT License](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
