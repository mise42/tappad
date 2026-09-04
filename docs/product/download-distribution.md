# Download distribution

TapPad publishes one maintained download for current Omarchy:

1. The project site shows one Omarchy download button.
2. Cloudflare Pages Function `GET /api/downloads` reads
   `latest/downloads.json` from R2.
3. The site starts the Omarchy download directly.

No account, email address, use-case submission, or license key is required.

## Target artifact

The Omarchy release contains:

- the headless `tappad-host` binary;
- a systemd user service;
- the Omarchy Quickshell TapPad Shell Surface;
- the browser Mobile Input Surface assets;
- reversible install, update, and removal commands.

macOS and Windows artifacts are no longer published.

## Cloudflare Pages setup

Deploy `landing/` as the Pages project root and bind only:

| Binding name | Type | Purpose |
| --- | --- | --- |
| `TAPPAD_DOWNLOADS_BUCKET` | R2 bucket | Reads `latest/downloads.json` for the public Omarchy download. |

The previous beta-access lead capture is intentionally removed. Do not restore
a mandatory form or write visitor details to the downloads bucket.

## Release acceptance

A release is ready after:

- automated Host and browser protocol checks pass;
- `omarchy plugin validate` accepts the Shell Surface;
- install, first launch, pairing, core input, Desktop Actions, restart, update,
  and removal pass on current Omarchy;
- release notes identify the tested Omarchy version and commit.
