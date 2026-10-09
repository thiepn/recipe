import { canonicalJson } from '../workspace/canonical.ts';
import type { RecipeCoreApi } from '../api/core.ts';
import type {
  RecipeLocalDb, ConflictRecord, CollectionConflictRecord, RecipeAccountBackup,
} from '../data/local-db.ts';
import { editableFromRemote } from '../sync/recipe-sync.ts';
import { editableCollectionBookFromRemote } from '../sync/collection-sync.ts';

export type ConflictChoice = 'keep-local' | 'use-cloud';

export async function resolveRecipeConflictSafely(
  db: RecipeLocalDb,
  api: Pick<RecipeCoreApi, 'document'>,
  accountId: string,
  conflict: ConflictRecord,
  expectedLocalRevision: number,
  choice: ConflictChoice,
  randomUUID: () => string = () => crypto.randomUUID(),
  now: () => number = Date.now,
): Promise<void> {
  if (conflict.accountId !== accountId || !conflict.remote ||
      conflict.remoteRevision === null) {
    throw new Error('Cannot resolve missing cloud recipes automatically. Download your backup first.');
  }
  const live = await api.document(conflict.resourceId);
  if (live.recipe.revision !== conflict.remoteRevision ||
      canonicalJson(live) !== canonicalJson(conflict.remote)) {
    throw new Error('The cloud recipe has changed. Sync again and review its latest version.');
  }
  const local = await db.getDocument(accountId, conflict.resourceId);
  if (!local || local.localRevision !== expectedLocalRevision ||
      canonicalJson(local.working) !== canonicalJson(conflict.local)) {
    throw new Error('Your local recipe changed. Refresh the recovery review.');
  }
  await db.resolveRecipeConflict(
    accountId, conflict.id, expectedLocalRevision, choice,
    editableFromRemote(live), randomUUID(), now(),
  );
}

export async function resolveCollectionConflictSafely(
  db: RecipeLocalDb,
  api: Pick<RecipeCoreApi, 'collections'>,
  accountId: string,
  conflict: CollectionConflictRecord,
  expectedLocalRevision: number,
  choice: ConflictChoice,
  randomUUID: () => string = () => crypto.randomUUID(),
  now: () => number = Date.now,
): Promise<void> {
  if (conflict.accountId !== accountId)
    throw new Error('Collection conflict ownership mismatch.');
  const live = await api.collections();
  if (live.revision !== conflict.remoteRevision ||
      canonicalJson(live) !== canonicalJson(conflict.remote))
    throw new Error('The cloud collections changed. Sync again before choosing a version.');
  const local = await db.getCollectionBook(accountId);
  if (!local || local.localRevision !== expectedLocalRevision ||
      canonicalJson(local.working) !== canonicalJson(conflict.local))
    throw new Error('The local collection changed. Refresh the recovery review.');
  await db.resolveCollectionConflict(
    accountId, conflict.id, expectedLocalRevision, choice,
    editableCollectionBookFromRemote(live), randomUUID(), now(),
  );
}

export function serializeBackup(backup: RecipeAccountBackup): string {
  if (backup.format !== 'thiepn-recipe-local-backup' || backup.schemaVersion !== 1)
    throw new Error('Unexpected local recovery file format.');
  return JSON.stringify(backup, null, 2);
}

/** Browsers create the file only after the explicit user download action. */
export function downloadBackup(backup: RecipeAccountBackup): void {
  const payload = serializeBackup(backup);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = backup.exportedAt.slice(0, 10);
  link.href = url;
  link.download = `recipe-local-backup-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  // Delay URL cleanup until after the browser has initiated the download.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
