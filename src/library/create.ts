import {
  recipeEditableDocumentSchema,
  type RecipeEditableDocument,
} from '../api/protocol.ts';

export function createBlankRecipe(
  title: string,
  options: {
    locale?: string;
    randomUUID?: () => string;
  } = {},
): RecipeEditableDocument {
  const trimmed = title.trim();
  if (!trimmed) throw new TypeError('Recipe title is required');

  const randomUUID =
    options.randomUUID ??
    (() => {
      if (!globalThis.crypto?.randomUUID)
        throw new Error('crypto.randomUUID is unavailable');
      return globalThis.crypto.randomUUID();
    });

  const recipeId = randomUUID();
  const versionId = randomUUID();

  return recipeEditableDocumentSchema.parse({
    schemaVersion: 1,
    recipe: {
      id: recipeId,
      state: 'draft',
      favorite: false,
      metadata: {},
    },
    version: {
      id: versionId,
      recipeId,
      versionNumber: 1,
      kind: 'original',
      title: trimmed,
      description: null,
      story: null,
      yieldText: null,
      servings: null,
      servingUnit: null,
      difficulty: 'unknown',
      prepMinutes: null,
      activeMinutes: null,
      passiveMinutes: null,
      restMinutes: null,
      totalMinutes: null,
      cuisineTags: [],
      categoryTags: [],
      dietaryTags: [],
      locale: options.locale ?? null,
      authorNote: null,
      changeSummary: null,
      metadata: {},
    },
    ingredientGroups: [],
    ingredients: [],
    steps: [],
    stepIngredients: [],
    equipment: [],
    stepEquipment: [],
  });
}
