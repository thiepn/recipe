# P15 — Resilient Account startup

## User-visible issue
The app previously called Account `getUser()` during boot and treated **every thrown error** as if the user had signed out. A temporary service outage, expired-network request or failed token refresh therefore showed the Google sign-in screen even when local auth state was still present.

## Fix
- Check for an existing local Supabase session first; only an absent session is a signed-out state.
- If a session exists, still require `getUser()` verification before opening owner-scoped recipe data; do not infer ownership from an unverified token payload.
- Surface verification or refresh failures as recoverable startup errors.
- Replace the misleading always-configuration error screen with **Retry opening Recipe** and explicit local-data reassurance.
- Test no session, valid verified session, remote verification failure, local session refresh failure and unverified identity.

## Scope and safety
- No cookies or private storage shared between origins.
- No extra cross-app SSO promises: THIEPN Account remains the identity authority.
- No new database migrations, no public Recipe access.
- Does not activate P13 workspace cloud continuity or Luna.

## Verification
Run `pnpm verify` (TypeScript, Vitest and Vite build) and check login, authenticated reload, session expiration/offline recovery, and `/auth/callback` on a real device.

This PR is stacked on P14 while P14 awaits CI. It is not production-certified merely by opening the PR.
