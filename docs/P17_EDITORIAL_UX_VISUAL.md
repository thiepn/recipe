# P17 — Advanced Visual Experience / editorial UX (stacked draft)

## Source audit and findings
- Cookbook P4 uses a fixed two-column mobile grid and decorative abstract recipe placeholders; avoid suggesting photography exists.
- Saved results had only one presentation. P17 adds grid / reading-list choices that never touch recipe or Account persistence.
- Recipe detail had no section jump controls, its icon close button lacked an accessible label, and keyboard focus could escape the modal. P17 adds a focus boundary, Escape handling, focus return, labeled close, and fast Ingredients/Method navigation.
- P9 Recipe Studio already guards unsaved edits but had no structured section outline. P17 adds an accessible, responsive section navigation for recipe, ingredients, method, organization, and notes.
- P10/P11/P16 Cook Mode benefits from distraction-free step focus, but active timers, hands-free controls, and persisted session state must remain reachable. Focus view hides only the ingredient sidebar, as a transient local UI preference.
- P12 Meal Planner has a weekly notebook but weak progress glance. P17 displays filled/total slot counts and unchecked shopping count, with keyboard focus transfer to its existing shopping slip.
- CSS refinements retain warm editorial typography and neutral surfaces, provide strong focus outlines, reflow at narrow widths, and do not invent content or generic SaaS dashboards.

## Automated evidence
- The real source components are mounted with synthetic local-only fake recipe documents in \`tests/browser/p17-visual.fixture.tsx\`. No real Auth token or account data is loaded.
- Playwright desktop and mobile Chromium run existing P15F/P16 tests plus view switch, keyboard focus trap, modal Escape/focus restore, editor section links, Cook/P16 retention, planner focus, prefers-reduced-motion and 200% CSS zoom checks.
- Synthetic screenshot evidence \`test-results/p17-*.png\` is uploaded after tests to \`recipe-p17-synthetic-visual-review\` and is **not** a manually approved visual baseline. No screenshots are silently accepted/overwritten.
- Unit tests check semantic, accessible view-state markup; full CI still runs TypeScript, all Vitest, independent Node HTTP smoke, production build, local built-site smoke and Chromium browser tests.

## Limitations and explicit release gates
- 200% CSS zoom and mobile viewport emulation do not replace physical OS/browser accessibility certification.
- Browser tests do not authenticate real OAuth, inspect private-account isolation, or approve real-device speech/notification behavior.
- P7 MCP activation remains unapproved; P13 cross-device workspace flag remains disabled; Luna remains disabled pending owner-backed qualification.
- No database migration, service-worker behavior change, real user-data write, manual deployment, production mutation or merge.
- Ancestor P15F PR #27 and P16 draft PR #28 remain unmerged; P17 targets P16 as a stacked DRAFT. Actual release still requires independently signed-off acceptance.
