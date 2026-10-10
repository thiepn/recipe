import { afterEach,describe,expect,it } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import type { LocalRecipeRecord } from '../src/data/local-db.ts';
import { RecipeLocalDb } from '../src/data/local-db.ts';
import { createBlankRecipe } from '../src/library/create.ts';
import { newIngredient,newStep } from '../src/library/editor.ts';
import { EMPTY_PANTRY } from '../src/library/ingredients.ts';
import {addHiddenIngredient,cleanCookingPreferences,contextualSubstitutionNotes,
 DEFAULT_COOKING_PREFERENCES,suggestCookingIdeas} from '../src/intelligence/suggestions.ts';

const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const pantry={...EMPTY_PANTRY,ingredients:['tomato','olive oil','lime']};
const preferences={...DEFAULT_COOKING_PREFERENCES,enabled:true};
let db:RecipeLocalDb|undefined;
afterEach(()=>{db?.close();db=undefined;});
function rec(title:string,owner=A,ingredients:string[]=['tomato'],minutes:number|null=25):LocalRecipeRecord{
 const base=createBlankRecipe(title);
 return {accountId:owner,resourceId:base.recipe.id,working:{
  ...base,recipe:{...base.recipe,favorite:false},
  version:{...base.version,totalMinutes:minutes},
  ingredients:ingredients.map((name,i)=>({...newIngredient(base.version.id,crypto.randomUUID(),i),name})),
  steps:[{...newStep(base.version.id,crypto.randomUUID(),0),instruction:'Sauté the ingredients for a few minutes.'}],
 },base:null,serverRevision:0,localRevision:1,syncState:'pending',tombstone:false,updatedAt:1};
}
describe('P19 local cooking intelligence safety and reproducibility',()=>{
 it('is off by default and rejects records from another Account even when passed in',()=>{
  const mine=rec('Mine'),others=rec('Private other',B);
  expect(suggestCookingIdeas([mine,others],pantry,DEFAULT_COOKING_PREFERENCES,A)).toEqual([]);
  expect(suggestCookingIdeas([mine,others],pantry,preferences,A).map(i=>i.title)).toEqual(['Mine']);
  expect(suggestCookingIdeas([mine],pantry,preferences,B)).toEqual([]);
  expect(suggestCookingIdeas([mine],pantry,preferences,null)).toEqual([]);
 });
 it('never calls pantry quantities available or manufactures unknown cooking duration',()=>{
  const a=rec('Quick',A,['tomato'],25);
  expect(suggestCookingIdeas([a],pantry,preferences,A)[0]?.reasons)
    .toContain('1 of 1 required ingredient types on your pantry list');
  expect(suggestCookingIdeas([a],pantry,preferences,A)[0]?.reasons)
    .toContain('Recipe lists 25 minutes (estimate only)');
 });
 it('compares documented ingredient types, filters unknown duration, and deterministically breaks ties',()=>{
  const a=rec('Beta',A,['tomato','garlic'],20);
  const b=rec('Alpha',A,['tomato','garlic'],20);
  const unknown=rec('Unknown',A,['tomato'],null);
  expect(suggestCookingIdeas([a,b,unknown],pantry,{...preferences,maxMinutes:30},A)
   .map(x=>x.title)).toEqual(['Alpha','Beta']);
  const item=suggestCookingIdeas([a],pantry,preferences,A)[0]!;
  expect(item.missing).toEqual(['garlic']);
  expect(item.reasons).toContain('1 of 2 required ingredient types on your pantry list');
  expect(item.reasons.some(x=>x.includes('amounts'))).toBe(false);
  expect(suggestCookingIdeas([unknown],pantry,preferences,A)[0]?.reasons)
   .toContain('No recorded cooking time');
 });
 it('does not accept hidden names as allergy clearance or assume missing ingredient lists are safe',()=>{
  const a=rec('Contains milk',A,['milk','tomato']);
  const empty=rec('No ingredients',A,[]);
  const raw={...preferences,hiddenIngredients:['milch']};
  expect(suggestCookingIdeas([a,empty],pantry,raw,A)).toHaveLength(0);
  expect(()=>addHiddenIngredient(preferences,'milk, eggs')).toThrow();
  expect(()=>addHiddenIngredient(preferences,'')).toThrow();
  expect(cleanCookingPreferences({...preferences,hiddenIngredients:['milk','milch']}).hiddenIngredients).toEqual(['milk']);
  expect(cleanCookingPreferences({...preferences,maxMinutes:'tomorrow'}).enabled).toBe(false);
  expect(cleanCookingPreferences({...preferences,hiddenIngredients:Array(13).fill('x')}).enabled).toBe(false);
 });
 it('offers a conditional note without baking conversion or ingredient mutation',()=>{
  const saute=rec('Pan supper',A,['butter'],25);
  const before=structuredClone(saute.working);
  expect(contextualSubstitutionNotes(saute,pantry).join('')).toContain('olive oil');
  expect(saute.working).toEqual(before);
  const baking={...saute,working:{...saute.working,version:{...saute.working.version,categoryTags:['baking']}}};
  expect(contextualSubstitutionNotes(baking,pantry)).toEqual([]);
  expect(contextualSubstitutionNotes(saute,{...EMPTY_PANTRY,ingredients:[]})).toEqual([]);
 });
 it('persists preferences in owner-specific IndexedDB metadata, deletes on Account wipe',async()=>{
  db=await RecipeLocalDb.open(indexedDB);
  await db.setMeta(A,'cooking-preferences-v1',{...preferences,maxMinutes:30});
  expect(cleanCookingPreferences(await db.getMeta(A,'cooking-preferences-v1')).maxMinutes).toBe(30);
  expect(cleanCookingPreferences(await db.getMeta(B,'cooking-preferences-v1')).enabled).toBe(false);
  await db.wipeAccount(A);
  expect(cleanCookingPreferences(await db.getMeta(A,'cooking-preferences-v1')).enabled).toBe(false);
 });
});
