import { describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { RecipeLocalDb, createBlankRecipe, type LocalRecipeRecord } from '../src/index.ts';
import {
  EMPTY_PANTRY,
  addIngredients,
  cleanPantry,
  evaluateRecipe,
  ingredientKey,
  ingredientSuggestions,
  rankByPantry,
  removeIngredient,
} from '../src/library/ingredients.ts';
import { recipeCardFromLocal } from '../src/library/model.ts';

function fixture(
  title: string,
  ingredients: Array<{ name: string; optional?: boolean; canonicalKey?: string; quantity?: number }>,
  updatedAt = 1,
): LocalRecipeRecord {
  const document = createBlankRecipe(title);
  return {
    accountId: '11111111-1111-4111-8111-111111111111',
    resourceId: document.recipe.id,
    working: {
      ...document,
      ingredients: ingredients.map((item, index) => ({
        id: crypto.randomUUID(),
        recipeVersionId: document.version.id,
        groupId: null,
        position: index,
        name: item.name,
        quantity: item.quantity ?? null,
        quantityMax: null,
        unit: null,
        preparation: null,
        note: null,
        optional: item.optional ?? false,
        scalingMode: 'linear' as const,
        canonicalKey: item.canonicalKey ?? null,
        metadata: {},
      })),
    },
    base: null,
    serverRevision: 1,
    localRevision: 0,
    syncState: 'synced',
    tombstone: false,
    updatedAt,
  };
}

describe('P5 deterministic ingredient matching', () => {
  it('normalizes known English/German equivalents, case and diacritics', () => {
    expect(ingredientKey('  TOMATEN  ')).toBe(ingredientKey('tomatoes'));
    expect(ingredientKey('Hähnchenbrust')).toBe(ingredientKey('chicken breast'));
    expect(ingredientKey('OLIVENÖL')).toBe(ingredientKey('olive oil'));
    expect(ingredientKey('Eier')).toBe(ingredientKey('eggs'));
  });

  it('does not invent substitutions from token overlap or related ingredients', () => {
    expect(ingredientKey('rice')).not.toBe(ingredientKey('rice vinegar'));
    expect(ingredientKey('chicken')).not.toBe(ingredientKey('chicken breast'));
    expect(ingredientKey('milk')).not.toBe(ingredientKey('oat milk'));
    expect(ingredientKey('olive oil')).not.toBe(ingredientKey('vegetable oil'));
  });

  it('keeps pantry values bounded, unique and safe when hydrating malformed data', () => {
    const restored = cleanPantry({
      ingredients: [' Egg ', 'EIER', 'rice', 33, '', ' '.repeat(5), 'x'.repeat(110)],
      assumeStaples: 'true',
    });
    expect(restored.ingredients).toEqual(['Egg', 'rice']);
    expect(restored.assumeStaples).toBe(false);
    expect(cleanPantry(null).ingredients).toEqual([]);
  });

  it('accepts pasted ingredient lists and removes aliases as one item', () => {
    const first = addIngredients(EMPTY_PANTRY, 'rice, egg; Reis\nchicken');
    expect(first.ingredients).toEqual(['rice', 'egg', 'chicken']);
    expect(removeIngredient(first, 'Eier').ingredients).toEqual(['rice', 'chicken']);
  });

  it('separates required, duplicate and optional ingredients', () => {
    const recipe = fixture('Egg fried rice', [
      { name: 'rice', quantity: 100 },
      { name: 'Reis', quantity: 200 },
      { name: 'eggs', quantity: 3 },
      { name: 'scallions', optional: true },
    ]);
    const coverage = evaluateRecipe(recipe, addIngredients(EMPTY_PANTRY, 'rice'));
    expect(coverage).toMatchObject({
      status: 'measured', required: 2, available: 1,
      missing: ['eggs'], optional: 1, percent: 50,
    });
  });

  it('does not silently include staples; assumptions are opt-in and disclosed', () => {
    const recipe = fixture('Simple rice', [
      { name: 'rice' }, { name: 'salt' }, { name: 'water' },
    ]);
    const pantry = addIngredients(EMPTY_PANTRY, 'rice');
    expect(evaluateRecipe(recipe, pantry).missing).toEqual(['salt', 'water']);
    const assumed = evaluateRecipe(recipe, { ...pantry, assumeStaples: true });
    expect(assumed.missing).toEqual([]);
    expect(assumed.assumed).toEqual(['salt', 'water']);
  });

  it('uses known canonical ingredient keys for descriptive recipe names', () => {
    const recipe = fixture('Tomato soup', [
      { name: 'Two ripe tomatoes, chopped', canonicalKey: 'tomato' },
    ]);
    expect(evaluateRecipe(recipe, addIngredients(EMPTY_PANTRY, 'Tomaten')).available).toBe(1);
  });

  it('does not confuse an empty ingredient list with a complete match', () => {
    const recipe = fixture('Unfinished', [{ name: 'parsley', optional: true }]);
    expect(evaluateRecipe(recipe, EMPTY_PANTRY)).toMatchObject({
      status: 'unknown', required: 0, available: 0, percent: null,
    });
  });

  it('never claims quantity sufficiency from an ingredient-type match', () => {
    const recipe = fixture('Omelette', [{ name: 'eggs', quantity: 8 }]);
    const result = evaluateRecipe(recipe, addIngredients(EMPTY_PANTRY, 'egg'));
    expect(result).toMatchObject({ available: 1, required: 1, missing: [] });
    expect(result).not.toHaveProperty('readyToCook');
  });

  it('ranks by missing count and excludes unknowns from limited-missing filters', () => {
    const perfect = fixture('Perfect', [{ name: 'egg' }, { name: 'rice' }]);
    const partial = fixture('Partial', [{ name: 'egg' }, { name: 'tofu' }]);
    const unknown = fixture('Draft', []);
    const records = [unknown, partial, perfect];
    const cards = records.map(recipeCardFromLocal);
    const pantry = addIngredients(EMPTY_PANTRY, 'rice,egg');
    expect(rankByPantry(cards, records, pantry, { maxMissing: 'any', sortByMatch: true })
      .map(({ card }) => card.title)).toEqual(['Perfect', 'Partial', 'Draft']);
    expect(rankByPantry(cards, records, pantry, { maxMissing: 0, sortByMatch: true })
      .map(({ card }) => card.title)).toEqual(['Perfect']);
    expect(rankByPantry(cards, records, pantry, { maxMissing: 1, sortByMatch: true })
      .map(({ card }) => card.title)).toEqual(['Perfect', 'Partial']);
  });

  it('preserves normal ordering and never hides recipes without a selected pantry', () => {
    const a = fixture('A', [{ name: 'egg' }]);
    const b = fixture('B', []);
    const records = [b, a];
    const cards = records.map(recipeCardFromLocal);
    expect(rankByPantry(cards, records, EMPTY_PANTRY, { maxMissing: 0, sortByMatch: true })
      .map(({ card }) => card.title)).toEqual(['B', 'A']);
    expect(rankByPantry(cards, records, addIngredients(EMPTY_PANTRY, 'rice'), {
      maxMissing: 'any', sortByMatch: false,
    }).map(({ card }) => card.title)).toEqual(['B', 'A']);
  });

  it('deduplicates cookbook suggestions by ingredient equivalence', () => {
    const records = [
      fixture('One', [{ name: 'Egg' }, { name: 'rice' }]),
      fixture('Two', [{ name: 'Eier' }, { name: 'tofu' }]),
      fixture('Archived', [{ name: 'butter' }]),
    ];
    records[2]!.working.recipe.state = 'archived';
    expect(ingredientSuggestions(records, '', [])).toEqual(['Egg', 'rice', 'tofu']);
    expect(ingredientSuggestions(records, 'ei', [])).toEqual(['Egg']);
    expect(ingredientSuggestions(records, '', ['eggs'])).not.toContain('Egg');
  });
});

describe('P5 account-scoped pantry persistence', () => {
  it('isolates saved pantry metadata by account without changing the DB version', async () => {
    const db = await RecipeLocalDb.open(indexedDB);
    const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const pantry = addIngredients(EMPTY_PANTRY, 'rice,egg');
    try {
      await db.setMeta(a, 'pantry-v1', pantry);
      expect(await db.getMeta(a, 'pantry-v1')).toEqual(pantry);
      expect(await db.getMeta(b, 'pantry-v1')).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
