# ADR 0007: Encrypt the mobile-to-Host connection

## Status

Accepted

## Context

Mobile clients sent pointer, keyboard, text, and Omarchy authorization
passwords over plain `ws://`, with the pairing token in the URL. Anyone on the
local network could read the input and the token.

## Decision

- The Host creates a self-signed certificate on first start
  (`~/.config/tappad/tls/`, private files). LAN peers are served only over TLS on
  the Host port; a plaintext request from a non-loopback address is refused.
  Loopback keeps plain HTTP for the Quickshell plugin and CLI.
- Clients trust the certificate's SHA-256 fingerprint, not a CA, host name, or
  address, so address changes do not break pairing. `reset-pairing` replaces the
  token and the certificate together.
- The pairing QR code is `https://<host>:<port>/#token=…&fp=…`.
- The native app pins the fingerprint per connection through a local Expo
  module (`mobile-app/modules/tappad-pinned-socket`), never through global trust.
- The token is bound to the observed certificate: the app sends an HMAC of the
  token, fingerprint, and a fresh nonce, and requires the Host's matching HMAC
  in `ready` before sending input. A man in the middle presents a different
  certificate and can produce neither proof. This lets manual token entry and
  pairings saved before TLS pin the certificate safely on their next connection.
- There is no plaintext compatibility mode. Clients older than this change must
  be updated.
- The browser surface moves to HTTPS. Browsers cannot pin the fingerprint, so it
  only protects against passive listeners and the user must accept the
  certificate warning. It sends the token as its first WebSocket message.

## Consequences

- A token that travelled in clear text before this change stays as trusted as
  it was; resetting pairing once after upgrading removes that exposure.
- A changed certificate stops automatic reconnects; the user re-pairs by
  scanning the QR code.
- The iOS module is written but has not been built or verified on a device.
