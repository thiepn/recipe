# P15D — Local data backup and conflict recovery

## Scope
The P15C sidebar showed that a mutation was blocked, but supplied no reliable action to inspect, preserve or repair it. P15D adds a recovery workspace accessible in the sidebar and from conflict/blocked status banners.

### Account-scoped JSON backup
- Export one coherent IndexedDB snapshot: owned recipes, collection book, all six relevant outbox/conflict stores, pantry, planner, kitchen sessions, workspace baselines and other Recipe-owned metadata.
- Reads all stores through one readonly transaction to avoid mixing incompatible versions.
- Backup is downloaded in the browser, not uploaded to any server. Auth tokens and other-account rows are not included.
- The file contains potentially sensitive household or personal data. Protect it accordingly.
- No automatic import/restore is advertised. Retain the export for manual investigation or future restoration capability.

### Recipe and collection conflict resolution
- Review the saved on-device and cloud version descriptions.
- Explicit two-click choices: keep this device (new server-CAS mutation) or accept cloud version (discard local unsynced edits for this resource).
- Live cloud revision *and full canonical document* are checked before either choice.
- Local revision and conflict snapshot are rechecked in an atomic IndexedDB transaction.
- Outbox and conflicts are cleared only as part of the same transaction that commits the chosen local view. In-flight uploads prevent resolution.
- Remote-not-found recipe conflicts remain manual-only, preventing accidental recreation/deletion.
- All actions preserve the live device version until an acknowledged choice.

### Quarantined upload recovery
- Permanently rejected recipe and collection mutations are visible with their last error code.
- Recipe entries can be opened for editing; a user can then deliberately requeue the latest saved draft with a new idempotency key.
- Only quarantined and unattempted queued mutations can be replaced. A live in-flight, retryable or conflict mutation prevents this shortcut.
- Requeued changes are still subject to server validation and revision conflicts; success is never guaranteed.
- Take a backup before choosing a potentially destructive recovery option.

### Validation
Run `pnpm verify` (typecheck, Vitest and build) and test on a browser device: offline backup export, changed-cloud rejection, two tabs editing during review, original conflict choices, blocked draft correction and requeue, and sign-out guards from P14.

### Deferred
- Interactive JSON import/restore with schema validation and non-destructive merge policy.
- Three-way recipe or collection merge.
- Automatic repair of malformed documents or permanent 4xx failures.
- Full cross-device workspace release. P13 stays feature-gated.
