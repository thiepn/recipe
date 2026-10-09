# P15E — Verified recovery, guarded backup restore and release qualification

## Product behavior
- P15D introduced JSON recovery export and conflict resolution. P15E adds an explicit local-only file review and missing-only restore.
- Files are parsed and validated before any IndexedDB write. A different-account backup or mixed ownership is rejected.
- Limit backup file size to 12 MB. Cap documents, outbox and metadata collections before processing.
- Recovery candidates include previously unsent recipe drafts, locally edited collection sets, and known device-only pantry/meal-plan/kitchen-session data.
- Previously synced recipes are excluded because the authoritative cloud should provide them; automatically inserting these could create collisions.
- Existing local records and pantry/planner/cooking data are never overwritten, even if the backup appears newer.
- Import uses a single IndexedDB transaction and freshly minted mutation identities. It never replays old outbox receipts, conflicts, cloud cursor or workspace baseline metadata.
- Orphaned cooking sessions are skipped rather than recreating removed recipes.
- A restored unsent recipe can encounter a cloud conflict. Use P15D review before choosing to accept or keep a version.
- All restore operations require file selection, visible preview and explicit confirmation. There is no upload or remote API call while parsing or applying the backup.
- A successful restore refreshes the cookbook, pantry and workspace views and then resumes ordinary sync.

## Verification matrix

| Scenario | Expected outcome |
| --- | --- |
| Wrong account or mixed account file | Rejected without writes |
| Corrupt JSON or invalid recipe schema | Rejected before preview |
| A record already exists locally | Skipped without changing it |
| Older device pantry backup | Current pantry preserved |
| Unsent recipe draft from backup | New local pending mutation ID |
| Cloud-synced recipe from backup | Not reimported |
| Cursor, workspace baseline, conflict receipts | Never restored |
| Cooking session whose recipe is gone | Skipped |
| Upload conflict after restore | Review with P15D; do not replace automatically |
| Download and restore while offline | Local-only operations work |
| Multiple tabs and interrupted writes | Browser acceptance gate; verify transaction safety |

## Build and release gates
1. `pnpm verify`: TypeScript, Vitest, and Vite production build.
2. Browser device testing on desktop and mobile: file input, export, same-account restore, connection loss, conflict resolution, sign-out guard.
3. Production Vercel build on the merged commit; check custom domain `recipe.thiepn.dev`.
4. Keep `VITE_RECIPE_WORKSPACE_SYNC` disabled until its independent cross-device acceptance tests pass. Do not claim pantry/plan/kitchen histories cloud backed.

## Deployment incident
Vercel previously reported HTTP 402 `api-deployments-free-per-day` (>100 deployments in 24 hours), and multiple intermediate P15D previews failed with `lint_or_type_error`. GitHub Actions passed for the corrected P15D merge commit. A Vercel READY production deployment for that commit was **not** confirmed at the start of P15E. Never mark the release live without a matching production commit in Vercel.

## Deferred
Cross-device account-level backup ingestion, full three-way merge, restoring arbitrary metadata, rolling over archived media blobs, and silent overwrite/replace are deliberately excluded.
