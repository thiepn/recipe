import { afterEach, describe, expect, it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { RecipeLocalDb, type LocalRecipeRecord } from '../src/data/local-db.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import { newIngredient, newStep } from '../src/library/editor.ts';
import {
  MealPlannerStore, mealPlannerStoreFor, addDays, addManualItem, amountLabel, assignMeal,
  cleanMealPlanner, emptyMealPlanner, localToday, mondayOf,
  removeManualItem, shoppingRows, shoppingText, toggleManualItem,
  togglePurchased, weekDays,
} from '../src/planning/model.ts';

const ownerA='11111111-1111-4111-8111-111111111111';
const ownerB='22222222-2222-4222-8222-222222222222';
const WEEK='2026-10-05';
const nextId=()=>crypto.randomUUID();
let db:RecipeLocalDb | undefined;
afterEach(()=>{db?.close();db=undefined;});

function recipe(name:string,ingredients:Array<{name:string;quantity:number|null;unit:string|null;scalingMode?:'linear'|'fixed'|'seasoning'|'contextual';optional?:boolean;preparation?:string|null;quantityMax?:number|null}>,servings:number|null=2): LocalRecipeRecord {
 const base=createBlankRecipe(name);
 const working={
  ...base,
  version:{...base.version,servings},
  ingredients:ingredients.map((i,index)=>({
   ...newIngredient(base.version.id,nextId(),index),
   name:i.name,quantity:i.quantity,unit:i.unit,optional:i.optional??false,
   scalingMode:i.scalingMode??'linear',preparation:i.preparation??null,
   quantityMax:i.quantityMax??null,
  })),
  steps:[{...newStep(base.version.id,nextId(),0),instruction:'Cook and serve'}],
 };
 return {
  accountId:ownerA,resourceId:base.recipe.id,working,base:null,serverRevision:0,
  localRevision:1,syncState:'pending',tombstone:false,updatedAt:0,
 };
}
describe('P12 calendar and meal-plan model',()=>{
 it('uses Monday as week start, including Sundays and month and year boundaries',()=>{
  expect(mondayOf('2026-10-08')).toBe('2026-10-05');
  expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  expect(weekDays('2026-10-08')).toEqual([
   '2026-10-05','2026-10-06','2026-10-07','2026-10-08',
   '2026-10-09','2026-10-10','2026-10-11',
  ]);
 });
 it('advances dates over daylight-saving and leap-day changes',()=>{
  expect(addDays('2026-10-25',1)).toBe('2026-10-26');
  expect(addDays('2028-02-28',1)).toBe('2028-02-29');
  expect(addDays('2028-02-29',1)).toBe('2028-03-01');
  expect(()=>mondayOf('2026-02-30')).toThrow();
  expect(localToday(new Date(2026,9,8))).toBe('2026-10-08');
 });
 it('assigns, replaces, removes a single meal without changing other slots',()=>{
  const a=recipe('Rice',[]);
  const b=recipe('Soup',[]);
  let p=emptyMealPlanner(0);
  p=assignMeal(p,'2026-10-08','dinner',a.resourceId,3,1);
  p=assignMeal(p,'2026-10-08','lunch',b.resourceId,2,2);
  p=assignMeal(p,'2026-10-08','dinner',b.resourceId,4,3);
  expect(p.entries).toHaveLength(2);
  expect(p.entries.find(x=>x.slot==='dinner')?.servings).toBe(4);
  p=assignMeal(p,'2026-10-08','dinner',null,null,4);
  expect(p.entries).toHaveLength(1);
  expect(p.entries[0]?.slot).toBe('lunch');
 });
 it('replaces malicious, unsupported or structurally invalid storage snapshots with defaults',()=>{
  expect(cleanMealPlanner({schemaVersion:999,entries:[]})).toMatchObject({
   schemaVersion:1,entries:[],manualItems:[],purchased:[],
  });
  expect(cleanMealPlanner({schemaVersion:1,entries:[{day:'2026-11-31'}]}).entries).toHaveLength(0);
  expect(cleanMealPlanner(null).manualItems).toHaveLength(0);
 });
});
describe('P12 safe generated shopping list',()=>{
 it('combines only compatible metric measurements and scales servings',()=>{
  const a=recipe('Pasta',[
   {name:'Tomatoes',quantity:0.5,unit:'kg'},
   {name:'Rice',quantity:100,unit:'g'},
  ]);
  const b=recipe('Curry',[
   {name:'tomato',quantity:250,unit:'g'},
   {name:'Rice',quantity:0.2,unit:'kg'},
  ]);
  let p=assignMeal(emptyMealPlanner(),'2026-10-05','lunch',a.resourceId,4);
  p=assignMeal(p,'2026-10-06','dinner',b.resourceId,2);
  const rows=shoppingRows(p,WEEK,[a,b]);
  const tomato=rows.find(r=>r.name==='Tomatoes');
  const rice=rows.find(r=>r.name==='Rice');
  expect(tomato).toMatchObject({amount:1250,unit:'g',contributions:2});
  expect(rice).toMatchObject({amount:400,unit:'g',contributions:2});
 });
 it('does not silently add cups, spoons, grams, pieces or unknown quantities',()=>{
  const r=recipe('Cake',[
   {name:'Flour',quantity:100,unit:'g'},
   {name:'Flour',quantity:2,unit:'cup'},
   {name:'Flour',quantity:null,unit:null},
   {name:'Butter',quantity:1,unit:'tbsp'},
   {name:'Butter',quantity:15,unit:'g'},
  ]);
  const p=assignMeal(emptyMealPlanner(),'2026-10-05','dinner',r.resourceId,2);
  expect(shoppingRows(p,WEEK,[r]).filter(x=>x.name==='Flour')).toHaveLength(3);
  expect(shoppingRows(p,WEEK,[r]).filter(x=>x.name==='Butter')).toHaveLength(2);
 });
 it('keeps ranges, fixed portions, optional ingredients and preparation distinctions explicit',()=>{
  const r=recipe('Salad',[
   {name:'Egg',quantity:2,unit:null,scalingMode:'fixed'},
   {name:'Egg',quantity:2,unit:null,scalingMode:'fixed'},
   {name:'Carrot',quantity:3,quantityMax:5,unit:null},
   {name:'Carrot',quantity:4,unit:null,preparation:'grated'},
   {name:'Mint',quantity:1,unit:'bunch',optional:true},
  ]);
  const p=assignMeal(emptyMealPlanner(),'2026-10-05','dinner',r.resourceId,5);
  const rows=shoppingRows(p,WEEK,[r]);
  expect(rows.filter(x=>x.name==='Egg')).toHaveLength(2);
  expect(rows.filter(x=>x.name==='Carrot')).toHaveLength(2);
  expect(rows.find(x=>x.name==='Mint')?.note).toBe('Optional ingredient');
  expect(rows.find(x=>x.name==='Egg')?.note).toContain('Fixed quantity');
  expect(rows.find(x=>x.name==='Carrot'&&x.amountMax!==null)?.amountMax).toBe(12.5);
 });
 it('marks pantry availability as ingredient-type only and does not hide it from the full list',()=>{
  const r=recipe('Rice bowl',[{name:'rice',quantity:300,unit:'g'}]);
  const p=assignMeal(emptyMealPlanner(),'2026-10-05','lunch',r.resourceId);
  expect(shoppingRows(p,WEEK,[r],['Reis'])[0]).toMatchObject({available:true,checked:false});
 });
 it('invalidates purchased tick when the computed quantity changes',()=>{
  const r=recipe('Soup',[{name:'water',quantity:200,unit:'ml'}]);
  let p=assignMeal(emptyMealPlanner(),'2026-10-05','lunch',r.resourceId,2);
  const first=shoppingRows(p,WEEK,[r])[0]!;
  p=togglePurchased(p,WEEK,first.key);
  expect(shoppingRows(p,WEEK,[r])[0]?.checked).toBe(true);
  p=assignMeal(p,'2026-10-05','lunch',r.resourceId,4);
  expect(shoppingRows(p,WEEK,[r])[0]?.checked).toBe(false);
 });
 it('does not fabricate shopping quantities for unknown recipe yield or missing recipes',()=>{
  const r=recipe('Porridge',[{name:'Oats',quantity:100,unit:'g'}],null);
  let p=assignMeal(emptyMealPlanner(),'2026-10-05','breakfast',r.resourceId,8);
  p=assignMeal(p,'2026-10-05','dinner',nextId(),2);
  expect(shoppingRows(p,WEEK,[r])).toHaveLength(1);
  expect(shoppingRows(p,WEEK,[r])[0]?.amount).toBe(100);
 });
});
describe('P12 manual groceries and durable account privacy',()=>{
 it('stores manual groceries independently for each week and exports checklist text',()=>{
  const id=nextId();
  let p=addManualItem(emptyMealPlanner(),WEEK,'Tea',id);
  p=toggleManualItem(p,id);
  expect(p.manualItems[0]?.checked).toBe(true);
  expect(shoppingText([],p.manualItems,'My list')).toContain('[x] Tea');
  p=removeManualItem(p,id);
  expect(p.manualItems).toHaveLength(0);
  expect(amountLabel({amount:null,amountMax:null,unit:null})).toBe('Amount unspecified');
 });
 it('reuses the exact same queued store across tab remounts',async()=>{
  db=await RecipeLocalDb.open(indexedDB);
  const first=mealPlannerStoreFor(db,ownerA);
  const second=mealPlannerStoreFor(db,ownerA);
  const other=mealPlannerStoreFor(db,ownerB);
  expect(second).toBe(first);
  expect(other).not.toBe(first);
  const r=recipe('Breakfast',[]);
  const saved=assignMeal(emptyMealPlanner(),WEEK,'breakfast',r.resourceId);
  const write=first.save(saved);
  expect((await second.load()).entries).toHaveLength(1);
  await write;
 });
 it('round-trips, serializes rapid writes, and isolates data by Account',async()=>{
  db=await RecipeLocalDb.open(indexedDB);
  const writer=new MealPlannerStore(db,ownerA);
  const r=recipe('Stew',[]);
  const first=assignMeal(emptyMealPlanner(),'2026-10-05','dinner',r.resourceId);
  const second=addManualItem(first,WEEK,'Tea',nextId());
  await Promise.all([writer.save(first),writer.save(second)]);
  const reopened=new MealPlannerStore(db,ownerA);
  expect((await reopened.load()).manualItems).toHaveLength(1);
  expect((await reopened.load()).entries).toHaveLength(1);
  const another=new MealPlannerStore(db,ownerB);
  expect((await another.load()).entries).toHaveLength(0);
  await db.wipeAccount(ownerA);
  expect((await reopened.load()).entries).toHaveLength(0);
 });
});
