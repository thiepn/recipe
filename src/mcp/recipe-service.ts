import { z } from 'zod';
import { RecipeCoreApi } from '../api/core.ts';
import { recipeEditableDocumentSchema, type RecipeDocument } from '../api/protocol.ts';
import { createImportedRecipe, safeSourceUrl, type ImportDraft } from '../import/recipe-import.ts';
import { ingredientKey } from '../library/ingredients.ts';

export const listInput = z.object({
  query: z.string().trim().max(140).default(''),
  limit: z.number().int().min(1).max(30).default(20),
  favorites_only: z.boolean().default(false),
}).strict();

export const getInput = z.object({ recipe_id: z.string().uuid() }).strict();

export const ingredientsInput = z.object({
  available: z.array(z.string().trim().min(1).max(100)).min(1).max(40),
  max_missing: z.number().int().min(0).max(10).optional(),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();

export const saveInput = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000).default(''),
  ingredients: z.array(z.string().trim().min(1).max(240)).min(1).max(100),
  steps: z.array(z.string().trim().min(1).max(20000)).min(1).max(100),
  source_url: z.string().max(2048).optional(),
  servings: z.number().int().min(1).max(200).optional(),
  total_minutes: z.number().int().min(1).max(10080).optional(),
  request_id: z.string().uuid(),
  confirmed: z.literal(true),
  allow_duplicate: z.boolean().default(false),
}).strict();

export type RecipeMcpCore = Pick<RecipeCoreApi, 'manifest' | 'document' | 'mutate'>;

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').trim().replace(/\s+/g, ' ');
}

const MAX_REMOTE_INSPECTION = 120;

async function deterministicIds(
  userId: string,
  requestId: string,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(`thiepn-recipe-mcp/v1/${userId}/${requestId}/${index}`)));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes.slice(0, 16)).map(v => v.toString(16).padStart(2, '0')).join('');
    ids.push(`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`);
  }
  return ids;
}

function summary(document: RecipeDocument) {
  return {
    recipe_id: document.recipe.id,
    title: document.version.title,
    description: document.version.description,
    state: document.recipe.state,
    favorite: document.recipe.favorite,
    total_minutes: document.version.totalMinutes,
    servings: document.version.servings,
    ingredients: document.ingredients.map(item => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      optional: item.optional,
    })),
    steps: document.steps.map(item => ({ instruction: item.instruction, position: item.position }))
      .sort((a,b) => a.position - b.position),
    provenance: document.version.metadata.importSource ?? null,
  };
}

async function readMatchingDocuments(core: RecipeMcpCore, ids: string[]) {
  const documents: RecipeDocument[] = [];
  for (const id of ids) {
    // Serial reads bound remote pressure and avoid hitting gateway concurrency limits.
    try { documents.push(await core.document(id)); }
    catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) continue;
      throw error;
    }
  }
  return documents;
}

export function recipeMcpService(core: RecipeMcpCore, ownerId: string) {
  return {
    async list(raw: unknown) {
      const input = listInput.parse(raw);
      const manifest = await core.manifest();
      const matches = manifest.recipes
        .filter(item => !item.deletedAt && item.state !== 'archived')
        .filter(item => !input.favorites_only || item.favorite)
        .filter(item => !input.query || normalize(item.title ?? '').includes(normalize(input.query)))
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
      return {
        count: matches.length,
        recipes: matches.slice(0, input.limit).map(item => ({
          recipe_id: item.id,
          title: item.title,
          state: item.state,
          favorite: item.favorite,
          updated_at: item.updatedAt,
        })),
        has_more: matches.length > input.limit,
      };
    },

    async get(raw: unknown) {
      const { recipe_id } = getInput.parse(raw);
      return summary(await core.document(recipe_id));
    },

    async findByIngredients(raw: unknown) {
      const input = ingredientsInput.parse(raw);
      const available = new Set(input.available.map(ingredientKey));
      const manifest = await core.manifest();
      const candidates = manifest.recipes.filter(item =>
        !item.deletedAt && item.state !== 'archived');
      const documents = await readMatchingDocuments(
        core, candidates.slice(0, MAX_REMOTE_INSPECTION).map(item => item.id));
      const results = documents.flatMap(doc => {
        const required = new Map<string,string>();
        for (const item of doc.ingredients) {
          if (item.optional) continue;
          const key = ingredientKey(item.canonicalKey || item.name);
          if (key !== 'exact:' && !required.has(key)) required.set(key,item.name);
        }
        if (required.size === 0) return [];
        const missing = [...required].filter(([key]) => !available.has(key))
          .map(([,name]) => name);
        if (input.max_missing !== undefined && missing.length > input.max_missing) return [];
        return [{
          recipe_id: doc.recipe.id, title: doc.version.title,
          matched_types: required.size - missing.length,
          required_types: required.size,
          missing_ingredients: missing,
        }];
      }).sort((a,b) => a.missing_ingredients.length - b.missing_ingredients.length ||
        (b.matched_types/b.required_types) - (a.matched_types/a.required_types));
      return {
        recipes: results.slice(0,input.limit),
        inspected: documents.length,
        total_candidate_recipes: candidates.length,
        truncated: candidates.length > MAX_REMOTE_INSPECTION,
        caveat: 'Ingredient types only: amounts, freshness and substitutions are not verified.',
      };
    },

    async saveDraft(raw: unknown) {
      const input = saveInput.parse(raw);
      const stable = await deterministicIds(ownerId,input.request_id,input.ingredients.length+input.steps.length+3);
      const recipeId = stable[0]!;
      const manifest = await core.manifest();
      const existing = manifest.recipes.find(item=>item.id===recipeId && !item.deletedAt);
      const contentKey = JSON.stringify({
        title: input.title,
        ingredients: input.ingredients,
        steps: input.steps,
        description: input.description,
        source_url: input.source_url ? safeSourceUrl(input.source_url) : null,
        servings: input.servings ?? null,
        total_minutes: input.total_minutes ?? null,
      });
      const contentDigest = Array.from(new Uint8Array(await crypto.subtle.digest(
        'SHA-256',new TextEncoder().encode(contentKey))))
        .map(n=>n.toString(16).padStart(2,'0')).join('');
      if (existing) {
        const document = await core.document(recipeId);
        if (document.version.metadata.mcpContentDigest !== contentDigest)
          return { status:'idempotency_conflict', recipe_id:recipeId,
            message:'This request_id was already used for different recipe content.' };
        return { status:'already_saved', recipe_id:recipeId,
          message:'This exact request was already saved. No new recipe was created.' };
      }

      const titleMatches = manifest.recipes.filter(item =>
        !item.deletedAt && item.state !== 'archived' &&
        normalize(item.title ?? '') === normalize(input.title));
      if (titleMatches.length > 0 && !input.allow_duplicate) {
        return {
          status:'duplicate_warning',
          matches:titleMatches.slice(0,10).map(item=>({recipe_id:item.id,title:item.title})),
          message:'A recipe with this title already exists. Review it or resubmit with allow_duplicate=true after user confirmation.',
        };
      }

      const sourceUrl = input.source_url ? safeSourceUrl(input.source_url) : null;
      const draft: ImportDraft = {
        kind: sourceUrl ? 'website' : 'text',
        method:'text', title:input.title, description:input.description,
        ingredients:input.ingredients, steps:input.steps,
        servings:input.servings ?? null,
        totalMinutes:input.total_minutes ?? null,
        sourceUrl, sourceName:null,
        originalText:contentKey, warnings:[],
      };
      let index = 0;
      const document = await createImportedRecipe(draft, {
        randomUUID: () => {
          const id=stable[index++];
          if (!id) throw new Error('Too many generated recipe IDs');
          return id;
        },
      });
      const validated = recipeEditableDocumentSchema.parse({
        ...document,
        recipe: {...document.recipe, state:'draft'},
        version: {
          ...document.version,
          metadata: {
            ...document.version.metadata,
            mcpContentDigest:contentDigest,
            importSource: {
              ...(document.version.metadata.importSource as Record<string,unknown>),
              kind:'chatgpt',
              reviewStatus:'user-confirmed-draft',
            },
          },
        },
      });
      const mutationId=stable[stable.length-1]!;
      const result=await core.mutate([{
        mutationId, resourceId:recipeId, baseRevision:0,
        operation:'create', document:validated,
      }]);
      const saved=result.results[0];
      if (!saved) throw new Error('Core returned an empty mutation result');
      if (saved.status==='applied') return {
        status:'saved', recipe_id:recipeId, revision:saved.revision,
        message:'Private recipe draft saved in THIEPN Recipe. It will appear in the cookbook after sync.',
      };
      if(saved.status==='conflict' && saved.reason==='already_exists') {
        const recovered=await core.document(recipeId);
        if(recovered.version.metadata.mcpContentDigest===contentDigest)
          return { status:'already_saved',recipe_id:recipeId };
      }
      return {status:'conflict',recipe_id:recipeId,message:'The draft was not saved. Review the recipe in THIEPN Recipe before retrying.'};
    },
  };
}
