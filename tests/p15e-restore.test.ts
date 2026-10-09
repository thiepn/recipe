import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { RecipeLocalDb, type LocalRecipeRecord, type OutboxMutation } from '../src/data/local-db.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import { inspectBackupText } from '../src/recovery/backup-import.ts';
import { serializeBackup } from '../src/recovery/recovery.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const oldId = '33333333-3333-4333-8333-333333333333';
const newId = '44444444-4444-4444-8444-444444444444';
const opened: RecipeLocalDb[] = [];
async function db() {
  const result = await RecipeLocalDb.open(new IDBFactory());
  opened.push(result);
  return result;
}
afterEach(() => { for (const handle of opened) handle.close(); opened.length = 0; });

function draft() {
  const working = createBlankRecipe('Saved offline');
  const record: LocalRecipeRecord = {
    accountId: owner, resourceId: working.recipe.id,
    working, base: null, serverRevision: 0, localRevision: 1,
    syncState: 'pending', tombstone: false, updatedAt: 100,
  };
  const mutation: OutboxMutation = {
    mutationId: oldId, accountId: owner, resourceId: record.resourceId,
    baseRevision: 0, operation: 'create', document: working,
    state: 'retry', attempts: 2, createdAt: 100,
    lastAttemptAt: 150, lastErrorCode: 'OFFLINE',
  };
  return { working, record, mutation };
}
async function sourceBackup() {
  const source = await db();
  const { record, mutation } = draft();
  await source.commitMutation(record, mutation);
  await source.setMeta(owner, 'pantry-v1', {
    schemaVersion: 1, ingredients: ['rice'], assumeStaples: false,
  });
  await source.setMeta(owner, 'cursor', 111);
  await source.setMeta(owner, 'workspace-base-v1:plan:main', {
    revision: 8, document: { hidden: true },
  });
  return { source, record, backup: await source.exportAccountBackup(owner) };
}

describe('P15E guarded backup restore', () => {
  it('previews unsent drafts, excludes server cursors and cloud baselines', async () => {
    const { record, backup } = await sourceBackup();
    const preview = inspectBackupText(serializeBackup(backup), owner);
    expect(preview.candidate.documents.map(item => item.resourceId)).toEqual([record.resourceId]);
    expect(preview.candidate.metadata).toEqual([{
      key: 'pantry-v1',
      value: { schemaVersion: 1, ingredients: ['rice'], assumeStaples: false },
    }]);
    expect(preview.ignoredMetadata).toBe(2);
  });

  it('restores only missing local work with new mutation ids', async () => {
    const { backup, record } = await sourceBackup();
    const target = await db();
    const preview = inspectBackupText(serializeBackup(backup), owner);
    const result = await target.restoreMissingFromBackup(
      preview.candidate, () => newId, () => 250,
    );
    expect(result).toMatchObject({ recipes: 1, collections: 0, metadata: 1, skipped: 0 });
    expect((await target.getDocument(owner, record.resourceId))?.working.version.title)
      .toBe('Saved offline');
    expect((await target.listOutbox(owner)).map(row => row.mutationId)).toEqual([newId]);
    expect((await target.listOutbox(owner))[0]).toMatchObject({
      attempts: 0, baseRevision: 0, state: 'pending', operation: 'create',
    });
    expect(await target.getMeta(owner, 'cursor')).toBeUndefined();
    expect(await target.getMeta(owner, 'workspace-base-v1:plan:main')).toBeUndefined();
  });

  it('never overwrites existing recipes or metadata, even with older exported data', async () => {
    const { backup, record } = await sourceBackup();
    const target = await db();
    const existing = {
      ...record,
      working: {
        ...record.working,
        version: { ...record.working.version, title: 'New on this device' },
      },
      syncState: 'synced' as const, localRevision: 14, serverRevision: 11,
    };
    await target.putDocument(existing);
    await target.setMeta(owner, 'pantry-v1', {
      schemaVersion: 1, ingredients: ['onion'], assumeStaples: true,
    });
    const preview = inspectBackupText(serializeBackup(backup), owner);
    const result = await target.restoreMissingFromBackup(preview.candidate, () => newId);
    expect(result).toMatchObject({recipes:0,metadata:0,skipped:2});
    expect((await target.getDocument(owner, record.resourceId))?.working.version.title)
      .toBe('New on this device');
    expect((await target.getMeta<{ingredients:string[]}>(owner,'pantry-v1'))?.ingredients)
      .toEqual(['onion']);
    expect(await target.listOutbox(owner)).toHaveLength(0);
  });

  it('rejects different-account, mixed-account and invalid JSON without any writes', async () => {
    const { backup } = await sourceBackup();
    const target = await db();
    expect(() => inspectBackupText(serializeBackup(backup), other))
      .toThrow('different THIEPN account');
    const mixed = structuredClone(backup);
    mixed.metadata.push({accountId:other,key:'pantry-v1',value:{ingredients:['secret']}});
    expect(() => inspectBackupText(serializeBackup(mixed),owner))
      .toThrow('mixed account data');
    expect(() => inspectBackupText('{ broken',owner)).toThrow('not valid JSON');
    expect(await target.listDocuments(owner)).toHaveLength(0);
  });

  it('rejects a malformed recipe before any restore is offered', async () => {
    const { backup } = await sourceBackup();
    const tampered = structuredClone(backup);
    tampered.documents[0]!.working.version.title = '';
    expect(() => inspectBackupText(JSON.stringify(tampered), owner))
      .toThrow();
  });

  it('does not restore cloud-synced recipes as new pending creates', async () => {
    const { backup } = await sourceBackup();
    const safe = structuredClone(backup);
    safe.outbox = [];
    safe.documents[0]!.syncState = 'synced';
    const candidate = inspectBackupText(serializeBackup(safe),owner);
    expect(candidate.candidate.documents).toHaveLength(0);
    expect(candidate.skippedCloudSynced).toBe(1);
  });

  it('skips orphaned cooking sessions without recreating removed recipes', async () => {
    const { backup } = await sourceBackup();
    const working = backup.documents[0]!.working;
    const session = {
      schemaVersion: 1,
      recipeId: working.recipe.id,
      recipeVersionId: working.version.id,
      currentStepId: null, checkedIngredientIds: [], completedStepIds: [],
      servings: 2, timers: [], updatedAt: 20,
    };
    const onlySession = structuredClone(backup);
    onlySession.documents = [];
    onlySession.outbox = [];
    onlySession.metadata.push({
      accountId:owner, key:'kitchen-session-v1:'+working.recipe.id, value:session,
    });
    const preview = inspectBackupText(serializeBackup(onlySession),owner);
    const target = await db();
    const result = await target.restoreMissingFromBackup(preview.candidate);
    expect(result.skipped).toBe(1);
    expect(await target.getMeta(owner,'kitchen-session-v1:'+working.recipe.id)).toBeUndefined();
  });
});
