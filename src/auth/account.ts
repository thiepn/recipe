import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type { RecipeLocalDb } from '../data/local-db.ts';
import { clearRecipeMediaCache } from '../media/cache.ts';
import { mealPlannerStoreFor } from '../planning/model.ts';
import { kitchenSessionStoreFor } from '../kitchen/session.ts';

const RETURN_KEY = 'thiepn-recipe:return-to';
const STORAGE_KEY = 'thiepn-recipe-auth-v1';

export interface RecipeAuthConfig {
  accountUrl: string;
  accountPublishableKey: string;
  appOrigin?: string;
}

export interface VerifiedRecipeIdentity {
  userId: string;
  user: User;
}

export class UnsyncedChangesError extends Error {
  constructor(public readonly pendingCount: number) {
    super(
      `Cannot sign out safely while ${pendingCount} local Recipe change(s) are not synced.`,
    );
    this.name = 'UnsyncedChangesError';
  }
}

export class UnsyncedWorkspaceError extends Error {
  constructor(public readonly pendingCount: number) {
    super(`Signing out would discard ${pendingCount} device-only Recipe workspace item(s).`);
    this.name = 'UnsyncedWorkspaceError';
  }
}

function safeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const base = 'https://recipe-return.invalid';
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function exactOrigin(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new TypeError('Expected an exact HTTP(S) origin');
  return url.origin;
}

export function createRecipeAuthClient(
  config: RecipeAuthConfig,
): SupabaseClient {
  const accountUrl = exactOrigin(config.accountUrl);
  if (!config.accountPublishableKey.trim())
    throw new TypeError('Missing THIEPN Account publishable key');

  return createClient(accountUrl, config.accountPublishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: STORAGE_KEY,
    },
  });
}

export async function signInWithGoogle(
  client: SupabaseClient,
  options: {
    appOrigin?: string;
    returnTo?: string;
  } = {},
): Promise<void> {
  const origin = exactOrigin(
    options.appOrigin ?? globalThis.location?.origin ?? 'https://recipe.thiepn.dev',
  );
  const returnTo = safeReturnTo(options.returnTo);

  if (globalThis.sessionStorage)
    globalThis.sessionStorage.setItem(RETURN_KEY, returnTo);

  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('/auth/callback', origin).href,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

export async function handleRecipeAuthCallback(
  client: SupabaseClient,
): Promise<{ identity: VerifiedRecipeIdentity; returnTo: string }> {
  const url = new URL(globalThis.location.href);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Missing OAuth authorization code');

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;

  const identity = await getVerifiedRecipeIdentity(client);
  const stored = globalThis.sessionStorage?.getItem(RETURN_KEY);
  globalThis.sessionStorage?.removeItem(RETURN_KEY);

  const clean = new URL('/auth/callback', url.origin);
  globalThis.history?.replaceState(null, '', clean.pathname);

  return {
    identity,
    returnTo: safeReturnTo(stored ?? undefined),
  };
}

export async function getVerifiedRecipeIdentity(
  client: SupabaseClient,
): Promise<VerifiedRecipeIdentity> {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Authentication required');
  return { userId: data.user.id, user: data.user };
}

/**
 * Distinguish a genuinely signed-out browser from a temporary Account outage.
 * Never interpret a failed verification of a cached session as sign-out:
 * otherwise users are sent through OAuth again while their token remains stored.
 * getUser() remains the authority for identifying the Account owner.
 */
export async function getStartupRecipeIdentity(
  client: SupabaseClient,
): Promise<VerifiedRecipeIdentity | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  return getVerifiedRecipeIdentity(client);
}

/**
 * getSession() is used only to retrieve the current bearer token for the Core
 * Gateway. Authorization is performed by the Gateway, which verifies the token
 * against THIEPN Account /auth/v1/user.
 */
export async function getRecipeAccessToken(
  client: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

export async function signOutRecipe(
  client: SupabaseClient,
  localDb: RecipeLocalDb,
  accountId: string,
  options: { discardUnsynced?: boolean; discardLocalWorkspace?: boolean } = {},
): Promise<void> {
  // Drain local planner/cooking queues so rapid edits cannot disappear during logout.
  await Promise.all([
    mealPlannerStoreFor(localDb, accountId).load(),
    kitchenSessionStoreFor(localDb, accountId).flush(),
  ]);
  const pending = await localDb.countUnsynced(accountId);
  if (pending > 0 && !options.discardUnsynced)
    throw new UnsyncedChangesError(pending);

  const workspacePending = await localDb.countUnsyncedWorkspace(accountId);
  if (workspacePending > 0 && !options.discardLocalWorkspace)
    throw new UnsyncedWorkspaceError(workspacePending);

  // Never erase account-scoped IndexedDB while an active auth session remains.
  // A failed local sign-out must leave recoverable recipes and workspace data.
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;

  // If cleanup fails, the auth session is already closed and owner-scoped data
  // remains locally recoverable after the same Account signs in again.
  await localDb.wipeAccount(accountId);
  await clearRecipeMediaCache(accountId);
}
