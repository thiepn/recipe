# P4 — Search-first Cookbook

## Product change

Recipe is a **private, searchable cookbook**. Its primary screen is the saved recipe library at `/`; the old `/recipes` URL redirects to `/`. There is no separate marketing homepage, analytics dashboard or empty statistics panel.

Core workflow:

1. Save a real recipe in the account-owned backend.
2. Find it by title, saved ingredient or tag.
3. Narrow by favorites, time, difficulty or collection.
4. Open the recipe, cook from its ingredients and steps, and organize it.

A future ChatGPT integration will import/generate recipes into the same private backend. It will not bypass account ownership or replace normal cookbook search.

## P4 implementation

- One primary navigation entry: **Cookbook**.
- Compact cookbook heading and recipe count rather than oversized hero text.
- Search field remains visible even when the cookbook is empty.
- Search uses existing P3 relevance scoring across names, ingredient names, tags and descriptions.
- One-tap favorite and ≤30-minute filters, optional difficulty and collection selectors, deterministic sorting and clear-filters behavior.
- Empty and no-results states make the next action explicit.
- Responsive recipe grid: dense cards on desktop and two columns on mobile; no landing-style dashboard blocks.
- Cards have a dedicated keyboard-accessible open target. Favorite and collection actions remain independent.
- Collections, Cook and Plan remain separate routes, with their existing data and UI behavior preserved.
- `/recipes` legacy deep links are canonicalized to `/` without dropping query strings/fragments.

## Non-goals and guardrails

**P4 does not implement**: pantry availability, missing-ingredient ranking, recipe extraction, URL/photo import, ChatGPT write actions, Luna chat, generated food photos, or Cook Mode. Showing 'can cook now' or a missing count without P5 data would be misleading.

No schema migrations, authentication changes or synchronization protocol changes are required. Preserve all existing account-scoped records and offline/outbox state.

## Acceptance criteria

- [x] Root URL displays the same single cookbook view as the previous Recipes page.
- [x] Search and filtering work on the current in-memory/IndexedDB-backed recipe library without new API calls.
- [x] Favorites, collections, recipe detail, create flow and sync handlers remain wired.
- [x] Legacy route and independent navigation have dedicated tests.
- [x] Desktop/mobile responsive rules and visible focus states are defined in CSS.
- [ ] GitHub CI verifies TypeScript, unit tests and the production build.
- [ ] Human/device visual QA verifies keyboard navigation, 320px–1440px layouts, sign-in, sign-out, offline/search/sync and real recipe content.

## Follow-up

**P5 — Ingredient Intelligence:** normalize pantry ingredient names, score recipe ingredient coverage against selected inventory, distinguish pantry staples and optional items, report exact missing-ingredient lists and provide safe zero-missing/limited-missing filters. Do not implement P5 with search token matches alone.

**P6 — Import:** backend-owned authenticated ingestion with source provenance, reviewable drafts, validation and deduplication. **P7 — ChatGPT:** private MCP write/read tools; never store write credentials in the frontend. **P8 — Luna:** bounded app-local capabilities via `thiepn/ai`.
