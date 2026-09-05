# ADR 0001: Keep TapPad as a single-context product repo

## Status

Accepted

## Context

TapPad includes one Omarchy Target Backend, a headless TapPad Host, the TapPad Shell Surface, a native Expo Mobile Input Surface with a browser fallback, and a public open-source project site.

These deliverables are different surfaces, but they still share one product language: Mobile Input Surface, Target Backend, Platform Input Device, Text Transfer, Desktop Action, Device Authorization, and Paired Device.

## Decision

Keep the repo as a single-context product repo with one root `CONTEXT.md`.

Use `docs/product/` for community strategy and product boundary notes, and `docs/adr/` for durable architectural decisions.

Do not introduce `CONTEXT-MAP.md` or per-surface `CONTEXT.md` files until the website, TapPad Host, Shell Surface, and Mobile Input Surface develop genuinely separate domain vocabularies or ownership boundaries.

## Consequences

- Engineering skills should read the root `CONTEXT.md` for product vocabulary before working anywhere in the repo.
- Product, website, Host, Quickshell, native mobile, and browser work should use the same names for shared concepts.
- Future split points remain possible, but they should be driven by real domain divergence rather than directory structure alone.
