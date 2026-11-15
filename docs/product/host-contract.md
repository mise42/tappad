# Host Contract

## Purpose

The Host Contract is the stable interface between the native Mobile Input
Surface and the headless TapPad Host. It defines input messages, named Desktop
Actions, Device Authorization, capability states, and execution results.

It is not a portability abstraction. Omarchy is the only Supported Target
Backend.

## Contract snapshot

The Host publishes the additive contract snapshot in the authenticated WebSocket
`ready` message, in the `hostState` reply to a `hostState` request on that
socket, and in `GET /api/host-state`:

```json
{
  "version": 1,
  "protocolVersion": 2,
  "inputCapabilities": {
    "pointerButton": { "state": "supported" },
    "textSubmit": { "state": "supported" }
  },
  "actionCapabilities": {
    "screenshot": { "state": "supported" },
    "workspace.1": { "state": "supported" }
  }
}
```

The authenticated snapshot is authoritative for that connection. Native clients
refresh it over the pinned socket; the HTTP snapshot remains for local tools.

## Transport and authentication

LAN clients reach the Host only over TLS on the Host port; plain HTTP is
accepted from loopback only (Quickshell plugin and CLI). The Host certificate is
self-signed and identified by its SHA-256 fingerprint. See ADR 0007.

- Native clients pin that fingerprint and authenticate the WebSocket upgrade with
  `Authorization: TapPad-Binding <nonce>.<hex HMAC-SHA256(token,
  "tappad-client-v1\n" + fingerprint + "\n" + nonce)>`. The Host answers in
  `ready.hostProof` with the same HMAC under the label `tappad-host-v1`; clients
  send nothing until it verifies.
- The browser surface cannot set headers; its first message must be
  `{"type":"auth","token":…}` within five seconds.
- The pairing token never appears in a URL that is sent to the Host. The pairing
  link is `https://<host>:<port>/#token=<token>&fp=<fingerprint>`.

## Stability rules

- Message shapes, action IDs, capability meanings, Device Authorization, and
  result semantics belong to the Host Contract.
- Only actions advertised as runnable may execute.
- Native and browser clients ignore unknown additive fields and action IDs.
- Raw commands never cross the Host Contract.
- Changing an existing message or action meaning is breaking; adding an
  optional field or capability is additive.

Build identity, installation, systemd lifecycle, and Quickshell IPC are outside
the Host Contract.

### Omarchy authorization input

The additive `authorize` client message carries a `password` string and requires
the same paired WebSocket as other input. It accepts only 1–1024 printable ASCII
bytes, only while an `omarchy-polkit` layer is visible. The reply is an
`authorizationResult` with `submitted`, `blocked`, or `failed` status. Submission
does not attest to successful authentication. `/api/host-state.authorization`
exposes `supported` and `requestActive`, never the password. Raw protocol payloads
and parser error values must not be logged, including under verbose `RUST_LOG`.

### Native client identity and session disconnect

A `ready` message advertises `connectionManagement: true` when the Host accepts
`clientInfo` with a self-reported `name`. Clients must gate this additive message
on the advertisement for compatibility with older Hosts. Names are bounded,
control characters are removed, and names are display metadata, not identity proof.
A `disconnected` message announces a user-requested session close. Updated native
clients stop automatic retries until the user taps Reconnect. Pairing is retained.

### Text submit

A `text` message may set the additive `submit: true` field to press Enter once
the text has been typed, or, for text the Host pastes through the clipboard,
shortly after the paste. `inputCapabilities.textSubmit` advertises support.
Clients must not set `submit` unless the Host advertises it, because older Hosts
ignore the field and type the text without Enter. A missing `submit` means
`false`.
