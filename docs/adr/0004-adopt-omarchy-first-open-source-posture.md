# ADR 0004: Adopt an Omarchy-native open-source architecture

## Status

Accepted

## Context

TapPad began as a personal Omarchy tool. The cross-platform Tauri Host and
native mobile discovery shell expanded the test and release surface without
improving the maintainer's primary use case. A paid product would add another
layer of licensing, activation, analytics, and support work.

Omarchy now provides a long-running Quickshell process with installable panel,
service, and bar-widget plugins. This is the natural Desktop Host Surface for an
Omarchy utility. Input injection, LAN networking, Device Authorization, and
protocol concurrency remain security-sensitive backend responsibilities and
should not run inside an unsandboxed shell plugin.

## Decision

Release TapPad under the MIT License as an independent community project.

Support current Omarchy as the only Target Backend. Remove macOS, Windows,
generic-Linux, and native-mobile parity from the product and test promise.

Replace the Tauri Desktop Host with:

- a headless Rust **TapPad Host** that owns input injection, local networking,
  discovery, Device Authorization, settings, and named Desktop Actions; and
- an Omarchy Quickshell **TapPad Shell Surface** that owns lifecycle controls,
  status, readiness, and pairing.

The command/IPC interface between these modules must not expose pairing
credentials through logs or process listings. The Mobile Input Surface remains
browser-based and speaks the Host Contract directly to the TapPad Host.

Remove paid licensing, online activation, mandatory email capture, conversion
analytics, and multi-platform release artifacts.

Do not claim official Omarchy or Omacom Foundation status without explicit
authorization.

## Consequences

- Tauri, AppKit, Windows adapters, and the Expo shell are removed from the
  maintained source.
- The maintained acceptance environment is current Omarchy only.
- A small Rust Host remains because deleting it would move networking, trust,
  input injection, and concurrency complexity into QML.
- Quickshell becomes the only Desktop Host Surface and the visible owner of the
  Omarchy user journey.
- Fewer modules, packages, workflows, and device matrices reduce maintainer
  burden.
