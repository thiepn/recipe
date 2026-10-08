import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { RecipeLocalDb, type LocalRecipeRecord } from '../src/data/local-db.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import { newStep } from '../src/library/editor.ts';
import { assignMeal, emptyMealPlanner, mealPlannerStoreFor } from '../src/planning/model.ts';
import { createKitchenSession, kitchenSessionStoreFor } from '../src/kitchen/session.ts';
import { RecipeWorkspaceSync, canonicalJson } from '../src/workspace/sync.ts';
import type { RecipeCoreApi } from '../src/api/core.ts';
import type { WorkspaceKind } from '../src/workspace/contracts.ts';

const owner='11111111-1111-4111-8111-111111111111';
type API=Pick<RecipeCoreApi,'workspaceList'|'workspaceApply'>;
type RemoteRow={
 kind:WorkspaceKind;resourceKey:string;revision:number;
 document:unknown|null;updatedAt:string;
};
const time='2026-10-08T20:00:00Z';
const uuid=()=>crypto.randomUUID();

class Server {
  readonly rows=new Map<string,RemoteRow>();
  readonly calls:Array<{kind:WorkspaceKind;resourceKey:string;baseRevision:number}>=[];
  api():API {
    return {
      workspaceList:async()=>({schemaVersion:1 as const,documents:[...this.rows.values()]}),
      workspaceApply:async input=>{
        this.calls.push({kind:input.kind,resourceKey:input.resourceKey,
          baseRevision:input.baseRevision});
        const k=`${input.kind}:${input.resourceKey}`;
        const old=this.rows.get(k);
        if((old?.revision??0)!==input.baseRevision){
          return {status:'conflict' as const,revision:old?.revision??0,
            document:old?.document??null,updatedAt:old?.updatedAt??time};
        }
        const next:{kind:WorkspaceKind;resourceKey:string;revision:number;document:unknown|null;updatedAt:string}={
          kind:input.kind,resourceKey:input.resourceKey,
          revision:(old?.revision??0)+1,document:input.document,updatedAt:time,
        };
        this.rows.set(k,next);
        return {status:'applied' as const,revision:next.revision,
          document:next.document,updatedAt:next.updatedAt};
      },
    } as API;
  }
}

const handles:RecipeLocalDb[]=[];
afterEach(()=>{for(const h of handles)h.close();handles.length=0;});
async function open(){
 const db=await RecipeLocalDb.open(new IDBFactory());handles.push(db);return db;
}
function meal(record:LocalRecipeRecord,servings=2){
 return assignMeal(emptyMealPlanner(100),'2026-10-08','dinner',record.resourceId,servings,200);
}
function fixture():LocalRecipeRecord{
 const d=createBlankRecipe('Pasta');
 const working={
   ...d,
   version:{...d.version,servings:2},
   steps:[{...newStep(d.version.id,uuid(),0),instruction:'Mix'}],
 };
 return {accountId:owner,resourceId:d.recipe.id,working,base:null,
   serverRevision:0,localRevision:1,syncState:'pending',
   tombstone:false,updatedAt:100};
}
async function buildWithRecord(record:LocalRecipeRecord){
 const db=await open();
 await db.putDocument(record);
 return db;
}

describe('P13 lossless cross-device workspace',()=>{
 it('canonicalizes Postgres JSONB key ordering without phantom edits',()=>{
  expect(canonicalJson({b:1,a:{z:2,x:1}}))
    .toBe(canonicalJson({a:{x:1,z:2},b:1}));
  expect(canonicalJson([1,2])).not.toBe(canonicalJson([2,1]));
 });
 it('pushes an existing local planner, then pulls it on another device',async()=>{
  const record=fixture(),server=new Server();
  const a=await buildWithRecord(record),b=await buildWithRecord(record);
  await mealPlannerStoreFor(a,owner).save(meal(record));
  const one=new RecipeWorkspaceSync(a,server.api(),owner);
  const two=new RecipeWorkspaceSync(b,server.api(),owner);
  expect((await one.syncOnce()).pushed).toBe(1);
  expect(server.rows.get('plan:main')?.revision).toBe(1);
  expect((await two.syncOnce()).pulled).toBe(1);
  expect((await mealPlannerStoreFor(b,owner).load()).entries).toHaveLength(1);
 });
 it('never clobbers independently created local documents on a second device',async()=>{
  const record=fixture(),server=new Server();
  const a=await buildWithRecord(record),b=await buildWithRecord(record);
  await mealPlannerStoreFor(a,owner).save(meal(record,2));
  await mealPlannerStoreFor(b,owner).save(meal(record,4));
  await new RecipeWorkspaceSync(a,server.api(),owner).syncOnce();
  const result=await new RecipeWorkspaceSync(b,server.api(),owner).syncOnce();
  expect(result.status).toBe('conflict');
  expect(result.conflicts).toHaveLength(1);
  expect((await mealPlannerStoreFor(b,owner).load()).entries[0]?.servings).toBe(4);
 });
 it('keeps local edits after explicit resolution, then pushes at the new revision',async()=>{
  const record=fixture(),server=new Server();
  const a=await buildWithRecord(record),b=await buildWithRecord(record);
  const sa=mealPlannerStoreFor(a,owner),sb=mealPlannerStoreFor(b,owner);
  await sa.save(meal(record,2));
  const as=new RecipeWorkspaceSync(a,server.api(),owner);
  const bs=new RecipeWorkspaceSync(b,server.api(),owner);
  await as.syncOnce();await bs.syncOnce();
  await sa.save(meal(record,3));await as.syncOnce();
  await sb.save(meal(record,4));
  const result=await bs.syncOnce();
  expect(result.conflicts).toHaveLength(1);
  await bs.resolve(result.conflicts[0]!,'keep-local');
  expect((await bs.syncOnce()).pushed).toBe(1);
  expect((server.rows.get('plan:main')?.document as ReturnType<typeof meal>).entries[0]?.servings).toBe(4);
 });
 it('replaces local state only after explicit use-cloud decision',async()=>{
  const record=fixture(),server=new Server();
  const a=await buildWithRecord(record),b=await buildWithRecord(record);
  await mealPlannerStoreFor(a,owner).save(meal(record,3));
  await mealPlannerStoreFor(b,owner).save(meal(record,5));
  await new RecipeWorkspaceSync(a,server.api(),owner).syncOnce();
  const sync=new RecipeWorkspaceSync(b,server.api(),owner);
  const c=(await sync.syncOnce()).conflicts[0]!;
  expect((await mealPlannerStoreFor(b,owner).load()).entries[0]?.servings).toBe(5);
  await sync.resolve(c,'use-cloud');
  expect((await mealPlannerStoreFor(b,owner).load()).entries[0]?.servings).toBe(3);
  expect((await sync.syncOnce()).conflicts).toEqual([]);
 });
 it('persists and restores an account-scoped cooking session',async()=>{
  const record=fixture(),server=new Server();
  const a=await buildWithRecord(record),b=await buildWithRecord(record);
  const session=createKitchenSession(record.working);
  await kitchenSessionStoreFor(a,owner).save({...session,
    completedStepIds:[record.working.steps[0]!.id]});
  const aSync=new RecipeWorkspaceSync(a,server.api(),owner);
  const bSync=new RecipeWorkspaceSync(b,server.api(),owner);
  expect((await aSync.syncOnce()).pushed).toBe(1);
  expect((await bSync.syncOnce()).pulled).toBe(1);
  expect((await kitchenSessionStoreFor(b,owner).load(record))?.completedStepIds)
    .toEqual([record.working.steps[0]!.id]);
 });
 it('propagates explicit session deletion as a tombstone and prevents resurrection',async()=>{
  const record=fixture(),server=new Server();
  const a=await buildWithRecord(record),b=await buildWithRecord(record);
  const sa=kitchenSessionStoreFor(a,owner),sb=kitchenSessionStoreFor(b,owner);
  await sa.save(createKitchenSession(record.working));
  const aSync=new RecipeWorkspaceSync(a,server.api(),owner);
  const bSync=new RecipeWorkspaceSync(b,server.api(),owner);
  await aSync.syncOnce();await bSync.syncOnce();
  await sa.clear(record.resourceId);
  await aSync.syncOnce();
  expect(server.rows.get(`session:${record.resourceId}`)?.document).toBeNull();
  await bSync.syncOnce();
  expect(await sb.load(record)).toBeNull();
  expect((await bSync.syncOnce()).pushed).toBe(0);
 });
 it('refuses a server revision rollback rather than clearing local work',async()=>{
  const record=fixture(),server=new Server();
  const db=await buildWithRecord(record);
  const store=mealPlannerStoreFor(db,owner);
  await store.save(meal(record));
  const sync=new RecipeWorkspaceSync(db,server.api(),owner);
  await sync.syncOnce();
  server.rows.clear();
  const report=await sync.syncOnce();
  expect(report.status).toBe('conflict');
  expect(report.conflicts).toHaveLength(1);
  expect((await store.load()).entries).toHaveLength(1);
 });
 it('does not throw away unsynced changes after network errors',async()=>{
  const record=fixture(),db=await buildWithRecord(record);
  await mealPlannerStoreFor(db,owner).save(meal(record));
  const failing:API={
    workspaceList:async()=>{throw new Error('offline');},
    workspaceApply:async()=>{throw new Error('offline');},
  };
  const sync=new RecipeWorkspaceSync(db,failing,owner);
  await expect(sync.syncOnce()).rejects.toThrow('offline');
  expect((await mealPlannerStoreFor(db,owner).load()).entries).toHaveLength(1);
 });
});
