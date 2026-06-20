# ADR 0002: Keep native macOS while using Tauri for beta downloads and host parity

## Status

Accepted

## Context

TapPad now has host-surface paths for macOS, Windows, and Linux. macOS keeps a native AppKit host because it already has native pairing, settings, and permission surfaces. Windows and Linux use the shared Tauri host surface.

The macOS Tauri target is now acceptable as the public beta download when it provides the current cross-platform desktop host contract. The native macOS app remains an important system-integrated macOS path, but it is not a blocker for shipping the current macOS beta download.

## Decision

Keep the product contract consistent across macOS, Windows, and Linux: pairing, server state, readiness, settings, and supported desktop actions should use the same product language and user-result expectations.

Keep the native macOS host surface instead of deleting or replacing it with a cross-platform rewrite. Use the Tauri host surface for Windows and Linux, and allow the Tauri macOS build to serve the public beta download while the native macOS app continues as the deeper macOS integration path.

## Consequences

- Product positioning should describe TapPad as a cross-platform beta across macOS, Windows, and Linux rather than a Mac-only beta.
- macOS implementation work may touch either the native host or the Tauri host, so issues and docs should name which macOS path they mean.
- Download distribution may prefer the Tauri `.dmg` for macOS beta releases when it represents the current tested desktop host package.
- Native macOS work should be evaluated by system integration and product polish goals, not treated as the only valid macOS artifact for beta distribution.
- Cross-platform parity means user-result parity, not identical implementation details.
