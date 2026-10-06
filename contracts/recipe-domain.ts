/**
 * Recipe domain contract v1.
 *
 * Framework-neutral TypeScript shapes for recipe.thiepn.dev.
 * These mirror the P1 PostgreSQL model conceptually; database enum values are
 * intentionally preserved as string unions.
 */

export type UUID = string;
export type ISODateTime = string;

export type RecipeState =
  | "draft"
  | "needs_review"
  | "verified"
  | "active"
  | "archived";

export type RecipeVisibility =
  | "private"
  | "household"
  | "shared_link"
  | "public";

export type RecipeDifficulty = "unknown" | "easy" | "medium" | "hard";

export type RecipeSourceType =
  | "manual"
  | "family"
  | "website"
  | "photo"
  | "screenshot"
  | "book"
  | "voice"
  | "video"
  | "social"
  | "chatgpt"
  | "import"
  | "unknown";

export type RecipeVersionKind = "original" | "revision" | "variant";

export type IngredientScalingMode =
  | "linear"
  | "seasoning"
  | "fixed"
  | "contextual";

export type CollectionKind = "manual" | "smart" | "system";

export type HeatLevel =
  | "low"
  | "medium_low"
  | "medium"
  | "medium_high"
  | "high";

export type JsonObject = Record<string, unknown>;

export interface RecipeRecord {
  id: UUID;
  userId: UUID;
  currentVersionId: UUID | null;
  state: RecipeState;
  visibility: RecipeVisibility;
  favorite: boolean;
  heroImagePath: string | null;
  lastCookedAt: ISODateTime | null;
  archivedAt: ISODateTime | null;
  deletedAt: ISODateTime | null;
  revision: number;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecipeVersion {
  id: UUID;
  userId: UUID;
  recipeId: UUID;
  parentVersionId: UUID | null;
  versionNumber: number;
  kind: RecipeVersionKind;
  title: string;
  description: string | null;
  story: string | null;
  yieldText: string | null;
  servings: number | null;
  servingUnit: string | null;
  difficulty: RecipeDifficulty;
  prepMinutes: number | null;
  activeMinutes: number | null;
  passiveMinutes: number | null;
  restMinutes: number | null;
  totalMinutes: number | null;
  cuisineTags: string[];
  categoryTags: string[];
  dietaryTags: string[];
  locale: string | null;
  authorNote: string | null;
  changeSummary: string | null;
  revision: number;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecipeSource {
  id: UUID;
  userId: UUID;
  recipeId: UUID;
  versionId: UUID | null;
  sourceType: RecipeSourceType;
  label: string | null;
  personName: string | null;
  sourceUrl: string | null;
  originalStoragePath: string | null;
  originalText: string | null;
  extractedText: string | null;
  confidence: number | null;
  uncertainties: unknown[];
  capturedAt: ISODateTime | null;
  contentHash: string | null;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface IngredientGroup {
  id: UUID;
  userId: UUID;
  recipeVersionId: UUID;
  name: string;
  position: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecipeIngredient {
  id: UUID;
  userId: UUID;
  recipeVersionId: UUID;
  groupId: UUID | null;
  position: number;
  name: string;
  quantity: number | null;
  quantityMax: number | null;
  unit: string | null;
  preparation: string | null;
  note: string | null;
  optional: boolean;
  scalingMode: IngredientScalingMode;
  canonicalKey: string | null;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecipeStep {
  id: UUID;
  userId: UUID;
  recipeVersionId: UUID;
  position: number;
  title: string | null;
  instruction: string;
  durationSecondsMin: number | null;
  durationSecondsMax: number | null;
  timerLabel: string | null;
  temperatureC: number | null;
  temperatureDisplay: string | null;
  heatLevel: HeatLevel | null;
  visualCue: string | null;
  donenessCue: string | null;
  techniqueKeys: string[];
  isPassive: boolean;
  canParallelize: boolean;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface StepIngredient {
  userId: UUID;
  recipeVersionId: UUID;
  stepId: UUID;
  ingredientId: UUID;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  createdAt: ISODateTime;
}

export interface RecipeEquipment {
  id: UUID;
  userId: UUID;
  recipeVersionId: UUID;
  position: number;
  name: string;
  quantity: number | null;
  optional: boolean;
  note: string | null;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface StepEquipment {
  userId: UUID;
  recipeVersionId: UUID;
  stepId: UUID;
  equipmentId: UUID;
  note: string | null;
  createdAt: ISODateTime;
}

export interface RecipeCollection {
  id: UUID;
  userId: UUID;
  kind: CollectionKind;
  name: string;
  description: string | null;
  iconKey: string | null;
  coverImagePath: string | null;
  position: number;
  smartFilter: JsonObject | null;
  metadata: JsonObject;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CollectionRecipe {
  userId: UUID;
  collectionId: UUID;
  recipeId: UUID;
  position: number;
  addedAt: ISODateTime;
}

/**
 * Canonical hydrated recipe payload for future application/API layers.
 * P1 defines the shape; a later phase will define transport/RPC endpoints.
 */
export interface RecipeDocumentV1 {
  recipe: RecipeRecord;
  version: RecipeVersion;
  sources: RecipeSource[];
  ingredientGroups: IngredientGroup[];
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  stepIngredients: StepIngredient[];
  equipment: RecipeEquipment[];
  stepEquipment: StepEquipment[];
}
