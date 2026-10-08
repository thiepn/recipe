# P10 — Kitchen-first guided cooking

This phase replaces the placeholder Cook tab with a genuinely usable, offline-friendly cooking surface. No model calls, subscription, service token, or database migration.

## Use

1. Open **Cook** or choose **Start cooking** inside a recipe that has one or more instructions.
2. Select an existing private recipe with steps.
3. Check off your mise en place ingredients. Ingredient quantities scale when the original recipe has a known servings count and the ingredient's `scalingMode` is `linear`. Fixed/seasoning/contextual ingredient quantities are **not multiplied**.
4. Follow one instruction at a time with clear step numbers and next/previous navigation. Tap other numbered steps to jump; progress reflects explicitly completed instructions only.
5. Start the step's suggested timer or a manually selected 1–180 minute timer. Pause, resume and clear supported.
6. When all steps are marked complete, see the serve/repeat screen. Do not treat an expired timer as proof of safe cooking.

## Intentional scope limits

- Progress/checkmarks and countdown are transient to the open cooking session. Closing or reloading resets them. The user is warned before deliberately exiting an active session. Persistent resumable sessions and multi-timer support are separate future enhancements.
- Timers use a timestamp deadline based on `Date.now()`, so elapsed time remains correct after an inactive browser tab resumes. They cannot reliably alert or keep the device awake if the browser or OS terminates the tab.
- Optional ingredient quantities, source provenance and existing cookbook recipe data are never mutated by a cooking session.
- Guidance comes only from saved recipe content. A timer does not determine whether food is safe, heated to the right temperature, or properly cooked.
- Recipes missing instructions remain in the cookbook and are available for editing but do not launch an empty cook session.

## QA

- Unit tests cover quantity scaling, fixed-mode quantities, ranges, optional ingredients, timestamp timer and step progress.
- Verify portrait phone, tablet and desktop responsive layouts, large touch controls and keyboard focus.
- Verify Cook tab functions while offline with locally saved recipes, and return to the cookbook without modifying ingredients or steps.
- Manual production checks must be carried out once `recipe.thiepn.dev` DNS and Account OAuth are qualified.

P10 does not enable Luna. `VITE_RECIPE_LUNA_ENABLED` remains absent by default.
