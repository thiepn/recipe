import { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Download, RefreshCw, X } from 'lucide-react';
import type {
  CollectionConflictRecord, ConflictRecord, RecipeLocalDb,
  CollectionOutboxMutation, OutboxMutation,
} from '../data/local-db.ts';
import type { RecipeCoreApi } from '../api/core.ts';
import {
  downloadBackup, resolveCollectionConflictSafely, resolveRecipeConflictSafely,
  type ConflictChoice,
} from '../recovery/recovery.ts';

interface ReviewData {
  recipes: ConflictRecord[];
  collections: CollectionConflictRecord[];
  failedRecipes: OutboxMutation[];
  failedCollections: CollectionOutboxMutation[];
}

type Selection = (
  { category: 'recipe' | 'collection'; id: string; choice: ConflictChoice }
  | { category: 'blocked-recipe' | 'blocked-collection'; id: string; choice: 'retry' }
) | null;

function newestPerRecipe(records: ConflictRecord[]): ConflictRecord[] {
  const seen = new Set<string>();
  return records.filter(record => {
    if (seen.has(record.resourceId)) return false;
    seen.add(record.resourceId);
    return true;
  });
}

export function RecoveryPanel({
  db, api, accountId, onClose, onRecovered, onEditRecipe, syncBusy,
}: {
  db: RecipeLocalDb;
  api: RecipeCoreApi;
  accountId: string;
  onClose: () => void;
  onRecovered: () => Promise<void>;
  onEditRecipe: (id: string) => void;
  syncBusy: boolean;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Selection>(null);
  const refresh = useCallback(async (): Promise<ReviewData> => {
    const [recipes, collections, recipeOutbox, collectionOutbox] = await Promise.all([
      db.listConflicts(accountId), db.listCollectionConflicts(accountId),
      db.listOutbox(accountId), db.listCollectionOutbox(accountId),
    ]);
    const result = {
      recipes: newestPerRecipe(recipes),
      collections: collections.slice(0, 1),
      failedRecipes: recipeOutbox.filter(item => item.state === 'quarantined'),
      failedCollections: collectionOutbox.filter(item => item.state === 'quarantined'),
    };
    setData(result);
    return result;
  }, [db, accountId]);

  useEffect(() => {
    let active = true;
    void refresh().catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Recovery data unavailable');
    });
    return () => { active = false; };
  }, [refresh]);

  const backup = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const snapshot = await db.exportAccountBackup(accountId);
      downloadBackup(snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create backup');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (!confirm || busy || syncBusy || !data) return;
    setBusy(true); setError(null);
    try {
      if (confirm.category === 'recipe') {
        const record = data.recipes.find(item => item.id === confirm.id);
        if (!record) throw new Error('Recipe conflict no longer exists');
        const local = await db.getDocument(accountId, record.resourceId);
        if (!local) throw new Error('Local recipe no longer exists');
        await resolveRecipeConflictSafely(
          db, api, accountId, record, local.localRevision, confirm.choice,
        );
      } else if (confirm.category === 'collection') {
        const record = data.collections.find(item => item.id === confirm.id);
        if (!record) throw new Error('Collection conflict no longer exists');
        const local = await db.getCollectionBook(accountId);
        if (!local) throw new Error('Local collections no longer exist');
        await resolveCollectionConflictSafely(
          db, api, accountId, record, local.localRevision, confirm.choice,
        );
      } else if (confirm.category === 'blocked-recipe') {
        await db.repairQuarantinedRecipe(accountId, confirm.id, crypto.randomUUID(), Date.now());
      } else {
        await db.repairQuarantinedCollection(accountId, crypto.randomUUID(), Date.now());
      }
      setConfirm(null);
      await refresh();
      await onRecovered();
    } catch (cause) {
      setConfirm(null);
      setError(cause instanceof Error ? cause.message : 'Resolution failed. Local changes were retained.');
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const proposed = confirm?.category === 'recipe'
    ? data?.recipes.find(record => record.id === confirm.id)
    : confirm?.category === 'collection'
      ? data?.collections.find(record => record.id === confirm.id)
      : null;

  return (
    <div className="modal-layer" role="presentation">
      <section className="sheet recovery-sheet" role="dialog" aria-modal="true"
        aria-labelledby="recovery-title" aria-describedby="recovery-description">
        <header className="sheet-header">
          <div>
            <p className="eyebrow">Local data safety</p>
            <h2 id="recovery-title">Backup & recovery</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close recovery"
            disabled={busy} onClick={onClose}><X size={20}/></button>
        </header>
        <p className="recovery-description" id="recovery-description">
          Your device can contain recipes, cooking sessions, pantry items and edits
          that have not reached the cloud. Download a private snapshot before changing
          any conflicting version.
        </p>
        <div className="recovery-backup">
          <div>
            <strong>Export this device</strong>
            <p>JSON snapshot of this account’s local recipes, collections, pending changes,
              meal plans and cooking records. No Account access tokens are included.</p>
          </div>
          <button type="button" className="button button-primary" onClick={() => void backup()}
            disabled={busy}><Download size={16}/> Download backup</button>
        </div>
        <p className="recovery-private-note">The file can contain private recipe and household information.
          Store it securely. Automatic restore from this file is not yet available.</p>
        {error && <p className="recovery-error" role="alert">{error}</p>}
        {!data ? <p className="recovery-empty">Reading local recovery records…</p> : (
          <div className="recovery-items">
            {data.recipes.length === 0 && data.collections.length === 0 &&
              data.failedRecipes.length === 0 && data.failedCollections.length === 0 && (
                <p className="recovery-empty">No blocked saves or known conflicts on this device.</p>
              )}
            {data.recipes.map(conflict => {
              const remote = conflict.remote;
              return (
                <article className="recovery-item" key={conflict.id}>
                  <div className="recovery-item-heading">
                    <CircleAlert size={18}/>
                    <div><strong>{conflict.local?.version.title ?? 'Recipe conflict'}</strong>
                      <small>Recipe versions disagree · {conflict.reason}</small></div>
                  </div>
                  <div className="recovery-comparison">
                    <div><span>On this device</span>
                      <strong>{conflict.local?.version.title ?? 'Deleted locally'}</strong></div>
                    <div><span>Cloud version</span>
                      <strong>{remote?.version.title ?? 'Not available'}</strong></div>
                  </div>
                  {remote && conflict.remoteRevision !== null ? (
                    <div className="recovery-actions">
                      <button type="button" className="button button-secondary"
                        disabled={busy || syncBusy}
                        onClick={() => setConfirm({category:'recipe',id:conflict.id,choice:'keep-local'})}>
                        Keep device version
                      </button>
                      <button type="button" className="button button-secondary"
                        disabled={busy || syncBusy}
                        onClick={() => setConfirm({category:'recipe',id:conflict.id,choice:'use-cloud'})}>
                        Use cloud version
                      </button>
                    </div>
                  ) : <p className="recovery-manual">Cloud recipe is unavailable.
                    Export a backup and review this item manually; nothing will be overwritten.</p>}
                </article>
              );
            })}
            {data.collections.map(conflict => (
              <article className="recovery-item" key={conflict.id}>
                <div className="recovery-item-heading">
                  <CircleAlert size={18}/>
                  <div><strong>Collection conflict</strong>
                    <small>Organizing changes · {conflict.reason}</small></div>
                </div>
                <div className="recovery-comparison">
                  <div><span>On this device</span>
                    <strong>{conflict.local.collections.length} collection(s)</strong></div>
                  <div><span>Cloud version</span>
                    <strong>{conflict.remote.collections.length} collection(s)</strong></div>
                </div>
                <div className="recovery-actions">
                  <button type="button" className="button button-secondary"
                    disabled={busy || syncBusy}
                    onClick={() => setConfirm({category:'collection',id:conflict.id,choice:'keep-local'})}>
                    Keep device version
                  </button>
                  <button type="button" className="button button-secondary"
                    disabled={busy || syncBusy}
                    onClick={() => setConfirm({category:'collection',id:conflict.id,choice:'use-cloud'})}>
                    Use cloud version
                  </button>
                </div>
              </article>
            ))}
            {data.failedRecipes.map(item => (
              <article className="recovery-item recovery-item--blocked" key={item.mutationId}>
                <strong>Recipe upload blocked</strong>
                <p>Change {item.resourceId.slice(0, 8)} · {item.lastErrorCode ?? 'Unknown server rejection'}.
                  The last upload was rejected. You can correct the local recipe and requeue its current draft.</p>
                <div className="recovery-actions">
                  <button type="button" className="button button-secondary"
                    disabled={busy || syncBusy} onClick={() => onEditRecipe(item.resourceId)}>
                    Edit local recipe
                  </button>
                  <button type="button" className="button button-secondary"
                    disabled={busy || syncBusy}
                    onClick={() => setConfirm({category:'blocked-recipe',id:item.resourceId,choice:'retry'})}>
                    Requeue current draft
                  </button>
                </div>
              </article>
            ))}
            {data.failedCollections.map(item => (
              <article className="recovery-item recovery-item--blocked" key={item.mutationId}>
                <strong>Collection upload blocked</strong>
                <p>{item.lastErrorCode ?? 'Unknown server rejection'}.
                  The local collection arrangement is preserved. Download a backup before requeuing it.</p>
                <div className="recovery-actions">
                  <button type="button" className="button button-secondary"
                    disabled={busy || syncBusy}
                    onClick={() => setConfirm({category:'blocked-collection',id:'collections',choice:'retry'})}>
                    Requeue collections
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {confirm && (
          <div className="recovery-confirm" role="group" aria-label="Confirm conflict resolution">
            <strong>{confirm.choice === 'use-cloud'
              ? 'Replace your local version with the cloud version?'
              : confirm.choice === 'retry'
                ? 'Requeue the current local draft as a fresh upload?'
                : 'Submit this device’s version as a new cloud change?'}</strong>
            <p>{confirm.choice === 'use-cloud'
              ? 'Local unsynced edits for this item will be discarded. Download a backup first.'
              : confirm.choice === 'retry'
                ? 'The rejected upload identifiers will be replaced by a new attempt containing your latest saved device draft. It may fail again if the original validation issue remains. Download a backup first.'
                : 'Your existing device version will remain, and a fresh mutation will be queued. A newer cloud edit can still cause another conflict.'}
              {proposed ? ' The cloud revision will be verified again before applying.' : ''}</p>
            <div className="recovery-actions">
              <button type="button" className="button button-secondary"
                disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="button button-primary"
                disabled={busy || syncBusy} onClick={() => void resolve()}>
                {busy ? 'Checking…' : 'Confirm choice'}
              </button>
            </div>
          </div>
        )}
        <div className="recovery-footer">
          <button type="button" className="button button-secondary"
            disabled={busy} onClick={() => {setError(null);void refresh();}}>
            <RefreshCw size={15}/> Refresh status
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
