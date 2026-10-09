import { canonicalJson } from '../workspace/canonical.ts';
import type {
  RecipeCollectionBook,
  RecipeDocument,
  RecipeEditableCollectionBook,
  RecipeEditableDocument,
} from '../api/protocol.ts';

const DB_NAME = 'thiepn-recipe';
const DB_VERSION = 2;

const STORES = {
  documents: 'documents',
  outbox: 'outbox',
  conflicts: 'conflicts',
  collectionBook: 'collectionBook',
  collectionOutbox: 'collectionOutbox',
  collectionConflicts: 'collectionConflicts',
  meta: 'meta',
} as const;

export type LocalSyncState =
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'conflict'
  | 'error';

export type OutboxState =
  | 'pending'
  | 'in_flight'
  | 'retry'
  | 'conflict'
  | 'quarantined';

export interface LocalRecipeRecord {
  accountId: string;
  resourceId: string;
  working: RecipeEditableDocument;
  base: RecipeDocument | null;
  serverRevision: number;
  localRevision: number;
  syncState: LocalSyncState;
  tombstone: boolean;
  updatedAt: number;
}

export interface OutboxMutation {
  mutationId: string;
  accountId: string;
  resourceId: string;
  baseRevision: number;
  operation: 'create' | 'replace' | 'delete';
  document: RecipeEditableDocument | null;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number | null;
  lastErrorCode: string | null;
}

export interface ConflictRecord {
  id: string;
  accountId: string;
  resourceId: string;
  mutationId: string | null;
  reason: string;
  baseRevision: number;
  remoteRevision: number | null;
  base: RecipeDocument | null;
  local: RecipeEditableDocument | null;
  remote: RecipeDocument | null;
  createdAt: number;
}


export interface LocalCollectionBookRecord {
  accountId: string;
  working: RecipeEditableCollectionBook;
  base: RecipeCollectionBook | null;
  serverRevision: number;
  localRevision: number;
  syncState: LocalSyncState;
  updatedAt: number;
}

export interface CollectionOutboxMutation {
  mutationId: string;
  accountId: string;
  baseRevision: number;
  document: RecipeEditableCollectionBook;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number | null;
  lastErrorCode: string | null;
}

export interface CollectionConflictRecord {
  id: string;
  accountId: string;
  mutationId: string | null;
  reason: string;
  baseRevision: number;
  remoteRevision: number;
  base: RecipeCollectionBook | null;
  local: RecipeEditableCollectionBook;
  remote: RecipeCollectionBook;
  createdAt: number;
}

interface MetaRecord {
  accountId: string;
  key: string;
  value: unknown;
}

export interface RecipeAccountBackup {
  format: 'thiepn-recipe-local-backup';
  schemaVersion: 1;
  accountId: string;
  exportedAt: string;
  documents: LocalRecipeRecord[];
  outbox: OutboxMutation[];
  conflicts: ConflictRecord[];
  collectionBook: LocalCollectionBookRecord | null;
  collectionOutbox: CollectionOutboxMutation[];
  collectionConflicts: CollectionConflictRecord[];
  metadata: MetaRecord[];
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(indexedDBFactory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDBFactory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.documents)) {
        const store = db.createObjectStore(STORES.documents, {
          keyPath: ['accountId', 'resourceId'],
        });
        store.createIndex('by-account', 'accountId');
        store.createIndex('by-account-sync', ['accountId', 'syncState']);
      }

      if (!db.objectStoreNames.contains(STORES.outbox)) {
        const store = db.createObjectStore(STORES.outbox, {
          keyPath: 'mutationId',
        });
        store.createIndex('by-account', 'accountId');
        store.createIndex('by-account-created', ['accountId', 'createdAt']);
        store.createIndex('by-account-resource', ['accountId', 'resourceId']);
        store.createIndex('by-account-state', ['accountId', 'state']);
      }

      if (!db.objectStoreNames.contains(STORES.conflicts)) {
        const store = db.createObjectStore(STORES.conflicts, {
          keyPath: 'id',
        });
        store.createIndex('by-account', 'accountId');
        store.createIndex('by-account-resource', ['accountId', 'resourceId']);
      }


      if (!db.objectStoreNames.contains(STORES.collectionBook)) {
        db.createObjectStore(STORES.collectionBook, { keyPath: 'accountId' });
      }

      if (!db.objectStoreNames.contains(STORES.collectionOutbox)) {
        const store = db.createObjectStore(STORES.collectionOutbox, {
          keyPath: 'mutationId',
        });
        store.createIndex('by-account', 'accountId');
        store.createIndex('by-account-created', ['accountId', 'createdAt']);
      }

      if (!db.objectStoreNames.contains(STORES.collectionConflicts)) {
        const store = db.createObjectStore(STORES.collectionConflicts, {
          keyPath: 'id',
        });
        store.createIndex('by-account', 'accountId');
      }

      if (!db.objectStoreNames.contains(STORES.meta)) {
        const store = db.createObjectStore(STORES.meta, {
          keyPath: ['accountId', 'key'],
        });
        store.createIndex('by-account', 'accountId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () =>
      reject(new Error('Recipe database upgrade is blocked by another tab'));
  });
}

export class RecipeLocalDb {
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(
    indexedDBFactory: IDBFactory = globalThis.indexedDB,
  ): Promise<RecipeLocalDb> {
    if (!indexedDBFactory)
      throw new Error('IndexedDB is not available in this environment');
    return new RecipeLocalDb(await openDatabase(indexedDBFactory));
  }

  close() {
    this.#db.close();
  }

  async getDocument(
    accountId: string,
    resourceId: string,
  ): Promise<LocalRecipeRecord | undefined> {
    const tx = this.#db.transaction(STORES.documents, 'readonly');
    return requestResult(
      tx.objectStore(STORES.documents).get([accountId, resourceId]),
    ) as Promise<LocalRecipeRecord | undefined>;
  }

  async listDocuments(accountId: string): Promise<LocalRecipeRecord[]> {
    const tx = this.#db.transaction(STORES.documents, 'readonly');
    const rows = (await requestResult(
      tx.objectStore(STORES.documents).index('by-account').getAll(accountId),
    )) as LocalRecipeRecord[];
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async putDocument(record: LocalRecipeRecord): Promise<void> {
    const tx = this.#db.transaction(STORES.documents, 'readwrite');
    tx.objectStore(STORES.documents).put(record);
    await transactionDone(tx);
  }

  async commitMutation(
    record: LocalRecipeRecord,
    mutation: OutboxMutation,
  ): Promise<void> {
    if (
      record.accountId !== mutation.accountId ||
      record.resourceId !== mutation.resourceId
    )
      throw new Error('Local mutation ownership mismatch');

    const tx = this.#db.transaction(
      [STORES.documents, STORES.outbox],
      'readwrite',
    );
    tx.objectStore(STORES.documents).put(record);
    tx.objectStore(STORES.outbox).put(mutation);
    await transactionDone(tx);
  }

  async listOutbox(accountId: string): Promise<OutboxMutation[]> {
    const tx = this.#db.transaction(STORES.outbox, 'readonly');
    const rows = (await requestResult(
      tx.objectStore(STORES.outbox).index('by-account').getAll(accountId),
    )) as OutboxMutation[];
    return rows.sort(
      (a, b) => a.createdAt - b.createdAt || a.mutationId.localeCompare(b.mutationId),
    );
  }

  async listResourceOutbox(
    accountId: string,
    resourceId: string,
  ): Promise<OutboxMutation[]> {
    const tx = this.#db.transaction(STORES.outbox, 'readonly');
    const rows = (await requestResult(
      tx
        .objectStore(STORES.outbox)
        .index('by-account-resource')
        .getAll([accountId, resourceId]),
    )) as OutboxMutation[];
    return rows.sort(
      (a, b) => a.createdAt - b.createdAt || a.mutationId.localeCompare(b.mutationId),
    );
  }

  async countUnsynced(accountId: string): Promise<number> {
    // Conflict/quarantined mutations still represent unique local work that has
    // not reached canonical cloud state. They must therefore block ordinary
    // sign-out just like pending/retry mutations.
    const [recipes, collections] = await Promise.all([
      this.listOutbox(accountId),
      this.listCollectionOutbox(accountId),
    ]);
    return recipes.length + collections.length;
  }

  /** Count locally authored pantry, plan and cooking data not yet acknowledged
   * by the workspace cloud stream. These records would be erased on sign-out.
   * No cloud feature flag is required to detect unsafe local-only data. */
  async countUnsyncedWorkspace(accountId: string): Promise<number> {
    const tx = this.#db.transaction(STORES.meta, 'readonly');
    const rows = (await requestResult(
      tx.objectStore(STORES.meta).index('by-account').getAll(accountId),
    )) as MetaRecord[];
    const meta = new Map(rows.map(row => [row.key, row.value]));
    const resources = new Set<string>();
    for (const key of meta.keys()) {
      if (key === 'meal-plan-v1') resources.add('plan:main');
      else if (key.startsWith('kitchen-session-v1:'))
        resources.add('session:' + key.slice('kitchen-session-v1:'.length));
      else if (key.startsWith('workspace-base-v1:'))
        resources.add(key.slice('workspace-base-v1:'.length));
    }
    let pending = 0;
    for (const resource of resources) {
      const key = resource === 'plan:main' ? 'meal-plan-v1'
        : 'kitchen-session-v1:' + resource.slice('session:'.length);
      const local = meta.get(key) ?? null;
      const base = meta.get('workspace-base-v1:' + resource);
      if (base && typeof base === 'object' &&
          'document' in base && 'revision' in base &&
          Number.isSafeInteger(base.revision) && Number(base.revision) >= 0) {
        if (canonicalJson(local) !== canonicalJson(base.document)) pending++;
      } else if (local !== null) {
        // A blank planner has no user work; any cooking session is user work.
        const emptyPlan = resource === 'plan:main' && typeof local === 'object' &&
          !Array.isArray(local) &&
          Array.isArray((local as { entries?: unknown }).entries) &&
          Array.isArray((local as { manualItems?: unknown }).manualItems) &&
          Array.isArray((local as { purchased?: unknown }).purchased) &&
          (local as { entries: unknown[] }).entries.length === 0 &&
          (local as { manualItems: unknown[] }).manualItems.length === 0 &&
          (local as { purchased: unknown[] }).purchased.length === 0;
        if (!emptyPlan) pending++;
      }
    }
    const pantry = meta.get('pantry-v1');
    if (pantry && typeof pantry === 'object' && (
      !Array.isArray((pantry as { ingredients?: unknown }).ingredients) ||
      (pantry as { ingredients: unknown[] }).ingredients.length > 0 ||
      (pantry as { assumeStaples?: unknown }).assumeStaples === true
    )) pending++;
    return pending;
  }

  async putMutation(mutation: OutboxMutation): Promise<void> {
    const tx = this.#db.transaction(STORES.outbox, 'readwrite');
    tx.objectStore(STORES.outbox).put(mutation);
    await transactionDone(tx);
  }

  /**
   * Mark only the exact snapshot that failed. A later local edit may have
   * committed while the HTTP request was in progress; never overwrite it.
   */
  async markRecipeSyncFailure(
    accountId: string,
    resourceId: string,
    expectedLocalRevision: number,
    now: number,
  ): Promise<void> {
    const tx = this.#db.transaction(STORES.documents, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORES.documents);
    const latest = (await requestResult(store.get([accountId, resourceId]))) as LocalRecipeRecord | undefined;
    if (latest && latest.localRevision === expectedLocalRevision &&
        latest.syncState !== 'conflict') {
      store.put({ ...latest, syncState: 'error', updatedAt: now });
    }
    await done;
  }

  /**
   * Acknowledge a mutation and compute the surviving working copy in one
   * IndexedDB transaction. The user may have edited during the canonical
   * download, so a previously captured document or outbox list is unsafe.
   */
  async settleRecipeMutation(
    accountId: string,
    resourceId: string,
    mutationId: string,
    remote: RecipeDocument,
    canonicalWorking: RecipeEditableDocument,
    revision: number,
    now: number,
  ): Promise<void> {
    const tx = this.#db.transaction([STORES.documents, STORES.outbox], 'readwrite');
    const done = transactionDone(tx);
    const documents = tx.objectStore(STORES.documents);
    const outbox = tx.objectStore(STORES.outbox);
    const current = (await requestResult(documents.get([accountId, resourceId]))) as LocalRecipeRecord | undefined;
    const acknowledged = (await requestResult(outbox.get(mutationId))) as OutboxMutation | undefined;

    if (!current || !acknowledged || acknowledged.accountId !== accountId ||
        acknowledged.resourceId !== resourceId) {
      await done;
      return;
    }
    const queued = (await requestResult(
      outbox.index('by-account-resource').getAll([accountId, resourceId]),
    )) as OutboxMutation[];
    const later = queued.filter(row => row.mutationId !== mutationId);
    const preserveWorking = later.length > 0 || current.syncState === 'conflict';
    const state: LocalSyncState = current.syncState === 'conflict' ? 'conflict'
      : later.some(row => row.state === 'conflict') ? 'conflict'
      : later.some(row => row.state === 'quarantined') ? 'error'
      : later.length > 0 ? 'pending' : 'synced';

    documents.put({
      ...current,
      working: preserveWorking ? current.working : canonicalWorking,
      base: remote,
      serverRevision: revision,
      syncState: state,
      tombstone: preserveWorking ? current.tombstone : remote.recipe.deletedAt !== null,
      updatedAt: now,
    } satisfies LocalRecipeRecord);
    outbox.delete(mutationId);
    await done;
  }

  async removeMutation(mutationId: string): Promise<void> {
    const tx = this.#db.transaction(STORES.outbox, 'readwrite');
    tx.objectStore(STORES.outbox).delete(mutationId);
    await transactionDone(tx);
  }

  async applyMutationSuccess(
    record: LocalRecipeRecord,
    mutationId: string,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.documents, STORES.outbox],
      'readwrite',
    );
    tx.objectStore(STORES.documents).put(record);
    tx.objectStore(STORES.outbox).delete(mutationId);
    await transactionDone(tx);
  }

  async recordConflict(
    record: LocalRecipeRecord,
    mutation: OutboxMutation | null,
    conflict: ConflictRecord,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.documents, STORES.outbox, STORES.conflicts],
      'readwrite',
    );
    const done = transactionDone(tx);
    const documents = tx.objectStore(STORES.documents);
    const latest = (await requestResult(
      documents.get([record.accountId, record.resourceId]),
    )) as LocalRecipeRecord | undefined;
    // A conflict response may arrive after another local edit was committed.
    // Conflict resolution must show that newest working copy, not erase it.
    documents.put({
      ...record,
      working: latest?.working ?? record.working,
      localRevision: latest?.localRevision ?? record.localRevision,
      tombstone: latest?.tombstone ?? record.tombstone,
      updatedAt: Math.max(record.updatedAt, latest?.updatedAt ?? 0),
    });
    if (mutation) tx.objectStore(STORES.outbox).put(mutation);
    tx.objectStore(STORES.conflicts).put({
      ...conflict, local: latest?.working ?? conflict.local,
    });
    await done;
  }

  async listConflicts(accountId: string): Promise<ConflictRecord[]> {
    const tx = this.#db.transaction(STORES.conflicts, 'readonly');
    const rows = (await requestResult(
      tx.objectStore(STORES.conflicts).index('by-account').getAll(accountId),
    )) as ConflictRecord[];
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async clearConflictsForResource(
    accountId: string,
    resourceId: string,
  ): Promise<void> {
    const tx = this.#db.transaction(STORES.conflicts, 'readwrite');
    const store = tx.objectStore(STORES.conflicts);
    const keys = await requestResult(
      store.index('by-account-resource').getAllKeys([accountId, resourceId]),
    );
    for (const key of keys) store.delete(key);
    await transactionDone(tx);
  }


  async getCollectionBook(
    accountId: string,
  ): Promise<LocalCollectionBookRecord | undefined> {
    const tx = this.#db.transaction(STORES.collectionBook, 'readonly');
    return requestResult(
      tx.objectStore(STORES.collectionBook).get(accountId),
    ) as Promise<LocalCollectionBookRecord | undefined>;
  }

  async putCollectionBook(record: LocalCollectionBookRecord): Promise<void> {
    const tx = this.#db.transaction(STORES.collectionBook, 'readwrite');
    tx.objectStore(STORES.collectionBook).put(record);
    await transactionDone(tx);
  }

  async commitCollectionMutation(
    record: LocalCollectionBookRecord,
    mutation: CollectionOutboxMutation,
  ): Promise<void> {
    if (record.accountId !== mutation.accountId)
      throw new Error('Collection mutation ownership mismatch');
    const tx = this.#db.transaction(
      [STORES.collectionBook, STORES.collectionOutbox],
      'readwrite',
    );
    tx.objectStore(STORES.collectionBook).put(record);
    tx.objectStore(STORES.collectionOutbox).put(mutation);
    await transactionDone(tx);
  }

  async listCollectionOutbox(
    accountId: string,
  ): Promise<CollectionOutboxMutation[]> {
    const tx = this.#db.transaction(STORES.collectionOutbox, 'readonly');
    const rows = (await requestResult(
      tx
        .objectStore(STORES.collectionOutbox)
        .index('by-account')
        .getAll(accountId),
    )) as CollectionOutboxMutation[];
    return rows.sort(
      (a, b) => a.createdAt - b.createdAt || a.mutationId.localeCompare(b.mutationId),
    );
  }

  async putCollectionMutation(
    mutation: CollectionOutboxMutation,
  ): Promise<void> {
    const tx = this.#db.transaction(STORES.collectionOutbox, 'readwrite');
    tx.objectStore(STORES.collectionOutbox).put(mutation);
    await transactionDone(tx);
  }

  async markCollectionSyncFailure(
    accountId: string,
    expectedLocalRevision: number,
    now: number,
  ): Promise<void> {
    const tx = this.#db.transaction(STORES.collectionBook, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORES.collectionBook);
    const current = (await requestResult(store.get(accountId))) as LocalCollectionBookRecord | undefined;
    if (current && current.localRevision === expectedLocalRevision &&
        current.syncState !== 'conflict') {
      store.put({ ...current, syncState: 'error', updatedAt: now });
    }
    await done;
  }

  async settleCollectionMutation(
    accountId: string,
    mutationId: string,
    remote: RecipeCollectionBook,
    canonicalWorking: RecipeEditableCollectionBook,
    revision: number,
    now: number,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.collectionBook, STORES.collectionOutbox], 'readwrite',
    );
    const done = transactionDone(tx);
    const books = tx.objectStore(STORES.collectionBook);
    const outbox = tx.objectStore(STORES.collectionOutbox);
    const current = (await requestResult(books.get(accountId))) as LocalCollectionBookRecord | undefined;
    const acknowledged = (await requestResult(outbox.get(mutationId))) as CollectionOutboxMutation | undefined;

    if (!current || !acknowledged || acknowledged.accountId !== accountId) {
      await done;
      return;
    }
    const queued = (await requestResult(
      outbox.index('by-account').getAll(accountId),
    )) as CollectionOutboxMutation[];
    const later = queued.filter(row => row.mutationId !== mutationId);
    const preserveWorking = later.length > 0 || current.syncState === 'conflict';
    books.put({
      ...current,
      working: preserveWorking ? current.working : canonicalWorking,
      base: remote,
      serverRevision: revision,
      syncState: current.syncState === 'conflict' ? 'conflict'
        : later.some(row => row.state === 'conflict') ? 'conflict'
        : later.some(row => row.state === 'quarantined') ? 'error'
        : later.length > 0 ? 'pending' : 'synced',
      updatedAt: now,
    } satisfies LocalCollectionBookRecord);
    outbox.delete(mutationId);
    await done;
  }

  async applyCollectionMutationSuccess(
    record: LocalCollectionBookRecord,
    mutationId: string,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.collectionBook, STORES.collectionOutbox],
      'readwrite',
    );
    tx.objectStore(STORES.collectionBook).put(record);
    tx.objectStore(STORES.collectionOutbox).delete(mutationId);
    await transactionDone(tx);
  }

  async recordCollectionConflict(
    record: LocalCollectionBookRecord,
    mutation: CollectionOutboxMutation,
    conflict: CollectionConflictRecord,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [
        STORES.collectionBook,
        STORES.collectionOutbox,
        STORES.collectionConflicts,
      ],
      'readwrite',
    );
    const done = transactionDone(tx);
    const books = tx.objectStore(STORES.collectionBook);
    const latest = (await requestResult(books.get(record.accountId))) as LocalCollectionBookRecord | undefined;
    books.put({
      ...record,
      working: latest?.working ?? record.working,
      localRevision: latest?.localRevision ?? record.localRevision,
      updatedAt: Math.max(record.updatedAt, latest?.updatedAt ?? 0),
    });
    tx.objectStore(STORES.collectionOutbox).put(mutation);
    tx.objectStore(STORES.collectionConflicts).put({
      ...conflict, local: latest?.working ?? conflict.local,
    });
    await done;
  }

  async listCollectionConflicts(
    accountId: string,
  ): Promise<CollectionConflictRecord[]> {
    const tx = this.#db.transaction(STORES.collectionConflicts, 'readonly');
    const rows = (await requestResult(
      tx
        .objectStore(STORES.collectionConflicts)
        .index('by-account')
        .getAll(accountId),
    )) as CollectionConflictRecord[];
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getMeta<T>(accountId: string, key: string): Promise<T | undefined> {
    const tx = this.#db.transaction(STORES.meta, 'readonly');
    const row = (await requestResult(
      tx.objectStore(STORES.meta).get([accountId, key]),
    )) as MetaRecord | undefined;
    return row?.value as T | undefined;
  }

  async setMeta(accountId: string, key: string, value: unknown): Promise<void> {
    const tx = this.#db.transaction(STORES.meta, 'readwrite');
    tx.objectStore(STORES.meta).put({ accountId, key, value } satisfies MetaRecord);
    await transactionDone(tx);
  }

  async applyPullPage(
    accountId: string,
    documents: LocalRecipeRecord[],
    conflicts: ConflictRecord[],
    nextCursor: number,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.documents, STORES.conflicts, STORES.meta],
      'readwrite',
    );
    const done = transactionDone(tx);
    const documentStore = tx.objectStore(STORES.documents);
    const conflictStore = tx.objectStore(STORES.conflicts);
    for (const document of documents) {
      if (document.accountId !== accountId) {
        tx.abort();
        void done.catch(() => undefined);
        throw new Error('Pulled document ownership mismatch');
      }
      const latest = (await requestResult(
        documentStore.get([accountId, document.resourceId]),
      )) as LocalRecipeRecord | undefined;
      // A user edit committed after the remote response was prepared.
      // Abort the *entire* page (including cursor), so the next sync retries.
      if (latest && (latest.localRevision !== document.localRevision ||
          (latest.syncState === 'pending' && document.syncState === 'synced'))) {
        tx.abort();
        void done.catch(() => undefined);
        throw new Error('Local recipe changed while applying cloud updates; retry sync');
      }
      documentStore.put(document);
    }
    for (const conflict of conflicts) {
      if (conflict.accountId !== accountId)
        throw new Error('Pulled conflict ownership mismatch');
      conflictStore.put(conflict);
    }
    tx.objectStore(STORES.meta).put({
      accountId,
      key: 'cursor',
      value: nextCursor,
    } satisfies MetaRecord);
    await done;
  }

  /**
   * Read every account-owned IndexedDB store in one readonly transaction so the
   * downloaded recovery file contains a consistent view. No credentials, tokens
   * or storage from other THIEPN apps are included.
   */
  async exportAccountBackup(
    accountId: string,
    now: Date = new Date(),
  ): Promise<RecipeAccountBackup> {
    const tx = this.#db.transaction(Object.values(STORES), 'readonly');
    const done = transactionDone(tx);
    const byOwner = async <T>(store: string): Promise<T[]> =>
      await requestResult(tx.objectStore(store).index('by-account').getAll(accountId)) as T[];
    const documents = await byOwner<LocalRecipeRecord>(STORES.documents);
    const outbox = await byOwner<OutboxMutation>(STORES.outbox);
    const conflicts = await byOwner<ConflictRecord>(STORES.conflicts);
    const collectionBook = await requestResult(
      tx.objectStore(STORES.collectionBook).get(accountId),
    ) as LocalCollectionBookRecord | undefined;
    const collectionOutbox = await byOwner<CollectionOutboxMutation>(STORES.collectionOutbox);
    const collectionConflicts = await byOwner<CollectionConflictRecord>(STORES.collectionConflicts);
    const metadata = await byOwner<MetaRecord>(STORES.meta);
    await done;
    return {
      format: 'thiepn-recipe-local-backup',
      schemaVersion: 1,
      accountId,
      exportedAt: now.toISOString(),
      documents,
      outbox,
      conflicts,
      collectionBook: collectionBook ?? null,
      collectionOutbox,
      collectionConflicts,
      metadata,
    };
  }

  /** A conflict choice is applied only if its viewed snapshot is still current.
   * Any in-flight mutation prevents resolution, avoiding idempotency races. */
  async resolveRecipeConflict(
    accountId: string,
    conflictId: string,
    expectedLocalRevision: number,
    choice: 'keep-local' | 'use-cloud',
    canonicalWorking: RecipeEditableDocument,
    newMutationId: string,
    now: number,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.documents, STORES.outbox, STORES.conflicts], 'readwrite',
    );
    const done = transactionDone(tx);
    try {
      const conflicts = tx.objectStore(STORES.conflicts);
      const conflict = await requestResult(conflicts.get(conflictId)) as ConflictRecord | undefined;
      if (!conflict || conflict.accountId !== accountId ||
          !conflict.remote || conflict.remoteRevision === null)
        throw new Error('This conflict is unavailable or cannot be resolved automatically.');
      const documents = tx.objectStore(STORES.documents);
      const record = await requestResult(documents.get([accountId, conflict.resourceId]))
        as LocalRecipeRecord | undefined;
      if (!record || record.localRevision !== expectedLocalRevision ||
          record.syncState !== 'conflict' ||
          canonicalJson(record.working) !== canonicalJson(conflict.local))
        throw new Error('This recipe changed. Review the latest local version before resolving.');
      const outbox = tx.objectStore(STORES.outbox);
      const pending = await requestResult(
        outbox.index('by-account-resource').getAll([accountId, conflict.resourceId]),
      ) as OutboxMutation[];
      if (pending.some(row => row.state === 'in_flight'))
        throw new Error('A save is still in progress. Retry after it completes.');
      if (await requestResult(outbox.get(newMutationId)))
        throw new Error('Duplicate recovery mutation identifier.');
      for (const row of pending) outbox.delete(row.mutationId);
      const conflictKeys = await requestResult(
        conflicts.index('by-account-resource').getAllKeys([accountId, conflict.resourceId]),
      );
      for (const key of conflictKeys) conflicts.delete(key);
      if (choice === 'keep-local') {
        outbox.put({
          mutationId: newMutationId,
          accountId,
          resourceId: record.resourceId,
          baseRevision: conflict.remoteRevision,
          operation: record.tombstone ? 'delete' : 'replace',
          document: record.tombstone ? null : record.working,
          state: 'pending',
          attempts: 0,
          createdAt: now,
          lastAttemptAt: null,
          lastErrorCode: null,
        } satisfies OutboxMutation);
      }
      documents.put({
        ...record,
        working: choice === 'keep-local' ? record.working : canonicalWorking,
        base: conflict.remote,
        serverRevision: conflict.remoteRevision,
        localRevision: record.localRevision + 1,
        syncState: choice === 'keep-local' ? 'pending' : 'synced',
        tombstone: choice === 'keep-local' ? record.tombstone
          : conflict.remote.recipe.deletedAt !== null,
        updatedAt: now,
      } satisfies LocalRecipeRecord);
      await done;
    } catch (error) {
      tx.abort();
      void done.catch(() => undefined);
      throw error;
    }
  }

  async resolveCollectionConflict(
    accountId: string,
    conflictId: string,
    expectedLocalRevision: number,
    choice: 'keep-local' | 'use-cloud',
    canonicalWorking: RecipeEditableCollectionBook,
    newMutationId: string,
    now: number,
  ): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.collectionBook, STORES.collectionOutbox, STORES.collectionConflicts],
      'readwrite',
    );
    const done = transactionDone(tx);
    try {
      const conflicts = tx.objectStore(STORES.collectionConflicts);
      const conflict = await requestResult(conflicts.get(conflictId))
        as CollectionConflictRecord | undefined;
      if (!conflict || conflict.accountId !== accountId)
        throw new Error('Collection conflict has changed. Reload and review again.');
      const books = tx.objectStore(STORES.collectionBook);
      const record = await requestResult(books.get(accountId)) as LocalCollectionBookRecord | undefined;
      if (!record || record.localRevision !== expectedLocalRevision ||
          record.syncState !== 'conflict' ||
          canonicalJson(record.working) !== canonicalJson(conflict.local))
        throw new Error('Collections changed locally. Review before resolving.');
      const outbox = tx.objectStore(STORES.collectionOutbox);
      const pending = await requestResult(outbox.index('by-account').getAll(accountId))
        as CollectionOutboxMutation[];
      if (pending.some(row => row.state === 'in_flight'))
        throw new Error('A collection save is still in progress.');
      if (await requestResult(outbox.get(newMutationId)))
        throw new Error('Duplicate recovery mutation identifier.');
      for (const row of pending) outbox.delete(row.mutationId);
      const ids = await requestResult(conflicts.index('by-account').getAllKeys(accountId));
      for (const id of ids) conflicts.delete(id);
      if (choice === 'keep-local') {
        outbox.put({
          mutationId: newMutationId, accountId,
          baseRevision: conflict.remoteRevision,
          document: record.working,
          state: 'pending', attempts: 0, createdAt: now,
          lastAttemptAt: null, lastErrorCode: null,
        } satisfies CollectionOutboxMutation);
      }
      books.put({
        ...record,
        working: choice === 'keep-local' ? record.working : canonicalWorking,
        base: conflict.remote,
        serverRevision: conflict.remoteRevision,
        localRevision: record.localRevision + 1,
        syncState: choice === 'keep-local' ? 'pending' : 'synced',
        updatedAt: now,
      } satisfies LocalCollectionBookRecord);
      await done;
    } catch (error) {
      tx.abort();
      void done.catch(() => undefined);
      throw error;
    }
  }

  async wipeAccount(accountId: string): Promise<void> {
    const tx = this.#db.transaction(
      [
        STORES.documents,
        STORES.outbox,
        STORES.conflicts,
        STORES.collectionBook,
        STORES.collectionOutbox,
        STORES.collectionConflicts,
        STORES.meta,
      ],
      'readwrite',
    );

    for (const storeName of Object.values(STORES)) {
      const store = tx.objectStore(storeName);
      if (storeName === STORES.collectionBook) {
        store.delete(accountId);
        continue;
      }
      const index = store.index('by-account');
      const keys = await requestResult(index.getAllKeys(accountId));
      for (const key of keys) store.delete(key);
    }

    await transactionDone(tx);
  }
}
