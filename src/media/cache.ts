const CACHE_PREFIX = 'thiepn-recipe-media-v1';

function cacheName(accountId: string): string {
  if (!accountId.trim()) throw new TypeError('accountId is required');
  return `${CACHE_PREFIX}:${accountId}`;
}

function cacheRequest(accountId: string, assetKey: string): Request {
  if (!assetKey.trim()) throw new TypeError('assetKey is required');
  const url = new URL('https://recipe-cache.invalid/media');
  url.searchParams.set('account', accountId);
  url.searchParams.set('asset', assetKey);
  return new Request(url, { method: 'GET' });
}

function storage(): CacheStorage {
  if (!globalThis.caches)
    throw new Error('Cache Storage is not available in this environment');
  return globalThis.caches;
}

/**
 * Cache only already-authorized media bytes. Signed download URLs are never
 * used as cache keys, so expiring credentials cannot leak into persistent
 * browser storage.
 */
export async function cacheRecipeMedia(
  accountId: string,
  assetKey: string,
  response: Response,
): Promise<void> {
  if (!response.ok)
    throw new Error(`Cannot cache failed media response (${response.status})`);
  const cache = await storage().open(cacheName(accountId));
  await cache.put(cacheRequest(accountId, assetKey), response.clone());
}

export async function readRecipeMedia(
  accountId: string,
  assetKey: string,
): Promise<Response | undefined> {
  const cache = await storage().open(cacheName(accountId));
  return (await cache.match(cacheRequest(accountId, assetKey))) ?? undefined;
}

export async function removeRecipeMedia(
  accountId: string,
  assetKey: string,
): Promise<boolean> {
  const cache = await storage().open(cacheName(accountId));
  return cache.delete(cacheRequest(accountId, assetKey));
}

export async function clearRecipeMediaCache(accountId: string): Promise<void> {
  // In unsupported/private browser environments no Cache Storage exists.
  if (!globalThis.caches) return;
  await globalThis.caches.delete(cacheName(accountId));
}
