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
4. The phone opens the browser Mobile Input Surface and completes Device
   Authorization.
5. Later visits reconnect as a Paired Device.

The Quickshell plugin is the only maintained desktop UI. Tauri tray, AppKit,
Windows, and native mobile surfaces are outside the product.
