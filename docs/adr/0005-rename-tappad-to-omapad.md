# ADR 0005: Rename TapPad to OmaPad

## Status

Accepted. Its browser-only module description is superseded by ADR 0006; the naming decision remains unchanged.

## Context

The project is now an independent, Omarchy-native open-source contribution.
Its public name should make that focus legible while still describing a phone
or tablet used as a control pad.

`TapPad` also appears in installed identifiers such as the Host binary, systemd
unit, mDNS service, local hostname, configuration directory, and Omarchy plugin
id. Changing all of those identifiers piecemeal would leave mixed installations
that are difficult to update or remove.

## Decision

Rename the public product from **TapPad** to **OmaPad**.

Use `OmaPad` for human-facing product copy and `omapad` for new machine-facing
identifiers. Treat the installed-identity change as one migration seam rather
than a series of unrelated text replacements.

Retire the native AppKit macOS client first. Complete the Omarchy architecture
cleanup before changing installed identifiers. During the identifier cutover,
the installer and uninstaller must recognize the legacy `tappad` installation
well enough to remove or migrate it safely.

## Consequences

- The maintained product remains the headless Host, Quickshell Shell Surface,
  and browser Mobile Input Surface for current Omarchy.
- Historical ADRs and release notes may retain the old name when describing the
  state that existed at that time.
- Public copy can move to OmaPad before the installed-identity cutover, provided
  documentation labels legacy commands accurately.
- The binary, systemd unit, plugin id, mDNS records, configuration path, package
  metadata, and release artifact names change together in one later phase.
- The migration does not imply official Omarchy or Omacom Foundation status.
