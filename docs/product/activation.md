# Online Activation

## Purpose

The activation backend verifies that a TapPad installation is allowed to run as a paid commercial product.

It is a licensing and entitlement service, not a remote-control relay. Mobile input events should stay local between the mobile input surface and the target backend.

## Initial responsibilities

- Accept a license key or purchase token.
- Bind an activation to a device identity with a small reset allowance.
- Return entitlement state to the TapPad client.
- Support deactivation or replacement for normal device changes.
- Provide enough audit trail to debug support requests.
- Optionally issue an early-user benefit code or license after useful feedback.

## Early-user benefit

Early users who provide useful feedback should receive a future benefit. The exact benefit can remain flexible while pricing, update policy, and paid packaging are unresolved.

Acceptable benefits include a launch discount, free v1 license, extended access, or another early-user offer. Avoid promising permanent access to all future paid updates.

## Out of scope for the first slice

- Team seat management.
- Usage-based billing.
- Remote input relay.
- Cloud sync of user settings.
- Complex fraud scoring.
- Admin dashboard.
- Requiring email before the user can download the beta client.
- Treating early-user access as a permanent entitlement to all future paid updates.

## Client behavior

The client should cache a successful activation locally. During short network failures, the paid experience should continue according to the cached entitlement policy.

Activation checks should happen at startup, first-run, periodic refresh, or explicit license actions. They should not block pointer, keyboard, text transfer, paste, or desktop action handling once the local runtime is active.
