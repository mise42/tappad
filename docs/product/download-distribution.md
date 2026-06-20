# Download Distribution

TapPad beta downloads use a gated static-site flow:

1. The Landing page shows macOS, Windows, and Linux download buttons.
2. The visitor clicks a platform download, then enters an email and expected use case in a dialog.
3. Cloudflare Pages Function `POST /api/beta-access` validates the submission and selected platform.
4. The function stores the beta access request as JSON in R2.
5. The function reads `latest/downloads.json` from R2 and returns the matching TapPad download link.
6. The Landing page starts that download automatically after the form submission succeeds.

## Cloudflare Pages Setup

Deploy the Landing site as a Cloudflare Pages project with `landing/` as the project root.

Current production deployment:

- Pages project: `tappad`
- Public site: `https://tappad.mise42.top`
- Pages fallback domain: `https://tappad.pages.dev`
- R2 bucket: `tappad-downloads`
- Current public R2 download origin: `https://pub-f5c49124efb14d8a80d107934b3f79c3.r2.dev`

Configure these bindings for the Pages Function:

| Binding name | Type | Purpose |
| --- | --- | --- |
| `TAPPAD_DOWNLOADS_BUCKET` | R2 bucket | Reads `latest/downloads.json` for current download links. |
| `TAPPAD_LEADS_BUCKET` | R2 bucket | Stores beta access requests under `beta-access/YYYY-MM-DD/`. |

`TAPPAD_DOWNLOADS_BUCKET` and `TAPPAD_LEADS_BUCKET` can point at the same R2 bucket if we want one operational surface.

## GitHub Actions Setup

The main packaging workflow still publishes GitHub prereleases. When Cloudflare settings are present, it also syncs the release files to R2:

| Name | GitHub type | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare account for Wrangler. |
| `CLOUDFLARE_API_TOKEN` | Secret | API token allowed to write R2 objects. |
| `TAPPAD_R2_BUCKET` | Variable | R2 bucket name, for example `tappad-downloads`. |
| `TAPPAD_DOWNLOAD_BASE_URL` | Variable | Public download origin, for example `https://downloads.tappad.app`. |

The workflow writes each build to:

- `releases/<release-tag>/<file>`
- `latest/<file>`
- `latest/downloads.json`

The macOS beta download may point to the Tauri `.dmg`. The native macOS `.zip` can still be published for internal validation or future system-integrated distribution, but it is not required to be the default public beta artifact.

Manual workflow runs support two paths:

```bash
# Build packages, publish a new GitHub pre-release, and sync it to R2.
gh workflow run build-desktop-host.yml --ref main

# Sync an existing GitHub release to R2 without rebuilding packages.
gh workflow run build-desktop-host.yml --ref main -f release_tag=main-20260620T104052Z-2cea3f5
```

The Landing page only receives the final download link after the visitor submits the dialog, so public download URL shape can change without editing the static HTML.
