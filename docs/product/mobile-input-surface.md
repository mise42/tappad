# Mobile Input Surface

## Purpose

The Mobile Input Surface is the browser UI used from a phone or tablet to
control an Omarchy machine. The TapPad Host serves it directly over the local
network; no native mobile application is required.

## Entry journey

1. The TapPad Shell Surface shows the local address and a pairing QR code.
2. The Community User opens or scans it from a phone or tablet.
3. The TapPad Host performs Device Authorization.
4. The browser stores only the credential required for that Paired Device.
5. Later visits reconnect while that credential remains valid.

mDNS supplies an address route only. It does not authorize a device.

## Omarchy Desktop Actions

The Mobile Input Surface exposes only actions advertised by the current TapPad
Host. The maintained action set includes:

- screen and window recording;
- screenshots;
- workspace navigation;
- window close;
- Walker launch;
- lock;
- media and volume control;
- the verified Codex voice shortcuts.

Raw shell commands are outside the Host Contract. A new action requires a
named ID, an Omarchy implementation, capability evidence, and a user-visible
result.

## Recording semantics

Recordings are saved under `~/Videos/TapPad`. Mobile-triggered recording does
not show a desktop picker because the Community User may be away from the
keyboard. Only one TapPad recording session may be active at a time.

`screenrecord.window` records the active window. If the current Omarchy capture
tool cannot isolate it, the Host must report a downgrade instead of silently
claiming the intended result.

## Omarchy authorization requests

When the Host detects an existing `omarchy-polkit` layer, the browser surface
shows an authorization control. A paired connection can submit a bounded ASCII
password through the dedicated `authorize` message. The Host rechecks that the
request is visible before typing the password and Enter. `authorizationResult`
with `submitted` means input was sent, not that Polkit accepted it.

The browser keeps the password only in page memory. It is never written to
localStorage, sessionStorage, URLs, or Host settings. Refreshing, leaving the
page, or disconnecting clears it; the user can also choose “忘记密码”. This
replaces the retired Expo SecureStore flow without claiming equivalent durable
secure storage in a LAN browser. After submission, a two-second cooldown allows
the user to replace the password if the request remains visible. Missing replies
never cause automatic retries.

Validation covers protocol routing, request detection, browser session state,
and mocked browser interaction. A real phone/Polkit acceptance check is still
required before claiming the deployed authorization flow works.
