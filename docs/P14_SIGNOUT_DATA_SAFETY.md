# P14 — Account sign-out and device-only data safety

## Problem

Recipe documents and collections already used a durable outbox, which blocked logout while edits were unsynced. The P11–P12 saved kitchen sessions, P12 weekly meal planner and P5 pantry lived in account-scoped IndexedDB metadata. With P13 workspace cloud sync disabled by default, this metadata had **no cloud backup**, but the original sign-out flow erased it without warning.

## Implemented behavior

- The app drains queued meal-planner, cooking-session and pantry writes before sign-out checks.
- Pending recipe and collection mutations still block ordinary sign-out; a workspace confirmation cannot bypass that protection.
- Pantry ingredient selections and the assume-staples setting count as device-only data.
- A non-empty meal plan or any saved kitchen session without an acknowledged workspace cloud baseline counts as device-only data.
- For qualified P13 sync, a workspace copy that exactly matches its acknowledged cloud document is safe to clear; changes and local deletions since acknowledgement are protected.
- Cloud comparison is order-independent for JSON object keys and order-sensitive for arrays, matching Postgres JSONB behavior.
- A dedicated modal explains the number of unbacked-up items and offers **Keep my data** (default) or **Discard local data & sign out** (explicit destruction).
- Unsupported Cache Storage no longer blocks local sign-out cleanup.

## Deliberate limitations

- **Confirmation is not a backup.** Keeping the user signed in protects the local copy; it does not upload it when P13 sync is disabled.
- Clearing site storage directly, browsing in a disposable/private session or uninstalling the browser can still erase device-only work.
- P13 remains `VITE_RECIPE_WORKSPACE_SYNC=qualified-v1` gated until Core migration, Gateway permissions and two-device regression qualification.
- Owner-scoped recipe and collection cloud sync stays independent of P13.

## Acceptance

1. On a signed-in browser, create a meal plan and pantry. Tap the account sign-out control. A warning appears, and **Keep my data** preserves both.
2. After all cookbook mutations have synced, choose **Discard local data & sign out**. Only then are the device-only plan, pantry and sessions cleared.
3. Add a new unsynced recipe while offline. The normal outbox safety guard must still refuse sign-out, even after opening the local-data warning.
4. If P13 is qualified, verify already acknowledged unchanged work signs out without a local-data warning. Confirm an offline edit or deletion does trigger one.
5. Verify the warning and actions on mobile screen widths, including keyboard and screen-reader use.

## Release gate

`pnpm verify` plus manual sign-in/sign-out qualification on a real browser. GitHub CI queued at authoring time; this document does **not** claim it has passed.
