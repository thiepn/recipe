# P11 — Resumable Kitchen & Independent Timers

P11 upgrades Cook mode without relying on Luna, a cloud service, new API keys, or a database migration.

## User experience

- Every cooking session has its own local state: recipe/version ID, checked ingredients, completed step IDs, selected step, adjusted servings, and up to eight independent timers.
- **Save & leave** returns to Cook without discarding work. The Cook list shows **Resume cooking** and the saved completion percentage; selecting the recipe restores its state.
- Reopening Cook after a page reload restores saved cooking sessions on the same device, under the currently signed-in Account.
- Timers run independently. Adding one does not replace an existing timer. Each can be paused, resumed or dismissed without changing the others.
- Each timer saves an absolute deadline. On restoration, a timer whose deadline has passed is marked **Time is up**; paused timers retain their remaining duration.
- When a recipe is edited, missing ingredient/step IDs are filtered out of restored sessions rather than pointing to deleted items. Existing valid step progress is preserved.
- Explicitly selecting **Finish and clear session** deletes the saved session, with a warning if any timer is still running. **Cook again** resets the recipe's current session.
- Account sign-out already erases account-scoped IndexedDB data, including P11 cooking snapshots.

## Privacy, persistence and recovery

Session snapshots are stored in `RecipeLocalDb.meta` under account- and recipe-scoped `kitchen-session-v1:<recipeId>` keys. They are **local to the current device/browser profile** and contain no full recipe, user profile, notes, bearer tokens or API secrets.

Writes for one recipe are serialized, so rapid checkmarks or timer actions don't write out of order. Different recipes are independently stored. Reopened sessions are strictly validated; corrupted or mismatched records do not cause untrusted data to be rendered.

Progress is not yet synced across devices. In particular, cooking state from another account or device must not be shown just because a recipe ID matches. Tabs editing the **same** session simultaneously should be avoided; last persisted snapshot wins. User-initiated browser storage clearing erases local cooking sessions.

## Timers and safety

- Timer duration: 1 second to 12 hours. Manual timer entry is limited to 1–180 minutes.
- Up to eight independent timers per cooking session.
- Timer deadlines use wall-clock time, not callback-counting, and are rechecked on foregrounding the app.
- Timers cannot reliably notify the user while the browser/tab is closed, the OS kills the page, or device alerts are blocked. There are no server-side alarms or scheduled push notifications in P11.
- A finished timer is never treated as proof of food safety or doneness.

## Release qualification

- Verify restoration across navigation, reload, and brief offline use.
- Verify that expired timers return as due; paused timers are not decremented while closed.
- Verify multiple recipes preserve separate sessions and sign-out wipes Account-local state.
- Verify mobile controls, focus/keyboard access and touch sizing.
- Production deployment remains subject to Vercel daily-deployment rate limit and separately scheduled Porkbun DNS/OAuth activation. P11 does not enable Luna.
