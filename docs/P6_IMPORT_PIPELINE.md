# P6 — Recipe Import Pipeline

## Implementation status

**Implemented in code; CI-verified.** Production deployment and real-device/website qualification remain open. This implementation is intentionally a *safe client-side importer* backed by the existing authenticated Recipe Core Gateway mutation path, not an unrestricted URL-fetching backend or a ChatGPT integration.

## User workflow

1. Sign in to `recipe.thiepn.dev` through THIEPN Account.
2. Open **Add recipe** and choose **Paste recipe text**, **Import from URL**, or **Photo or screenshot**.
3. Extract content. Text parsing accepts Ingredients/Instructions sections and JSON-LD. URL parsing attempts CORS-permitted HTTPS pages containing schema.org Recipe JSON-LD. Photo parsing runs optional on-device Tesseract OCR in English and German.
4. Review/edit title, description, ingredients and numbered steps.
5. Save as a private `draft`. An existing copy is detected locally and prompts for explicit duplicate confirmation.
6. The validated recipe goes into the existing RecipeSyncEngine outbox and is synced to THIEPN Core through the Account-verified Gateway. No client-owned `user_id` is accepted for authoritative mutation ownership.

## Data handling

- Import metadata resides at `version.metadata.importSource` in the existing strict, schema-validated editable document contract. It includes source kind, extraction method, sanitized HTTPS URL (when supplied), filename (for photos), original extracted text (capped at 24 KB), SHA-256 fingerprint, timestamp and review warnings.
- The server-side canonical `recipe_sources` table is **not** written by this editable document contract yet. Future Gateway work must promote source metadata to that table with owner checks.
- Photo image bytes remain on the device during OCR and are discarded after processing. Only the extracted text and filename are saved; **original images are not stored or uploaded**.
- Original pasted text is preserved up to the declared cap. When URL auto-extraction succeeds, the normalized extracted recipe content is preserved, not the full webpage HTML.
- Source material is data and cannot modify application instructions or authorization policies.

## Security/correctness boundaries

- HTTPS-only public-looking URL validation rejects credentials, nonstandard ports, local/private IP literals and local-style hostnames. No privileged server-side URL fetching has been added, so there is no new SSRF-capable endpoint.
- Browser fetches use `credentials: omit`, `redirect: error`, an abort timeout and size/type limits. Cross-origin website policy may block them.
- URL extraction requires embedded schema.org Recipe data. When blocked or absent, the user can paste the ingredients/instructions into the text tab and preserve the URL separately.
- No arbitrary unreviewed AI transformation or auto-publishing. Missing extraction sections cause warnings; the user must supply at least one ingredient and one step.
- Duplicate detection is owner-scoped and based on normalized source URL/content hash or exact title plus ingredient names. It is **local best effort**, not transactional cross-device deduplication.
- OCR can misread quantities, allergens and cooking temperatures. Review is mandatory before save.
- Static TypeScript, runtime validation via the existing Zod recipe schema, bounded inputs and typed local structures.

## Verification

- [x] New tests for plain-text extraction, German headings, schema.org JSON-LD HowToStep nesting, URL validation, private draft building, provenance fingerprints and duplicate detection.
- [x] Full TypeScript check.
- [x] Full Vitest suite: 32 tests passing.
- [x] Vite production build.
- [ ] Browser qualification for CORS-permitted sites, OCR language download, JPEG/PNG/WebP, mobile/desktop interactions and accessiblity.
- [ ] Live signed-in Account/Core end-to-end test with cross-device sync.
- [ ] Dedicated private source-media upload/storage and canonical `recipe_sources` write API.

## Following phases

**P7 — ChatGPT recipe actions:** expose authenticated read/write capabilities for the private recipe collection and duplicate-safe draft creation. Keep tools narrow and never expose service-role secrets.

**P8 — GPT-6 Luna:** add structured recipe extraction/generation and substitution assistance through the existing shared `thiepn/ai` service.

A separate backend extension should handle source image storage and universal secure URL ingestion before labeling those P6 capabilities production-qualified.
