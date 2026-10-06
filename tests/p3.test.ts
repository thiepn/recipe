import { describe, expect, it } from 'vitest';
import {
  EMPTY_COLLECTION_BOOK,
  createBlankRecipe,
  createCollection,
  filterRecipes,
  removeCollection,
  renameCollection,
  setRecipeInCollection,
  type LocalRecipeRecord,
  type RecipeLibraryFilters,
} from '../src/index.ts';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function localRecipe(
  id: string,
  title: string,
  options: {
    favorite?: boolean;
    totalMinutes?: number | null;
    difficulty?: 'unknown' | 'easy' | 'medium' | 'hard';
    tags?: string[];
    ingredients?: string[];
    updatedAt?: number;
  } = {},
): LocalRecipeRecord {
  const doc = createBlankRecipe(title, {
    locale: 'en',
    randomUUID: (() => {
      const values = [
        id,
        id.replace(/^./, id[0] === '2' ? '3' : '2'),
      ];
      return () => values.shift() ?? crypto.randomUUID();
    })(),
  });

  return {
    accountId: ACCOUNT,
    resourceId: id,
    working: {
      ...doc,
      recipe: { ...doc.recipe, favorite: options.favorite ?? false },
      version: {
        ...doc.version,
        totalMinutes: options.totalMinutes ?? null,
        difficulty: options.difficulty ?? 'unknown',
        categoryTags: options.tags ?? [],
      },
      ingredients: (options.ingredients ?? []).map((name, index) => ({
        id: `${index + 4}4444444-4444-4444-8444-44444444444${index}`.slice(0, 36),
        recipeVersionId: doc.version.id,
        groupId: null,
        position: index,
        name,
        quantity: null,
        quantityMax: null,
        unit: null,
        preparation: null,
        note: null,
        optional: false,
        scalingMode: 'linear' as const,
        canonicalKey: null,
        metadata: {},
      })),
    },
    base: null,
    serverRevision: 1,
    localRevision: 0,
    syncState: 'synced',
    tombstone: false,
    updatedAt: options.updatedAt ?? 1,
  };
}

const defaults: RecipeLibraryFilters = {
  query: '',
  favoritesOnly: false,
  underThirtyMinutes: false,
  difficulty: 'all',
  collectionId: null,
  sort: 'recent',
};

describe('Recipe P3 library', () => {
  it('creates a private blank draft with stable recipe/version identity', () => {
    const ids = [
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const doc = createBlankRecipe('  Mom\'s soup  ', {
      locale: 'de-DE',
      randomUUID: () => ids.shift()!,
    });

    expect(doc.recipe.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(doc.version.recipeId).toBe(doc.recipe.id);
    expect(doc.version.id).toBe('33333333-3333-4333-8333-333333333333');
    expect(doc.version.title).toBe("Mom's soup");
    expect(doc.recipe.state).toBe('draft');
  });

  it('searches across title, tags and ingredients and keeps relevance first', () => {
    const recipes = [
      localRecipe('22222222-2222-4222-8222-222222222222', 'Kimchi jjigae', {
        tags: ['Korean'],
        ingredients: ['kimchi', 'tofu'],
        updatedAt: 1,
      }),
      localRecipe('33333333-3333-4333-8333-333333333333', 'Tofu bowl', {
        tags: ['quick'],
        ingredients: ['tofu', 'rice'],
        updatedAt: 3,
      }),
      localRecipe('44444444-4444-4444-8444-444444444444', 'Pasta', {
        ingredients: ['tomato'],
        updatedAt: 5,
      }),
    ];

    expect(
      filterRecipes(recipes, undefined, { ...defaults, query: 'kimchi' }).map(
        (recipe) => recipe.title,
      ),
    ).toEqual(['Kimchi jjigae']);

    expect(
      filterRecipes(recipes, undefined, { ...defaults, query: 'tofu' }).map(
        (recipe) => recipe.title,
      ),
    ).toEqual(['Tofu bowl', 'Kimchi jjigae']);
  });

  it('filters favorites, time and collections without mutating source records', () => {
    const quickId = '22222222-2222-4222-8222-222222222222';
    const slowId = '33333333-3333-4333-8333-333333333333';
    const recipes = [
      localRecipe(quickId, 'Quick soup', {
        favorite: true,
        totalMinutes: 20,
        difficulty: 'easy',
      }),
      localRecipe(slowId, 'Slow stew', {
        favorite: false,
        totalMinutes: 120,
        difficulty: 'hard',
      }),
    ];

    const collectionId = '55555555-5555-4555-8555-555555555555';
    const collectionRecord = {
      accountId: ACCOUNT,
      working: {
        schemaVersion: 1 as const,
        collections: [
          {
            id: collectionId,
            kind: 'manual' as const,
            name: 'Weeknight',
            description: null,
            iconKey: null,
            coverImagePath: null,
            position: 0,
            metadata: {},
            recipeIds: [quickId],
          },
        ],
      },
      base: null,
      serverRevision: 0,
      localRevision: 1,
      syncState: 'pending' as const,
      updatedAt: 1,
    };

    expect(
      filterRecipes(recipes, collectionRecord, {
        ...defaults,
        favoritesOnly: true,
        underThirtyMinutes: true,
        difficulty: 'easy',
        collectionId,
      }).map((recipe) => recipe.id),
    ).toEqual([quickId]);

    expect(recipes).toHaveLength(2);
  });

  it('creates, renames, assigns and removes manual collections immutably', () => {
    const collectionId = '55555555-5555-4555-8555-555555555555';
    const recipeId = '22222222-2222-4222-8222-222222222222';

    const created = createCollection(EMPTY_COLLECTION_BOOK, ' Family ', {
      randomUUID: () => collectionId,
    });
    expect(created.collections[0]?.name).toBe('Family');

    const renamed = renameCollection(created, collectionId, 'Mom');
    expect(renamed.collections[0]?.name).toBe('Mom');
    expect(created.collections[0]?.name).toBe('Family');

    const assigned = setRecipeInCollection(
      renamed,
      collectionId,
      recipeId,
      true,
    );
    expect(assigned.collections[0]?.recipeIds).toEqual([recipeId]);

    const removed = removeCollection(assigned, collectionId);
    expect(removed.collections).toEqual([]);
  });
});
