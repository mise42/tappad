# Mobile Input Surface

## Purpose

The maintained phone/tablet client is the native Expo app in `mobile-app/`.
It controls the headless Rust Host on Omarchy; Quickshell owns the desktop UI.
The Host-served browser UI is a secondary fallback and does not replace native
pairing, secure storage, or the native control surface.

## Entry journey

1. The app discovers `_tappad._tcp.local.` Hosts using native DNS-SD.
2. The user selects a Host and scans its Quickshell pairing QR code in the app,
   or enters the pairing token manually.
3. The app validates the QR address and port against the selected Host, then
   connects to `/ws?token=...` and waits for `ready` before saving credentials.
4. SecureStore retains the pairing under the stable Host ID.
5. Later discovery reconnects to that paired Host and opens native controls.

Discovery supplies candidates; it never grants Device Authorization. Preserve
legacy service names, stable Host IDs, and tokens until an explicit identity
migration. Native pairing must be tested on a real phone before deployment is
claimed successful.

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

When the Host detects a visible `omarchy-polkit` layer, the native app enables
its authorization button. The first use saves an ASCII password in the phone's
SecureStore, scoped to the Host ID. Later taps reuse it. The Host checks the
request again before injecting the password and Enter; `submitted` reports only
input submission, not successful Polkit authentication.

After two seconds, a still-active request offers password replacement and retry.
The password field is masked by default and can be explicitly revealed. Passwords
must not be stored in Host settings or logged. This native secure-storage flow
remains maintained; the browser does not replace it with page-memory storage.

## Development and verification

`pnpm --filter mobile-app test` covers QR matching, protocol, input gestures,
Codex actions, and authorization recovery; `pnpm --filter mobile-app typecheck`
checks the native source. Android development uses the co-installable TapPad Dev
variant described in `mobile-app/README.md`. Installing either client or replacing
a running Host is a separate deployment step.
