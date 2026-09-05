# Security Policy

TapPad can control pointer, keyboard, clipboard, and Desktop Actions on a paired
computer. Treat authentication and input handling issues as security-sensitive.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could allow unauthorized
control, credential disclosure, command execution, or access to user input.

Use GitHub's private vulnerability reporting for
[`miselabs/tappad`](https://github.com/miselabs/tappad/security/advisories/new).
If private reporting is unavailable, email `hello@tappad.app` with the subject
`TapPad security report`.

Please include the affected version or commit, Target Backend, reproduction
steps, and expected impact. Avoid including real credentials or private user
content.

## Security boundaries

- LAN reachability is not Device Authorization.
- Nearby Host Discovery does not grant trust.
- Mobile input events remain on the local network.
- The Mobile Input Surface may request only named Desktop Actions; arbitrary
  shell commands are outside the protocol.
- Pairing credentials must be revocable and must not be exposed through logs,
  analytics, issue reports, or screenshots.
