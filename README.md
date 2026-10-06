# Recipe

Personal cooking system for **https://recipe.thiepn.dev**.

Recipe is designed around one loop:

```text
Capture → Verify → Recipe → Prepare → Cook → Review → Improve
```

It is not a public recipe feed or generic CRUD cookbook. Each account owns an isolated private cookbook, recipes retain provenance and version history, and the structured domain model is designed to power an interactive Cook Mode rather than static instruction text.

## Architecture

- **Identity authority:** THIEPN Account
- **Product data:** THIEPN Core
- **Product namespace:** `recipe`
- **Backend level:** `5`
- **Default visibility:** `private`
- **Ownership:** canonical authenticated user UUID; clients never choose another user's owner ID
- **Database security:** PostgreSQL RLS on every Recipe table
- **Public URL:** `recipe.thiepn.dev`

The private `recipe` schema is not intended to be used as an unstructured public REST surface. Later phases add narrow typed product APIs/RPCs while RLS remains defense in depth.

## P1 — complete

P1 establishes the durable recipe domain:

- recipe identity and lifecycle
- immutable-ish recipe version history
- original source/provenance preservation
- structured ingredient groups and ingredients
- structured cooking steps
- ingredient ↔ step relationships
- equipment ↔ step relationships
- collections
- ownership-preserving composite foreign keys
- RLS owner isolation
- explicit database grants
- FK/index hardening
- optimistic revision fields for later sync work

Live migrations:

- `20261006082742_recipe_p1_domain_foundation.sql`
- `20261006082826_recipe_p1_fk_index_hardening.sql`

Supabase security advisors report no Recipe-specific findings after P1. Performance advisor FK coverage is clean; new indexes naturally report as unused until application traffic exists.

## Product constraints

- New accounts begin with no personal recipes.
- Personal recipes are user data, never hard-coded application content.
- Imported source material is preserved separately from normalized recipe data.
- AI may create drafts and flag uncertainty; it must not silently rewrite canonical family recipes.
- Sharing/public visibility may exist later, but owner-only access remains the P1 security behavior.
- Cook Mode is a first-class product surface and drives the structured schema.

## Repository

```text
contracts/
  recipe-domain.ts

docs/
  P1_DOMAIN_MODEL.md

supabase/
  migrations/
```

## Next

**P2 — Authentication Boundary, Local/Offline Data Architecture, Sync Contract & Privacy Hardening**
