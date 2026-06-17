# TapPad Commercialization

## Product position

TapPad turns a phone or tablet into a mobile input surface for a desktop machine. It is not a remote desktop product.

## First commercial wedge

The first commercial backend is macOS. The first buyer is a MacBook user working with an external display who wants a temporary trackpad, keyboard, text-transfer surface, and control pad.

Omarchy/Linux remains a real supported backend and proof of the product experience, but it is not the initial commercial wedge.

## Commercial surfaces

- **Client app**: desktop-side TapPad runtime that receives input from the mobile surface.
- **Mobile input surface**: browser-based control UI used from a phone or tablet.
- **Website**: product explanation, download, pricing, onboarding, and support entry point.
- **Online activation backend**: validates purchases, activations, entitlement state, and device limits.

The first website surface can start as a simple landing page with product explanation, use scenarios, a download entry point, and a feedback entry point. It does not need the full launch website, activation flow, or detailed analytics configuration upfront.

## Early packaging assumption

Start with a paid individual license before adding teams, seats, usage tiers, or enterprise policy. The initial product value should be clear without an admin console.

## Public beta download

The beta website should allow public download instead of requiring an application form. A low-friction download is part of validating whether enough people are willing to try a small utility product.

Feedback collection should happen around the public download and inside the client app, not by blocking trial behind an approval step.

The website should not require email before download. The beta should have a free usable layer so visitors can try TapPad without first proving intent.

Users who provide useful feedback should receive a future benefit, such as a launch discount, free v1 license, extended access, or another early-user offer. Keep the promise intentionally flexible until pricing, update policy, and paid packaging are clearer.

The free usable layer still needs a conversion loop. Download analytics alone are not enough; TapPad should be able to observe whether a downloaded client was opened, connected to the mobile input surface, used for core input, and later converted into feedback or an email-backed early-user relationship.

Email capture should happen after download or inside the client, where it can be framed as receiving updates, an early-user benefit, or a future license offer instead of as a download gate.

TapPad should keep diagnostics and conversion tracking lightweight. The macOS client can use Apple's unified logging for local diagnostics, while remote analytics should be limited to anonymous conversion and health events such as app opened, pairing ready, mobile connected, first input sent, feedback opened, feedback submitted, and email linked.

Remote analytics must not collect typed text, clipboard contents, window titles, file names, precise pointer streams, or session replay.

## Product constraints

- Activation should not be in the pointer-event hot path.
- Local input should keep working during short network outages after successful activation.
- Licensing should protect the paid product without making first-run setup feel brittle.
- Website and activation service should share product language with the client rather than inventing a separate SaaS vocabulary.
