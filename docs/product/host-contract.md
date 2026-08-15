# Host Contract

## Purpose

TapPad has one Tauri Desktop Host and may add Host Adapters for new Target
Backends. Every Adapter implements the same platform-neutral Host Contract; it
does not create a target-specific mobile protocol.

The contract is the shared meaning of input messages, named Desktop Actions,
authorization, capability states, and execution results. Platform commands and
runtime probes stay behind the Adapter seam.

## Contract snapshot

The Host publishes the same additive contract snapshot in `GET
/api/host-state` and the authenticated WebSocket `ready` message:

```json
{
  "version": 1,
  "protocolVersion": 2,
  "inputCapabilities": {
    "pointerButton": { "state": "supported" }
  },
  "actionCapabilities": {
    "screenshot": { "state": "supported" },
    "workspace.1": { "state": "hidden" }
  }
}
```

The authenticated `ready` snapshot is authoritative for that connection. The
HTTP snapshot supports preflight and runtime refresh. Existing top-level
`actions`, `protocolVersion`, and `inputCapabilities` fields remain during the
backward-compatible transition.

## Stability rules

- Message shapes, action ids, capability meanings, authorization, and result
  semantics belong to the Host Contract rather than to an Adapter.
- The shared action catalog includes optional actions even when only one
  Adapter currently implements them.
- An Adapter reports every shared action as `supported`, `deferred`,
  `downgraded`, `unavailable`, or `hidden`; it cannot add a private protocol id.
- Only `supported` and explicitly executable `deferred` actions may cross the
  Adapter execution seam.
- Mobile clients ignore unknown additive fields and action ids. They fall back
  to legacy capability fields when the contract snapshot is missing or its
  version is unknown.
- Raw target-specific commands never cross the Host Contract.

Changing an existing message or action meaning is a breaking contract change.
Adding an optional field or a new shared capability is additive and keeps the
same contract version.

## Adding a Host Adapter

A new Adapter joins the product by implementing the existing input and Desktop
Action seams and passing the shared conformance tests. Mobile code changes only
when the product intentionally adds a new shared capability or presents an
already-advertised capability in the UI.

Host build identity, release ordering, update checks, and installation are not
part of the Host Contract.
