import type { RecipeLocalDb, OutboxState } from '../data/local-db.ts';

export interface SyncHealth {
  queued: number;
  retrying: number;
  blocked: number;
  conflicts: number;
  total: number;
}

export type SyncAttempt = 'idle' | 'succeeded' | 'failed';
export type SyncNoticeKind =
  | 'offline' | 'syncing' | 'blocked' | 'conflict'
  | 'retrying' | 'queued' | 'unavailable' | 'saved';

export interface SyncNotice {
  kind: SyncNoticeKind;
  title: string;
  detail: string;
  canRetry: boolean;
  showBanner: boolean;
}

export const EMPTY_SYNC_HEALTH: SyncHealth = Object.freeze({
  queued: 0, retrying: 0, blocked: 0, conflicts: 0, total: 0,
});

export function summarizeSyncHealth(
  states: OutboxState[],
  conflicts: number,
): SyncHealth {
  const queued = states.filter(state => state === 'pending' || state === 'in_flight').length;
  const retrying = states.filter(state => state === 'retry').length;
  const blocked = states.filter(state => state === 'conflict' || state === 'quarantined').length;
  return { queued, retrying, blocked, conflicts, total: states.length };
}

/** IndexedDB remains authoritative, even when the HTTP engine returns normally
 * after deferring a retry. A resolved syncOnce promise does not imply success. */
export async function readSyncHealth(db: RecipeLocalDb, accountId: string): Promise<SyncHealth> {
  const [recipes, collections, recipeConflicts, collectionConflicts] = await Promise.all([
    db.listOutbox(accountId),
    db.listCollectionOutbox(accountId),
    db.listConflicts(accountId),
    db.listCollectionConflicts(accountId),
  ]);
  return summarizeSyncHealth(
    [...recipes.map(row => row.state), ...collections.map(row => row.state)],
    recipeConflicts.length + collectionConflicts.length,
  );
}

export function describeSyncHealth(
  health: SyncHealth,
  options: { online: boolean; syncing: boolean; attempt: SyncAttempt },
): SyncNotice {
  if (!options.online) return {
    kind: 'offline',
    title: 'Working offline',
    detail: health.total
      ? `${health.total} change(s) are held on this device. They can sync when the connection returns.`
      : 'Your saved cookbook stays available on this device. Cloud updates are paused.',
    canRetry: false,
    showBanner: true,
  };
  if (options.syncing) return {
    kind: 'syncing', title: 'Checking your cookbook',
    detail: 'Sending saved changes and checking for updates. You can continue cooking.',
    canRetry: false, showBanner: health.total > 0,
  };
  if (health.blocked > 0) return {
    kind: 'blocked', title: 'Some changes need attention',
    detail: `${health.blocked} change(s) cannot be uploaded automatically. Your local copy is retained. Do not sign out until these are resolved.`,
    canRetry: health.queued + health.retrying > 0, showBanner: true,
  };
  if (health.conflicts > 0) return {
    kind: 'conflict', title: 'Versions need review',
    detail: `${health.conflicts} conflict(s) need resolution. The local versions remain on this device. Avoid signing out.`,
    canRetry: health.queued + health.retrying > 0, showBanner: true,
  };
  if (health.retrying > 0) return {
    kind: 'retrying', title: 'Upload interrupted',
    detail: `${health.retrying} change(s) are still saved locally. Recipe will try again when the cloud responds.`,
    canRetry: true, showBanner: true,
  };
  if (health.queued > 0) return {
    kind: 'queued', title: 'Changes saved on this device',
    detail: `${health.queued} change(s) are waiting for cloud confirmation. You can keep using Recipe.`,
    canRetry: true, showBanner: true,
  };
  if (options.attempt === 'failed') return {
    kind: 'unavailable', title: 'Cloud could not be checked',
    detail: 'Your local cookbook remains available. Try again to check for new changes.',
    canRetry: true, showBanner: true,
  };
  return {
    kind: 'saved',
    title: options.attempt === 'succeeded' ? 'Cookbook up to date' : 'Saved on this device',
    detail: options.attempt === 'succeeded'
      ? 'No pending recipe or collection uploads. Pantry and cooking plans may still be device-only.'
      : 'Cloud status has not yet been checked. Recipes remain on this device.',
    canRetry: true, showBanner: false,
  };
}
