import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  RecipeLocalDb,
  type CollectionOutboxMutation,
  type LocalCollectionBookRecord,
  type LocalRecipeRecord,
  type OutboxMutation,
} from '../src/data/local-db.ts';
import {
  type RecipeCollectionBook,
  type RecipeDocument,
  type RecipeEditableDocument,
} from '../src/api/protocol.ts';
import { createBlankRecipe } from '../src/library/create.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const mutationOne = '33333333-3333-4333-8333-333333333333';
const mutationTwo = '44444444-4444-4444-8444-444444444444';
const handles: RecipeLocalDb[] = [];
async function openDb(): Promise<RecipeLocalDb> {
  const db = await RecipeLocalDb.open(new IDBFactory());
  handles.push(db);
  return db;
}
afterEach(() => { for (const db of handles) db.close(); handles.length = 0; });

function recipeFixture(title = 'Soup') {
  const working = createBlankRecipe(title);
  const record: LocalRecipeRecord = {
    accountId: owner,
    resourceId: working.recipe.id,
    working,
    base: null,
    serverRevision: 0,
    localRevision: 1,
    syncState: 'pending',
    tombstone: false,
    updatedAt: 100,
  };
  const first: OutboxMutation = {
    accountId: owner,
    resourceId: working.recipe.id,
    mutationId: mutationOne,
    baseRevision: 0,
    operation: 'create',
    document: working,
    state: 'in_flight',
    attempts: 1,
    createdAt: 100,
    lastAttemptAt: 105,
    lastErrorCode: null,
  };
  return { record, first, working };
}
function editedWorking(working: RecipeEditableDocument, title: string) {
  return { ...working, version: { ...working.version, title } };
}
const remote = { recipe: { deletedAt: null } } as unknown as RecipeDocument;

describe('P15B atomic recipe sync recovery', () => {
  it('marks only an unchanged failed snapshot as an error', async () => {
    const db = await openDb();
    const { record, first } = recipeFixture();
    await db.commitMutation(record, first);
    await db.markRecipeSyncFailure(owner, record.resourceId, 1, 125);
    expect((await db.getDocument(owner, record.resourceId))?.syncState).toBe('error');

    const latest: LocalRecipeRecord = {
      ...record,
      working: editedWorking(record.working, 'Edited while offline'),
      localRevision: 2,
      syncState: 'pending',
      updatedAt: 150,
    };
    await db.putDocument(latest);
    await db.markRecipeSyncFailure(owner, record.resourceId, 1, 175);
    expect(await db.getDocument(owner, record.resourceId)).toEqual(latest);
  });

  it('acknowledges the first server save without deleting a later edit', async () => {
    const db = await openDb();
    const { record, first, working } = recipeFixture();
    await db.commitMutation(record, first);
    const newer = editedWorking(working, 'Second version');
    const second: OutboxMutation = {
      ...first,
      mutationId: mutationTwo,
      operation: 'replace',
      document: newer,
      createdAt: 125,
      lastAttemptAt: null,
      attempts: 0,
      state: 'pending',
    };
    await db.commitMutation({
      ...record, working: newer, localRevision: 2, updatedAt: 125,
    }, second);
    await db.settleRecipeMutation(owner, record.resourceId, mutationOne,
      remote, working, 1, 200);

    const saved = await db.getDocument(owner, record.resourceId);
    expect(saved?.working.version.title).toBe('Second version');
    expect(saved?.localRevision).toBe(2);
    expect(saved?.serverRevision).toBe(1);
    expect(saved?.syncState).toBe('pending');
    expect((await db.listOutbox(owner)).map(row => row.mutationId))
      .toEqual([mutationTwo]);
  });

  it('safely adopts canonical data after the last queued mutation succeeds', async () => {
    const db = await openDb();
    const { record, first, working } = recipeFixture();
    await db.commitMutation(record, first);
    await db.settleRecipeMutation(owner, record.resourceId, mutationOne,
      remote, working, 1, 200);
    expect(await db.countUnsynced(owner)).toBe(0);
    expect((await db.getDocument(owner, record.resourceId))?.syncState).toBe('synced');
    expect((await db.getDocument(owner, record.resourceId))?.serverRevision).toBe(1);
  });

  it('refuses a stale cloud page and does not advance the cursor', async () => {
    const db = await openDb();
    const { record, first, working } = recipeFixture();
    await db.commitMutation(record, first);
    const stale: LocalRecipeRecord = {
      ...record,
      working: editedWorking(working, 'Old cloud copy'),
      syncState: 'synced',
      localRevision: 0,
      serverRevision: 2,
    };
    await expect(db.applyPullPage(owner, [stale], [], 52))
      .rejects.toThrow('Local recipe changed');
    expect((await db.getDocument(owner, record.resourceId))?.working.version.title)
      .toBe('Soup');
    expect(await db.getMeta(owner, 'cursor')).toBeUndefined();
    expect(await db.countUnsynced(owner)).toBe(1);
  });
});

describe('P15B atomic collection recovery', () => {
  const editable = { schemaVersion: 1 as const, collections: [] };
  const remoteBook = { revision: 2, collections: [] } as unknown as RecipeCollectionBook;
  function collectionFixture() {
    const current: LocalCollectionBookRecord = {
      accountId: owner,
      working: editable,
      base: null,
      serverRevision: 0,
      localRevision: 1,
      syncState: 'pending',
      updatedAt: 10,
    };
    const first: CollectionOutboxMutation = {
      accountId: owner, mutationId: mutationOne, baseRevision: 0,
      document: editable, state: 'in_flight',
      attempts: 1, createdAt: 10, lastAttemptAt: 10, lastErrorCode: null,
    };
    return { current, first };
  }

  it('does not restore an old collection snapshot after request failure', async () => {
    const db = await openDb();
    const { current, first } = collectionFixture();
    await db.commitCollectionMutation(current, first);
    const changed = {
      ...current, localRevision: 2, syncState: 'pending' as const, updatedAt: 20,
    };
    await db.putCollectionBook(changed);
    await db.markCollectionSyncFailure(owner, 1, 30);
    expect(await db.getCollectionBook(owner)).toEqual(changed);
  });

  it('preserves later collection changes on acknowledgement', async () => {
    const db = await openDb();
    const { current, first } = collectionFixture();
    await db.commitCollectionMutation(current, first);
    await db.commitCollectionMutation({
      ...current, localRevision: 2, updatedAt: 20,
    }, {
      ...first, mutationId: mutationTwo, createdAt: 20, state: 'pending', attempts: 0,
    });
    await db.settleCollectionMutation(owner, mutationOne,
      remoteBook, editable, 2, 30);
    expect((await db.getCollectionBook(owner))?.localRevision).toBe(2);
    expect((await db.getCollectionBook(owner))?.syncState).toBe('pending');
    expect((await db.listCollectionOutbox(owner)).map(row => row.mutationId))
      .toEqual([mutationTwo]);
  });
});
