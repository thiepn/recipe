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

## V3 owner approval and rollback qualification (source-only)
- V3 release-source QA runs SHA-256-pinned `actionlint` on both release workflows and invokes the *actual preflight shell* with expected accept/reject cases. No Vercel credential, deployment or API request is used by this QA.
- A source-only QA pass is **not** a production qualification. Before the first owner-approved merge, verify the enforceable `main` branch rules (PR reviews + required exact-head CI + block direct/force pushes), and an existing `thiepn-vercel-production` environment with main-only branch restrictions and required human approval. Never assume an environment is protected just because its name appears in YAML.
- Only after verification configure a least-privilege environment-scoped `VERCEL_TOKEN`, reviewed exact `VERCEL_CLI_VERSION`, and opt-in `THIEPN_RELEASES_ENABLED=true` separately. Keep the flag disabled until all protections and a successful source/policy audit are evidenced.
- Owner signs off on the exact `main` SHA, a currently serving production deployment ID/URL (not merely `latestDeployment`), its custom domain mapping, last successful CI run, immutable static/staged test evidence, and scope of allowed release. The approval must be specific to this project and SHA; do not reuse an approval across projects.
- **Stage approval:** manually dispatch `stage` with current 40-character `main` SHA and `STAGE <sha>`. Build and deploy `--skip-domain`, inspect the resulting staged production deployment and prove no user-facing alias moved; do not equate staged READY status with live approval.
- **Promotion approval (separate):** after explicit stage acceptance and data compatibility, manually dispatch `promote` with same exact current `main` SHA, the matching staged URL and `PROMOTE <sha>`. Reject stale commits or mismatched project/deployment metadata. Confirm live deployed SHA, domain status, function/API health, and error logs.
- **Hobby rollback procedure:** record the existing live ID before promotion; if the new release fails, use an independently owner-approved `vercel rollback --scope thiepn-project` and `vercel rollback status --scope thiepn-project` for the verified project. Hobby rollback can target only the *immediately previous production deployment*; verify live aliases and data afterward. Rollback of code does not undo database/schema/data changes. After rollback Vercel disables auto-alias assignment; do not restore automatic Git deploys to solve this.
- If Vercel is quota blocked, stop; never automate repeated retries. No production dispatch, environment/secrets/rules changes, staging, promotion or rollback is authorized by V3.

References: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments ; https://vercel.com/docs/cli/rollback
