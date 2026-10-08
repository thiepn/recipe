import {describe,expect,it} from 'vitest';
import {recipeEditableDocumentSchema} from '../src/api/protocol.ts';
import {createBlankRecipe} from '../src/library/create.ts';
import {
  finalizeRecipeEdits,moveRow,newIngredient,newStep,
} from '../src/library/editor.ts';

const ids=[
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 '44444444-4444-4444-8444-444444444444',
 '55555555-5555-4555-8555-555555555555',
 '66666666-6666-4666-8666-666666666666',
 '77777777-7777-4777-8777-777777777777',
];
function base(){
 let index=0;
 return createBlankRecipe('Rice bowl',{randomUUID:()=>ids[index++]!});
}
function filled(){
 const doc=base();
 const i1={...newIngredient(doc.version.id,ids[2]!,0),name:'rice',quantity:150,unit:'g',canonicalKey:'rice'};
 const i2={...newIngredient(doc.version.id,ids[3]!,1),name:'carrots',quantity:100,unit:'g'};
 const s1={...newStep(doc.version.id,ids[4]!,0),instruction:'Cook the rice'};
 const s2={...newStep(doc.version.id,ids[5]!,1),instruction:'Add carrots'};
 return recipeEditableDocumentSchema.parse({
  ...doc,ingredients:[i1,i2],steps:[s1,s2],
  stepIngredients:[{recipeVersionId:doc.version.id,stepId:ids[4],ingredientId:ids[2],quantity:150,unit:'g',note:null}],
  version:{...doc.version,
   metadata:{importSource:{kind:'family',url:null,text:'Original handwritten note'}},
   authorNote:'A family favorite'},
 });
}
describe('P9 Recipe Studio editor model',()=>{
 it('creates validated ingredients and steps from a previously blank recipe',()=>{
  const document=base();
  const ingredient={...newIngredient(document.version.id,ids[2]!,0),name:'egg',quantity:2,unit:'pcs'};
  const step={...newStep(document.version.id,ids[3]!,0),instruction:'Boil the eggs'};
  const result=finalizeRecipeEdits({...document,ingredients:[ingredient],steps:[step]});
  expect(result.ingredients[0]?.quantity).toBe(2);
  expect(result.steps[0]?.instruction).toBe('Boil the eggs');
  expect(result.recipe.id).toBe(document.recipe.id);
  expect(result.version.id).toBe(document.version.id);
 });
 it('preserves provenance, notes, row IDs and valid references',()=>{
  const before=filled();
  const after=finalizeRecipeEdits({...before,
   version:{...before.version,title:'  Rice & carrots  ',servings:2,totalMinutes:30},
   ingredients:before.ingredients.map((row,i)=>i?row:{...row,quantity:200}),
  },{cuisineTags:'Korean, Home, Korean',categoryTags:'Dinner, Easy'});
  expect(after.version.title).toBe('Rice & carrots');
  expect(after.version.metadata).toEqual(before.version.metadata);
  expect(after.version.authorNote).toBe('A family favorite');
  expect(after.ingredients[0]?.id).toBe(before.ingredients[0]?.id);
  expect(after.stepIngredients).toHaveLength(1);
  expect(after.version.cuisineTags).toEqual(['Korean','Home']);
  expect(after.version.categoryTags).toEqual(['Dinner','Easy']);
  expect(after.version.id).toBe(before.version.id);
 });
 it('does not leave broken references after explicit deletion',()=>{
  const before=filled();
  const next=finalizeRecipeEdits({
   ...before,
   ingredients:before.ingredients.filter(i=>i.id!==ids[2]),
   steps:before.steps.filter(s=>s.id!==ids[4]),
  });
  expect(next.ingredients).toHaveLength(1);
  expect(next.steps).toHaveLength(1);
  expect(next.stepIngredients).toEqual([]);
 });
 it('renumbers reordered ingredient and step positions consistently',()=>{
  const before=filled();
  const next=finalizeRecipeEdits({
   ...before,ingredients:moveRow(before.ingredients,0,1),
   steps:moveRow(before.steps,0,1),
  });
  expect(next.ingredients.map(i=>i.name)).toEqual(['carrots','rice']);
  expect(next.ingredients.map(i=>i.position)).toEqual([0,1]);
  expect(next.steps.map(s=>s.position)).toEqual([0,1]);
  expect(next.stepIngredients[0]?.ingredientId).toBe(ids[2]);
  expect(next.stepIngredients[0]?.stepId).toBe(ids[4]);
 });
 it('prevents an empty ingredient or step from being silently saved',()=>{
  const before=base();
  const empty={...before,ingredients:[newIngredient(before.version.id,ids[2]!,0)]};
  expect(()=>finalizeRecipeEdits(empty)).toThrow();
  const invalid={...before,steps:[newStep(before.version.id,ids[3]!,0)]};
  expect(()=>finalizeRecipeEdits(invalid)).toThrow();
 });
 it('bounds reordering and keeps already existing rows identical',()=>{
  const arr=['a','b','c'];
  expect(moveRow(arr,0,-1)).toEqual(arr);
  expect(moveRow(arr,2,1)).toEqual(arr);
  expect(moveRow(arr,1,-1)).toEqual(['b','a','c']);
  expect(moveRow(arr,1,1)).toEqual(['a','c','b']);
 });
 it('never silently converts a recipe to public or removes source metadata',()=>{
  const before=filled();
  const after=finalizeRecipeEdits(before);
  expect(after.recipe.state).toBe('draft');
  expect(after.version.metadata.importSource).toEqual(before.version.metadata.importSource);
  expect(after.recipe.favorite).toBe(before.recipe.favorite);
 });
});
