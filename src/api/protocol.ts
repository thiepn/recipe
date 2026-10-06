import { z } from 'zod';

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const jsonObject = z.record(z.string(), z.unknown());

export const recipeStateSchema = z.enum([
  'draft',
  'needs_review',
  'verified',
  'active',
  'archived',
]);
export const recipeVisibilitySchema = z.enum([
  'private',
  'household',
  'shared_link',
  'public',
]);
export const recipeDifficultySchema = z.enum([
  'unknown',
  'easy',
  'medium',
  'hard',
]);
export const recipeVersionKindSchema = z.enum([
  'original',
  'revision',
  'variant',
]);
export const recipeSourceTypeSchema = z.enum([
  'manual',
  'family',
  'website',
  'photo',
  'screenshot',
  'book',
  'voice',
  'video',
  'social',
  'chatgpt',
  'import',
  'unknown',
]);
export const ingredientScalingModeSchema = z.enum([
  'linear',
  'seasoning',
  'fixed',
  'contextual',
]);
export const recipeHeatLevelSchema = z.enum([
  'low',
  'medium_low',
  'medium',
  'medium_high',
  'high',
]);

const nullableText = (max: number) => z.string().max(max).nullable();

const editableRecipeIdentitySchema = z
  .object({
    id: uuid,
    state: recipeStateSchema,
    favorite: z.boolean(),
    metadata: jsonObject,
  })
  .strict();

const editableRecipeVersionSchema = z
  .object({
    id: uuid,
    recipeId: uuid,
    versionNumber: z.number().int().positive(),
    kind: recipeVersionKindSchema,
    title: z.string().trim().min(1).max(240),
    description: nullableText(20_000).optional().default(null),
    story: nullableText(50_000).optional().default(null),
    yieldText: nullableText(240).optional().default(null),
    servings: z.number().positive().nullable().optional().default(null),
    servingUnit: nullableText(120).optional().default(null),
    difficulty: recipeDifficultySchema,
    prepMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    activeMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    passiveMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    restMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    totalMinutes: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    cuisineTags: z.array(z.string().trim().min(1).max(120)).max(40),
    categoryTags: z.array(z.string().trim().min(1).max(120)).max(40),
    dietaryTags: z.array(z.string().trim().min(1).max(120)).max(40),
    locale: nullableText(40).optional().default(null),
    authorNote: nullableText(20_000).optional().default(null),
    changeSummary: nullableText(2_000).optional().default(null),
    metadata: jsonObject,
  })
  .strict();

const ingredientGroupSchema = z
  .object({
    id: uuid,
    recipeVersionId: uuid,
    name: z.string().trim().min(1).max(120),
    position: z.number().int().nonnegative(),
  })
  .strict();

const ingredientSchema = z
  .object({
    id: uuid,
    recipeVersionId: uuid,
    groupId: uuid.nullable().optional().default(null),
    position: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(240),
    quantity: z.number().nonnegative().nullable().optional().default(null),
    quantityMax: z.number().nonnegative().nullable().optional().default(null),
    unit: nullableText(80).optional().default(null),
    preparation: nullableText(500).optional().default(null),
    note: nullableText(2_000).optional().default(null),
    optional: z.boolean(),
    scalingMode: ingredientScalingModeSchema,
    canonicalKey: nullableText(240).optional().default(null),
    metadata: jsonObject,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.quantity !== null &&
      value.quantityMax !== null &&
      value.quantityMax < value.quantity
    )
      ctx.addIssue({
        code: 'custom',
        message: 'quantityMax must not be below quantity',
      });
  });

const stepSchema = z
  .object({
    id: uuid,
    recipeVersionId: uuid,
    position: z.number().int().nonnegative(),
    title: nullableText(240).optional().default(null),
    instruction: z.string().trim().min(1).max(20_000),
    durationSecondsMin: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    durationSecondsMax: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional()
      .default(null),
    timerLabel: nullableText(240).optional().default(null),
    temperatureC: z.number().nullable().optional().default(null),
    temperatureDisplay: nullableText(120).optional().default(null),
    heatLevel: recipeHeatLevelSchema.nullable().optional().default(null),
    visualCue: nullableText(2_000).optional().default(null),
    donenessCue: nullableText(2_000).optional().default(null),
    techniqueKeys: z.array(z.string().trim().min(1).max(120)).max(40),
    isPassive: z.boolean(),
    canParallelize: z.boolean(),
    metadata: jsonObject,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.durationSecondsMin !== null &&
      value.durationSecondsMax !== null &&
      value.durationSecondsMax < value.durationSecondsMin
    )
      ctx.addIssue({
        code: 'custom',
        message: 'durationSecondsMax must not be below durationSecondsMin',
      });
  });

const stepIngredientSchema = z
  .object({
    recipeVersionId: uuid,
    stepId: uuid,
    ingredientId: uuid,
    quantity: z.number().nonnegative().nullable().optional().default(null),
    unit: nullableText(80).optional().default(null),
    note: nullableText(2_000).optional().default(null),
  })
  .strict();

const equipmentSchema = z
  .object({
    id: uuid,
    recipeVersionId: uuid,
    position: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(160),
    quantity: z.number().positive().nullable().optional().default(null),
    optional: z.boolean(),
    note: nullableText(2_000).optional().default(null),
    metadata: jsonObject,
  })
  .strict();

const stepEquipmentSchema = z
  .object({
    recipeVersionId: uuid,
    stepId: uuid,
    equipmentId: uuid,
    note: nullableText(2_000).optional().default(null),
  })
  .strict();

export const recipeEditableDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    recipe: editableRecipeIdentitySchema,
    version: editableRecipeVersionSchema,
    ingredientGroups: z.array(ingredientGroupSchema).max(50),
    ingredients: z.array(ingredientSchema).max(500),
    steps: z.array(stepSchema).max(300),
    stepIngredients: z.array(stepIngredientSchema).max(1500),
    equipment: z.array(equipmentSchema).max(100),
    stepEquipment: z.array(stepEquipmentSchema).max(500),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (doc.version.recipeId !== doc.recipe.id)
      ctx.addIssue({
        code: 'custom',
        message: 'version.recipeId must match recipe.id',
      });
    const versionId = doc.version.id;

    const checkUnique = (
      name: string,
      values: Array<string | number>,
      field: string,
    ) => {
      const seen = new Set<string | number>();
      values.forEach((value, index) => {
        if (seen.has(value))
          ctx.addIssue({
            code: 'custom',
            path: [name, index, field],
            message: `Duplicate ${field}`,
          });
        seen.add(value);
      });
    };

    checkUnique(
      'ingredientGroups',
      doc.ingredientGroups.map((row) => row.id),
      'id',
    );
    checkUnique(
      'ingredientGroups',
      doc.ingredientGroups.map((row) => row.position),
      'position',
    );
    checkUnique(
      'ingredients',
      doc.ingredients.map((row) => row.id),
      'id',
    );
    checkUnique(
      'ingredients',
      doc.ingredients.map((row) => row.position),
      'position',
    );
    checkUnique(
      'steps',
      doc.steps.map((row) => row.id),
      'id',
    );
    checkUnique(
      'steps',
      doc.steps.map((row) => row.position),
      'position',
    );
    checkUnique(
      'equipment',
      doc.equipment.map((row) => row.id),
      'id',
    );
    checkUnique(
      'equipment',
      doc.equipment.map((row) => row.position),
      'position',
    );
    checkUnique(
      'stepIngredients',
      doc.stepIngredients.map((row) => `${row.stepId}:${row.ingredientId}`),
      'link',
    );
    checkUnique(
      'stepEquipment',
      doc.stepEquipment.map((row) => `${row.stepId}:${row.equipmentId}`),
      'link',
    );

    const groupIds = new Set(doc.ingredientGroups.map((row) => row.id));
    const ingredientIds = new Set(doc.ingredients.map((row) => row.id));
    const stepIds = new Set(doc.steps.map((row) => row.id));
    const equipmentIds = new Set(doc.equipment.map((row) => row.id));

    doc.ingredients.forEach((row, index) => {
      if (row.groupId !== null && !groupIds.has(row.groupId))
        ctx.addIssue({
          code: 'custom',
          path: ['ingredients', index, 'groupId'],
          message:
            'groupId must reference an ingredient group in this document',
        });
    });

    doc.stepIngredients.forEach((row, index) => {
      if (!stepIds.has(row.stepId))
        ctx.addIssue({
          code: 'custom',
          path: ['stepIngredients', index, 'stepId'],
          message: 'stepId must reference a step in this document',
        });
      if (!ingredientIds.has(row.ingredientId))
        ctx.addIssue({
          code: 'custom',
          path: ['stepIngredients', index, 'ingredientId'],
          message: 'ingredientId must reference an ingredient in this document',
        });
    });

    doc.stepEquipment.forEach((row, index) => {
      if (!stepIds.has(row.stepId))
        ctx.addIssue({
          code: 'custom',
          path: ['stepEquipment', index, 'stepId'],
          message: 'stepId must reference a step in this document',
        });
      if (!equipmentIds.has(row.equipmentId))
        ctx.addIssue({
          code: 'custom',
          path: ['stepEquipment', index, 'equipmentId'],
          message: 'equipmentId must reference equipment in this document',
        });
    });

    for (const [name, rows] of [
      ['ingredientGroups', doc.ingredientGroups],
      ['ingredients', doc.ingredients],
      ['steps', doc.steps],
      ['stepIngredients', doc.stepIngredients],
      ['equipment', doc.equipment],
      ['stepEquipment', doc.stepEquipment],
    ] as const) {
      rows.forEach((row, index) => {
        if (row.recipeVersionId !== versionId)
          ctx.addIssue({
            code: 'custom',
            path: [name, index, 'recipeVersionId'],
            message: 'recipeVersionId must match version.id',
          });
      });
    }
  });

const serverRecipeIdentitySchema = z
  .object({
    id: uuid,
    currentVersionId: uuid,
    state: recipeStateSchema,
    visibility: recipeVisibilitySchema,
    favorite: z.boolean(),
    heroImagePath: z.string().nullable(),
    lastCookedAt: isoDateTime.nullable(),
    archivedAt: isoDateTime.nullable(),
    deletedAt: isoDateTime.nullable(),
    revision: z.number().int().nonnegative(),
    metadata: jsonObject,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

const serverRecipeVersionSchema = editableRecipeVersionSchema.extend({
  parentVersionId: uuid.nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const recipeSourceSchema = z
  .object({
    id: uuid,
    recipeId: uuid,
    versionId: uuid.nullable(),
    sourceType: recipeSourceTypeSchema,
    label: z.string().nullable(),
    personName: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    originalStoragePath: z.string().nullable(),
    originalText: z.string().nullable(),
    extractedText: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    uncertainties: z.array(z.unknown()),
    capturedAt: isoDateTime.nullable(),
    contentHash: z.string().nullable(),
    metadata: jsonObject,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

export const recipeDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    recipe: serverRecipeIdentitySchema,
    version: serverRecipeVersionSchema,
    sources: z.array(recipeSourceSchema),
    ingredientGroups: z.array(ingredientGroupSchema),
    ingredients: z.array(ingredientSchema),
    steps: z.array(stepSchema),
    stepIngredients: z.array(stepIngredientSchema),
    equipment: z.array(equipmentSchema),
    stepEquipment: z.array(stepEquipmentSchema),
  })
  .strict();

export type RecipeDocument = z.infer<typeof recipeDocumentSchema>;
export type RecipeEditableDocument = z.infer<
  typeof recipeEditableDocumentSchema
>;

export const recipeManifestItemSchema = z
  .object({
    id: uuid,
    revision: z.number().int().nonnegative(),
    state: recipeStateSchema,
    favorite: z.boolean(),
    currentVersionId: uuid.nullable(),
    title: z.string().nullable(),
    heroImagePath: z.string().nullable(),
    deletedAt: isoDateTime.nullable(),
    updatedAt: isoDateTime,
  })
  .strict();

export const recipeManifestSchema = z
  .object({
    cursor: z.number().int().nonnegative(),
    recipes: z.array(recipeManifestItemSchema),
  })
  .strict();

export const recipeChangeSchema = z
  .object({
    sequence: z.number().int().positive(),
    resourceId: uuid,
    revision: z.number().int().positive(),
    kind: z.enum(['upsert', 'deleted']),
    changedAt: isoDateTime,
  })
  .strict();

export const recipeChangesSchema = z
  .object({
    changes: z.array(recipeChangeSchema).max(100),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();

export const recipeMutationSchema = z
  .object({
    mutationId: uuid,
    resourceId: uuid,
    baseRevision: z.number().int().nonnegative(),
    operation: z.enum(['create', 'replace', 'delete']),
    document: recipeEditableDocumentSchema.nullable().optional(),
  })
  .strict()
  .superRefine((mutation, ctx) => {
    if (
      (mutation.operation === 'create' || mutation.operation === 'replace') &&
      !mutation.document
    )
      ctx.addIssue({
        code: 'custom',
        path: ['document'],
        message: 'document is required for create/replace',
      });
    if (
      mutation.document &&
      mutation.document.recipe.id !== mutation.resourceId
    )
      ctx.addIssue({
        code: 'custom',
        path: ['resourceId'],
        message: 'resourceId must match document.recipe.id',
      });
  });

export type RecipeMutation = z.infer<typeof recipeMutationSchema>;

const appliedMutationResultSchema = z
  .object({
    status: z.literal('applied'),
    resourceId: uuid,
    revision: z.number().int().positive(),
    changeSequence: z.number().int().positive(),
  })
  .strict();

const conflictMutationResultSchema = z
  .object({
    status: z.literal('conflict'),
    reason: z.enum(['already_exists', 'revision', 'deleted']),
    resourceId: uuid,
    remoteRevision: z.number().int().nonnegative(),
    remote: recipeDocumentSchema.nullable(),
  })
  .strict();

const notFoundMutationResultSchema = z
  .object({
    status: z.literal('not_found'),
    resourceId: uuid,
  })
  .strict();

export const recipeMutationResultSchema = z.discriminatedUnion('status', [
  appliedMutationResultSchema,
  conflictMutationResultSchema,
  notFoundMutationResultSchema,
]);
export type RecipeMutationResult = z.infer<typeof recipeMutationResultSchema>;

export const recipeMutationBatchInputSchema = z
  .object({
    mutations: z.array(recipeMutationSchema).min(1).max(20),
  })
  .strict();

export const recipeMutationBatchResultSchema = z
  .object({
    results: z.array(recipeMutationResultSchema).min(1).max(20),
  })
  .strict();

const recipeCollectionBaseSchema = z
  .object({
    id: uuid,
    kind: z.literal('manual'),
    name: z.string().trim().min(1).max(120),
    description: nullableText(2_000).optional().default(null),
    iconKey: nullableText(120).optional().default(null),
    coverImagePath: nullableText(1_000).optional().default(null),
    position: z.number().int().nonnegative(),
    metadata: jsonObject,
    recipeIds: z.array(uuid).max(1000),
  })
  .strict();

export const recipeEditableCollectionBookSchema = z
  .object({
    schemaVersion: z.literal(1),
    collections: z.array(recipeCollectionBaseSchema).max(200),
  })
  .strict()
  .superRefine((book, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    book.collections.forEach((collection, collectionIndex) => {
      if (ids.has(collection.id))
        ctx.addIssue({
          code: 'custom',
          path: ['collections', collectionIndex, 'id'],
          message: 'Duplicate collection id',
        });
      ids.add(collection.id);

      const normalizedName = collection.name.trim().toLocaleLowerCase();
      if (names.has(normalizedName))
        ctx.addIssue({
          code: 'custom',
          path: ['collections', collectionIndex, 'name'],
          message: 'Collection names must be unique',
        });
      names.add(normalizedName);

      const recipeIds = new Set<string>();
      collection.recipeIds.forEach((recipeId, recipeIndex) => {
        if (recipeIds.has(recipeId))
          ctx.addIssue({
            code: 'custom',
            path: ['collections', collectionIndex, 'recipeIds', recipeIndex],
            message: 'Duplicate recipe id in collection',
          });
        recipeIds.add(recipeId);
      });
    });
  });

export type RecipeEditableCollectionBook = z.infer<
  typeof recipeEditableCollectionBookSchema
>;

const recipeCollectionSchema = recipeCollectionBaseSchema.extend({
  revision: z.number().int().nonnegative(),
  deletedAt: isoDateTime.nullable(),
});

export const recipeCollectionBookSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    updatedAt: isoDateTime,
    collections: z.array(recipeCollectionSchema).max(200),
  })
  .strict();

export type RecipeCollectionBook = z.infer<typeof recipeCollectionBookSchema>;

export const recipeCollectionMutationSchema = z
  .object({
    mutationId: uuid,
    baseRevision: z.number().int().nonnegative(),
    document: recipeEditableCollectionBookSchema,
  })
  .strict();

export type RecipeCollectionMutation = z.infer<
  typeof recipeCollectionMutationSchema
>;

const recipeCollectionAppliedSchema = z
  .object({
    status: z.literal('applied'),
    revision: z.number().int().positive(),
    document: recipeCollectionBookSchema,
  })
  .strict();

const recipeCollectionConflictSchema = z
  .object({
    status: z.literal('conflict'),
    remoteRevision: z.number().int().nonnegative(),
    remote: recipeCollectionBookSchema,
  })
  .strict();

export const recipeCollectionMutationResultSchema = z.discriminatedUnion(
  'status',
  [recipeCollectionAppliedSchema, recipeCollectionConflictSchema],
);

export type RecipeCollectionMutationResult = z.infer<
  typeof recipeCollectionMutationResultSchema
>;

export const recipeDeleteAllResultSchema = z
  .object({
    deleted: z.literal(true),
    recipes: z.number().int().nonnegative(),
    mutationReceipts: z.number().int().nonnegative(),
    changeRecords: z.number().int().nonnegative(),
    collections: z.number().int().nonnegative(),
    collectionMutationReceipts: z.number().int().nonnegative(),
    collectionBooks: z.number().int().nonnegative(),
  })
  .strict();
