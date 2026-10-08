# P7 — ChatGPT ↔ THIEPN Recipe

## Architecture and scope

P7 exposes a private, owner-scoped **stateless Streamable HTTP MCP** resource at:

- Endpoint: `https://recipe.thiepn.dev/api/mcp`
- OAuth protected-resource metadata: `https://recipe.thiepn.dev/.well-known/oauth-protected-resource`
- Issuer: the existing THIEPN Account Supabase OAuth 2.1 server, **not a separate login system**
- Backend: the existing THIEPN Core Gateway's authenticated Recipe routes

A successful ChatGPT connection is **not** implied by merging this code. The live endpoint, OAuth client registration, Account consent, access-token resource binding, and smoke tests have separate activation gates.

```text
ChatGPT (installed private Recipe plugin)
      ↓ OAuth 2.1 authorization + PKCE, explicit user consent
THIEPN Account OAuth issuer
      ↓ access token with aud/resource bound to Recipe MCP
THIEPN Recipe /api/mcp
      ↓ issuer/audience/resource/client/scope/subject + live /auth/v1/user check
RecipeCoreApi (forwards the SAME user bearer only)
      ↓
THIEPN Core Gateway → canonical THIEPN Account owner UUID
      ↓
private recipe schema and revision-checked mutations
      ↓
Recipe app syncs and shows saved private drafts
```

No service-role key, owner ID supplied by the model, unrestricted SQL, public recipe access, or writes to other THIEPN apps.

## Tools

| Tool | Permission | Behavior |
|---|---|---|
| `recipe_list` | Read | Search private recipe titles and favorites, return bounded summaries |
| `recipe_get` | Read | Retrieve one private recipe with ingredients/steps and source metadata |
| `recipe_find_by_ingredients` | Read | Match ingredient types, list missing types; scans at most 120 recipes and reports truncation |
| `recipe_save_draft` | Write | Creates one **private draft** only after explicit user save intent, with validated title/ingredients/steps and attribution |

No update, delete, publication, favorites modification or account-management tools are exposed.

## Write safeguards

- `recipe_save_draft` requires `confirmed:true`, a caller-generated UUID `request_id`, and at least one ingredient and step.
- A stable SHA-256-derived UUID namespace of `(verified user ID, request_id, record index)` determines recipe IDs, version IDs, ingredient/step IDs and the mutation ID. Retries with the same request ID cannot create a second recipe. Reusing it with different content yields a conflict.
- Exact-title collisions return `duplicate_warning` unless the user specifically approves `allow_duplicate:true`. This is **best-effort owner-scoped** preflight, not a globally serialized uniqueness constraint.
- Schema validation is performed using the same `recipeEditableDocumentSchema` contract as the Recipe app, and the Core Gateway independently validates and owner-scopes the mutation.
- The write tool creates **drafts**. It does not silently publish or overwrite family recipes.
- Source URL is strictly sanitized; provenance is marked `kind:'chatgpt'` and `reviewStatus:'user-confirmed-draft'`. Imported content is treated as data, not instructions.
- Remote reads come only from the authorized Core Gateway. An untrusted recipe ID does not grant access to another owner's record.

## OAuth policy

`api/mcp-auth.ts` requires:

1. Bearer token on `/api/mcp` from the canonical Recipe MCP origin.
2. Exact THIEPN Account issuer.
3. Resource-bound `aud` and `resource` **both** equal to `https://recipe.thiepn.dev/api/mcp`.
4. UUID `sub` and OAuth `client_id`, future `exp`, exact required scopes `openid email profile offline_access`.
5. A fresh Account `/auth/v1/user` verification whose user ID matches the token subject.
6. Only after successful authentication may the bearer be forwarded to THIEPN Core Gateway.

Unauthorized requests receive a 401 OAuth challenge and protected-resource discovery link. The server does not accept raw Supabase browser-session access tokens lacking the MCP resource binding.

## Companion Account PR

See `thiepn/account` P7 Recipe OAuth consent PR:

- distinct Recipe consent text: reads private cookbook, may create private drafts, cannot edit/delete;
- strict ChatGPT callback + exact Recipe resource and existing Finance/Hub separation;
- stage flag `VITE_RECIPE_MCP_OAUTH_ENABLED=staged-v1`;
- opt-in trusted mapping `private.recipe_mcp_oauth_clients` in the Account database access-token hook;
- no clients are automatically granted access by the schema migration.

**Important:** Account's resource-binding hook only issues Recipe-audience tokens for client IDs manually allowlisted by an authorized administrator after checking the exact ChatGPT callback, owner consent and OAuth client registration. Do not bind an unknown client ID to the Recipe MCP resource.

## Production configuration

Recipe Vercel server environment variables:

```text
THIEPN_ACCOUNT_URL=https://<account-project>.supabase.co
THIEPN_ACCOUNT_PUBLISHABLE_KEY=<account-project-public-publishable-key>
THIEPN_CORE_GATEWAY_URL=https://<core-gateway-host>
RECIPE_MCP_RESOURCE_URL=https://recipe.thiepn.dev/api/mcp
```

These are server-only configuration values. Never prefix them with `VITE_`, except the Account frontend feature flag separately. The Account publishable key is not a service-role secret.

## Activation and qualification gates

1. Merge and deploy both `thiepn/recipe` P7 and `thiepn/account` P7 code.
2. Confirm Account OAuth Server + PKCE + DCR are enabled and `/oauth/consent` is configured as the authorization path; verify the existing Finance integration is unaffected.
3. Apply the Account migration that extends the existing token hook to the Recipe client mapping. Confirm the hook remains enabled.
4. Configure the Recipe server-only Vercel environment and redeploy.
5. Verify `GET /.well-known/oauth-protected-resource` gives canonical Recipe resource and Account issuer.
6. Verify unauthenticated `POST /api/mcp` returns 401 with the OAuth metadata challenge.
7. Enable `VITE_RECIPE_MCP_OAUTH_ENABLED=staged-v1` in the Account frontend and deploy.
8. Add **https://recipe.thiepn.dev/api/mcp** as a custom ChatGPT MCP plugin using OAuth.
9. Confirm its OAuth client ID and ChatGPT-only callback; explicitly bind that client ID to Recipe in `private.recipe_mcp_oauth_clients`. If the first attempt fails due to missing token audience, re-consent after binding.
10. Complete Account consent, refresh-token qualification, inspect a real access token's `aud` and `resource` in a secure diagnostic (never share bearer bytes).
11. Verify `recipe_list`, `recipe_get`, `recipe_find_by_ingredients`, a new `recipe_save_draft`, same-`request_id` retry, duplicate warning and denied token from Finance.
12. Verify private draft appears in Recipe on desktop/mobile after sync and no other Account can access it.

**Current status:** implementation and CI in repository; production OAuth activation and real-user qualification cannot be inferred from CI or GitHub merge.

## P8 handoff

The optional GPT-6 Luna in-app assistant may use the same constrained Recipe semantics, but must not bypass owner scoping, private-draft confirmation, validation, deduplication and human review. Basic searching and import remain usable without Luna.
