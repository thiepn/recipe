import type { LocalRecipeRecord } from '../data/local-db.ts';
import type { RecipeCardModel } from './model.ts';

/**
 * Ingredient-type availability, not quantity, safety, or substitution advice.
 * Alias groups are deliberately narrow: different ingredients are never
 * treated as interchangeable merely because they are often substituted.
 */
const ALIAS_GROUPS: Record<string, readonly string[]> = {
  egg: ['egg', 'eggs', 'ei', 'eier'],
  rice: ['rice', 'reis'],
  onion: ['onion', 'onions', 'zwiebel', 'zwiebeln'],
  garlic: ['garlic', 'knoblauch'],
  tomato: ['tomato', 'tomatoes', 'tomate', 'tomaten'],
  potato: ['potato', 'potatoes', 'kartoffel', 'kartoffeln'],
  carrot: ['carrot', 'carrots', 'karotte', 'karotten', 'mohre', 'mohren'],
  milk: ['milk', 'milch'],
  butter: ['butter'],
  flour: ['flour', 'mehl', 'wheat flour', 'weizenmehl'],
  sugar: ['sugar', 'zucker'],
  salt: ['salt', 'salz'],
  water: ['water', 'wasser'],
  'black pepper': ['black pepper', 'schwarzer pfeffer', 'schwarzen pfeffer', 'schwarze pfeffer'],
  'olive oil': ['olive oil', 'olivenol'],
  'vegetable oil': ['vegetable oil', 'pflanzenol'],
  'soy sauce': ['soy sauce', 'sojasauce', 'soja sauce'],
  'sesame oil': ['sesame oil', 'sesamol'],
  'sesame seeds': ['sesame seeds', 'sesame seed', 'sesam', 'sesamsamen'],
  chicken: ['chicken', 'hahnchen', 'huhn', 'huhnerfleisch', 'chicken meat'],
  'chicken breast': ['chicken breast', 'chicken breasts', 'hahnchenbrust', 'huhnerbrust'],
  beef: ['beef', 'rindfleisch'],
  tofu: ['tofu'],
  ginger: ['ginger', 'ingwer'],
  mushrooms: ['mushrooms', 'mushroom', 'pilz', 'pilze', 'champignon', 'champignons'],
  spinach: ['spinach', 'spinat'],
  cucumber: ['cucumber', 'cucumbers', 'gurke', 'gurken'],
  lemon: ['lemon', 'lemons', 'zitrone', 'zitronen'],
  lime: ['lime', 'limes', 'limette', 'limetten'],
  cheese: ['cheese', 'kase'],
  pasta: ['pasta', 'nudeln'],
  bread: ['bread', 'brot'],
  kimchi: ['kimchi'],
  gochujang: ['gochujang'],
  vinegar: ['vinegar', 'essig'],
};

const STAPLE_KEYS = new Set(['salt', 'water', 'black pepper']);
const MAX_ITEMS = 80;
const MAX_NAME = 100;

export interface PantryDocument {
  schemaVersion: 1;
  ingredients: string[];
  assumeStaples: boolean;
}

export interface RecipeCoverage {
  status: 'unknown' | 'measured';
  required: number;
  available: number;
  missing: string[];
  assumed: string[];
  optional: number;
  percent: number | null;
}

export interface RankedRecipe {
  card: RecipeCardModel;
  coverage: RecipeCoverage;
}

export type MissingLimit = 'any' | 0 | 1 | 2;

export const EMPTY_PANTRY: PantryDocument = {
  schemaVersion: 1,
  ingredients: [],
  assumeStaples: false,
};

export function normalizeIngredientText(value: string): string {
  return value.normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ß/g, 'ss')
    .toLocaleLowerCase('en')
    .replace(/['’]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const aliasLookup = new Map<string, string>();
for (const [key, names] of Object.entries(ALIAS_GROUPS)) {
  for (const name of names) aliasLookup.set(normalizeIngredientText(name), key);
}

export function ingredientKey(value: string): string {
  const normalized = normalizeIngredientText(value);
  return aliasLookup.get(normalized) ?? `exact:${normalized}`;
}

function validName(value: unknown): value is string {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_NAME &&
    normalizeIngredientText(value).length > 0;
}

export function cleanPantry(input: unknown): PantryDocument {
  if (!input || typeof input !== 'object') return { ...EMPTY_PANTRY, ingredients: [] };
  const value = input as Record<string, unknown>;
  const seen = new Set<string>();
  const ingredients: string[] = [];
  if (Array.isArray(value.ingredients)) {
    for (const entry of value.ingredients) {
      if (!validName(entry)) continue;
      const label = entry.trim().replace(/\s+/g, ' ');
      const key = ingredientKey(label);
      if (seen.has(key)) continue;
      seen.add(key);
      ingredients.push(label);
      if (ingredients.length === MAX_ITEMS) break;
    }
  }
  return {
    schemaVersion: 1,
    ingredients,
    assumeStaples: value.assumeStaples === true,
  };
}

export function addIngredients(pantry: PantryDocument, raw: string): PantryDocument {
  const candidates = raw.split(/[,;\n]+/).map((name) => name.trim());
  return cleanPantry({
    ...pantry,
    ingredients: [...pantry.ingredients, ...candidates],
  });
}

export function removeIngredient(pantry: PantryDocument, name: string): PantryDocument {
  const key = ingredientKey(name);
  return {
    ...pantry,
    ingredients: pantry.ingredients.filter((entry) => ingredientKey(entry) !== key),
  };
}

function recipeIngredientKey(ingredient: {
  name: string;
  canonicalKey: string | null;
}): string {
  // A common-name canonical key can supply better equivalence where the raw
  // recipe name is descriptive. Opaque database identifiers are not inferred.
  const canonical = ingredient.canonicalKey;
  if (canonical && normalizeIngredientText(canonical)) {
    const canonicalKey = ingredientKey(canonical);
    if (!canonicalKey.startsWith('exact:')) return canonicalKey;
  }
  return ingredientKey(ingredient.name);
}

export function evaluateRecipe(
  record: LocalRecipeRecord,
  pantry: PantryDocument,
): RecipeCoverage {
  const owned = new Set(pantry.ingredients.map(ingredientKey));
  const required = new Map<string, string>();
  const optional = new Set<string>();

  for (const ingredient of record.working.ingredients) {
    const key = recipeIngredientKey(ingredient);
    if (key === 'exact:') continue;
    if (ingredient.optional) {
      optional.add(key);
    } else if (!required.has(key)) {
      required.set(key, ingredient.name);
    }
  }

  if (required.size === 0) {
    return {
      status: 'unknown',
      required: 0,
      available: 0,
      missing: [],
      assumed: [],
      optional: optional.size,
      percent: null,
    };
  }

  const missing: string[] = [];
  const assumed: string[] = [];
  let available = 0;
  for (const [key, name] of required) {
    if (owned.has(key)) {
      available += 1;
    } else if (pantry.assumeStaples && STAPLE_KEYS.has(key)) {
      available += 1;
      assumed.push(name);
    } else {
      missing.push(name);
    }
  }

  return {
    status: 'measured',
    required: required.size,
    available,
    missing,
    assumed,
    optional: [...optional].filter((key) => !required.has(key)).length,
    percent: Math.round((available / required.size) * 100),
  };
}

/** Filters and ranks an already filtered recipe library; stable ties keep P4 sorting. */
export function rankByPantry(
  cards: readonly RecipeCardModel[],
  records: readonly LocalRecipeRecord[],
  pantry: PantryDocument,
  options: { maxMissing: MissingLimit; sortByMatch: boolean },
): RankedRecipe[] {
  const byId = new Map(records.map((record) => [record.resourceId, record]));
  const active = pantry.ingredients.length > 0;
  const ranked = cards.flatMap((card) => {
    const record = byId.get(card.id);
    return record ? [{ card, coverage: evaluateRecipe(record, pantry) }] : [];
  });
  const maxMissing = options.maxMissing;
  const filtered = active && typeof maxMissing === 'number'
    ? ranked.filter(({ coverage }) =>
      coverage.status === 'measured' && coverage.missing.length <= maxMissing,
    )
    : ranked;
  if (!active || !options.sortByMatch) return filtered;
  return filtered.sort((a, b) => {
    if (a.coverage.status !== b.coverage.status)
      return a.coverage.status === 'measured' ? -1 : 1;
    if (a.coverage.missing.length !== b.coverage.missing.length)
      return a.coverage.missing.length - b.coverage.missing.length;
    if (a.coverage.percent !== b.coverage.percent)
      return (b.coverage.percent ?? -1) - (a.coverage.percent ?? -1);
    return 0;
  });
}

export function ingredientSuggestions(
  records: readonly LocalRecipeRecord[],
  query: string,
  selected: readonly string[],
  limit = 8,
): string[] {
  const chosen = new Set(selected.map(ingredientKey));
  const byKey = new Map<string, { label: string; count: number }>();
  for (const record of records) {
    if (record.tombstone || record.working.recipe.state === 'archived') continue;
    const seenInRecipe = new Set<string>();
    for (const item of record.working.ingredients) {
      const label = item.name.trim();
      if (!validName(label)) continue;
      const key = recipeIngredientKey(item);
      if (chosen.has(key) || seenInRecipe.has(key)) continue;
      seenInRecipe.add(key);
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else byKey.set(key, { label, count: 1 });
    }
  }
  const needle = normalizeIngredientText(query);
  return [...byKey.entries()]
    .filter(([key, { label }]) =>
      normalizeIngredientText(label).includes(needle) ||
      (ALIAS_GROUPS[key]?.some((alias) => normalizeIngredientText(alias).startsWith(needle)) ?? false),
    )
    .map(([, value]) => value)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit))
    .map(({ label }) => label);
}
