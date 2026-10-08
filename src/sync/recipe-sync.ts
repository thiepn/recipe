import {
  recipeEditableDocumentSchema,
  type RecipeDocument,
  type RecipeEditableDocument,
  type RecipeMutation,
  type RecipeMutationResult,
} from '../api/protocol.ts';
import { RecipeApiError, RecipeCoreApi } from '../api/core.ts';
import {
  RecipeLocalDb,
  type ConflictRecord,
  type LocalRecipeRecord,
  type OutboxMutation,
} from '../data/local-db.ts';

export interface RecipeSyncEngineOptions {
  accountId: string;
  db: RecipeLocalDb;
  api: RecipeCoreApi;
  now?: () => number;
  randomUUID?: () => string;
}

function editableFromRemote(document: RecipeDocument): RecipeEditableDocument {
  return recipeEditableDocumentSchema.parse({
    schemaVersion: 1,
    recipe: {
      id: document.recipe.id,
      state: document.recipe.state,
      favorite: document.recipe.favorite,
      metadata: document.recipe.metadata,
    },
    version: {
      id: document.version.id,
      recipeId: document.version.recipeId,
      versionNumber: document.version.versionNumber,
      kind: document.version.kind,
      title: document.version.title,
      description: document.version.description,
      story: document.version.story,
      yieldText: document.version.yieldText,
      servings: document.version.servings,
      servingUnit: document.version.servingUnit,
      difficulty: document.version.difficulty,
      prepMinutes: document.version.prepMinutes,
      activeMinutes: document.version.activeMinutes,
      passiveMinutes: document.version.passiveMinutes,
      restMinutes: document.version.restMinutes,
      totalMinutes: document.version.totalMinutes,
      cuisineTags: document.version.cuisineTags,
      categoryTags: document.version.categoryTags,
      dietaryTags: document.version.dietaryTags,
      locale: document.version.locale,
      authorNote: document.version.authorNote,
      changeSummary: document.version.changeSummary,
      metadata: document.version.metadata,
    },
    ingredientGroups: document.ingredientGroups,
    ingredients: document.ingredients,
    steps: document.steps,
    stepIngredients: document.stepIngredients,
    equipment: document.equipment,
    stepEquipment: document.stepEquipment,
  });
}

function conflictId(randomUUID: () => string): string {
  return randomUUID();
}

function mutationPayload(mutation: OutboxMutation): RecipeMutation {
  return {
    mutationId: mutation.mutationId,
    resourceId: mutation.resourceId,
    baseRevision: mutation.baseRevision,
    operation: mutation.operation,
    document: mutation.document,
  };
}

function failureDisposition(
  error: unknown,
): { state: 'retry' | 'quarantined'; stopCycle: boolean } {
  if (!(error instanceof RecipeApiError))
    return { state: 'retry', stopCycle: true };

  if (
    error.status === 0 ||
    error.status === 401 ||
    error.status === 403 ||
    error.status >= 500
  )
    return { state: 'retry', stopCycle: true };

  return { state: 'quarantined', stopCycle: false };
}

export class RecipeSyncEngine {
  readonly #accountId: string;
  readonly #db: RecipeLocalDb;
  readonly #api: RecipeCoreApi;
  readonly #now: () => number;
  readonly #randomUUID: () => string;
  #running: Promise<void> | null = null;

  constructor(options: RecipeSyncEngineOptions) {
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

  async stageCreate(document: RecipeEditableDocument): Promise<void> {
    const parsed = recipeEditableDocumentSchema.parse(document);
    const resourceId = parsed.recipe.id;

    if (await this.#db.getDocument(this.#accountId, resourceId))
      throw new Error('Recipe already exists locally');

    const now = this.#now();
    const mutation: OutboxMutation = {
      mutationId: this.#randomUUID(),
      accountId: this.#accountId,
      resourceId,
      baseRevision: 0,
      operation: 'create',
      document: parsed,
      state: 'pending',
      attempts: 0,
      createdAt: now,
      lastAttemptAt: null,
      lastErrorCode: null,
    };

    const record: LocalRecipeRecord = {
      accountId: this.#accountId,
      resourceId,
      working: parsed,
      base: null,
      serverRevision: 0,
      localRevision: 1,
      syncState: 'pending',
      tombstone: false,
      updatedAt: now,
    };

    await this.#db.commitMutation(record, mutation);
  }

  async stageReplace(document: RecipeEditableDocument): Promise<void> {
    const parsed = recipeEditableDocumentSchema.parse(document);
    const resourceId = parsed.recipe.id;
    const current = await this.#db.getDocument(this.#accountId, resourceId);
    if (!current) throw new Error('Recipe does not exist locally');
    if (current.syncState === 'conflict')
      throw new Error('Resolve the existing Recipe conflict before editing');

    const now = this.#now();
    const mutation: OutboxMutation = {
      mutationId: this.#randomUUID(),
      accountId: this.#accountId,
      resourceId,
      baseRevision: current.serverRevision,
      operation: 'replace',
      document: parsed,
      state: 'pending',
      attempts: 0,
      createdAt: now,
      lastAttemptAt: null,
      lastErrorCode: null,
    };

    await this.#db.commitMutation(
      {
        ...current,
        working: parsed,
        localRevision: current.localRevision + 1,
        syncState: 'pending',
        tombstone: false,
        updatedAt: now,
      },
      mutation,
    );
  }

  async stageDelete(resourceId: string): Promise<void> {
    const current = await this.#db.getDocument(this.#accountId, resourceId);
    if (!current) throw new Error('Recipe does not exist locally');
    if (current.syncState === 'conflict')
      throw new Error('Resolve the existing Recipe conflict before deleting');

    const now = this.#now();
    const mutation: OutboxMutation = {
      mutationId: this.#randomUUID(),
      accountId: this.#accountId,
      resourceId,
      baseRevision: current.serverRevision,
      operation: 'delete',
      document: null,
      state: 'pending',
      attempts: 0,
      createdAt: now,
      lastAttemptAt: null,
      lastErrorCode: null,
    };

    await this.#db.commitMutation(
      {
        ...current,
        localRevision: current.localRevision + 1,
        syncState: 'pending',
        tombstone: true,
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
    const pushed = await this.#pushPending();
    if (!pushed) return;

    const cursor = await this.#db.getMeta<number>(this.#accountId, 'cursor');
    if (cursor === undefined) {
      await this.#bootstrap();
      return;
    }

    await this.#pull(cursor);
  }

  async #pushPending(): Promise<boolean> {
    const outbox = await this.#db.listOutbox(this.#accountId);
    const blockedResources = new Set<string>();

    for (let mutation of outbox) {
      if (blockedResources.has(mutation.resourceId)) continue;

      if (mutation.state === 'conflict' || mutation.state === 'quarantined') {
        blockedResources.add(mutation.resourceId);
        continue;
      }

      const local = await this.#db.getDocument(
        this.#accountId,
        mutation.resourceId,
      );
      if (!local) {
        mutation = {
          ...mutation,
          state: 'quarantined',
          lastErrorCode: 'LOCAL_DOCUMENT_MISSING',
        };
        await this.#db.putMutation(mutation);
        blockedResources.add(mutation.resourceId);
        continue;
      }

      if (local.syncState === 'conflict') {
        blockedResources.add(mutation.resourceId);
        continue;
      }

      // Before first transmission, a later mutation may safely advance from the
      // revision committed by an earlier queued mutation. Once attempted, its
      // base revision and payload remain immutable for idempotent retries.
      if (
        mutation.attempts === 0 &&
        mutation.operation !== 'create' &&
        mutation.baseRevision !== local.serverRevision
      ) {
        mutation = { ...mutation, baseRevision: local.serverRevision };
      }

      const inFlight: OutboxMutation = {
        ...mutation,
        state: 'in_flight',
        attempts: mutation.attempts + 1,
        lastAttemptAt: this.#now(),
        lastErrorCode: null,
      };
      await this.#db.putMutation(inFlight);

      let result: RecipeMutationResult;
      try {
        const response = await this.#api.mutate([
          mutationPayload(inFlight),
        ]);
        const first = response.results[0];
        if (!first) throw new Error('Gateway returned no mutation result');
        result = first;
      } catch (error) {
        const disposition = failureDisposition(error);
        await this.#db.putMutation({
          ...inFlight,
          state: disposition.state,
          lastErrorCode:
            error instanceof RecipeApiError ? error.code : 'SYNC_ERROR',
        });

        await this.#db.markRecipeSyncFailure(
          this.#accountId, mutation.resourceId, local.localRevision, this.#now(),
        );

        if (disposition.stopCycle) return false;

        // A malformed/non-retryable mutation is isolated so it cannot poison
        // unrelated recipes. Later dependent mutations for the same recipe
        // stay blocked until the bad mutation is repaired.
        blockedResources.add(mutation.resourceId);
        continue;
      }

      if (result.status === 'conflict') {
        const conflict: ConflictRecord = {
          id: conflictId(this.#randomUUID),
          accountId: this.#accountId,
          resourceId: mutation.resourceId,
          mutationId: mutation.mutationId,
          reason: result.reason,
          baseRevision: mutation.baseRevision,
          remoteRevision: result.remoteRevision,
          base: local.base,
          local: mutation.document ?? local.working,
          remote: result.remote,
          createdAt: this.#now(),
        };

        await this.#db.recordConflict(
          {
            ...local,
            serverRevision: result.remoteRevision,
            syncState: 'conflict',
            updatedAt: this.#now(),
          },
          { ...inFlight, state: 'conflict' },
          conflict,
        );
        blockedResources.add(mutation.resourceId);
        continue;
      }

      if (result.status === 'not_found') {
        const conflict: ConflictRecord = {
          id: conflictId(this.#randomUUID),
          accountId: this.#accountId,
          resourceId: mutation.resourceId,
          mutationId: mutation.mutationId,
          reason: 'remote_not_found',
          baseRevision: mutation.baseRevision,
          remoteRevision: null,
          base: local.base,
          local: mutation.document ?? local.working,
          remote: null,
          createdAt: this.#now(),
        };
        await this.#db.recordConflict(
          {
            ...local,
            syncState: 'conflict',
            updatedAt: this.#now(),
          },
          { ...inFlight, state: 'conflict' },
          conflict,
        );
        blockedResources.add(mutation.resourceId);
        continue;
      }

      // Do not remove the durable outbox receipt until the authoritative state
      // can also be downloaded. If this fetch fails, retrying the same mutation
      // ID is safe and returns the stored server result.
      let remote: RecipeDocument;
      try {
        remote = await this.#api.document(mutation.resourceId);
      } catch (error) {
        await this.#db.putMutation({
          ...inFlight,
          state: 'retry',
          lastErrorCode:
            error instanceof RecipeApiError
              ? error.code
              : 'CANONICAL_FETCH_FAILED',
        });
        return false;
      }

      // Atomically inspect current outbox and local document at commit time.
      // A new edit may arrive between the canonical fetch and this write.
      await this.#db.settleRecipeMutation(
        this.#accountId,
        mutation.resourceId,
        mutation.mutationId,
        remote,
        editableFromRemote(remote),
        result.revision,
        this.#now(),
      );
    }

    return true;
  }

  async #bootstrap(): Promise<void> {
    const manifest = await this.#api.manifest();
    const documents: LocalRecipeRecord[] = [];
    const conflicts: ConflictRecord[] = [];

    for (const item of manifest.recipes) {
      const local = await this.#db.getDocument(this.#accountId, item.id);
      if (local && item.revision <= local.serverRevision) continue;

      const remote = await this.#api.document(item.id);
      const dirty =
        local?.syncState === 'conflict' ||
        (await this.#db.listResourceOutbox(this.#accountId, item.id)).length > 0;

      if (local && dirty) {
        documents.push({
          ...local,
          syncState: 'conflict',
          updatedAt: this.#now(),
        });
        conflicts.push({
          id: conflictId(this.#randomUUID),
          accountId: this.#accountId,
          resourceId: item.id,
          mutationId: null,
          reason: 'bootstrap_remote_changed',
          baseRevision: local.serverRevision,
          remoteRevision: remote.recipe.revision,
          base: local.base,
          local: local.working,
          remote,
          createdAt: this.#now(),
        });
        continue;
      }

      documents.push({
        accountId: this.#accountId,
        resourceId: item.id,
        working: editableFromRemote(remote),
        base: remote,
        serverRevision: remote.recipe.revision,
        localRevision: local?.localRevision ?? 0,
        syncState: 'synced',
        tombstone: remote.recipe.deletedAt !== null,
        updatedAt: this.#now(),
      });
    }

    await this.#db.applyPullPage(
      this.#accountId,
      documents,
      conflicts,
      manifest.cursor,
    );
  }

  async #pull(initialCursor: number): Promise<void> {
    let cursor = initialCursor;

    do {
      const page = await this.#api.changes(cursor, 50);
      const documents: LocalRecipeRecord[] = [];
      const conflicts: ConflictRecord[] = [];

      for (const change of page.changes) {
        const local = await this.#db.getDocument(
          this.#accountId,
          change.resourceId,
        );

        // A change already represented by the local canonical baseline is only
        // a delayed sync hint; advancing the cursor is safe.
        if (local && change.revision <= local.serverRevision) continue;

        const remote = await this.#api.document(change.resourceId);
        const dirty =
          local?.syncState === 'conflict' ||
          (
            await this.#db.listResourceOutbox(
              this.#accountId,
              change.resourceId,
            )
          ).length > 0;

        if (local && dirty) {
          documents.push({
            ...local,
            syncState: 'conflict',
            updatedAt: this.#now(),
          });
          conflicts.push({
            id: conflictId(this.#randomUUID),
            accountId: this.#accountId,
            resourceId: change.resourceId,
            mutationId: null,
            reason: 'remote_changed_while_dirty',
            baseRevision: local.serverRevision,
            remoteRevision: remote.recipe.revision,
            base: local.base,
            local: local.working,
            remote,
            createdAt: this.#now(),
          });
          continue;
        }

        documents.push({
          accountId: this.#accountId,
          resourceId: change.resourceId,
          working: editableFromRemote(remote),
          base: remote,
          serverRevision: remote.recipe.revision,
          localRevision: local?.localRevision ?? 0,
          syncState: 'synced',
          tombstone: remote.recipe.deletedAt !== null,
          updatedAt: this.#now(),
        });
      }

      await this.#db.applyPullPage(
        this.#accountId,
        documents,
        conflicts,
        page.nextCursor,
      );
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (true);
  }

  /**
   * Browser lifecycle triggers accelerate sync while the app is open. Correctness
   * never depends on background execution while the browser/PWA is closed.
   */
  startAutoSync(intervalMs = 60_000): () => void {
    if (!Number.isFinite(intervalMs) || intervalMs < 10_000)
      throw new TypeError('intervalMs must be at least 10 seconds');

    const sync = () => void this.syncOnce().catch(() => undefined);
    const onVisibility = () => {
      if (globalThis.document?.visibilityState === 'visible') sync();
    };

    globalThis.addEventListener?.('online', sync);
    globalThis.document?.addEventListener('visibilitychange', onVisibility);
    const timer = globalThis.setInterval(sync, intervalMs);
    sync();

    return () => {
      globalThis.removeEventListener?.('online', sync);
      globalThis.document?.removeEventListener(
        'visibilitychange',
        onVisibility,
      );
      globalThis.clearInterval(timer);
    };
  }
}

export { editableFromRemote };
