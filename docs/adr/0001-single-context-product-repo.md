# ADR 0001: Keep TapPad as a single-context product repo

## Status

Accepted

## Context

TapPad currently includes an Omarchy/Linux backend, a shared mobile input surface, and a macOS package that is intended to become the first commercial backend. The repo will also include a future website and online activation backend.

These deliverables are different surfaces, but they still share one product language: mobile input surface, target backend, platform input device, text transfer, desktop action, activation, and entitlement.

## Decision

Keep the repo as a single-context product repo with one root `CONTEXT.md`.

Use `docs/product/` for commercialization and activation notes, and `docs/adr/` for durable architectural decisions.

Do not introduce `CONTEXT-MAP.md` or per-surface `CONTEXT.md` files until the website, activation backend, and client develop genuinely separate domain vocabularies or ownership boundaries.

## Consequences

- Engineering skills should read the root `CONTEXT.md` for product vocabulary before working anywhere in the repo.
- Product, website, activation, macOS, and Omarchy work should use the same names for shared concepts.
- Future split points remain possible, but they should be driven by real domain divergence rather than directory structure alone.
