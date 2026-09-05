# Browser-based local device discovery and pairing

Status: research note, 2026-07-31

## Conclusion

A known local hostname can be TapPad's default **launch surface**, but a normal web page cannot reliably enumerate nearby Desktop Host Surfaces across browsers.

The practical distinction is:

- **Stable name resolution** — resolving a known `tappad-<host-id>.local` alias to the host's current LAN address — is available when the phone, network, and host support mDNS.
- **Discovery** — finding arbitrary TapPad hosts on the LAN or enumerating `_tappad._tcp.local` — is not available to ordinary web pages.
- **Authorization** — deciding whether a connected mobile device may control the host — remains necessary and is not supplied by mDNS.

For TapPad, the preferred browser-first design is therefore:

1. Let the headless TapPad Host start as a systemd user service, remain in the background, and publish a collision-resistant `tappad-<host-id>.local` alias plus `_tappad._tcp.local` while the backend is available.
2. Let browser users navigate directly to the known host-specific address; let the TapPad Mobile App enumerate `_tappad._tcp.local` and resolve its SRV target.
3. Require one-time device authorization and persist a device credential independently of the transient browser/WebSocket connection.
4. On later visits, reconnect automatically while the credential remains valid.
5. Keep QR as a fallback for name-resolution failure, name conflict, or fast first-time pairing.

## What browsers can and cannot do

### mDNS and DNS-SD

DNS-SD defines browsing for service instances, while mDNS gives link-local names such as `host.local`. However, the proposed W3C Network Service Discovery API was discontinued and explicitly says it must not be used as an implementation basis. Ordinary page JavaScript therefore has no supported API to browse `_tappad._tcp.local` or enumerate Bonjour records. ([W3C Network Service Discovery](https://www.w3.org/TR/discovery-api/), [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763.html))

A page can still navigate or connect to a **known** `.local` hostname if the browser and OS resolve it. That is name resolution, not discovery. `.local` is link-local, and an mDNS responder must handle name conflicts. The conventional `<hostname>.local` belongs to the operating system's responder; TapPad's embedded responder should instead publish a collision-resistant alias derived from its stable host id. The DNS-SD service instance carries the user-friendly computer name, its SRV record targets the TapPad alias, and TXT metadata carries the full stable host id. ([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762.html), [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763.html))

### WebRTC

WebRTC does not scan the LAN for services. It connects two already-identified peers after the application exchanges offers, answers, and ICE candidates through an out-of-band signaling channel. ICE can find a direct route and TURN can relay when direct connectivity fails. Browser-generated `.local` ICE candidates are privacy-preserving address aliases inside ICE, not a general mDNS browser. ([W3C WebRTC](https://www.w3.org/TR/webrtc/))

WebRTC is viable only if the Desktop Host Surface becomes a WebRTC peer and a rendezvous service introduces the paired browser and host.

### HTTPS, HTTP, and local-network permissions

Secure pages normally cannot load active insecure content, and an HTTPS page opening `ws://` is blocked as mixed content. `wss://` needs a certificate the browser accepts for the requested hostname. A self-signed certificate on a `.local` host is therefore not a seamless cross-browser solution. ([W3C Mixed Content](https://w3c.github.io/webappsec-mixed-content/), [WebKit mixed WebSocket policy](https://bugs.webkit.org/show_bug.cgi?id=89068))

Chromium now has Local Network Access (LNA): public sites requesting private or loopback destinations prompt the user. Chrome 147 extended this to WebSockets and WebTransport. A granted permission can relax mixed-content checks for recognized local targets, including private IP literals and `.local` names. Firefox 153 likewise enables local-network permission prompts by default on desktop. These permissions authorize a request; they do not discover an endpoint. ([Chrome 142](https://developer.chrome.com/release-notes/142), [Chrome 147](https://developer.chrome.com/release-notes/147), [Firefox local network permissions](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox), [Mozilla LNA guide](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access))

Private Network Access (PNA), the earlier proposal based on special CORS preflights, was put on hold and replaced in Chrome by permission-based LNA. TapPad should not make the old `Access-Control-Allow-Private-Network` flow its core architecture. ([Chrome LNA announcement](https://developer.chrome.com/blog/local-network-access))

### CORS and WebSocket origin checks

LNA does not replace the same-origin policy:

- A public page using `fetch()` against a local host still needs the local HTTP server to opt into the public TapPad origin with narrowly scoped CORS headers.
- Browser WebSockets do not use normal CORS response headers, but they send an `Origin` header. The host must reject unexpected origins and must still authenticate the paired device. ([Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-new-header-syntax), [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455.html))

The current pairing token remains necessary. Local-network permission only says the user allows the website to attempt a connection.

### WebTransport

WebTransport is transport, not discovery. It requires an `https` URL and normally uses Web PKI; certificate-hash pinning exists for short-lived certificates but adds certificate provisioning and rotation. Chrome 147 applies LNA to local WebTransport, and Safari 26.4 added WebTransport support, but this does not remove the need to know the endpoint first. It is more machinery than TapPad's current WebSocket path needs. ([W3C WebTransport](https://www.w3.org/TR/webtransport/), [Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/))

## iPhone and iPad constraints

Apple's OS-level Local Network Privacy prompt explicitly exempts traffic originating from Safari and `WKWebView`; that exception is not a JavaScript Bonjour-discovery API. Safari still follows WebKit mixed-content rules, including blocking `ws://` from an HTTPS page. ([Apple TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy), [WebKit mixed WebSocket policy](https://bugs.webkit.org/show_bug.cgi?id=89068))

Mobile pages may also be frozen or discarded in the background. A WebSocket is a foreground-session resource, not a durable pairing record. TapPad must persist pairing state separately and reconnect on foreground/page restoration. ([HTML document lifecycle](https://html.spec.whatwg.org/multipage/document-lifecycle.html), [Page Lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api))

## Viable architectures

| Architecture | Result | Fit |
| --- | --- | --- |
| Known `.local` host + direct local page | The user opens a host-specific URL such as `http://tappad-a1b2c3d4.local:8765/`. Once on the local page, its `ws://` connection is same-origin. mDNS resolves the known name; no browser LAN enumeration is implied. | Browser local-only path; needs explicit device authorization and a QR/link fallback when the name is unavailable or conflicted. |
| Public page + direct local API/WebSocket | Keeps the public UI open and connects to the known local host. Requires LNA permission, correct CORS/origin handling, and either browser-specific mixed-content relaxation or trusted local TLS. | Chromium/Firefox prototype; not the cross-browser baseline. |
| Cloud rendezvous + WebRTC data channel | Host and paired browser connect outbound to a public signaling service; ICE attempts direct connectivity and TURN provides fallback. | Good privacy/latency compromise, but requires a new host transport and cloud control plane. |
| Cloud WebSocket relay | Both browser and host make outbound `wss://` connections to TapPad's service. No local discovery, local TLS, or LNA dependency. | Most predictable UX; adds infrastructure, relay cost, and a stronger privacy/security obligation. |
| Browser extension/native helper | An extension can exchange messages with an installed native application. On iOS this effectively means distributing an app plus Safari extension. | Technically strong but defeats the low-friction browser-only promise. ([Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Safari extension messaging](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)) |

## Recommendation for TapPad

Use `tappad-<host-id>.local:8765` as the direct browser launch surface and `_tappad._tcp.local` as the browser-client discovery surface. The headless TapPad Host owns backend lifecycle and mDNS/DNS-SD publication under a systemd user service. The service instance carries the user-friendly TapPad host label, while its SRV record targets the stable TapPad alias rather than claiming the operating system's hostname.

Keep addressing and trust separate. On first connection, require a short PIN, desktop confirmation, or equivalent one-time approval, then issue a persistent device credential. Persist the stable host id and approved credential separately from WebSocket state so a dropped connection or later page visit can reconnect without repeating authorization.

Treat QR as a recovery and fast-pairing mechanism for `.local` resolution failure, name conflict, or a new device—not as a required step in the normal journey.

If the product later needs reliable access away from the LAN, add a public launcher or cloud rendezvous path; choose WebRTC plus relay fallback when local-first transport and privacy justify the complexity, or a cloud WebSocket relay when operational predictability is the priority.
