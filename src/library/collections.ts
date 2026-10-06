import {
  recipeEditableCollectionBookSchema,
  type RecipeEditableCollectionBook,
} from '../api/protocol.ts';

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function createCollection(
  book: RecipeEditableCollectionBook,
  name: string,
  options: {
    description?: string | null;
    randomUUID?: () => string;
  } = {},
): RecipeEditableCollectionBook {
  const trimmed = name.trim();
  if (!trimmed) throw new TypeError('Collection name is required');
  if (
    book.collections.some(
      (collection) => normalizeName(collection.name) === normalizeName(trimmed),
    )
  )
    throw new Error('A collection with this name already exists');

  const randomUUID =
    options.randomUUID ??
    (() => {
      if (!globalThis.crypto?.randomUUID)
        throw new Error('crypto.randomUUID is unavailable');
      return globalThis.crypto.randomUUID();
    });

  return recipeEditableCollectionBookSchema.parse({
    schemaVersion: 1,
    collections: [
      ...book.collections,
      {
        id: randomUUID(),
        kind: 'manual',
        name: trimmed,
        description: options.description?.trim() || null,
        iconKey: null,
        coverImagePath: null,
        position: book.collections.length,
        metadata: {},
        recipeIds: [],
      },
    ],
  });
}

export function renameCollection(
  book: RecipeEditableCollectionBook,
  collectionId: string,
  name: string,
): RecipeEditableCollectionBook {
  const trimmed = name.trim();
  if (!trimmed) throw new TypeError('Collection name is required');
  if (
    book.collections.some(
      (collection) =>
        collection.id !== collectionId &&
        normalizeName(collection.name) === normalizeName(trimmed),
    )
  )
    throw new Error('A collection with this name already exists');

  return recipeEditableCollectionBookSchema.parse({
    ...book,
    collections: book.collections.map((collection) =>
      collection.id === collectionId
        ? { ...collection, name: trimmed }
        : collection,
    ),
  });
}

export function removeCollection(
  book: RecipeEditableCollectionBook,
  collectionId: string,
): RecipeEditableCollectionBook {
  return recipeEditableCollectionBookSchema.parse({
    ...book,
    collections: book.collections
      .filter((collection) => collection.id !== collectionId)
      .map((collection, position) => ({ ...collection, position })),
  });
}

export function setRecipeInCollection(
  book: RecipeEditableCollectionBook,
  collectionId: string,
  recipeId: string,
  included: boolean,
): RecipeEditableCollectionBook {
  return recipeEditableCollectionBookSchema.parse({
    ...book,
    collections: book.collections.map((collection) => {
      if (collection.id !== collectionId) return collection;
      const existing = collection.recipeIds.filter((id) => id !== recipeId);
      return {
        ...collection,
        recipeIds: included ? [...existing, recipeId] : existing,
      };
    }),
  });
}

export const EMPTY_COLLECTION_BOOK: RecipeEditableCollectionBook = {
  schemaVersion: 1,
  collections: [],
};
