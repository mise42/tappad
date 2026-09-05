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
desktops, macOS, Windows, and native mobile shells are outside the maintained
product promise.

TapPad is independent. Do not describe it as official, endorsed, sponsored, or
affiliated with Omarchy or the Omacom Foundation unless that relationship is
explicitly established.

## Maintained modules

- **TapPad Host** — headless Rust process for local input, Device Authorization,
  discovery, the Host Contract, and Desktop Actions.
- **TapPad Shell Surface** — Omarchy Quickshell plugin for lifecycle, status,
  readiness, and pairing.
- **Mobile Input Surface** — browser UI served by the TapPad Host.

Tauri, native AppKit, Windows adapters, and the Expo discovery shell have been
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

- automated Rust and browser protocol tests;
- Quickshell plugin validation;
- one end-to-end acceptance flow on current Omarchy.

No macOS, Windows, iOS, Android, or generic-Linux release matrix is promised.

## Sustainability

TapPad does not have a paid product roadmap. Voluntary donations, sponsorship,
or funded ecosystem work may be considered later, but they must not introduce a
license gate or make core local input dependent on a hosted service.
