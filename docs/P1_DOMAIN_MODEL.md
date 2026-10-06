# P1 — Rich Recipe Domain Model, Database Architecture, Ownership & RLS

## Status

Implemented against **THIEPN Core** on 2026-10-06.

Public product: **recipe.thiepn.dev**

Canonical identity remains owned by **THIEPN Account**. Recipe product data lives in the private Core-owned `recipe` schema and is keyed by the canonical authenticated user UUID.

## Boundary

```text
THIEPN Account
  └─ canonical identity / session
            │
            ▼
recipe.thiepn.dev
            │
            ▼
THIEPN Core
  └─ recipe schema
       ├─ recipe identity
       ├─ versioned content
       ├─ provenance
       ├─ structured ingredients
       ├─ structured steps
       ├─ equipment
       └─ collections
```

The client must never be trusted to choose ownership for another user. Database policies resolve ownership from `auth.uid()`.

## Aggregate model

A recipe is split into stable identity and versioned content.

```text
recipes
  └─ current_version_id ─────────────┐
                                     ▼
                              recipe_versions
                               ├─ sources
                               ├─ ingredient_groups
                               ├─ ingredients
                               │    └─ step_ingredients
                               ├─ steps
                               │    ├─ step_ingredients
                               │    └─ step_equipment
                               └─ equipment

collections
  └─ collection_recipes ── recipes
```

### Why recipe identity and recipe version are separate

The stable `recipes` row owns lifecycle state, privacy, favorite state, hero media, deletion/archive state and the pointer to the current version.

The `recipe_versions` row owns recipe content: title, story, yield, servings, difficulty, time model, tags and author notes.

This allows later phases to preserve:

- Mom's original recipe
- personal revisions
- alternate variants
- historical cooking sessions tied to the exact version that was cooked
- source provenance without overwriting the original

## Tables

### `recipe.recipes`

Stable recipe identity.

Important fields:

- `user_id`
- `current_version_id`
- `state`
- `visibility`
- `favorite`
- `hero_image_path`
- `last_cooked_at`
- `revision`
- archive/delete timestamps

P1 visibility values reserve future sharing states, but **P1 RLS remains owner-only regardless of visibility**. Household/public access must be explicitly introduced in the sharing phase.

### `recipe.recipe_versions`

Versioned canonical recipe content.

Contains:

- title / description / story
- yield and serving model
- active, passive, prep, rest and total time
- difficulty
- cuisine/category/dietary tags
- parent-version relationship
- revision metadata

### `recipe.recipe_sources`

Preserves provenance independently of normalized recipe content.

Can retain:

- source type
- family member/person
- source URL
- original media storage path
- original text
- extracted text
- extraction confidence
- unresolved uncertainties
- content hash

The original source is never treated as disposable AI input.

### `recipe.ingredient_groups`

Optional visual/semantic grouping such as:

- Sauce
- Dough
- Filling
- Garnish

### `recipe.recipe_ingredients`

Structured ingredients.

Core fields support:

- quantity ranges
- unit
- preparation
- optional ingredients
- notes
- canonical ingredient keys
- scaling behavior

Scaling behavior is explicit:

- `linear`
- `seasoning`
- `fixed`
- `contextual`

This avoids assuming every ingredient scales by simple multiplication.

### `recipe.recipe_steps`

Cooking instructions are executable structured steps rather than one opaque instructions blob.

P1 includes:

- stable ordering
- duration range
- timer label
- normalized Celsius temperature plus display text
- heat level
- visual cue
- doneness cue
- technique keys
- passive/parallelizable flags

This is the foundation for Mise-en-place and Cook Mode.

### `recipe.step_ingredients`

Links an ingredient to the exact step where it is used.

This enables future interactions such as:

- highlight ingredients required for the current step
- show remaining ingredient amounts
- scale step-level quantities
- answer “how much garlic now?”

### `recipe.recipe_equipment` / `recipe.step_equipment`

Stores recipe equipment and maps equipment to individual steps.

This enables future prep checklists and kitchen-aware assistance.

### `recipe.collections` / `recipe.collection_recipes`

Personal cookbook organization.

The schema supports manual, smart and reserved system collections without creating a separate ownership model.

## Ownership invariants

Every user-owned table contains `user_id`.

RLS policies use:

```sql
(select auth.uid()) is not null
and (select auth.uid()) = user_id
```

For updates, both `USING` and `WITH CHECK` enforce ownership so a row cannot be reassigned to another user.

Composite foreign keys include `user_id` wherever child relationships could otherwise cross ownership boundaries. This prevents a valid user from attaching one of their rows to another user's recipe/version through guessed UUIDs.

All 11 P1 tables have RLS enabled and four owner policies:

- SELECT own
- INSERT own
- UPDATE own
- DELETE own

Anonymous table grants: **0**.

## API exposure

The `recipe` schema is a private product schema.

Authenticated access is granted so future **SECURITY INVOKER** product RPCs can operate under the caller's privileges and RLS. The schema is not intended to become a raw public API surface.

Later phases should expose narrow application contracts rather than teaching frontend code the entire normalized persistence model.

## Source of truth and migrations

Live Core migrations:

1. `20261006082742_recipe_p1_domain_foundation`
2. `20261006082826_recipe_p1_fk_index_hardening`

The same SQL is checked into `supabase/migrations/`.

## Validation

P1 verification performed:

- full DDL dry-run inside a rolled-back transaction
- live migration application
- schema/policy/grant introspection
- authenticated transactional create/update child-row smoke test, rolled back
- Supabase Security Advisor
- Supabase Performance Advisor
- FK index remediation
- second advisor pass

Final Recipe-specific state:

- 11 base tables
- 44 RLS policies
- 11/11 tables with RLS
- 0 anonymous table grants
- 0 Recipe-specific security advisor findings
- 0 unindexed-FK advisor findings

“Unused index” notices are expected while the new schema has no production workload and should not be treated as defects.

## Deliberately deferred

P1 does **not** prematurely add:

- universal capture inbox tables
- OCR/AI processing runs
- storage bucket policy
- Cook Sessions
- timers/session state
- meal planning
- shopping lists
- pantry
- household permissions
- public sharing
- cooking knowledge catalog
- recipe search RPCs
- ChatGPT write actions

Those features get dedicated phases so their security and lifecycle requirements can be designed properly.

## P2 handoff

P2 should build on this model without changing its ownership semantics:

**P2 — Authentication Boundary, Local/Offline Data Architecture, Sync Contract & Privacy Hardening**

Key P2 decisions:

1. connect the web client to the existing THIEPN Account identity contract;
2. define local IndexedDB/offline persistence;
3. define server/local revision and conflict semantics;
4. establish typed RPC/service boundaries;
5. define image/source storage ownership and offline caching;
6. ensure logout/account deletion and device lifecycle correctly handle Recipe data.
