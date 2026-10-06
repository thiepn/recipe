import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  RecipeCoreApi,
  RecipeLocalDb,
  RecipeSyncEngine,
  recipeEditableDocumentSchema,
  type RecipeDocument,
  type RecipeEditableDocument,
} from '../src/index.ts';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const INGREDIENT_ID = '44444444-4444-4444-8444-444444444444';
const STEP_ID = '55555555-5555-4555-8555-555555555555';

function editable(title: string): RecipeEditableDocument {
  return recipeEditableDocumentSchema.parse({
    schemaVersion: 1,
    recipe: {
      id: RECIPE_ID,
      state: 'active',
      favorite: false,
      metadata: {},
    },
    version: {
      id: VERSION_ID,
      recipeId: RECIPE_ID,
      versionNumber: 1,
      kind: 'original',
      title,
      description: null,
      story: null,
      yieldText: '2 servings',
      servings: 2,
      servingUnit: 'servings',
      difficulty: 'easy',
      prepMinutes: 5,
      activeMinutes: 10,
      passiveMinutes: 0,
      restMinutes: 0,
      totalMinutes: 15,
      cuisineTags: [],
      categoryTags: [],
      dietaryTags: [],
      locale: 'en',
      authorNote: null,
      changeSummary: null,
      metadata: {},
    },
    ingredientGroups: [],
    ingredients: [
      {
        id: INGREDIENT_ID,
        recipeVersionId: VERSION_ID,
        groupId: null,
        position: 0,
        name: 'Water',
        quantity: 250,
        quantityMax: null,
        unit: 'ml',
        preparation: null,
        note: null,
        optional: false,
        scalingMode: 'linear',
        canonicalKey: 'water',
        metadata: {},
      },
    ],
    steps: [
      {
        id: STEP_ID,
        recipeVersionId: VERSION_ID,
        position: 0,
        title: null,
        instruction: 'Boil the water.',
        durationSecondsMin: 60,
        durationSecondsMax: null,
        timerLabel: 'Boil',
        temperatureC: 100,
        temperatureDisplay: '100 °C',
        heatLevel: 'high',
        visualCue: 'Rolling boil',
        donenessCue: null,
        techniqueKeys: [],
        isPassive: false,
        canParallelize: false,
        metadata: {},
      },
    ],
    stepIngredients: [
      {
        recipeVersionId: VERSION_ID,
        stepId: STEP_ID,
        ingredientId: INGREDIENT_ID,
        quantity: 250,
        unit: 'ml',
        note: null,
      },
    ],
    equipment: [],
    stepEquipment: [],
  });
}

function canonical(
  source: RecipeEditableDocument,
  revision: number,
  timestamp: string,
  deletedAt: string | null = null,
): RecipeDocument {
  return {
    schemaVersion: 1,
    recipe: {
      id: source.recipe.id,
      currentVersionId: source.version.id,
      state: deletedAt ? 'archived' : source.recipe.state,
      visibility: 'private',
      favorite: source.recipe.favorite,
      heroImagePath: null,
      lastCookedAt: null,
      archivedAt: deletedAt,
      deletedAt,
      revision,
      metadata: source.recipe.metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    version: {
      ...source.version,
      parentVersionId: null,
      revision: Math.max(0, revision - 1),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    sources: [],
    ingredientGroups: source.ingredientGroups,
    ingredients: source.ingredients,
    steps: source.steps,
    stepIngredients: source.stepIngredients,
    equipment: source.equipment,
    stepEquipment: source.stepEquipment,
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      ok: status >= 200 && status < 300,
      ...(status >= 200 && status < 300
        ? { data, meta: { requestId: 'test-request' } }
        : {
            error: {
              code: 'TEST_ERROR',
              message: 'Test error',
              requestId: 'test-request',
            },
          }),
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function fakeCore() {
  let remote: RecipeDocument | null = null;
  let cursor = 0;
  const changes: Array<{
    sequence: number;
    resourceId: string;
    revision: number;
    kind: 'upsert' | 'deleted';
    changedAt: string;
  }> = [];

  const timestamp = () => '2026-10-06T14:00:00+00:00';

  function commit(document: RecipeEditableDocument): RecipeDocument {
    const revision = (remote?.recipe.revision ?? 0) + 1;
    remote = canonical(document, revision, timestamp());
    cursor += 1;
    changes.push({
      sequence: cursor,
      resourceId: document.recipe.id,
      revision,
      kind: 'upsert',
      changedAt: timestamp(),
    });
    return remote;
  }

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    if (headers.get('Authorization') !== 'Bearer test-token')
      return response(null, 401);

    if (url.pathname === '/v1/recipe/manifest' && init?.method === 'GET') {
      return response({
        cursor,
        recipes: remote
          ? [
              {
                id: remote.recipe.id,
                revision: remote.recipe.revision,
                state: remote.recipe.state,
                favorite: remote.recipe.favorite,
                currentVersionId: remote.recipe.currentVersionId,
                title: remote.version.title,
                heroImagePath: remote.recipe.heroImagePath,
                deletedAt: remote.recipe.deletedAt,
                updatedAt: remote.recipe.updatedAt,
              },
            ]
          : [],
      });
    }

    if (url.pathname === '/v1/recipe/changes' && init?.method === 'GET') {
      const after = Number(url.searchParams.get('after') ?? '0');
      const page = changes.filter((change) => change.sequence > after);
      return response({
        changes: page,
        nextCursor: page.at(-1)?.sequence ?? after,
        hasMore: false,
      });
    }

    if (
      url.pathname === `/v1/recipe/documents/${RECIPE_ID}` &&
      init?.method === 'GET'
    ) {
      if (!remote) return response(null, 404);
      return response(remote);
    }

    if (url.pathname === '/v1/recipe/mutations' && init?.method === 'POST') {
      if (typeof init.body !== 'string') return response(null, 400);
      const payload = JSON.parse(init.body) as {
        mutations: Array<{
          mutationId: string;
          resourceId: string;
          baseRevision: number;
          operation: 'create' | 'replace' | 'delete';
          document: RecipeEditableDocument | null;
        }>;
      };

      const results = payload.mutations.map((mutation) => {
        if (mutation.operation === 'create') {
          if (remote)
            return {
              status: 'conflict' as const,
              reason: 'already_exists' as const,
              resourceId: mutation.resourceId,
              remoteRevision: remote.recipe.revision,
              remote,
            };
          if (!mutation.document) throw new Error('Missing test document');
          const committed = commit(mutation.document);
          return {
            status: 'applied' as const,
            resourceId: mutation.resourceId,
            revision: committed.recipe.revision,
            changeSequence: cursor,
          };
        }

        if (!remote)
          return {
            status: 'not_found' as const,
            resourceId: mutation.resourceId,
          };

        if (mutation.baseRevision !== remote.recipe.revision)
          return {
            status: 'conflict' as const,
            reason: remote.recipe.deletedAt ? ('deleted' as const) : ('revision' as const),
            resourceId: mutation.resourceId,
            remoteRevision: remote.recipe.revision,
            remote,
          };

        if (mutation.operation === 'replace') {
          if (!mutation.document) throw new Error('Missing test document');
          const committed = commit(mutation.document);
          return {
            status: 'applied' as const,
            resourceId: mutation.resourceId,
            revision: committed.recipe.revision,
            changeSequence: cursor,
          };
        }

        const revision = remote.recipe.revision + 1;
        cursor += 1;
        remote = canonical(
          editable(remote.version.title),
          revision,
          timestamp(),
          timestamp(),
        );
        changes.push({
          sequence: cursor,
          resourceId: mutation.resourceId,
          revision,
          kind: 'deleted',
          changedAt: timestamp(),
        });
        return {
          status: 'applied' as const,
          resourceId: mutation.resourceId,
          revision,
          changeSequence: cursor,
        };
      });

      return response({ results });
    }

    return response(null, 404);
  };

  return {
    fetchImpl,
    injectRemote(document: RecipeEditableDocument) {
      return commit(document);
    },
    current() {
      return remote;
    },
  };
}

const opened: RecipeLocalDb[] = [];
afterEach(() => {
  while (opened.length) opened.pop()?.close();
});

describe('Recipe P2', () => {
  it('rejects a document whose nested version belongs to another recipe', () => {
    const bad = {
      ...editable('Bad recipe'),
      version: {
        ...editable('Bad recipe').version,
        recipeId: '99999999-9999-4999-8999-999999999999',
      },
    };

    expect(recipeEditableDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('durably stores a local document and its outbox mutation together', async () => {
    const db = await RecipeLocalDb.open(indexedDB);
    opened.push(db);
    await db.wipeAccount(ACCOUNT_ID);

    const now = Date.now();
    const document = editable('Offline soup');

    await db.commitMutation(
      {
        accountId: ACCOUNT_ID,
        resourceId: RECIPE_ID,
        working: document,
        base: null,
        serverRevision: 0,
        localRevision: 1,
        syncState: 'pending',
        tombstone: false,
        updatedAt: now,
      },
      {
        mutationId: '66666666-6666-4666-8666-666666666666',
        accountId: ACCOUNT_ID,
        resourceId: RECIPE_ID,
        baseRevision: 0,
        operation: 'create',
        document,
        state: 'pending',
        attempts: 0,
        createdAt: now,
        lastAttemptAt: null,
        lastErrorCode: null,
      },
    );

    expect((await db.getDocument(ACCOUNT_ID, RECIPE_ID))?.working.version.title).toBe(
      'Offline soup',
    );
    expect(await db.countUnsynced(ACCOUNT_ID)).toBe(1);
  });

  it('syncs a local create, then preserves the local candidate on stale-revision conflict', async () => {
    const db = await RecipeLocalDb.open(indexedDB);
    opened.push(db);
    await db.wipeAccount(ACCOUNT_ID);

    const server = fakeCore();
    const api = new RecipeCoreApi({
      baseUrl: 'https://core.example',
      getAccessToken: () => 'test-token',
      fetch: server.fetchImpl,
    });

    const ids = [
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999',
    ];
    let idIndex = 0;
    const engine = new RecipeSyncEngine({
      accountId: ACCOUNT_ID,
      db,
      api,
      now: () => 1_760_000_000_000 + idIndex,
      randomUUID: () => ids[idIndex++] ?? crypto.randomUUID(),
    });

    await engine.stageCreate(editable('Original'));
    expect(await db.countUnsynced(ACCOUNT_ID)).toBe(1);

    await engine.syncOnce();

    const synced = await db.getDocument(ACCOUNT_ID, RECIPE_ID);
    expect(synced?.syncState).toBe('synced');
    expect(synced?.serverRevision).toBe(1);
    expect(await db.countUnsynced(ACCOUNT_ID)).toBe(0);
    expect(await db.getMeta<number>(ACCOUNT_ID, 'cursor')).toBe(1);

    await engine.stageReplace(editable('Local edit'));
    server.injectRemote(editable('Remote edit'));

    await engine.syncOnce();

    const conflicted = await db.getDocument(ACCOUNT_ID, RECIPE_ID);
    expect(conflicted?.syncState).toBe('conflict');
    expect(conflicted?.working.version.title).toBe('Local edit');
    expect(conflicted?.serverRevision).toBe(2);
    expect(await db.countUnsynced(ACCOUNT_ID)).toBe(1);

    const conflicts = await db.listConflicts(ACCOUNT_ID);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.local?.version.title).toBe('Local edit');
    expect(conflicts[0]?.remote?.version.title).toBe('Remote edit');
  });
});
