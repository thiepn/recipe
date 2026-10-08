import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { RecipeLocalDb, type LocalRecipeRecord } from '../src/data/local-db.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import { newIngredient, newStep } from '../src/library/editor.ts';
import {
  KitchenSessionStore, createKitchenSession, dismissKitchenTimer, kitchenSessionSchema,
  pauseKitchenTimer, remainingTimerSeconds, restoreKitchenSession, resumeKitchenTimer,
  startKitchenTimer, timerState, updateKitchenSession,
} from '../src/kitchen/session.ts';

const accountA='11111111-1111-4111-8111-111111111111';
const accountB='22222222-2222-4222-8222-222222222222';
let db: RecipeLocalDb | undefined;
afterEach(()=>{db?.close();db=undefined;});

function fixture(accountId=accountA):LocalRecipeRecord {
  const document=createBlankRecipe('Vegetable soup');
  const step={...newStep(document.version.id,crypto.randomUUID(),0),instruction:'Cut vegetables'};
  const second={...newStep(document.version.id,crypto.randomUUID(),1),instruction:'Simmer'};
  const ingredient={...newIngredient(document.version.id,crypto.randomUUID(),0),name:'carrot',quantity:2};
  const working={
    ...document,
    version:{...document.version,servings:2},
    steps:[step,second],ingredients:[ingredient],
  };
  return {accountId,resourceId:document.recipe.id,working,base:null,serverRevision:0,
    localRevision:1,syncState:'pending',tombstone:false,updatedAt:0};
}
const tid=()=>crypto.randomUUID();

describe('P11 cooking session model',()=>{
 it('starts an editable session without modifying the recipe',()=>{
  const record=fixture();
  const original=JSON.stringify(record.working);
  const session=createKitchenSession(record.working,100);
  expect(session.currentStepId).toBe(record.working.steps[0]?.id);
  expect(session.servings).toBe(2);
  expect(session.completedStepIds).toEqual([]);
  expect(JSON.stringify(record.working)).toBe(original);
 });
 it('restores ingredient ticks, completed steps, serving count and selected step',()=>{
  const record=fixture();
  const original=createKitchenSession(record.working,100);
  const updated=updateKitchenSession(original,{
    checkedIngredientIds:[record.working.ingredients[0]!.id],
    completedStepIds:[record.working.steps[0]!.id],
    currentStepId:record.working.steps[1]!.id,
    servings:5,
  },200);
  const restored=restoreKitchenSession(updated,record.working,201);
  expect(restored).toMatchObject({
    checkedIngredientIds:[record.working.ingredients[0]!.id],
    completedStepIds:[record.working.steps[0]!.id],
    currentStepId:record.working.steps[1]!.id,servings:5,
  });
 });
 it('keeps independently expiring simultaneous timers',()=>{
  let session=createKitchenSession(fixture().working,1000);
  session=startKitchenTimer(session,'Pasta',120,tid(),1000);
  session=startKitchenTimer(session,'Sauce',30,tid(),2000);
  expect(session.timers).toHaveLength(2);
  expect(remainingTimerSeconds(session.timers[0]!,8000)).toBe(113);
  expect(remainingTimerSeconds(session.timers[1]!,8000)).toBe(24);
  const restored=restoreKitchenSession(session,{...fixture().working,recipe:{...fixture().working.recipe,id:session.recipeId}},50_000);
  // A different recipe version can retain timers even when its rows change.
  expect(restored?.timers.map(t=>t.status)).toEqual(['running','finished']);
  expect(restored?.timers[1]?.remainingSeconds).toBe(0);
 });
 it('pauses one timer while another continues and resumes from exact remaining time',()=>{
  let session=createKitchenSession(fixture().working,0);
  session=startKitchenTimer(session,'Rice',100,tid(),1000);
  session=startKitchenTimer(session,'Stew',200,tid(),1000);
  const firstId=session.timers[0]!.id;
  session=pauseKitchenTimer(session,firstId,31_000);
  expect(session.timers[0]).toMatchObject({status:'paused',deadlineAt:null,remainingSeconds:70});
  expect(session.timers[1]?.status).toBe('running');
  expect(remainingTimerSeconds(session.timers[0]!,90_000)).toBe(70);
  session=resumeKitchenTimer(session,firstId,90_000);
  expect(session.timers[0]).toMatchObject({status:'running',deadlineAt:160_000});
 });
 it('recognizes timeouts without relying on background setInterval ticks',()=>{
  let session=createKitchenSession(fixture().working,0);
  session=startKitchenTimer(session,'Oven',90,tid(),10_000);
  expect(timerState(session.timers[0]!,90_000)).toBe('running');
  expect(timerState(session.timers[0]!,101_000)).toBe('finished');
  expect(remainingTimerSeconds(session.timers[0]!,999_000)).toBe(0);
 });
 it('rejects invalid timer input and caps timer count at eight',()=>{
  let session=createKitchenSession(fixture().working);
  expect(()=>startKitchenTimer(session,'Bad',0,tid(),1)).toThrow();
  expect(()=>startKitchenTimer(session,'Bad',43_201,tid(),1)).toThrow();
  for(let i=0;i<8;i++)session=startKitchenTimer(session,`Timer ${i}`,60,tid(),10);
  expect(session.timers).toHaveLength(8);
  expect(()=>startKitchenTimer(session,'Overflow',60,tid(),10)).toThrow();
  const id=session.timers[3]!.id;
  session=dismissKitchenTimer(session,id,11);
  expect(session.timers).toHaveLength(7);
  expect(session.timers.some(t=>t.id===id)).toBe(false);
 });
 it('drops removed ingredient/step IDs after recipe edits, retaining unrelated progress',()=>{
  const record=fixture();
  const session=updateKitchenSession(createKitchenSession(record.working),{
    checkedIngredientIds:[record.working.ingredients[0]!.id,tid()],
    completedStepIds:[record.working.steps[0]!.id,tid()],
    currentStepId:tid(),
  },200);
  const modified={...record.working,
    ingredients:[],steps:[record.working.steps[1]!]};
  const restored=restoreKitchenSession(session,modified,300);
  expect(restored?.checkedIngredientIds).toEqual([]);
  expect(restored?.completedStepIds).toEqual([]);
  expect(restored?.currentStepId).toBe(modified.steps[0]?.id);
 });
 it('rejects unrelated, malformed or poisoned persisted snapshots',()=>{
  const record=fixture();
  const session=createKitchenSession(record.working);
  expect(restoreKitchenSession({...session,recipeId:tid()},record.working)).toBeNull();
  expect(restoreKitchenSession({...session,timers:Array(9).fill({})},record.working)).toBeNull();
  expect(restoreKitchenSession({__proto__:null,...session,servings:Infinity},record.working)).toBeNull();
  expect(kitchenSessionSchema.safeParse({...session,accountId:accountB}).success).toBe(false);
 });
});

describe('P11 owner-scoped durable sessions',()=>{
 it('survives a new store instance, lists both recipes and isolates users',async()=>{
  db=await RecipeLocalDb.open(indexedDB);
  const a=fixture(),b=fixture();
  const writer=new KitchenSessionStore(db,accountA);
  const sessionA=updateKitchenSession(createKitchenSession(a.working),{
    completedStepIds:[a.working.steps[0]!.id],
  },5000);
  await Promise.all([writer.save(sessionA),writer.save(createKitchenSession(b.working,1000))]);
  const reopened=new KitchenSessionStore(db,accountA);
  expect((await reopened.load(a))?.completedStepIds).toEqual([a.working.steps[0]!.id]);
  expect((await reopened.list([a,b])).map(s=>s.recipeId)).toEqual([a.resourceId,b.resourceId]);
  expect(await new KitchenSessionStore(db,accountB).load({...a,accountId:accountB})).toBeNull();
 });
 it('serializes rapid writes and allows resetting a single recipe without clearing others',async()=>{
  db=await RecipeLocalDb.open(indexedDB);
  const a=fixture(),b=fixture();
  const store=new KitchenSessionStore(db,accountA);
  const initial=createKitchenSession(a.working,1);
  const later=updateKitchenSession(initial,{servings:4},2);
  const last=updateKitchenSession(later,{servings:6},3);
  await Promise.all([store.save(initial),store.save(later),store.save(last),store.save(createKitchenSession(b.working,4))]);
  expect((await store.load(a))?.servings).toBe(6);
  await store.clear(a.resourceId);
  expect(await store.load(a)).toBeNull();
  expect(await store.load(b)).not.toBeNull();
 });
 it('clears sessions along with all user local data on Account sign-out',async()=>{
  db=await RecipeLocalDb.open(indexedDB);
  const a=fixture();
  const store=new KitchenSessionStore(db,accountA);
  await store.save(createKitchenSession(a.working,10));
  expect(await store.load(a)).not.toBeNull();
  await db.wipeAccount(accountA);
  expect(await store.load(a)).toBeNull();
 });
});
