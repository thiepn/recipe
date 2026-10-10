# P19 — Local personal cooking intelligence and evidence

## Exact current-system audit
- P6 \`src/library/ingredients.ts\` implements narrow equivalence matching and ingredient-type-only presence. P19 reuses \`evaluateRecipe\` and \`ingredientKey\`; no quantities, stock levels, dates, allergy safety, nutrients or substitutions are inferred from mere names.
- P4 \`src/library/model.ts\` implements search/sort/favorites; P19 leaves its behavior unchanged.
- P12 \`src/planning/model.ts\` supplies account-scoped saved plans and conservative shopping aggregations. P19 links to its actual UI and never schedules or alters any meal automatically.
- P14/15 \`src/data/local-db.ts\` has owner-keyed \`getMeta\` / \`setMeta\`, \`wipeAccount\`, account backup/restore. P19 stores preferences as \`cooking-preferences-v1\` under the verified Account UUID, serializes updates, and drains the write queue before sign-out.
- The cookbook already has a P6 pantry editor, P16 hands-free controls, P17 editorial UI. P18 invitations/revocation still DENIED. P13 cross-device workspace sync remains disabled by default; P7 MCP and Luna remain release-gated.

## Product behavior
- Private, production-mounted \`What could I cook?\` section, explicitly OFF until opt-in.
- Deterministic, entirely on-device ordering from the current owner's preloaded active recipes, showing pantry type counts, missing named ingredients, favorite and recorded duration as transparent reasons.
- Preference controls: documented-time ceiling (unknown durations never qualify), favorites boost and named-ingredient hiding (max 12; exact/canonical name and narrow alias matching). Unknown ingredient lists are excluded when hiding names. These controls are NOT suitable for allergies, cross-contact or diet safety.
- Review-only, narrowly conditioned substitution notes for olive oil vs butter in instructions explicitly about pan sautéing, and lime vs lemon in dressing/seasoning. No baking conversions, amount advice, recipe changes or claims of nutritional equivalence.
- Open original recipe or go to the existing planner, without auto-assigning, saving to plan, making external calls or writing to another Account.
- In case of invalid/corrupt stored preferences, suggestions fail closed to OFF. Storage failures are reported; no silent cloud fallback.

## Verification, nonclaims and open gates
- Unit tests: opt-in, owner isolation, archived/deleted filtering, deterministic scores/ties, unknown time, exclusions, corrupt metadata and account-specific IndexedDB wipe, never automatic substitution.
- Desktop/mobile Chromium synthetic real React panel: initial OFF, role semantics, preferences, reload / account isolation, no POST/DELETE, keyboard, reduced-motion, 200% CSS zoom. Captures are review evidence not golden approvals.
- Exact-head GitHub CI, build and smoke, P19 artifact inspection required. Physical Android/iOS and screen readers, real account OAuth, documented allergy/food-safety verification and human owner approval remain OPEN.
- No merges, migrations, production deployment, Vercel setting changes or enabling P7 MCP, P13 cloud workspace, Luna or P18 sharing.
