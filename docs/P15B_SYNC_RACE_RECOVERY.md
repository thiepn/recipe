# P15B — Sync race prevention and crash-safe recovery

## Confirmed failure modes
1. A request failure wrote the recipe or collection snapshot captured *before* the request. An edit made during the request could be overwritten by the stale snapshot.
2. A successful recipe or collection acknowledgement read the pending outbox and local working document in independent transactions. An edit arriving between those reads and the final commit could be replaced by the canonical cloud copy.
3. A pull page prepared before a local edit could overwrite it and still advance the cloud cursor, preventing automatic replay.

## Implementation
- `RecipeLocalDb.markRecipeSyncFailure` and `markCollectionSyncFailure` update the live record only if its local revision is unchanged.
- `settleRecipeMutation` and `settleCollectionMutation` acknowledge the server receipt, preserve newer queued edits, update the baseline, and remove the acknowledged outbox row in one read/write IndexedDB transaction.
- `applyPullPage` rechecks local revision before writing a cloud response. If stale, it aborts the page and cursor in the same transaction. The next sync can retry after the local queue is pushed.
- Leave retry/in-flight mutation identities stable for idempotent server replays; no new remote routes or schema migrations.

## Regression coverage
- Request failure with a newer local recipe/collection edit.
- Canonical save completes after a second local mutation.
- Final mutation transitions to synced and clears the acknowledged outbox row.
- Stale cloud page cannot erase pending local content or advance cursor.

## Limitations / release gates
- GitHub CI must pass TypeScript, Vitest and Vite build (`pnpm verify`).
- Test a real disconnected/reconnected session and two-tab concurrent edit scenario before claiming deployment-quality coverage.
- P13 workspace cloud continuity remains feature-gated OFF pending its own multi-device qualification.
- No claim is made that sync runs while the PWA/browser is closed.
- This PR is stacked on P15A, itself stacked on P14. Merge in order after CI verification.
