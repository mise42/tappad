# Host Contract

## Purpose

The Host Contract is the stable interface between the browser Mobile Input
Surface and the headless TapPad Host. It defines input messages, named Desktop
Actions, Device Authorization, capability states, and execution results.

It is not a portability abstraction. Omarchy is the only Supported Target
Backend.

## Contract snapshot

The Host publishes the additive contract snapshot in `GET /api/host-state` and
the authenticated WebSocket `ready` message:

```json
{
  "version": 1,
  "protocolVersion": 2,
  "inputCapabilities": {
    "pointerButton": { "state": "supported" }
  },
  "actionCapabilities": {
    "screenshot": { "state": "supported" },
    "workspace.1": { "state": "supported" }
  }
}
```

The authenticated snapshot is authoritative for that connection. The HTTP
snapshot supports preflight and status refresh.

## Stability rules

- Message shapes, action IDs, capability meanings, Device Authorization, and
  result semantics belong to the Host Contract.
- Only actions advertised as runnable may execute.
- Browser clients ignore unknown additive fields and action IDs.
- Raw commands never cross the Host Contract.
- Changing an existing message or action meaning is breaking; adding an
  optional field or capability is additive.

Build identity, installation, systemd lifecycle, and Quickshell IPC are outside
the Host Contract.
