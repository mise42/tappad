# ADR 0003: Use Tauri as the single active Desktop Host

## Status

Superseded by [ADR 0004](0004-adopt-omarchy-first-open-source-posture.md)

## Context

TapPad has both a native AppKit macOS Host and a Tauri Host that runs on macOS,
Windows, and Linux. Maintaining two complete macOS Hosts duplicates the server,
protocol routing, pairing, settings, Desktop Actions, packaging, and validation
work. The native AppKit path currently provides a more native UI and direct
macOS API access, but those benefits do not justify maintaining a parallel
product implementation at the current stage.

The Tauri Host already owns the cross-platform Desktop Host contract, including
backend lifecycle, pairing, settings, local discovery, and the host-served
Mobile Input Surface.

## Decision

Use the Tauri Host as the single active Desktop Host for macOS, Windows, and
Linux.

Do not continue feature development on the complete native AppKit Host. Keep
the existing `macos/` implementation temporarily as reference code; it is not
an active product path or a required release artifact.

If a verified macOS limitation appears, add the smallest macOS-specific adapter
inside or alongside the Tauri Host. Appropriate triggers include Accessibility
permission handling, CoreGraphics input behavior, ScreenCaptureKit, or another
system integration that the shared implementation cannot deliver adequately.
Such an adapter should implement only the required native capability and should
not recreate the server, protocol, pairing, settings, or Mobile Input Surface.

## Consequences

- macOS, Windows, and Linux share one active Host architecture and release path.
- Product behavior and validation no longer need to be synchronized across two
  complete macOS Hosts.
- The current Swift implementation may be archived or removed in a later,
  explicit cleanup after useful reference code has been identified.
- A macOS adapter is introduced only in response to an observed limitation, not
  as speculative parallel infrastructure.
- ADR 0002 is superseded.
