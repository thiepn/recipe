# P8 production activation: Recipe, Account and Luna

Updated 2026-10-08. This runbook separates **deployed**, **verified in code**, and **blocked**. Do not mark an app or AI capability live merely because CI succeeds.

## Confirmed infrastructure

- Vercel team: `thiepn-project`.
- Recipe project: `recipe`, linked to `thiepn/recipe` GitHub `main`; production build is READY at Vercel. Custom domain `recipe.thiepn.dev` has been associated and Vercel ownership-verified.
- Production/preview/development Vite build environment: `VITE_THIEPN_ACCOUNT_URL`, `VITE_THIEPN_ACCOUNT_PUBLISHABLE_KEY` and `VITE_THIEPN_CORE_URL` are configured, with the public Account client key only.
- Recipe **Luna disabled**: `VITE_RECIPE_LUNA_ENABLED` is intentionally absent. The app keeps working without the AI service.
- Shared THIEPN AI P8 Recipe capabilities are deployed READY in `thiepn-project/ai`, with CI passing.
- Core Gateway P8 branch CI passed, including 144 tests; Core Worker upload/deploy succeeded on 2026-10-08 but the overall deploy workflow failed during the signed Languages AI smoke.
- Vercel AI and Recipe projects have deployment protection for auto-generated deployments, excluding verified custom domains. Use the custom-domain hosts, not preview `*.vercel.app` hosts, for production service-to-service traffic.

## Blocker 1: Porkbun DNS

Vercel lists `thiepn.dev` as an **external zone** with the authoritative nameservers `curitiba.ns.porkbun.com`, `fortaleza.ns.porkbun.com`, `maceio.ns.porkbun.com`, and `salvador.ns.porkbun.com`. It cannot manage these DNS records in its own zone.

GitHub Actions network diagnostics on 2026-10-07 returned **NXDOMAIN** for `ai.thiepn.dev`; the 2026-10-08 Core deployment signed AI smoke failed with `unavailable/NETWORK`. This remains the principal blocker to authenticated upstream calls. The Recipe custom domain has been added to Vercel, but DNS propagation was **not verified** externally.

In Porkbun → Domain Management → `thiepn.dev` → DNS:

1. Add/repair a **CNAME** for host `ai`, destination equal to the *exact* CNAME value displayed in Vercel → Project `ai` → Domains.
2. Add/repair a **CNAME** for host `recipe`, destination equal to the *exact* CNAME value displayed in Vercel → Project `recipe` → Domains.
3. Check for existing conflicting CNAME, A, AAAA or wildcard records before adding. Do not delete unrelated records.
4. Recheck `nslookup ai.thiepn.dev` and `nslookup recipe.thiepn.dev`. Each must resolve from an external network.
5. Check `https://ai.thiepn.dev/v1/health`: expect the THIEPN AI JSON response; if the status is 503, investigate runtime readiness/guardrail store without concluding DNS remains broken. `https://recipe.thiepn.dev` should deliver the React Recipe app.

Vercel's generic documentation shows `cname.vercel-dns-0.com` as a common subdomain target, but **prefer each project's exact recommended value**, which may be unique.

## Blocker 2: Recipe AI app identity and Gateway secrets

P8 requires an **independently generated 32+ character secret** that must be configured in two server-only places:

- AI production configuration: register a `recipe` signing identity in `THIEPN_AI_APP_SECRETS_JSON` on the `ai` project. **Merge** this entry into existing Languages and Finance identities; do not replace the JSON map and break those apps.
- Core Gateway deploy: add encrypted GitHub Actions secret `THIEPN_AI_RECIPE_SECRET` for the Core production deployment. Update `deploy-gateway.yml` and `scripts/deploy-gateway.ts` to pass the server-only binding into Cloudflare Worker deployment. The code already rejects missing Recipe secrets with controlled 503.

These sensitive values must **never** be put in repository files, the browser, `VITE_*`, ChatGPT messages, or logs. Only the same secret is shared server-to-server. The current GitHub deployment logs also show `THIEPN_AI_FINANCE_SECRET` empty, which separately blocks the Finance AI part of the existing full smoke script. Do not mislabel a worker upload as a passing whole-system smoke.

## Blocker 3: Account OAuth allowlist and signed-in smoke

THIEPN Account's Google OAuth redirect allowlist must include:

`https://recipe.thiepn.dev/auth/callback`

The Recipe Vercel configuration now includes a dedicated rewrite of `/auth/callback` to `/index.html`, alongside direct route rewrites for Collections, Cook and Plan. This handles SPA navigation after Google OAuth returns.

Check the real login flow using a trusted user without printing bearer tokens: Google → Account Supabase callback → Recipe `/auth/callback?code=...` → private cookbook. After login, verify the `/v1/recipe/manifest` Core call is owner-bound. Verify sign-out does not discard unsynced local records.

## Stage Luna last

1. Fix DNS and validate AI health.
2. Configure and qualify distinct Recipe signing secrets through proper encrypted secrets managers and redeploy AI + Core.
3. Confirm **signed** AI capability smoke for `recipe.generate`, `recipe.extract`, and `recipe.cookingHelp`, including budget-limit error behavior and no forwarded Account bearer. Validate Auth owner-scoping on the Core routes.
4. Validate Account OAuth callback.
5. Set **`VITE_RECIPE_LUNA_ENABLED=staged-v1`** only after all above checks pass, then redeploy Recipe.
6. Test generate/edit/save, OCR extraction/refinement, help from a selected recipe, mobile accessibility and unplugged/offline behavior. Verify a draft does not get saved without explicit user action.

## Public smoke endpoints

| Endpoint | Expected |
|---|---|
| `GET https://ai.thiepn.dev/v1/health` | AI JSON readiness, 200 if ready |
| `GET https://recipe.thiepn.dev` | Recipe frontend, 200 |
| `GET https://recipe.thiepn.dev/auth/callback` | SPA shell, 200; the app may show a missing-code message without a real OAuth callback |
| `GET https://thiepn-core-gateway.thiepn.workers.dev/health` | Core envelope, 200 |
| `POST /v1/recipe/ai/generate` with no bearer | 401 CORE_AUTH_REQUIRED |
| `POST /v1/recipe/ai/help` with no bearer | 401 CORE_AUTH_REQUIRED |

Do not test signed user requests from unauthenticated tools or share credentials to make smoke tests appear green. Until all checks pass, P8 is **deployed code with Luna hidden**, not a production-qualified assistant.
