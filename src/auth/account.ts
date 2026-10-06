import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type { RecipeLocalDb } from '../data/local-db.ts';
import { clearRecipeMediaCache } from '../media/cache.ts';

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
  const returnTo =
    options.returnTo && options.returnTo.startsWith('/')
      ? options.returnTo
      : '/';

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
    returnTo: stored?.startsWith('/') ? stored : '/',
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
  options: { discardUnsynced?: boolean } = {},
): Promise<void> {
  const pending = await localDb.countUnsynced(accountId);
  if (pending > 0 && !options.discardUnsynced)
    throw new UnsyncedChangesError(pending);

  await localDb.wipeAccount(accountId);
  await clearRecipeMediaCache(accountId);

  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw error;
}
