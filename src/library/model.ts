import type {
  LocalCollectionBookRecord,
  LocalRecipeRecord,
} from '../data/local-db.ts';

export type RecipeSort = 'recent' | 'name' | 'time';

export interface RecipeLibraryFilters {
  query: string;
  favoritesOnly: boolean;
  underThirtyMinutes: boolean;
  difficulty: 'all' | 'easy' | 'medium' | 'hard';
  collectionId: string | null;
  sort: RecipeSort;
}

export interface RecipeCardModel {
  id: string;
  title: string;
  description: string | null;
  difficulty: 'unknown' | 'easy' | 'medium' | 'hard';
  totalMinutes: number | null;
  servings: number | null;
  servingUnit: string | null;
  favorite: boolean;
  tags: string[];
  ingredientNames: string[];
  syncState: LocalRecipeRecord['syncState'];
  updatedAt: number;
  tombstone: boolean;
}

export interface CollectionCardModel {
  id: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  position: number;
  recipeIds: string[];
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

export function recipeCardFromLocal(record: LocalRecipeRecord): RecipeCardModel {
  const version = record.working.version;
  return {
    id: record.resourceId,
    title: version.title,
    description: version.description ?? null,
    difficulty: version.difficulty,
    totalMinutes: version.totalMinutes,
    servings: version.servings,
    servingUnit: version.servingUnit ?? null,
    favorite: record.working.recipe.favorite,
    tags: [
      ...version.cuisineTags,
      ...version.categoryTags,
      ...version.dietaryTags,
    ],
    ingredientNames: record.working.ingredients.map((ingredient) => ingredient.name),
    syncState: record.syncState,
    updatedAt: record.updatedAt,
    tombstone: record.tombstone,
  };
}

export function collectionCards(
  record: LocalCollectionBookRecord | undefined,
): CollectionCardModel[] {
  if (!record) return [];
  return record.working.collections
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      description: collection.description ?? null,
      iconKey: collection.iconKey ?? null,
      position: collection.position,
      recipeIds: collection.recipeIds,
    }))
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

function searchScore(recipe: RecipeCardModel, query: string): number {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 1;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const title = normalize(recipe.title);
  const description = normalize(recipe.description ?? '');
  const tags = recipe.tags.map(normalize);
  const ingredients = recipe.ingredientNames.map(normalize);

  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    if (title === token) tokenScore = Math.max(tokenScore, 30);
    if (title.startsWith(token)) tokenScore = Math.max(tokenScore, 18);
    if (title.includes(token)) tokenScore = Math.max(tokenScore, 12);
    if (tags.some((tag) => tag === token)) tokenScore = Math.max(tokenScore, 10);
    if (tags.some((tag) => tag.includes(token))) tokenScore = Math.max(tokenScore, 7);
    if (ingredients.some((item) => item === token))
      tokenScore = Math.max(tokenScore, 6);
    if (ingredients.some((item) => item.includes(token)))
      tokenScore = Math.max(tokenScore, 4);
    if (description.includes(token)) tokenScore = Math.max(tokenScore, 2);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }

  return score;
}

export function filterRecipes(
  records: LocalRecipeRecord[],
  collections: LocalCollectionBookRecord | undefined,
  filters: RecipeLibraryFilters,
): RecipeCardModel[] {
  const collection =
    filters.collectionId === null
      ? null
      : collections?.working.collections.find(
          (item) => item.id === filters.collectionId,
        );
  const allowedIds = collection ? new Set(collection.recipeIds) : null;

  const scored = records
    .map(recipeCardFromLocal)
    .filter((recipe) => !recipe.tombstone)
    .filter((recipe) => !filters.favoritesOnly || recipe.favorite)
    .filter(
      (recipe) =>
        !filters.underThirtyMinutes ||
        (recipe.totalMinutes !== null && recipe.totalMinutes <= 30),
    )
    .filter(
      (recipe) =>
        filters.difficulty === 'all' ||
        recipe.difficulty === filters.difficulty,
    )
    .filter((recipe) => allowedIds === null || allowedIds.has(recipe.id))
    .map((recipe) => ({ recipe, score: searchScore(recipe, filters.query) }))
    .filter(({ score }) => score > 0);

  scored.sort((a, b) => {
    if (filters.query.trim() && b.score !== a.score) return b.score - a.score;
    if (filters.sort === 'name')
      return a.recipe.title.localeCompare(b.recipe.title, undefined, {
        sensitivity: 'base',
      });
    if (filters.sort === 'time')
      return (
        (a.recipe.totalMinutes ?? Number.POSITIVE_INFINITY) -
        (b.recipe.totalMinutes ?? Number.POSITIVE_INFINITY)
      );
    return b.recipe.updatedAt - a.recipe.updatedAt;
  });

  return scored.map(({ recipe }) => recipe);
}

export function countFavoriteRecipes(records: LocalRecipeRecord[]): number {
  return records.filter(
    (record) => !record.tombstone && record.working.recipe.favorite,
  ).length;
}
