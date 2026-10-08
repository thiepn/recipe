# P13 — Cross-device Recipe continuity (staged)

## What P13 adds
A single verified THIEPN Account can sync both the weekly meal planner and each saved cooking session between devices. The existing cookbook sync remains unchanged. P13 adds a separate Account-owned workspace stream through Core Gateway.

- Cloud documents: one `plan:main` document and one `session:<recipe UUID>` per recipe.
- Local-first: an offline device can still edit its meal plan, shopping checkmarks, and kitchen session. No API call is required for any local interaction.
- Cloud reconciliation: pull when the device copy has not diverged; push local changes against the last acknowledged server revision; use server-side compare-and-swap.
- Conflicts: if cloud and local changed independently, **neither is discarded**. User must choose **Keep this device** or **Use cloud version**. The first choice uses the latest cloud revision for a new CAS attempt, and the latter explicitly copies the cloud snapshot locally.
- Saved session deletion is a revisioned tombstone, not a blind local delete that can reappear from another device.
- Invalid or rolled-back server revisions fail closed rather than wiping local work. Local schema validation prevents corrupt snapshots being uploaded.
- Each device stores the last acknowledged cloud version in account-scoped IndexedDB metadata; recipe contents themselves remain governed by the existing Recipe document sync layer.

## Gate — OFF until qualified

`VITE_RECIPE_WORKSPACE_SYNC` is intentionally **unset** by default. Only the exact value `qualified-v1` enables cloud continuity. P13 code merging does not activate the feature.

### Activation sequence

1. Review and apply the migration `thiepn/core/supabase/migrations/20261008224000_recipe_p13_workspace_sync.sql` **to the actual Core Supabase project**, not the separate THIEPN Account Auth Supabase project.
2. Verify PostgREST can call `gateway.recipe_workspace_list` and `gateway.recipe_workspace_apply` with **service_role** only and verify `anon` and `authenticated` cannot call either.
3. Deploy the updated Core Gateway from `thiepn/core`, verify bearer authorization and user isolation using test accounts, and run migration/RLS advisors.
4. Publish the latest Recipe `main` commit to its Vercel project, then test Recipe sign-in, cookbook sync, plan sync, and Cook from two distinct browsers.
5. Enable `VITE_RECIPE_WORKSPACE_SYNC=qualified-v1` only once steps 1–4 pass. Redeploy and run a final cross-device acceptance suite.

**Do not** set the flag before the migration and Gateway are ready, and do not enable Luna as part of P13. DNS/OAuth activation and Vercel deployment quota are independent production blockers.

## User-visible limitations

- Sync runs at startup and periodically/when returning to an active tab; it is **not realtime collaboration** or a transactional shared shopping list.
- Conflict resolution is whole-document: simultaneous changes in separate meal slots can still generate a conflict. P14 can implement per-field three-way merging after proving this lossless baseline.
- Timers maintain cloud-synced wall-clock deadlines but **cannot guarantee background OS notifications**.
- An edited recipe's ingredient/step IDs are matched when a cooking session is hydrated locally; missing IDs are pruned by the P11 restore layer. Recipe deletions must be verified before enabling P13.
- Browser storage clearing on an offline device removes its unsynced local changes; the cloud retains only successfully uploaded versions.

## Acceptance checks
- Two devices signed in with the same Account: create plan on A; see it on B; mark a shopping purchase on B; see it on A.
- Pause timer on A; verify paused duration and step progress on B; resume timer on B and verify wall-clock deadlines.
- Edit same plan independently offline on A and B, bring both online, and verify no silent loss and explicit conflict choices.
- Clear session on one device; confirm the other device does not resurrect it after a subsequent sync.
- Sign out of Account; verify locally retained work is wiped, and private cloud workspace requests cannot be made without bearer auth.
