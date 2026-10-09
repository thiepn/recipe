import { z } from 'zod';
import {
  recipeEditableDocumentSchema,
  recipeEditableCollectionBookSchema,
} from '../api/protocol.ts';
import { mealPlannerSchema } from '../planning/model.ts';
import { kitchenSessionSchema } from '../kitchen/session.ts';
import type { RestoreCandidate } from '../data/local-db.ts';

const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
const uuid = z.string().uuid();
const shape = z.object({
  format: z.literal('thiepn-recipe-local-backup'),
  schemaVersion: z.literal(1),
  accountId: uuid,
  exportedAt: z.string().datetime(),
  documents: z.array(z.unknown()).max(10000),
  outbox: z.array(z.unknown()).max(30000),
  conflicts: z.array(z.unknown()).max(30000),
  collectionBook: z.unknown(),
  collectionOutbox: z.array(z.unknown()).max(30000),
  collectionConflicts: z.array(z.unknown()).max(30000),
  metadata: z.array(z.unknown()).max(10000),
}).passthrough();

const rowBase = z.object({
  accountId: uuid,
  resourceId: uuid,
  localRevision: z.number().int().nonnegative(),
  serverRevision: z.number().int().nonnegative(),
  syncState: z.enum(['synced','pending','syncing','conflict','error']),
  tombstone: z.boolean(),
  working: recipeEditableDocumentSchema,
}).passthrough();
const collectionsBase = z.object({
  accountId: uuid,
  localRevision: z.number().int().nonnegative(),
  serverRevision: z.number().int().nonnegative(),
  syncState: z.enum(['synced','pending','syncing','conflict','error']),
  working: recipeEditableCollectionBookSchema,
}).passthrough();
const mutation = z.object({
  accountId: uuid,
  resourceId: uuid,
  mutationId: uuid,
}).passthrough();
const accountRow = z.object({ accountId: uuid }).passthrough();
const metadataRow = z.object({
  accountId: uuid,
  key: z.string().max(200),
  value: z.unknown(),
}).passthrough();
const pantrySchema = z.object({
  schemaVersion: z.literal(1),
  ingredients: z.array(z.string().trim().min(1).max(100)).max(80),
  assumeStaples: z.boolean(),
}).strict();

export interface BackupImportPreview {
  exportedAt: string;
  candidate: RestoreCandidate;
  skippedCloudSynced: number;
  ignoredMetadata: number;
}

/** Parse and validate locally; parsing alone must never mutate IndexedDB.
 * The caller must explicitly confirm before applying the selected candidates. */
export function inspectBackupText(raw: string, accountId: string): BackupImportPreview {
  if (new TextEncoder().encode(raw).byteLength > MAX_BACKUP_BYTES)
    throw new Error('Backup exceeds the 12 MB safety limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Backup is not valid JSON. Nothing was imported.'); }
  const backup = shape.parse(parsed);
  if (backup.accountId !== accountId)
    throw new Error('This backup belongs to a different THIEPN account. Nothing was imported.');

  // Reject injected rows belonging to a different account, even when those
  // rows will not be restored (e.g. cursor and cloud receipt history).
  for (const collection of [
    backup.documents, backup.outbox, backup.conflicts,
    backup.collectionOutbox, backup.collectionConflicts, backup.metadata,
  ]) {
    for (const value of collection) {
      if (accountRow.parse(value).accountId !== accountId)
        throw new Error('Backup contains mixed account data.');
    }
  }
  if (backup.collectionBook !== null &&
      accountRow.parse(backup.collectionBook).accountId !== accountId)
    throw new Error('Collection backup ownership mismatch.');

  const dirtyIds = new Set(backup.outbox.map(value => mutation.parse(value).resourceId));
  const docs: RestoreCandidate['documents'] = [];
  const known = new Set<string>();
  let skippedCloudSynced = 0;
  for (const value of backup.documents) {
    const row = rowBase.parse(value);
    if (row.resourceId !== row.working.recipe.id ||
        row.working.version.recipeId !== row.resourceId)
      throw new Error('Recipe identities in the backup are inconsistent.');
    if (known.has(row.resourceId))
      throw new Error('Backup contains duplicate recipe identifiers.');
    known.add(row.resourceId);
    const dirty = row.syncState !== 'synced' || dirtyIds.has(row.resourceId);
    if (!dirty || (row.tombstone && row.serverRevision === 0)) {
      skippedCloudSynced++;
      continue;
    }
    docs.push({
      resourceId: row.resourceId,
      working: row.working,
      serverRevision: row.serverRevision,
      tombstone: row.tombstone,
    });
  }
  if (backup.outbox.some(value => !known.has(mutation.parse(value).resourceId)))
    throw new Error('Backup references a missing local recipe.');
  const book = backup.collectionBook === null
    ? null : collectionsBase.parse(backup.collectionBook);
  const collection = book && (book.syncState !== 'synced' || backup.collectionOutbox.length > 0)
    ? { working: book.working, serverRevision: book.serverRevision } : null;

  const metadata: RestoreCandidate['metadata'] = [];
  let ignoredMetadata = 0;
  const keys = new Set<string>();
  for (const value of backup.metadata) {
    const row = metadataRow.parse(value);
    if (keys.has(row.key)) throw new Error('Backup has duplicate metadata keys.');
    keys.add(row.key);
    if (row.key === 'pantry-v1') {
      metadata.push({key:row.key, value:pantrySchema.parse(row.value)});
    } else if (row.key === 'meal-plan-v1') {
      metadata.push({key:row.key, value:mealPlannerSchema.parse(row.value)});
    } else if (row.key.startsWith('kitchen-session-v1:')) {
      const id = row.key.slice('kitchen-session-v1:'.length);
      if (!uuid.safeParse(id).success)
        throw new Error('Backup contains an invalid cooking session key.');
      const session = kitchenSessionSchema.parse(row.value);
      if (session.recipeId !== id)
        throw new Error('Backup cooking session has a mismatched recipe.');
      metadata.push({key:row.key,value:session});
    } else {
      ignoredMetadata++;
    }
  }
  return {
    exportedAt: backup.exportedAt,
    skippedCloudSynced,
    ignoredMetadata,
    candidate: { accountId, documents: docs, collection, metadata },
  };
}

export { MAX_BACKUP_BYTES };
