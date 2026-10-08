# Recipe P8 — optional GPT-6 Luna experience

The Recipe app gains three tightly bounded actions powered by the shared THIEPN AI service through THIEPN Core:

1. **Suggest with Luna:** user chooses a dish and optional exclusions; only the explicitly selected pantry ingredient types are included. The output is a proposal, editable before saving as a private draft.
2. **Refine extraction with Luna:** within the existing P6 importer, the user explicitly requests AI refinement of pasted text/OCR. Original captured text and source attribution remain available for review. The original deterministic parser still works without AI.
3. **Ask Luna:** within a selected recipe, send only that recipe's title, ingredients, steps and the question. Return advice, cautions and optional changes; never modify the recipe.

## Privacy and safety

- Users must be signed in to THIEPN Account. All AI requests go through the Account-authenticated Core Gateway with application-only service signing to THIEPN AI.
- No provider API keys, internal AI secrets, SQL or service-role credentials are present in the browser.
- No entire cookbook, personal pantry quantities, personal profile, account identifiers, or raw Account tokens are sent to Luna.
- Unknown model outputs are rejected by strict input/output schemas. The model must not invent precise source measurements in extraction or guarantee food safety.
- Error, budget limit or offline mode never blocks reading/searching/manual recipe creation and import.
- Nothing is automatically saved, overwritten or published. Existing P6 duplicate warnings and human review still apply.
- This implementation is a draft UI until real-device, OAuth, Gateway, budget and live-model smoke tests have passed.

## Release order

Shared AI capability branch → Core Gateway Recipe AI branch → Recipe UI branch. Provision a separate Recipe HMAC secret on AI and Core via their encrypted environments. Verify real service availability and model access before announcing Luna as live. Do not depend on the still-open P7 ChatGPT MCP PR to enable P8.

No new database table or migration is needed.
