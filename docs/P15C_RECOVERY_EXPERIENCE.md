# P15C — Recovery experience and operational sync signals

## Purpose
The earlier sidebar could say "Saved locally" whether an upload succeeded, silently returned a retry, or quarantined a mutation. Users could also click Sync while offline with no meaningful response. This phase makes the real device-side IndexedDB outbox the source of sync feedback.

## Behaviors
- Distinct statuses for offline, active sync, queued uploads, retryable failures, blocked mutations, recorded conflicts, failed cloud check, and verified empty outbox.
- Compact inline recovery strip appears throughout the app on desktop and mobile whenever cloud confirmation is incomplete or needs attention.
- Connected retry is explicit, never enabled offline or during a request.
- No repeated toast on scheduled sync failures; the persistent status is visible until the underlying data changes.
- Stable promise lock prevents concurrent sync invocations from click, 30-second timer, focus and online events.
- The App checks both recipe and collection queues before and after sync, because the sync engines can return normally while intentionally retaining retry mutations.
- Local edits refresh queue state immediately; recipe edit actions re-read the latest working document before applying transformations.
- Recovery messaging warns against signing out while blocked/conflicted changes remain on the device.

## User acceptance
1. Save a recipe online: show pending on this device until acknowledged; only then show up-to-date.
2. Disconnect before saving: edit remains locally available, offline status appears, Retry is disabled.
3. Reconnect: online event triggers sync; do not require a reload.
4. Force HTTP timeout/rate limit: show interrupted upload with Retry; retain mutation ID.
5. Force a permanent invalid mutation: show needs attention; do not claim that Retry fixes a quarantined mutation.
6. Force a cloud read failure with an empty outbox: show cloud unavailable, not synced.
7. Trigger repeated focus/timer/button events: a single app-level sync pass should run.
8. Check mobile: message and action remain readable without horizontal overflow.
9. Verify P14 sign-out protections and P15B concurrency tests remain passing.

## Scope / boundaries
- This is not a cloud migration or account-token change.
- P13 device-to-device workspace sync stays gated until separately qualified. Pantry, plans and cooking sessions must not be represented as backed up unless confirmed.
- Failed conflicts still require a dedicated resolution flow; this phase provides visibility and avoids destructive automatic retries.
- Cannot guarantee sync in the background while the browser/PWA is closed.

## Release gate
Run `pnpm verify` and device/browser fault-injection tests before merging into main. This PR is stacked on P15B (#23), which is stacked on P15A (#22) and P14 (#21).
