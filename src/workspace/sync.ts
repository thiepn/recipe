import { z } from 'zod';
import { canonicalJson } from './canonical.ts';
import type { RecipeCoreApi } from '../api/core.ts';
import type { RecipeLocalDb, LocalRecipeRecord } from '../data/local-db.ts';
import { mealPlannerSchema, mealPlannerStoreFor } from '../planning/model.ts';
import { kitchenSessionSchema, kitchenSessionStoreFor } from '../kitchen/session.ts';
import {
  workspaceKey, type WorkspaceKind, type WorkspaceRemote,
} from './contracts.ts';

export interface WorkspaceConflict {
  kind: WorkspaceKind;
  resourceKey: string;
  local: unknown | null;
  remote: unknown | null;
  remoteRevision: number;
}
export type WorkspaceSyncResult={
  status:'synced'|'conflict';
  pulled:number;
  pushed:number;
  conflicts:WorkspaceConflict[];
};

const baseSchema=z.object({
  revision:z.number().int().nonnegative(),
  document:z.unknown().nullable(),
}).strict();
type Base=z.infer<typeof baseSchema>;
const metaBase=(kind:WorkspaceKind,key:string)=>
  `workspace-base-v1:${workspaceKey(kind,key)}`;
const localKey=(kind:WorkspaceKind,key:string)=>
  kind==='plan'?'meal-plan-v1':`kitchen-session-v1:${key}`;

export { canonicalJson } from './canonical.ts';
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);

/**
 * Cloud continuity sits alongside existing local-first stores. Nothing is
 * uploaded without enabling the client flag and a qualified Core endpoint.
 * Local edits are never overwritten when server and device both changed.
 */
export class RecipeWorkspaceSync {
  readonly #db:RecipeLocalDb;
  readonly #api:Pick<RecipeCoreApi,'workspaceList'|'workspaceApply'>;
  readonly #accountId:string;
  #running:Promise<WorkspaceSyncResult>|null=null;

  constructor(db:RecipeLocalDb,api:Pick<RecipeCoreApi,'workspaceList'|'workspaceApply'>,accountId:string){
    this.#db=db;this.#api=api;this.#accountId=accountId;
  }

  async #readLocal(kind:WorkspaceKind,key:string,record?:LocalRecipeRecord):Promise<unknown|null>{
    const rawKey=localKey(kind,key);
    if(kind==='session' && !record){
      record=await this.#db.getDocument(this.#accountId,key);
    }
    if(kind==='plan'){
      // Wait until queued edits from the Plan page have reached IndexedDB.
      await mealPlannerStoreFor(this.#db,this.#accountId).load();
    }else if(record){
      await kitchenSessionStoreFor(this.#db,this.#accountId).load(record);
    }
    const raw=await this.#db.getMeta<unknown>(this.#accountId,rawKey);
    if(raw===undefined||raw===null)return null;
    const parsed=(kind==='plan'?mealPlannerSchema:kitchenSessionSchema).safeParse(raw);
    if(!parsed.success)throw new Error('Invalid local Recipe workspace data; refusing cloud overwrite');
    return parsed.data;
  }

  async #writeLocal(kind:WorkspaceKind,key:string,value:unknown|null):Promise<void>{
    if(kind==='plan'){
      const store=mealPlannerStoreFor(this.#db,this.#accountId);
      if(value===null)await store.clear();
      else await store.save(mealPlannerSchema.parse(value));
    }else{
      const store=kitchenSessionStoreFor(this.#db,this.#accountId);
      if(value===null)await store.clear(key);
      else await store.save(kitchenSessionSchema.parse(value));
    }
  }

  async #base(kind:WorkspaceKind,key:string):Promise<Base|null>{
    const raw=await this.#db.getMeta<unknown>(this.#accountId,metaBase(kind,key));
    return baseSchema.safeParse(raw).data??null;
  }
  async #saveBase(kind:WorkspaceKind,key:string,revision:number,document:unknown|null){
    await this.#db.setMeta(this.#accountId,metaBase(kind,key),{revision,document});
  }

  syncOnce():Promise<WorkspaceSyncResult>{
    if(this.#running)return this.#running;
    this.#running=this.#sync().finally(()=>{this.#running=null;});
    return this.#running;
  }

  async #sync():Promise<WorkspaceSyncResult>{
    const remote=await this.#api.workspaceList();
    const remoteMap=new Map<string,WorkspaceRemote>(
      remote.documents.map(row=>[workspaceKey(row.kind,row.resourceKey),row]),
    );
    const records=await this.#db.listDocuments(this.#accountId);
    const byRecipe=new Map(records.filter(row=>!row.tombstone).map(row=>[row.resourceId,row]));
    const keys:[WorkspaceKind,string][]=[['plan','main']];
    for(const recipeId of byRecipe.keys())keys.push(['session',recipeId]);
    const conflicts:WorkspaceConflict[]=[];
    let pulled=0,pushed=0;

    for(const [kind,key] of keys){
      const record=kind==='session'?byRecipe.get(key):undefined;
      const server=remoteMap.get(workspaceKey(kind,key));
      const remoteRev=server?.revision??0;
      const remoteDoc=server?.document??null;
      const local=await this.#readLocal(kind,key,record);
      const base=await this.#base(kind,key);
      const baseRev=base?.revision??0;
      const previouslySynced=base!==null;
      const localDirty=previouslySynced?!same(local,base.document):local!==null;

      // Reject missing/rolled-back or tampered server revisions. A remote
      // outage/reinitialization must never silently erase a local cookbook.
      if(base && (
        remoteRev<base.revision ||
        (remoteRev===base.revision && !same(remoteDoc,base.document))
      )){
        conflicts.push({kind,resourceKey:key,local,remote:remoteDoc,remoteRevision:remoteRev});
        continue;
      }

      if(!localDirty){
        if(remoteRev===baseRev && (previouslySynced||remoteRev===0))continue;
        // Do not replace a local edit made while the remote request was in flight.
        if(!same(await this.#readLocal(kind,key,record),local))continue;
        await this.#writeLocal(kind,key,remoteDoc);
        await this.#saveBase(kind,key,remoteRev,remoteDoc);
        pulled++;
        continue;
      }

      if(remoteRev!==baseRev || (!previouslySynced&&remoteRev>0)){
        if(same(local,remoteDoc)){
          await this.#saveBase(kind,key,remoteRev,remoteDoc);
          continue;
        }
        conflicts.push({kind,resourceKey:key,local,remote:remoteDoc,remoteRevision:remoteRev});
        continue;
      }

      const response=await this.#api.workspaceApply({
        kind,resourceKey:key,baseRevision:baseRev,document:local,
      });
      if(response.status==='conflict'){
        if(same(local,response.document)){
          await this.#saveBase(kind,key,response.revision,response.document);
        }else{
          conflicts.push({
            kind,resourceKey:key,local,remote:response.document,
            remoteRevision:response.revision,
          });
        }
      }else{
        // Keep any new local edits; acknowledgement records the submitted version.
        await this.#saveBase(kind,key,response.revision,local);
        pushed++;
      }
    }
    return {status:conflicts.length?'conflict':'synced',pulled,pushed,conflicts};
  }

  async resolve(conflict:WorkspaceConflict,choice:'keep-local'|'use-cloud'):Promise<void>{
    const key=workspaceKey(conflict.kind,conflict.resourceKey);
    // The dialog is only a snapshot. Re-read cloud state before honoring
    // either choice; never accept an expired version as the new baseline.
    const latest=await this.#api.workspaceList();
    const remote=latest.documents.find(row=>
      workspaceKey(row.kind,row.resourceKey)===key);
    const revision=remote?.revision??0;
    const document=remote?.document??null;
    if(revision!==conflict.remoteRevision || !same(document,conflict.remote))
      throw new Error('Cloud changed since this conflict. Sync again before resolving.');

    const existing=await this.#base(conflict.kind,conflict.resourceKey);
    if(existing && existing.revision>revision)
      throw new Error('A newer cloud revision is already known. Sync again.');

    const local=await this.#readLocal(conflict.kind,conflict.resourceKey);
    if(choice==='use-cloud'){
      // A user choosing an older dialog must never discard edits made locally
      // while the dialog was open.
      if(!same(local,conflict.local))
        throw new Error('This device changed since the conflict. Sync again.');
      await this.#writeLocal(conflict.kind,conflict.resourceKey,document);
    }
    // Keep-local preserves the freshest device data, including edits made
    // after the dialog opened. A subsequent CAS push checks cloud revision.
    await this.#saveBase(conflict.kind,conflict.resourceKey,revision,document);
  }
}
