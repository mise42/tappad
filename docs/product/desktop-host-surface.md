# TapPad Shell Surface

## Purpose

The TapPad Shell Surface is an Omarchy Quickshell plugin. It provides the one
visible place to start or stop TapPad, inspect readiness, pair a phone, and
change local settings.

## Responsibilities

The Shell Surface owns:

- systemd user-service lifecycle controls;
- running and readiness status;
- local address and pairing QR presentation;
- pairing credential reset confirmation;

The headless TapPad Host owns:

- LAN HTTP and WebSocket listeners;
- Device Authorization and credentials;
- mDNS publication;
- input injection and concurrency;
- clipboard handling;
- named Desktop Action execution;
- the Host Contract and Mobile Input Surface assets.

This seam keeps security-sensitive backend behavior outside the unsandboxed,
long-running Omarchy Shell process.

## Local interface

The Shell Surface should call a small `tappad-host` command interface rather
than parse private files directly. Initial commands are expected to cover:

- `status`
- `pairing`
- `start`
- `stop`
- `restart`
- `reset-pairing`

Command output must not include a durable credential unless the Community User
has explicitly opened the pairing view. Credentials must not appear in logs or
process arguments.

## Default journey

1. Omarchy starts the TapPad Host as a systemd user service.
2. The Quickshell plugin reports whether core input and Desktop Actions are
   ready.
3. Opening the pairing view requests a QR payload containing the current
   persistent pairing credential.
4. The native TapPad Mobile App discovers the Host, scans its QR code, verifies
   the token over WebSocket, and stores the pairing in SecureStore.
5. Later visits reconnect as a Paired Device.

The Quickshell plugin is the only maintained desktop UI. Tauri tray, AppKit,
and Windows desktop surfaces are outside the product. The native Expo phone surface remains maintained.

## Current connection panel

The Shell Surface uses Omarchy's shared Panel, KeyboardPanel, PanelHero and
PanelActionButton components, anchored to its top-bar button. It follows theme
colors/fonts and closes with Escape or an outside click. The default view shows
Host identity/running state, LAN address, active clients, self-reported client
names and received input-message counts. Counts include key cleanup messages;
they are not gesture counts or latency measurements. No device name is inferred.

“连接新手机” expands the QR code on demand. Closing the panel clears its QR data.
A disconnect action ends only the selected live WebSocket session, releasing
held input. It does not revoke or forget the pairing. Updated native clients
wait for manual Reconnect after this action; older clients may auto-reconnect.
Local CLI status/disconnect use loopback-only HTTP routes with the stored pairing
credential in an HTTP header, never in command arguments. Client names are not
part of the public LAN status response.
