# P5 — Ingredient Intelligence

## Scope

This phase adds **conservative, deterministic ingredient-type matching** to the P4 search-first cookbook. It does **not** imply that sufficient quantities or safe substitutes are available.

### Shipped capabilities

- A persistent *Cook with what you have* ingredient list on the main cookbook screen.
- Comma/semicolon/newline paste, suggestions drawn from saved recipes, de-duplication and chip removal.
- Conservative English/German normalization for explicitly known equivalent ingredient names, Unicode/diacritic handling and optional canonical keys.
- Required vs optional ingredients and duplicate ingredients handled independently.
- Ranking: fewest missing required ingredient types, then highest coverage, with stable P4 ordering on ties.
- Filters for **0, 1 or 2 missing ingredient types** as well as all recipes.
- Each card shows coverage and the **names of missing required ingredients**.
- Salt, water and black pepper are **only** assumed if the user checks the labeled option; assumptions are identified.
- Unknown coverage for a recipe with no required ingredients; such recipes never qualify for limited-missing filters.
- Readable mobile/desktop pantry workbench.

### Privacy/storage

Ingredient list is stored with `RecipeLocalDb.setMeta(accountId, 'pantry-v1', ...)` and loaded through `getMeta`. The existing IndexedDB meta store already uses an **account-scoped composite key**. There are no new backend tables or migrations. Existing account deletion `wipeAccount` also removes the scoped pantry record.

**P5 pantry is device-local.** It does not sync between devices yet. Recipe cloud sync and conflict semantics remain unchanged. Account-specific pantry data is not passed to the AI service.

### Correctness boundaries

- Matching is by **ingredient type**, not by quantity, unit, package size, freshness, food-safety status or allergen/substitution equivalence.
- No fuzzy cross-ingredient substitutions. Chicken is not chicken breast, milk is not oat milk, olive oil is not vegetable oil.
- Unknown or poorly normalized free-text names stay exact, rather than inventing matches.
- Matching is per unique required ingredient type, not by count of ingredient rows; optional ingredients are excluded from missing counts.
- Unfilled recipe drafts are **unknown**, never presented as zero missing.
- Pantry staples are opt-in and the card discloses what was assumed.
- The P4 search and collection filters still apply first.

### Verification gates

- [x] P5 deterministic regression tests for alias behavior, collisions, required/optional, pantry staples, unknown recipes, filter ranking, autocomplete, and account-scoped persistence.
- [x] CI TypeScript and Vitest success (24/24 tests, 4 test files).
- [x] CI production build success.
- [ ] Real-device UI and full signed-in account acceptance tests.

### P6 handoff

**P6 — Recipe Import Pipeline.** Accept URLs, text and photos; preserve original source and provenance; create reviewable structured drafts; protect writes behind authenticated account ownership and idempotent deduplication. P5's conservative matcher remains deterministic and does not need an AI API.
