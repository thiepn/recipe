# THIEPN Recipe — CI-first Vercel release (draft)

**Scope:** `thiepn/recipe`, Vercel `recipe` (`prj_u5xuNXb2ekkgnuajBKfg98kVWJB8`), `recipe.thiepn.dev`. Existing `vercel.json` SPA routes and Supabase authentication/data flows remain unchanged.

## CI-first policy
- `git.deploymentEnabled: false` prevents new Git-push previews and automatic production releases after merge, while retaining the presently deployed custom domain and all data.
- Current `.github/workflows/ci.yml` continues PR/main typechecks, vitest and Vite build with pnpm/Node 24. Do not add previews to every Codex commit.
- New manual-only owner workflow is **disabled by default**. Preflight requires actor `thiepn`, `main`, its exact 40-character SHA, typed stage/promote confirmation, pinned `VERCEL_CLI_VERSION`, and repository `THIEPN_RELEASES_ENABLED=true`. Fixed Vercel project/team IDs prevent accidental host substitution.
- Stage: Vercel CLI production prebuild with `--skip-domain`, giving a URL only. Promote: a separate manual action requiring exact staged URL and Vercel API validation (project identity, READY production target and source SHA metadata).

## Before any live release
1. Independently confirm exact-main GitHub CI and human acceptance of the UI, account separation, sign-in callback, ingredient search, Supabase permissions, local persisted data, backup and rollback.
2. Protect main (PR-only + required checks, no force pushes) and configure `thiepn-vercel-production` protected GitHub environment restricted to main, with human reviewers as permitted. These protections are not configured by this draft.
3. Confirm least-privilege environment-scoped `VERCEL_TOKEN` without disclosing it, set a reviewed exact `VERCEL_CLI_VERSION` and verify pnpm/Node 24 prebuilt compatibility.
4. Only after release preflight and a tested rollback target, explicitly set `THIEPN_RELEASES_ENABLED=true`. Missing flag makes every dispatch fail closed.

## Exact release instructions
- Run owner workflow `stage` on main, supplying `release_sha=<full current SHA>`, `confirmation=STAGE <sha>`. Verify staged URL without touching production user records.
- After browser, security, data and route acceptance, run `promote` on main with the same SHA, exact staged `*.vercel.app` URL and `confirmation=PROMOTE <sha>`.
- Verify `recipe.thiepn.dev`; preserve the existing live deployment and user data. Roll back via a separately approved procedure if errors occur.

**Unproven:** GitHub environment/secrets status and manual staged/prebuilt artifact runtime. This PR does not authorize merging, deploying, changing Vercel settings, or domain/data changes.

Reference: https://vercel.com/docs/project-configuration/git-configuration
