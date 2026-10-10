# P18 — Household sharing readiness / authorization hard stop

## Authoritative 2026-10-10 source audit (no live database inspection)
- \`thiepn/recipe\` P1 schema contains \`recipe_visibility\` enum with \`household\`, but **no household membership/invitation/revocation authority**. Enum alone must never enable access.
- P2 migration \`20261006092205_recipe_p2_identity_sync_gateway.sql\` removes direct \`authenticated\` schema privileges, replaces direct policies with explicit DENY, and moves recipe mutations behind service-role-only Core Gateway RPCs keyed to the verified Account UUID. The original P1 owner RLS is **superseded** and is not a household permission system.
- \`thiepn/core/apps/gateway/src/routes/private-recipe.ts\` authenticates the bearer against Account and exposes manifest, documents, mutations, collections, changes, workspace. It has **no** household endpoint or trusted member authorization lookup.
- \`thiepn/account\` docs / Account permission grant records are app-level connection controls; they explicitly **do not authorize Core namespace data paths**. They are not family membership.
- Recipe frontend \`src/auth/account.ts\` uses Account PKCE, getUser identity and local account-scoped IndexedDB; \`src/api/core.ts\` has no household API. P13 cross-device workspace is separately gated.
- Production DB migrations, active live RLS, historical users, real invitation delivery, notification channels, identity consent and physical accessibility were not verified. Never represent source audits as live signoff.

## Implemented (actual app branch)
- Cookbook top-level Family sharing control opens an accessible owner-first drawer.
- Clearly states sharing is **not available**, while allowing a local-only email/role **invitation draft preview**; it never persists or transmits the address, and all Send/Revoke controls remain disabled.
- Read-only role descriptions and explicit lack of verified memberships/revocations (no fake invitees).
- A small typed fail-closed access decision matrix, strict single-email draft validation and five separate required activation gates. Role inputs cannot serve as proof of server authorization.
- Unit adversarial cases: spoofed owner/editor, pending/revoked, unverified request, malformed invitation/extra field, missing gate.
- Synthetic real browser UI tests desktop + emulated mobile: keyboard focus, Escape/focus recovery, two offline form states, no POST/DELETE requests, zoom and reduced motion. None of this simulates or asserts actual multi-account backend authorization.

## Explicit next backend qualifications to enable **real** sharing (not implemented)
1. Identity-authoritative membership and invitation service design; owner-verifiable user consent and anti-enumeration; TTL single-use hashed invites, roles, atomic accept/revoke and replay resistance.
2. Reviewable **Core** migration + Gateway routes/RPC permission checks on every read/write; owner-scoped recipe collections, notes, original sources/media/CDN/offline caches and P13 workspace data **never** inherit exposure.
3. PostgreSQL adversarial integration with two or more independent Account identities, verified revocation after cache/token refresh and in-flight write races.
4. Account deletion / backup / portability semantics, audit log, invite dispatch provider qualification and independent human legal/privacy review.
5. Human operator release decision with rollout and rollback evidence.

There are deliberately NO real invitations, shared recipe payloads, real members or grants in P18. This PR must remain stacked DRAFT. No merge, migration, deployment or protected data access.
