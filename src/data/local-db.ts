import type {
  RecipeDocument,
  RecipeEditableDocument,
} from '../api/protocol.ts';

const DB_NAME = 'thiepn-recipe';
const DB_VERSION = 1;

const STORES = {
  documents: 'documents',
  outbox: 'outbox',
  conflicts: 'conflicts',
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

interface MetaRecord {
  accountId: string;
  key: string;
  value: unknown;
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
    const rows = await this.listOutbox(accountId);
    return rows.filter(
      (row) => row.state !== 'quarantined',
    ).length;
  }

  async putMutation(mutation: OutboxMutation): Promise<void> {
    const tx = this.#db.transaction(STORES.outbox, 'readwrite');
    tx.objectStore(STORES.outbox).put(mutation);
    await transactionDone(tx);
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
    tx.objectStore(STORES.documents).put(record);
    if (mutation) tx.objectStore(STORES.outbox).put(mutation);
    tx.objectStore(STORES.conflicts).put(conflict);
    await transactionDone(tx);
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
    const documentStore = tx.objectStore(STORES.documents);
    const conflictStore = tx.objectStore(STORES.conflicts);
    for (const document of documents) {
      if (document.accountId !== accountId)
        throw new Error('Pulled document ownership mismatch');
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
    await transactionDone(tx);
  }

  async wipeAccount(accountId: string): Promise<void> {
    const tx = this.#db.transaction(
      [STORES.documents, STORES.outbox, STORES.conflicts, STORES.meta],
      'readwrite',
    );

    for (const storeName of Object.values(STORES)) {
      const store = tx.objectStore(storeName);
      const index = store.index('by-account');
      const keys = await requestResult(index.getAllKeys(accountId));
      for (const key of keys) store.delete(key);
    }

    await transactionDone(tx);
  }
}
