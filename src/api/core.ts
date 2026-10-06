import { z } from 'zod';
import {
  recipeChangesSchema,
  recipeDeleteAllResultSchema,
  recipeDocumentSchema,
  recipeManifestSchema,
  recipeMutationBatchInputSchema,
  recipeMutationBatchResultSchema,
  type RecipeMutation,
} from './protocol.ts';

const failureSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string(),
        requestId: z.string().min(1),
      })
      .strict(),
  })
  .strict();

function successSchema<T extends z.ZodType>(schema: T) {
  return z
    .object({
      ok: z.literal(true),
      data: schema,
      meta: z.object({ requestId: z.string().min(1) }).strict(),
    })
    .strict();
}

export class RecipeApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecipeApiError';
  }
}

export interface RecipeCoreApiOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null> | string | null;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class RecipeCoreApi {
  readonly #base: URL;
  readonly #getAccessToken: RecipeCoreApiOptions['getAccessToken'];
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: RecipeCoreApiOptions) {
    const base = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    )
      throw new TypeError('baseUrl must be an HTTP(S) origin');

    const timeoutMs = options.timeoutMs ?? 8_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new TypeError('timeoutMs must be positive');

    this.#base = base;
    this.#getAccessToken = options.getAccessToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = timeoutMs;
  }

  async #request<T extends z.ZodType>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    schema: T,
    body?: unknown,
  ): Promise<z.output<T>> {
    const token = await this.#getAccessToken();
    if (!token)
      throw new RecipeApiError(
        'CORE_AUTH_REQUIRED',
        401,
        'client',
        'Authentication required',
      );

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#base), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
        credentials: 'omit',
        redirect: 'error',
      });
    } catch (error) {
      throw new RecipeApiError(
        'NETWORK_ERROR',
        0,
        'client',
        error instanceof Error ? error.message : 'Network request failed',
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = failureSchema.safeParse(payload);
      if (parsed.success)
        throw new RecipeApiError(
          parsed.data.error.code,
          response.status,
          parsed.data.error.requestId,
          parsed.data.error.message,
        );
      throw new RecipeApiError(
        'INVALID_GATEWAY_RESPONSE',
        response.status,
        response.headers.get('X-Request-ID') ?? 'unknown',
        'Invalid Gateway error response',
      );
    }

    return successSchema(schema).parse(payload).data;
  }

  manifest() {
    return this.#request(
      '/v1/recipe/manifest',
      'GET',
      recipeManifestSchema,
    );
  }

  changes(after = 0, limit = 50) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new TypeError('after must be a non-negative safe integer');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new TypeError('limit must be an integer from 1 to 100');

    const query = new URLSearchParams({
      after: String(after),
      limit: String(limit),
    });
    return this.#request(
      `/v1/recipe/changes?${query.toString()}`,
      'GET',
      recipeChangesSchema,
    );
  }

  document(recipeId: string) {
    const id = z.string().uuid().parse(recipeId);
    return this.#request(
      `/v1/recipe/documents/${id}`,
      'GET',
      recipeDocumentSchema,
    );
  }

  mutate(mutations: RecipeMutation[]) {
    const input = recipeMutationBatchInputSchema.parse({ mutations });
    return this.#request(
      '/v1/recipe/mutations',
      'POST',
      recipeMutationBatchResultSchema,
      input,
    );
  }

  deleteAll() {
    return this.#request(
      '/v1/recipe/account-data',
      'DELETE',
      recipeDeleteAllResultSchema,
    );
  }
}
