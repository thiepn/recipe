# P12 — Weekly meal plan and usable shopping list

This phase replaces the Plan placeholder with an editorial meal notebook and a real ingredient-based shopping list. Recipe remains a cookbook rather than a generic SaaS dashboard.

## Main workflow

1. Open **Plan**. The current calendar week (Monday–Sunday) appears with breakfast, lunch, dinner and snack slots.
2. Select a saved recipe for any slot. Change servings when the recipe defines a base serving count. You may navigate to another week without losing the current one.
3. Ingredient lines from planned recipes are collected automatically into the **Shopping list** on the same page.
4. Shop with checkboxes, add manual groceries for the chosen week, hide entries for ingredient types marked available in the existing pantry, or copy the entire checklist as text.
5. From a meal slot, jump directly into **Cook** when that recipe has cooking steps; incomplete recipes open **Recipe Studio** for authoring.

## Integrity rules

- All computation is deterministic; no model, paid API, third-party store or nutrition claim.
- `g` and `kg` aggregate in `g`; `ml` and `l` aggregate in `ml`. Other units stay separate. We never interpret `cup`, `tbsp`, `tsp`, pieces, weights, or volumes as interchangeable.
- Only **exact, linear** ingredients with compatible unit, ingredient, preparation and optionality are summed. Fixed/contextual/seasoning quantities, ranges and unknown quantities remain separate or explicitly marked.
- When a recipe does not specify its original servings, quantities cannot be scaled safely and remain unchanged even when a serving count is entered.
- Purchase checkmarks for generated ingredients are keyed to calculated quantities, so changed quantity totals become unchecked for confirmation.
- The pantry indicates **ingredient types only**, not whether the available quantity is enough to cook; hiding pantry items is an optional display choice, never a verified inventory deduction.
- Deleted or archived recipes are not used in shopping calculations; their plan references remain visible as unavailable entries, allowing explicit replacement.

## Local storage and privacy

`MealPlannerState` is a strict schema-versioned, account-scoped JSON document stored in the existing IndexedDB `meta` store at key `meal-plan-v1`. No Supabase migration is needed. The planner retains multiple calendar weeks, free-form shopping items and checkmarks.

- Data lives **on this browser/device**, not in cloud sync. Other devices do not automatically see your plan.
- Existing `RecipeLocalDb.wipeAccount` removes it on Account sign-out.
- Writes are serialized to avoid out-of-order local persistence from rapid changes.
- Browser storage clearing may erase the plan, and concurrent tabs editing it can overwrite one another. Cloud-synced planning needs an explicit future phase with conflict handling.
- Copying shopping text uses the user's browser clipboard only after an explicit click.

## Accessibility and release acceptance

Use semantic selects with full date/meal labels, label each serving input, preserve focus outlines, keep checkbox hit targets, and provide descriptive text errors when IndexedDB or clipboard permission fails.

Tests must cover week boundaries including DST/leap day, CRUD meal assignments, unit conversions and nonconvertible measures, optional/preparation distinctions, stale purchased quantities, pantry type-matching, missing recipe sources, manual items, account isolation and sign-out data wipe.

P12 introduces no Luna feature and requires no Porkbun DNS changes. Production deployment is separate and must be verified before claiming the new Plan tab is live.
