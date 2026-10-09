import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { RecipeCoreApi } from '../src/api/core.ts';
import type { RecipeCollectionBook, RecipeDocument } from '../src/api/protocol.ts';
import {
  RecipeLocalDb,
  type ConflictRecord,
  type CollectionConflictRecord,
  type LocalRecipeRecord,
  type LocalCollectionBookRecord,
  type CollectionOutboxMutation,
  type OutboxMutation,
} from '../src/data/local-db.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import {
  resolveRecipeConflictSafely, resolveCollectionConflictSafely,
  serializeBackup,
} from '../src/recovery/recovery.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const firstId = '33333333-3333-4333-8333-333333333333';
const newId = '44444444-4444-4444-8444-444444444444';
const conflictId = '55555555-5555-4555-8555-555555555555';
const handles: RecipeLocalDb[] = [];
async function fresh() {
  const db = await RecipeLocalDb.open(new IDBFactory());
  handles.push(db);
  return db;
}
afterEach(() => {
  for (const db of handles) db.close();
  handles.length = 0;
});

function recipeFixture() {
  const working = createBlankRecipe('Device soup');
  const resourceId = working.recipe.id;
  const record: LocalRecipeRecord = {
    accountId: owner, resourceId, working,
    base: null, serverRevision: 1, localRevision: 1,
    syncState: 'pending', tombstone: false, updatedAt: 100,
  };
  const first: OutboxMutation = {
    accountId: owner, resourceId, mutationId: firstId,
    baseRevision: 1, operation: 'replace', document: working,
    state: 'pending', attempts: 0, createdAt: 100,
    lastAttemptAt: null, lastErrorCode: null,
  };
  const remote = {
    ...working,
    recipe: { ...working.recipe, revision: 2, deletedAt: null },
    version: { ...working.version, title: 'Cloud soup' },
  } as unknown as RecipeDocument;
  const conflict: ConflictRecord = {
    id: conflictId, accountId: owner, resourceId, mutationId: firstId,
    reason: 'revision', baseRevision: 1, remoteRevision: 2,
    base: null, local: working, remote, createdAt: 140,
  };
  return { working, record, first, remote, conflict };
}

describe('P15D private local backup', () => {
  it('exports every owned device store and does not leak another account', async () => {
    const db = await fresh();
    const { record, first } = recipeFixture();
    await db.commitMutation(record, first);
    await db.setMeta(owner, 'pantry-v1', { ingredients: ['eggs'] });
    await db.setMeta(owner, 'meal-plan-v1', { entries: ['today'] });
    await db.setMeta(other, 'pantry-v1', { ingredients: ['secret'] });
    const backup = await db.exportAccountBackup(owner, new Date('2026-10-09T06:00:00Z'));
    expect(backup).toMatchObject({
      format: 'thiepn-recipe-local-backup',
      schemaVersion: 1, accountId: owner,
      exportedAt: '2026-10-09T06:00:00.000Z',
    });
    expect(backup.documents).toHaveLength(1);
    expect(backup.outbox).toHaveLength(1);
    expect(backup.metadata.map(row => row.key).sort())
      .toEqual(['meal-plan-v1', 'pantry-v1']);
    expect(serializeBackup(backup)).toContain('Device soup');
    expect(serializeBackup(backup)).not.toContain('secret');
  });
});

describe('P15D safe recipe conflict choices', () => {
  it('keeps the current device version and queues a new mutation based on cloud revision', async () => {
    const db = await fresh();
    const { record, first, remote, conflict } = recipeFixture();
    await db.commitMutation(record, first);
    await db.recordConflict({
      ...record, serverRevision: 2, syncState: 'conflict',
    }, { ...first, state: 'conflict' }, conflict);
    const api = { document: async () => remote } as unknown as Pick<RecipeCoreApi, 'document'>;
    await resolveRecipeConflictSafely(
      db, api, owner, conflict, 1, 'keep-local', () => newId, () => 220,
    );
    const result = await db.getDocument(owner, record.resourceId);
    expect(result?.working.version.title).toBe('Device soup');
    expect(result?.syncState).toBe('pending');
    expect(result?.serverRevision).toBe(2);
    expect((await db.listOutbox(owner)).map(item => item.mutationId)).toEqual([newId]);
    expect((await db.listOutbox(owner))[0]?.baseRevision).toBe(2);
    expect(await db.listConflicts(owner)).toHaveLength(0);
  });

  it('uses the verified cloud version only after deliberate choice', async () => {
    const db = await fresh();
    const { record, first, remote, conflict } = recipeFixture();
    await db.commitMutation(record, first);
    await db.recordConflict({
      ...record, syncState: 'conflict',
    }, { ...first, state: 'conflict' }, conflict);
    const api = { document: async () => remote } as unknown as Pick<RecipeCoreApi, 'document'>;
    await resolveRecipeConflictSafely(
      db, api, owner, conflict, 1, 'use-cloud', () => newId, () => 220,
    );
    const result = await db.getDocument(owner, record.resourceId);
    expect(result?.working.version.title).toBe('Cloud soup');
    expect(result?.syncState).toBe('synced');
    expect(await db.listOutbox(owner)).toHaveLength(0);
  });

  it('rejects stale cloud response without touching the local draft or outbox', async () => {
    const db = await fresh();
    const { record, first, remote, conflict } = recipeFixture();
    await db.commitMutation(record, first);
    await db.recordConflict({
      ...record, syncState: 'conflict',
    }, { ...first, state: 'conflict' }, conflict);
    const updated = {
      ...remote,
      recipe: { ...remote.recipe, revision: 3 },
    };
    const api = { document: async () => updated } as unknown as Pick<RecipeCoreApi, 'document'>;
    await expect(resolveRecipeConflictSafely(
      db, api, owner, conflict, 1, 'use-cloud',
    )).rejects.toThrow('cloud recipe has changed');
    expect((await db.getDocument(owner, record.resourceId))?.working.version.title)
      .toBe('Device soup');
    expect(await db.listOutbox(owner)).toHaveLength(1);
  });

  it('does not resolve an item while a mutation is already in flight', async () => {
    const db = await fresh();
    const { record, first, conflict, remote } = recipeFixture();
    await db.commitMutation(record, first);
    await db.recordConflict({ ...record, syncState: 'conflict' },
      { ...first, state: 'in_flight' }, conflict);
    const api = { document: async () => remote } as unknown as Pick<RecipeCoreApi, 'document'>;
    await expect(resolveRecipeConflictSafely(
      db, api, owner, conflict, 1, 'use-cloud',
    )).rejects.toThrow('still in progress');
    expect(await db.listOutbox(owner)).toHaveLength(1);
  });

  it('refuses resolution for a remote-not-found conflict', async () => {
    const db = await fresh();
    const { record, first, conflict, remote } = recipeFixture();
    const missing = { ...conflict, remote: null, remoteRevision: null };
    const api = { document: async () => remote } as unknown as Pick<RecipeCoreApi, 'document'>;
    await db.commitMutation(record, first);
    await expect(resolveRecipeConflictSafely(
      db, api, owner, missing, 1, 'use-cloud',
    )).rejects.toThrow('missing cloud recipes');
  });
});

describe('P15D collection and quarantined recovery', () => {
  it('safely keeps local collections if the remote collection revision is unchanged', async () => {
    const db = await fresh();
    const document = { schemaVersion: 1 as const, collections: [] };
    const current: LocalCollectionBookRecord = {
      accountId: owner, working: document, base: null,
      serverRevision: 1, localRevision: 1,
      syncState: 'pending', updatedAt: 100,
    };
    const mutation: CollectionOutboxMutation = {
      accountId: owner, mutationId: firstId, baseRevision: 1,
      document, state: 'pending', attempts: 0, createdAt: 100,
      lastAttemptAt: null, lastErrorCode: null,
    };
    const remote = { revision: 2, collections: [] } as unknown as RecipeCollectionBook;
    const conflict: CollectionConflictRecord = {
      id: conflictId, accountId: owner, mutationId: firstId,
      reason: 'revision', baseRevision: 1, remoteRevision: 2,
      base: null, local: document, remote, createdAt: 140,
    };
    await db.commitCollectionMutation(current, mutation);
    await db.recordCollectionConflict(
      { ...current, syncState: 'conflict' },
      { ...mutation, state: 'conflict' }, conflict,
    );
    const api = { collections: async () => remote } as unknown as Pick<RecipeCoreApi, 'collections'>;
    await resolveCollectionConflictSafely(
      db, api, owner, conflict, 1, 'keep-local', () => newId, () => 220,
    );
    expect((await db.getCollectionBook(owner))?.syncState).toBe('pending');
    expect((await db.listCollectionOutbox(owner)).map(row => row.mutationId)).toEqual([newId]);
    expect(await db.listCollectionConflicts(owner)).toHaveLength(0);
  });

  it('requeues the newest local recipe draft, dropping only rejected/unsent mutations', async () => {
    const db = await fresh();
    const { record, first, working } = recipeFixture();
    await db.commitMutation({ ...record, syncState: 'error' },
      { ...first, state: 'quarantined', lastErrorCode: 'INVALID_INPUT', attempts: 1 });
    const latest = {
      ...record, localRevision: 2, syncState: 'pending' as const,
      working: { ...working, version: { ...working.version, title: 'Corrected title' } },
    };
    await db.commitMutation(latest, {
      ...first, mutationId: newId, state: 'pending', document: latest.working,
      createdAt: 200,
    });
    const replacementId = '66666666-6666-4666-8666-666666666666';
    await db.repairQuarantinedRecipe(owner, record.resourceId, replacementId, 300);
    const outbox = await db.listOutbox(owner);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      mutationId: replacementId, state: 'pending', attempts: 0,
      operation: 'replace', baseRevision: 1,
    });
    expect(outbox[0]?.document?.version.title).toBe('Corrected title');
    expect((await db.getDocument(owner, record.resourceId))?.working.version.title)
      .toBe('Corrected title');
  });

  it('does not regenerate an in-flight rejected mutation', async () => {
    const db = await fresh();
    const { record, first } = recipeFixture();
    await db.commitMutation({ ...record, syncState: 'error' },
      { ...first, state: 'quarantined' });
    await db.putMutation({ ...first, mutationId: newId, state: 'in_flight' });
    await expect(db.repairQuarantinedRecipe(
      owner, record.resourceId, conflictId, 300,
    )).rejects.toThrow('Only blocked');
    expect(await db.listOutbox(owner)).toHaveLength(2);
  });

  it('requeues blocked collections with a new mutation id', async () => {
    const db = await fresh();
    const working = { schemaVersion: 1 as const, collections: [] };
    await db.commitCollectionMutation({
      accountId: owner, working, base: null, serverRevision: 1,
      localRevision: 1, syncState: 'error', updatedAt: 10,
    }, {
      accountId: owner, mutationId: firstId, baseRevision: 1,
      document: working, state: 'quarantined', attempts: 1,
      createdAt: 10, lastAttemptAt: 20, lastErrorCode: 'INVALID_INPUT',
    });
    await db.repairQuarantinedCollection(owner, newId, 30);
    expect((await db.listCollectionOutbox(owner)).map(row => row.mutationId))
      .toEqual([newId]);
    expect((await db.getCollectionBook(owner))?.syncState).toBe('pending');
  });
});
