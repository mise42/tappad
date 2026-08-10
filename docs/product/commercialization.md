# TapPad Commercialization

## Product position

TapPad turns a phone or tablet into a mobile input surface for a desktop machine. It is not a remote desktop product.

## Commercial beta posture

TapPad is now a cross-platform desktop beta across macOS, Windows, and Linux/Omarchy. The buyer is a desktop user working with a larger screen, temporary desk setup, presentation setup, or second-screen workflow who wants a temporary trackpad, keyboard, text-transfer surface, and control pad.

macOS was the first commercial wedge and remains important for individual-license polish. Windows and Linux are now part of the product promise rather than future directions, with platform-specific downgrade notes where action parity is not complete.

The macOS public beta uses the Tauri `.dmg` as the active desktop host package. The previous native AppKit implementation is not an active commercial path; any future macOS system integration should be introduced as a narrow adapter only after a concrete limitation is verified.

## Commercial surfaces

- **Client app**: desktop-side TapPad runtime that receives input from the mobile surface.
- **Mobile input surface**: browser-based control UI used from a phone or tablet.
- **Website**: product explanation, download, pricing, onboarding, and support entry point.
- **Online activation backend**: validates purchases, activations, entitlement state, and device limits.

The first website surface can stay as a simple landing page with product explanation, platform download entry points, use scenarios, and a feedback entry point. It does not need the full launch website, activation flow, or detailed analytics configuration upfront.

## Early packaging assumption

Start with a paid individual license before adding teams, seats, usage tiers, or enterprise policy. The initial product value should be clear without an admin console.

## Public beta download

The beta website should allow direct download after a lightweight email and use-case dialog instead of requiring an approval form. A low-friction download is part of validating whether enough people are willing to try a small utility product.

Feedback collection should happen around the download and inside the client app, not by blocking trial behind a manual review step.

The website can collect email and expected use case immediately before starting the beta download. The dialog should make clear that submission starts the download automatically and should not feel like an application queue.

Public download links should point at a public artifact surface. Private repository prereleases may prove packaging internally, but they are not a usable website download target for visitors.

Users who provide useful feedback should receive a future benefit, such as a launch discount, free v1 license, extended access, or another early-user offer. Keep the promise intentionally flexible until pricing, update policy, and paid packaging are clearer.

The free usable layer still needs a conversion loop. Download analytics alone are not enough; TapPad should be able to observe whether a downloaded client was opened, connected to the mobile input surface, used for core input, and later converted into feedback or an email-backed early-user relationship.

Email capture should be framed as beta access, follow-up, updates, an early-user benefit, or a future license offer instead of as a high-friction qualification step.

TapPad should keep diagnostics and conversion tracking lightweight. The macOS client can use Apple's unified logging for local diagnostics, while remote analytics should be limited to anonymous conversion and health events such as app opened, pairing ready, mobile connected, first input sent, feedback opened, feedback submitted, and email linked.

Remote analytics must not collect typed text, clipboard contents, window titles, file names, precise pointer streams, or session replay.

## Product constraints

- Activation should not be in the pointer-event hot path.
- Local input should keep working during short network outages after successful activation.
- Licensing should protect the paid product without making first-run setup feel brittle.
- Website and activation service should share product language with the client rather than inventing a separate SaaS vocabulary.
