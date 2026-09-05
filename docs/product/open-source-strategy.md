# Open-source strategy

## Product position

TapPad is an open-source, Omarchy-native Mobile Input Surface. It turns a phone
or tablet into an input peripheral and Desktop Action pad for an Omarchy
machine. It is not a remote desktop.

## Community posture

TapPad exists as a contribution to the Omarchy community. It does not require a
paid license, online activation, an account, lead capture, or cross-platform
parity.

Omarchy is the only Supported Target Backend. Documentation, installation,
releases, acceptance, and maintainer testing cover current Omarchy. Other Linux
desktop backends, macOS, and Windows are outside the maintained desktop promise.
The native Expo Android/iOS phone client remains part of the product.

TapPad is independent. Do not describe it as official, endorsed, sponsored, or
affiliated with Omarchy or the Omacom Foundation unless that relationship is
explicitly established.

## Maintained modules

- **TapPad Host** — headless Rust process for local input, Device Authorization,
  discovery, the Host Contract, and Desktop Actions.
- **TapPad Shell Surface** — Omarchy Quickshell plugin for lifecycle, status,
  readiness, and pairing.
- **Mobile Input Surface** — native Expo client for discovery, QR pairing, secure storage, and input; the Host-served browser UI remains a fallback.

Tauri, native AppKit, and Windows desktop adapters have been
removed from the maintained source.

## Roadmap order

1. Maintain the headless TapPad Host in `host/`.
2. Ship the TapPad Shell Surface as an Omarchy plugin.
3. Provide reversible install, update, and removal.
4. Harden Device Authorization and pairing credentials.
5. Verify core input and Desktop Actions on current Omarchy.
6. Keep superseded cross-platform code and workflows out of the maintained tree.

## Distribution and testing

Source code and Omarchy release artifacts are public on GitHub. Downloads do
not require an account or email address.

The maintained test matrix is deliberately small:

- automated Rust, native mobile protocol/pairing tests and TypeScript checks;
- Quickshell plugin validation;
- one end-to-end acceptance flow on current Omarchy.

No macOS, Windows, or generic-Linux desktop release matrix is promised. Native Android/iOS client verification remains required, including real-device pairing.

## Sustainability

TapPad does not have a paid product roadmap. Voluntary donations, sponsorship,
or funded ecosystem work may be considered later, but they must not introduce a
license gate or make core local input dependent on a hosted service.
