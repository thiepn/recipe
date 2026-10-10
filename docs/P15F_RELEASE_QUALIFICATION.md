# P15F — Release qualification and production cutover

## P15E cutover evidence
On 9 October 2026, Vercel accepted the previously quota-blocked deployment of main commit
`7a75767e2256eda5f05bf2a3aa3ea245b4439d22`. Deployment
`dpl_FqGUyQm7e7y1yL8bHXvkKoTkxe8y` finished READY, reported no alias error and assigned
`recipe.thiepn.dev`. This is deploy-provider evidence, not proof of full auth flows.

## Repeatable P15F gates
- Build emits `/release.json` with public app name, Git commit, branch and build timestamp.
- `pnpm verify` runs TS checks, Vitest, Vite build and local built-site HTTP smoke.
- `pnpm test:browser` runs Chromium on desktop and mobile viewports, checks signed-out
  privacy boundary, primary deep links, invalid callback recovery and horizontal layout.
- Production smoke is a separate workflow_dispatch: submit the **exact deployed SHA**
  and verify `https://recipe.thiepn.dev/release.json`, SPA rewrites and built assets.
- CLI: `RECIPE_SITE_URL=https://recipe.thiepn.dev RECIPE_EXPECTED_SHA=<SHA> node scripts/check-site.mjs`.
  The script performs anonymous GETs only and never mutates user data.
- Avoid repeated per-file Vercel preview pushes. Batch phase changes and merge only
  after CI passes, preserving free deployment quota.

## Important limits
- Viewport emulation is NOT testing a physical Android or iPhone device.
- Browser tests use deliberately invalid fake Account/Core URLs and no real user tokens;
  they test signed-out state and shell only. They do NOT qualify Google OAuth, permission
  boundaries against real accounts, API writes, offline IndexedDB recoverability or
  multi-device synchronization.
- These flows remain manual release acceptance requirements, using test accounts and
  safe non-production sample recipes. Record evidence before calling the app fully qualified.
- P13 workspace sync remains feature-gated. No migration or gate override in this phase.
- Do not include Account secrets or access tokens in the release manifest.

## Post-deploy manual acceptance checklist
1. On `recipe.thiepn.dev`, verify account sign-in and OAuth return, then logout/relogin.
2. Save a private sample recipe, reload the page, verify no draft loss.
3. Edit offline, reconnect, check durable retry and cloud confirmation.
4. Download an account-scoped backup. Restore missing items in a fresh browser profile
   of the same account; verify that already-existing local records remain untouched.
5. Simulate a stale cloud change and confirm that recovery requires re-review.
6. Compare desktop, Android Chrome and iOS Safari where available.
7. Check a second signed-in account cannot fetch or edit first-account recipes.
8. Check console, broken assets, slow network conditions and app-install/PWA behavior.
