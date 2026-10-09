import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { RecipeLocalDb, type OutboxMutation, type CollectionOutboxMutation } from '../src/data/local-db.ts';
import {
  describeSyncHealth,
  EMPTY_SYNC_HEALTH,
  readSyncHealth,
  summarizeSyncHealth,
} from '../src/sync/health.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const dbs: RecipeLocalDb[] = [];
async function freshDb() {
  const db = await RecipeLocalDb.open(new IDBFactory());
  dbs.push(db);
  return db;
}
afterEach(() => { for (const db of dbs) db.close(); dbs.length = 0; });

describe('P15C reliable sync indicator', () => {
  it('never calls a queued or interrupted upload cloud-synced', () => {
    const queued = summarizeSyncHealth(['pending', 'in_flight', 'retry'], 0);
    expect(queued).toMatchObject({ queued: 2, retrying: 1, total: 3 });
    expect(describeSyncHealth(queued, {
      online: true, syncing: false, attempt: 'succeeded',
    })).toMatchObject({ kind: 'retrying', showBanner: true, canRetry: true });
  });

  it('prioritizes unsolved conflicts and non-retryable failures', () => {
    const health = summarizeSyncHealth(['quarantined', 'pending', 'conflict'], 2);
    expect(health).toMatchObject({ blocked: 2, conflicts: 2, total: 3 });
    expect(describeSyncHealth(health, {
      online: true, syncing: false, attempt: 'succeeded',
    })).toMatchObject({ kind: 'blocked', showBanner: true });
    expect(describeSyncHealth(summarizeSyncHealth([], 2), {
      online: true, syncing: false, attempt: 'succeeded',
    })).toMatchObject({ kind: 'conflict', canRetry: false });
  });

  it('offers no inactive online retry button while offline or syncing', () => {
    const health = summarizeSyncHealth(['retry'], 0);
    expect(describeSyncHealth(health, {
      online: false, syncing: false, attempt: 'failed',
    })).toMatchObject({ kind: 'offline', canRetry: false });
    expect(describeSyncHealth(health, {
      online: true, syncing: true, attempt: 'failed',
    })).toMatchObject({ kind: 'syncing', canRetry: false });
  });

  it('does not claim cloud verification until a check succeeds', () => {
    const idle = describeSyncHealth(EMPTY_SYNC_HEALTH, {
      online: true, syncing: false, attempt: 'idle',
    });
    expect(idle).toMatchObject({ kind: 'saved', title: 'Saved on this device' });
    const confirmed = describeSyncHealth(EMPTY_SYNC_HEALTH, {
      online: true, syncing: false, attempt: 'succeeded',
    });
    expect(confirmed).toMatchObject({ kind: 'saved', title: 'Cookbook up to date' });
    expect(describeSyncHealth(EMPTY_SYNC_HEALTH, {
      online: true, syncing: false, attempt: 'failed',
    })).toMatchObject({ kind: 'unavailable', canRetry: true, showBanner: true });
  });

  it('derives actual pending, retrying and blocked totals from both durable queues', async () => {
    const db = await freshDb();
    const recipe: OutboxMutation = {
      mutationId: '22222222-2222-4222-8222-222222222222',
      accountId: owner, resourceId: '33333333-3333-4333-8333-333333333333',
      baseRevision: 1, operation: 'delete', document: null,
      state: 'retry', attempts: 2, createdAt: 5, lastAttemptAt: 6,
      lastErrorCode: 'NETWORK_ERROR',
    };
    const collection: CollectionOutboxMutation = {
      mutationId: '44444444-4444-4444-8444-444444444444',
      accountId: owner, baseRevision: 2,
      document: { schemaVersion: 1, collections: [] },
      state: 'quarantined', attempts: 1, createdAt: 9, lastAttemptAt: 10,
      lastErrorCode: 'INVALID_INPUT',
    };
    await db.putMutation(recipe);
    await db.putCollectionMutation(collection);
    expect(await readSyncHealth(db, owner)).toMatchObject({
      queued: 0, retrying: 1, blocked: 1, conflicts: 0, total: 2,
    });
    expect(await readSyncHealth(db, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
      .toEqual(EMPTY_SYNC_HEALTH);
  });
});
