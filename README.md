# Recipe

Personal cooking system for **https://recipe.thiepn.dev**.

Recipe is a **search-first private cookbook**. The everyday experience is:

```text
Save or import → Search recipes and ingredients → Open → Cook
```

The cookbook dashboard is the application root (`/`). Saved recipes are owned by individual accounts, preserve source provenance and version history, and remain searchable without AI. The existing structured recipe domain also supports a future kitchen-first Cook Mode. AI-powered ChatGPT imports and GPT-6 Luna assistance are optional later phases, not prerequisites for basic search and cooking.

## Architecture

- **Identity authority:** THIEPN Account
- **Product data:** THIEPN Core
- **Product namespace:** `recipe`
- **Backend level:** `5`
- **Default visibility:** `private`
- **Ownership:** canonical THIEPN Account UUID verified by the Core Gateway
- **Cloud data path:** Recipe client → Core Gateway → private Recipe schema
- **Local persistence:** IndexedDB + owner-scoped media Cache Storage
- **Database security:** no direct `anon`/`authenticated` Recipe table access; RLS remains defense in depth
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

Supabase security advisors reported no Recipe-specific findings after P1. Performance advisor FK coverage was clean; new indexes naturally report as unused until application traffic exists.

> **P2 correction:** P1 initially referenced THIEPN Core's local `auth.users`. P2 verified that THIEPN Account and Core are separate Auth tenants, removed those foreign keys, and moved Recipe to the existing verified Gateway identity boundary.

## P2 — complete

P2 adds:

- Google OAuth / PKCE through THIEPN Account;
- Gateway-only Core access;
- strict recipe-document compare-and-swap revisions;
- idempotent mutation receipts and a monotonic change cursor;
- tombstone deletes;
- IndexedDB documents/outbox/conflicts/meta;
- conflict preservation instead of last-write-wins;
- owner-scoped offline media cache;
- sign-out protection while unsynced changes remain;
- a service-role-only owner-scoped Recipe cleanup primitive for trusted lifecycle orchestration.

See `docs/P2_SYNC_AUTH.md`.

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
  P2_SYNC_AUTH.md

src/
  api/
  auth/
  data/
  media/
  sync/

supabase/
  migrations/
```

## P3 — complete

The initial recipe library, text search, favorites and collections are implemented. See `docs/P3_FINAL_CERTIFICATION.md`.

## P4 — merged and CI verified

The P4 search-first redesign consolidates the Recipes page into the single root cookbook, removes the separate homepage and overview stat cards, and upgrades responsive search/filter layout. See `docs/P4_SEARCH_FIRST_COOKBOOK.md`.

## P5 — implemented and CI-verified

The cookbook now includes an account-scoped, device-local ingredient selector, conservative English/German ingredient normalization, required/optional ingredient coverage, exact missing-item names, ranked recipe results, and filters for zero/one/two missing ingredient types. Quantities are **not** checked, so matching never claims a recipe is cookable with available amounts. See `docs/P5_INGREDIENT_INTELLIGENCE.md`.

## P6 — import pipeline implemented in code

Authenticated private draft creation now supports pasted recipe text, structured JSON-LD, browser-permitted HTTPS page extraction, and optional on-device photo OCR. It provides an editable review stage, provenance metadata, and best-effort local duplicate warnings. The existing Account/Core sync path remains authoritative. URL extraction is CORS-dependent, photo originals are not retained, and canonical source-table writes remain a backend follow-up. See `docs/P6_IMPORT_PIPELINE.md`.

## Next

**P7 — Authenticated ChatGPT Recipe Actions:** private recipe search and draft uploads through narrow tools. P8 adds optional GPT-6 Luna extraction and generation.

## P2 production gates

Before public release, THIEPN Account must allow the Recipe OAuth callback, full THIEPN Account deletion must coordinate Recipe deletion across the separate Core project, and private source-media upload/deletion must be certified in the Capture phase. Core Gateway production CORS already allows `https://recipe.thiepn.dev`.
