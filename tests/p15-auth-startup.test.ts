import { describe, expect, it } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getStartupRecipeIdentity } from '../src/auth/account.ts';

const accountId = '11111111-1111-4111-8111-111111111111';
const user = { id: accountId } as User;

function stubAuth(
  session: object | null,
  getUser: () => Promise<{ data: { user: User | null }; error: Error | null }>,
  sessionError: Error | null = null,
): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session },
        error: sessionError,
      }),
      getUser,
    },
  } as unknown as SupabaseClient;
}

describe('P15 resilient Account startup', () => {
  it('only treats an absent cached session as signed out', async () => {
    let called = false;
    const auth = stubAuth(null, async () => {
      called = true;
      return { data: { user }, error: null };
    });
    expect(await getStartupRecipeIdentity(auth)).toBeNull();
    expect(called).toBe(false);
  });

  it('verifies a cached session with the Account authority', async () => {
    const auth = stubAuth({ access_token: 'token' },
      async () => ({ data: { user }, error: null }));
    const identity = await getStartupRecipeIdentity(auth);
    expect(identity?.userId).toBe(accountId);
    expect(identity?.user).toBe(user);
  });

  it('surfaces failed online identity verification instead of returning signed out', async () => {
    const auth = stubAuth({ access_token: 'token' }, async () => ({
      data: { user: null },
      error: new Error('Account temporarily unavailable'),
    }));
    await expect(getStartupRecipeIdentity(auth))
      .rejects.toThrow('Account temporarily unavailable');
  });

  it('does not swallow refresh/session-loading errors', async () => {
    const auth = stubAuth(null, async () => ({
      data: { user: null }, error: null,
    }), new Error('Failed to refresh session'));
    await expect(getStartupRecipeIdentity(auth))
      .rejects.toThrow('Failed to refresh session');
  });

  it('rejects a cached token that is not backed by a verified user', async () => {
    const auth = stubAuth({ access_token: 'token' }, async () => ({
      data: { user: null }, error: null,
    }));
    await expect(getStartupRecipeIdentity(auth))
      .rejects.toThrow('Authentication required');
  });
});
