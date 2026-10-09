import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RecipeLocalDb } from '../src/data/local-db.ts';
import { signOutRecipe, UnsyncedWorkspaceError } from '../src/auth/account.ts';
import { assignMeal, emptyMealPlanner } from '../src/planning/model.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import { createKitchenSession, kitchenSessionStoreFor } from '../src/kitchen/session.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const recipeId = '22222222-2222-4222-8222-222222222222';
const openHandles: RecipeLocalDb[] = [];
async function freshDb() {
  const db = await RecipeLocalDb.open(new IDBFactory());
  openHandles.push(db);
  return db;
}
afterEach(() => { for (const db of openHandles) db.close(); openHandles.length = 0; });

describe('P14 account sign-out data-loss guard', () => {
  it('detects pantry and device-only meal data and refuses to wipe them silently', async () => {
    const db = await freshDb();
    await db.setMeta(owner, 'pantry-v1', { schemaVersion: 1, ingredients: ['rice'], assumeStaples: false });
    const plan = assignMeal(emptyMealPlanner(100), '2026-10-09', 'dinner', recipeId, 2, 200);
    await db.setMeta(owner, 'meal-plan-v1', plan);
    expect(await db.countUnsyncedWorkspace(owner)).toBe(2);
    const fakeAuth = {} as SupabaseClient;
    await expect(signOutRecipe(fakeAuth, db, owner)).rejects.toBeInstanceOf(UnsyncedWorkspaceError);
    expect(await db.getMeta(owner, 'meal-plan-v1')).toEqual(plan);
    expect(await db.getMeta(owner, 'pantry-v1')).toBeDefined();
  });

  it('does not flag empty plans or already acknowledged planner documents', async () => {
    const db = await freshDb();
    await db.setMeta(owner, 'meal-plan-v1', emptyMealPlanner(100));
    expect(await db.countUnsyncedWorkspace(owner)).toBe(0);
    const plan = assignMeal(emptyMealPlanner(100), '2026-10-09', 'dinner', recipeId, 3, 200);
    await db.setMeta(owner, 'meal-plan-v1', plan);
    await db.setMeta(owner, 'workspace-base-v1:plan:main', {
      revision: 1, document: { updatedAt: plan.updatedAt, purchased: [], manualItems: [],
        entries: [...plan.entries], schemaVersion: 1 },
    });
    expect(await db.countUnsyncedWorkspace(owner)).toBe(0);
    await db.setMeta(owner, 'meal-plan-v1', { ...plan, updatedAt: 300 });
    expect(await db.countUnsyncedWorkspace(owner)).toBe(1);
  });

  it('detects unsynced cooking sessions and session tombstones', async () => {
    const db = await freshDb();
    const document = createBlankRecipe('Rice');
    const session = createKitchenSession(document, 100);
    const key = 'kitchen-session-v1:' + document.recipe.id;
    const baseKey = 'workspace-base-v1:session:' + document.recipe.id;
    await kitchenSessionStoreFor(db, owner).save(session);
    expect(await db.countUnsyncedWorkspace(owner)).toBe(1);
    await db.setMeta(owner, baseKey, { revision: 1, document: session });
    expect(await db.countUnsyncedWorkspace(owner)).toBe(0);
    await db.setMeta(owner, key, null);
    expect(await db.countUnsyncedWorkspace(owner)).toBe(1);
  });

  it('never clears the local cache when authentication sign-out fails', async () => {
    const db = await freshDb();
    const pantry = { schemaVersion: 1, ingredients: ['carrots'], assumeStaples: false };
    await db.setMeta(owner, 'pantry-v1', pantry);
    const auth = {
      auth: { signOut: async () => ({ error: new Error('provider unavailable') }) },
    } as unknown as SupabaseClient;

    await expect(signOutRecipe(auth, db, owner, { discardLocalWorkspace: true }))
      .rejects.toThrow('provider unavailable');
    expect(await db.getMeta(owner, 'pantry-v1')).toEqual(pantry);
  });

  it('requires a deliberate opt-in before wiping device-only work on sign-out', async () => {
    const db = await freshDb();
    await db.setMeta(owner, 'pantry-v1', { schemaVersion: 1, ingredients: ['potato'], assumeStaples: false });
    let signedOut = false;
    const auth = { auth: { signOut: async () => { signedOut = true; return { error: null }; } } } as unknown as SupabaseClient;
    await signOutRecipe(auth, db, owner, { discardLocalWorkspace: true });
    expect(signedOut).toBe(true);
    expect(await db.getMeta(owner, 'pantry-v1')).toBeUndefined();
  });
});
