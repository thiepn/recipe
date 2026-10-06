# P2 — Authentication Boundary, Offline Data, Sync & Privacy

## Status

Implemented on 2026-10-06.

P2 turns the P1 domain model into a safe private application data path:

```text
Recipe browser/PWA
  │
  ├─ THIEPN Account Supabase Auth
  │    └─ Google OAuth / PKCE
  │
  ├─ IndexedDB
  │    ├─ recipe documents
  │    ├─ durable mutation outbox
  │    ├─ conflict/recovery records
  │    └─ sync cursor/meta
  │
  └─ Bearer token
       ↓
THIEPN Core Gateway
  │  verifies token against THIEPN Account /auth/v1/user
  │  derives canonical Account UUID
  ↓
gateway.recipe_* RPCs
  ↓
private Core recipe schema
```

The browser does **not** authenticate to THIEPN Core directly and does not receive a Core service credential.

## Critical P1 identity correction

P1 originally attached `recipe.user_id` columns to the THIEPN Core project's local `auth.users` table.

That was incorrect.

THIEPN Account and THIEPN Core are separate Supabase Auth tenants. Recipe ownership is the canonical UUID issued by **THIEPN Account**, verified by the existing Core Gateway. The Core-local Auth tenant is unrelated.

P2 therefore:

- removes Recipe foreign keys to Core `auth.users`;
- treats `user_id` as an externally verified canonical THIEPN Account UUID;
- removes direct browser table access;
- makes the Core Gateway the sole application data path;
- retains owner-coupled composite foreign keys inside the Recipe domain.

This is an architectural correction, not a relaxation of ownership security.

## Authentication

Recipe creates its own THIEPN Account Supabase Auth session using Google OAuth and PKCE.

The session is app-local. Recipe does not receive or export another application's session.

Production callback:

```text
https://recipe.thiepn.dev/auth/callback
```

The authenticated user is validated with `auth.getUser()`. `auth.getSession()` is used only to obtain the current bearer token for the Core Gateway.

The Gateway independently verifies that bearer token against THIEPN Account `/auth/v1/user` and derives the Account UUID server-side.

## Gateway-only Core access

Direct Recipe schema access is denied to `anon` and `authenticated`.

Every Recipe table has RLS enabled. Browser roles receive an explicit deny policy as defense in depth.

The public application API is limited to:

- `GET /v1/recipe/manifest`
- `GET /v1/recipe/changes?after=<cursor>&limit=<n>`
- `GET /v1/recipe/documents/:recipeId`
- `POST /v1/recipe/mutations`

The Gateway passes the verified owner UUID to service-role-only `gateway.recipe_*` RPCs. The destructive `gateway.recipe_delete_all()` primitive is intentionally **not** exposed as a normal browser route; it is reserved for trusted lifecycle orchestration.

## Sync primitive

Recipe uses a recipe-specific implementation of the semantics defined by THIEPN Sync Protocol v1.

The aggregate sync unit is one **Recipe Document**:

```text
Recipe identity
Current version
Ingredient groups
Ingredients
Steps
Step ↔ ingredient links
Equipment
Step ↔ equipment links
```

A recipe is treated as one cohesive document because its ingredients and steps are tightly related. Generic field-level last-write-wins would be unsafe.

### Strict compare-and-swap

Every mutable Recipe aggregate has a server revision.

A mutation contains:

```text
mutationId
resourceId
baseRevision
operation
document
```

Server behavior:

```text
baseRevision == current revision
  → apply atomically
  → increment revision
  → emit change sequence

baseRevision != current revision
  → do NOT overwrite
  → return conflict + remote canonical document
```

Client timestamps never decide conflicts.

## Mutation idempotency

The server stores a mutation receipt keyed by:

```text
(user_id, mutation_id)
```

It also stores a server-generated SHA-256 digest of the canonical mutation payload.

Retrying the same mutation ID and same payload returns the original result.

Reusing the same mutation ID with different content is rejected as protocol corruption.

This makes the following crash sequence safe:

```text
server commits mutation
network response is lost
browser restarts
same mutation is retried
server returns original result
```

## Change stream

Every accepted Recipe mutation emits a monotonically increasing `change_sequence`.

Clients persist a cursor and request changes after that cursor.

A change entry contains only synchronization metadata:

- sequence
- recipe/resource ID
- recipe revision
- upsert/deleted kind
- server timestamp

The current Recipe document is fetched separately.

Realtime is not required for correctness.

## Delete semantics

Normal Recipe deletion is revisioned.

The Recipe row becomes an archived tombstone:

```text
state = archived
deleted_at != null
revision += 1
```

This prevents an old offline client from silently resurrecting a deleted recipe.

Hard deletion is reserved for explicit whole-account Recipe data deletion.

## IndexedDB

Browser durability is implemented in `src/data/local-db.ts`.

Stores:

### documents

Owner-scoped local recipe state:

- working document
- last canonical server/base document
- server revision
- local revision
- sync state
- tombstone state

### outbox

Durable mutations:

```text
pending
  ↓
in_flight
  ├─ applied
  ├─ retry
  ├─ conflict
  └─ quarantined
```

A local recipe update and its outbox mutation are committed in one IndexedDB transaction **before the operation can be treated as safely saved**.

### conflicts

Durable recovery state preserves:

- base document
- local candidate
- remote candidate
- base and remote revisions
- mutation provenance
- conflict reason

### meta

Owner-scoped synchronization metadata, beginning with the global change cursor.

## Sync cycle

Normal cycle:

```text
durable local edit
      ↓
push pending outbox
      ↓
obtain canonical server result
      ↓
pull changes after cursor
      ↓
durably apply page
      ↓
advance cursor
```

The cursor is written in the same IndexedDB transaction as pulled documents and conflict records.

If the app crashes before that transaction commits, the page can be replayed safely.

## Multiple local edits

Several local edits may be made before connectivity returns.

Before an **untransmitted** later mutation is sent, it may advance its base revision to the revision committed by an earlier queued mutation.

After the first transmission attempt, mutation payload/base identity remains stable for idempotent retry.

When an earlier queued mutation succeeds, the client does not overwrite a newer local working copy with the intermediate server document.

## Conflict behavior

If a remote revision changes while local work is dirty:

- remote state is preserved;
- local state is preserved;
- the conflict is stored durably;
- the recipe enters `conflict` state;
- unrelated recipes continue synchronizing.

P2 intentionally does not implement a generic semantic auto-merge.

Future conflict UI can present:

```text
Base
Local candidate
Remote current version
```

and submit an explicit resolution as a new mutation against the latest remote revision.

## Offline behavior

The app can read/edit already local Recipe documents without network access.

Sync is attempted on independent triggers while the app is open:

- startup;
- after explicit caller requests;
- network reconnect;
- return to foreground;
- periodic foreground timer.

Correctness does **not** depend on browser Background Sync or on the PWA remaining open.

## Media cache

`src/media/cache.ts` provides owner-scoped Cache Storage for already-authorized media bytes.

Permanent cache keys are synthetic internal keys. Signed/expiring source URLs are never persisted as cache keys.

P2 does **not** claim that the server-side source-media upload pipeline exists yet. Original recipe photos/audio and storage authorization are implemented in the later Capture phase.

## Sign-out safety

Recipe local sign-out checks the durable outbox first.

If unsynchronized Recipe changes exist, ordinary sign-out is blocked with `UnsyncedChangesError`.

Explicit discard is required before unsynchronized local changes are destroyed.

After safe/confirmed sign-out:

1. owner-scoped IndexedDB data is erased;
2. owner-scoped media cache is erased;
3. the local Recipe Account session is signed out.

## Account control-plane disposition

Recipe is registered in the Git-owned **THIEPN Core app registry**.

It is intentionally **not yet registered as a connected app in THIEPN Account's UI control plane**.

Current Account documentation states that Account connection/grant rows do not yet authorize Core namespace operations. Advertising a Recipe connect/disconnect permission before the Core Gateway consumes those grants would be misleading security UI.

Recipe can still use the shared THIEPN Account identity directly.

Account control-plane registration belongs in the later ecosystem/account-integration phase when its grants are enforceable end-to-end.

## Production boundary status

Core Gateway production CORS now includes `https://recipe.thiepn.dev`. The browser still receives no Core service credential and all Recipe data routes remain bearer-authenticated.

## Privacy/lifecycle release gates

The following are explicit gates rather than hidden assumptions:

1. **OAuth redirect allowlist** — THIEPN Account production Auth must allow `https://recipe.thiepn.dev/auth/callback`.
2. **Full THIEPN Account deletion** — the Account finalizer currently operates in a different Supabase project and cannot rely on an FK cascade to Recipe Core data. Before general release, Account deletion must invoke/coordinate Recipe deletion server-to-server or otherwise certify equivalent deletion.
3. **Server media lifecycle** — private original-photo/audio upload/delete policies arrive with the Capture/storage phase.
4. **Generic Sync Protocol claim** — Recipe follows Sync v1 semantics but does not claim the still-unimplemented generic Core Sync Protocol Phase B.

## P2 backend verification

The live Core P2 migration was tested with a synthetic external Account UUID that does not exist in Core Auth.

Verified:

- create → revision 1;
- exact mutation replay → same result;
- replace → revision 2;
- stale replace → explicit revision conflict + remote document;
- incremental change pull;
- manifest;
- tombstone delete → revision 3;
- whole-owner Recipe cleanup;
- no synthetic test rows left behind.

## P2 certification — complete

Final certification was performed from branches created from the fully hardened P2 `main` baselines.

Recipe certification:

- `Recipe CI` run **15**: success;
- strict TypeScript: pass;
- P2 Vitest durability/sync/conflict tests: pass;
- final certification PR #2: merged;
- certification merge: `be927dee31877d44875b72faaaabf00ce1cba011`.

Core certification:

- `Core CI` run **352**: success;
- Prettier: pass;
- ESLint: pass;
- strict TypeScript: pass;
- Vitest including private Recipe Gateway regression coverage: pass;
- Git ↔ SQL registry drift validation: pass;
- credential scan: pass;
- Gateway Worker build: pass;
- local Supabase reset: pass;
- database lint: pass;
- pgTAP: pass;
- authenticated local HTTP smoke tests: pass;
- final certification PR #26: merged;
- certification merge: `6d21c3a68d9e6dbfa358ae4d33db9d725ea9b292`.

Final live Core security verification:

- 13/13 Recipe tables have RLS enabled;
- 0 Recipe foreign keys point at Core's unrelated `auth.users`;
- 0 `anon` / `authenticated` Recipe table grants;
- browser-role deny policies cover all 13 Recipe tables;
- all six Recipe Gateway/database RPC functions are `SECURITY INVOKER` and executable only by `service_role`;
- malformed relational payloads are normalized to `RECIPE_BAD_REQUEST`;
- Supabase Security Advisor: **0 Recipe-specific findings**;
- Performance Advisor: only expected unused-index INFO notices on the new workload.

The earlier exploratory certification PRs were closed as superseded after the final baseline passed.

## Next

**P3 — Recipe Library, Search, Collections & Visual Product Shell**

P3 can now build UI against a stable local repository/sync abstraction rather than coupling screens directly to database tables.
