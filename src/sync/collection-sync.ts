import {
  recipeEditableCollectionBookSchema,
  type RecipeCollectionBook,
  type RecipeCollectionMutationResult,
  type RecipeEditableCollectionBook,
} from '../api/protocol.ts';
import { RecipeApiError, RecipeCoreApi } from '../api/core.ts';
import { isRetryableSyncFailure } from './retry.ts';
import {
  RecipeLocalDb,
  type CollectionConflictRecord,
  type CollectionOutboxMutation,
  type LocalCollectionBookRecord,
} from '../data/local-db.ts';

export interface CollectionSyncEngineOptions {
  accountId: string;
  db: RecipeLocalDb;
  api: RecipeCoreApi;
  now?: () => number;
  randomUUID?: () => string;
}

export function editableCollectionBookFromRemote(
  remote: RecipeCollectionBook,
): RecipeEditableCollectionBook {
  return recipeEditableCollectionBookSchema.parse({
    schemaVersion: 1,
    collections: remote.collections
      .filter((collection) => collection.deletedAt === null)
      .map((collection) => ({
        id: collection.id,
        kind: 'manual' as const,
        name: collection.name,
        description: collection.description,
        iconKey: collection.iconKey,
        coverImagePath: collection.coverImagePath,
        position: collection.position,
        metadata: collection.metadata,
        recipeIds: collection.recipeIds,
      })),
  });
}

function disposition(
  error: unknown,
): { state: 'retry' | 'quarantined'; stopCycle: boolean } {
  if (isRetryableSyncFailure(error))
    return { state: 'retry', stopCycle: true };
  return { state: 'quarantined', stopCycle: true };
}

export class CollectionSyncEngine {
  readonly #accountId: string;
  readonly #db: RecipeLocalDb;
  readonly #api: RecipeCoreApi;
  readonly #now: () => number;
  readonly #randomUUID: () => string;
  #running: Promise<void> | null = null;

  constructor(options: CollectionSyncEngineOptions) {
    this.#accountId = options.accountId;
    this.#db = options.db;
    this.#api = options.api;
    this.#now = options.now ?? Date.now;
    this.#randomUUID =
      options.randomUUID ??
      (() => {
        if (!globalThis.crypto?.randomUUID)
          throw new Error('crypto.randomUUID is unavailable');
        return globalThis.crypto.randomUUID();
      });
  }

  async ensureLocal(): Promise<LocalCollectionBookRecord> {
    const existing = await this.#db.getCollectionBook(this.#accountId);
    if (existing) return existing;

    const remote = await this.#api.collections();
    const record: LocalCollectionBookRecord = {
      accountId: this.#accountId,
      working: editableCollectionBookFromRemote(remote),
      base: remote,
      serverRevision: remote.revision,
      localRevision: 0,
      syncState: 'synced',
      updatedAt: this.#now(),
    };
    await this.#db.putCollectionBook(record);
    return record;
  }

  async stageReplace(document: RecipeEditableCollectionBook): Promise<void> {
    const parsed = recipeEditableCollectionBookSchema.parse(document);
    const current =
      (await this.#db.getCollectionBook(this.#accountId)) ??
      ({
        accountId: this.#accountId,
        working: { schemaVersion: 1, collections: [] },
        base: null,
        serverRevision: 0,
        localRevision: 0,
        syncState: 'synced',
        updatedAt: this.#now(),
      } satisfies LocalCollectionBookRecord);

    if (current.syncState === 'conflict')
      throw new Error('Resolve the collection conflict before editing');

    const now = this.#now();
    const mutation: CollectionOutboxMutation = {
      mutationId: this.#randomUUID(),
      accountId: this.#accountId,
      baseRevision: current.serverRevision,
      document: parsed,
      state: 'pending',
      attempts: 0,
      createdAt: now,
      lastAttemptAt: null,
      lastErrorCode: null,
    };

    await this.#db.commitCollectionMutation(
      {
        ...current,
        working: parsed,
        localRevision: current.localRevision + 1,
        syncState: 'pending',
        updatedAt: now,
      },
      mutation,
    );
  }

  syncOnce(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #run(): Promise<void> {
    const pushed = await this.#push();
    if (!pushed) return;

    const remote = await this.#api.collections();
    const local = await this.#db.getCollectionBook(this.#accountId);
    if (!local) {
      await this.#db.putCollectionBook({
        accountId: this.#accountId,
        working: editableCollectionBookFromRemote(remote),
        base: remote,
        serverRevision: remote.revision,
        localRevision: 0,
        syncState: 'synced',
        updatedAt: this.#now(),
      });
      return;
    }

    if (remote.revision <= local.serverRevision) return;

    const outbox = await this.#db.listCollectionOutbox(this.#accountId);
    if (outbox.length > 0 || local.syncState === 'conflict') {
      const first = outbox[0];
      if (!first) return;
      const conflict: CollectionConflictRecord = {
        id: this.#randomUUID(),
        accountId: this.#accountId,
        mutationId: first.mutationId,
        reason: 'remote_changed_while_dirty',
        baseRevision: local.serverRevision,
        remoteRevision: remote.revision,
        base: local.base,
        local: local.working,
        remote,
        createdAt: this.#now(),
      };
      await this.#db.recordCollectionConflict(
        { ...local, syncState: 'conflict', updatedAt: this.#now() },
        { ...first, state: 'conflict' },
        conflict,
      );
      return;
    }

    await this.#db.putCollectionBook({
      ...local,
      working: editableCollectionBookFromRemote(remote),
      base: remote,
      serverRevision: remote.revision,
      syncState: 'synced',
      updatedAt: this.#now(),
    });
  }

  async #push(): Promise<boolean> {
    const outbox = await this.#db.listCollectionOutbox(this.#accountId);

    for (let mutation of outbox) {
      if (mutation.state === 'conflict' || mutation.state === 'quarantined')
        return false;

      const local = await this.#db.getCollectionBook(this.#accountId);
      if (!local) {
        await this.#db.putCollectionMutation({
          ...mutation,
          state: 'quarantined',
          lastErrorCode: 'LOCAL_COLLECTION_BOOK_MISSING',
        });
        return false;
      }

      if (local.syncState === 'conflict') return false;

      if (
        mutation.attempts === 0 &&
        mutation.baseRevision !== local.serverRevision
      ) {
        mutation = { ...mutation, baseRevision: local.serverRevision };
      }

      const inFlight: CollectionOutboxMutation = {
        ...mutation,
        state: 'in_flight',
        attempts: mutation.attempts + 1,
        lastAttemptAt: this.#now(),
        lastErrorCode: null,
      };
      await this.#db.putCollectionMutation(inFlight);

      let result: RecipeCollectionMutationResult;
      try {
        result = await this.#api.mutateCollections({
          mutationId: inFlight.mutationId,
          baseRevision: inFlight.baseRevision,
          document: inFlight.document,
        });
      } catch (error) {
        const state = disposition(error);
        await this.#db.putCollectionMutation({
          ...inFlight,
          state: state.state,
          lastErrorCode:
            error instanceof RecipeApiError ? error.code : 'SYNC_ERROR',
        });
        await this.#db.markCollectionSyncFailure(
          this.#accountId, local.localRevision, this.#now(),
        );
        return false;
      }

      if (result.status === 'conflict') {
        const conflict: CollectionConflictRecord = {
          id: this.#randomUUID(),
          accountId: this.#accountId,
          mutationId: inFlight.mutationId,
          reason: 'revision',
          baseRevision: inFlight.baseRevision,
          remoteRevision: result.remoteRevision,
          base: local.base,
          local: inFlight.document,
          remote: result.remote,
          createdAt: this.#now(),
        };
        await this.#db.recordCollectionConflict(
          {
            ...local,
            serverRevision: result.remoteRevision,
            syncState: 'conflict',
            updatedAt: this.#now(),
          },
          { ...inFlight, state: 'conflict' },
          conflict,
        );
        return false;
      }

      await this.#db.settleCollectionMutation(
        this.#accountId,
        inFlight.mutationId,
        result.document,
        editableCollectionBookFromRemote(result.document),
        result.revision,
        this.#now(),
      );
    }

    return true;
  }
}
