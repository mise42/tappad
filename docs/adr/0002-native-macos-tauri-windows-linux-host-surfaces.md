# ADR 0002: Keep native macOS while using Tauri for cross-platform host parity

## Status

Accepted

## Context

TapPad now has host-surface paths for macOS, Windows, and Linux. macOS keeps a native AppKit host because it already has native pairing, settings, and permission surfaces. Windows and Linux use the shared Tauri host surface. The Tauri macOS target exists for packaging and parity work, but the native macOS app remains the primary commercial macOS path.

## Decision

Keep the product contract consistent across macOS, Windows, and Linux: pairing, server state, readiness, settings, and supported desktop actions should use the same product language and user-result expectations.

Keep the native macOS host surface instead of forcing the commercial macOS path through a cross-platform rewrite. Use the Tauri host surface for Windows and Linux, and keep Tauri macOS as a parity and packaging target.

## Consequences

- Product positioning should describe TapPad as a cross-platform beta across macOS, Windows, and Linux rather than a Mac-only beta.
- macOS implementation work may touch either the native host or the Tauri host, so issues and docs should name which macOS path they mean.
- Cross-platform parity means user-result parity, not identical implementation details.
