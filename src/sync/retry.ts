import { RecipeApiError } from '../api/core.ts';

/**
 * The Gateway can temporarily reject an otherwise valid operation without
 * seeing or committing it. Keep that mutation's idempotency key in the outbox.
 * Other 4xx responses are treated as permanent validation failures.
 */
export function isRetryableSyncFailure(error: unknown): boolean {
  if (!(error instanceof RecipeApiError)) return true;
  const status = error.status;
  return status === 0 || status === 401 || status === 403 ||
    status === 408 || status === 425 || status === 429 ||
    status >= 500;
}
