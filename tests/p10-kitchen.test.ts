import {describe,expect,it} from 'vitest';
import {
  boundedServings,digitalTimer,kitchenIngredientText,
  scaledAmount,stepProgress,timerSeconds,
} from '../src/kitchen/model.ts';
import type {RecipeEditableDocument} from '../src/api/protocol.ts';
import {createBlankRecipe} from '../src/library/create.ts';
import {newIngredient,newStep} from '../src/library/editor.ts';

const fixture=()=>{
 const d=createBlankRecipe('Pasta');
 const base={...newIngredient(d.version.id,crypto.randomUUID(),0),
  name:'flour',quantity:200,quantityMax:250,unit:'g'};
 const step={...newStep(d.version.id,crypto.randomUUID(),0),instruction:'Knead'};
 return {base,step};
};

describe('P10 offline kitchen helpers',()=>{
 it('scales linear quantities and ranges for selected servings',()=>{
  const {base}=fixture();
  expect(kitchenIngredientText(base,0.5)).toContain('100–125 g flour');
  expect(kitchenIngredientText(base,2)).toContain('400–500 g flour');
  expect(scaledAmount(0.3,'linear',1.5)).toBe(0.45);
 });
 it('does not multiply fixed, seasoning or contextual ingredient amounts',()=>{
  const {base}=fixture();
  for(const scalingMode of ['fixed','seasoning','contextual'] as const){
   expect(kitchenIngredientText({...base,scalingMode},2)).toContain('200–250 g flour');
  }
 });
 it('handles missing quantities, preparation details and optional ingredients',()=>{
  const {base}=fixture();
  const row={...base,quantity:null,quantityMax:null,unit:null,
   name:'fresh parsley',preparation:'chopped',optional:true};
  expect(kitchenIngredientText(row,3)).toBe('fresh parsley, chopped (optional)');
 });
 it('uses stable real-world times even when browser timers are throttled',()=>{
  const endAt=100_000;
  expect(timerSeconds(90_000,endAt,12)).toBe(10);
  expect(timerSeconds(99_300,endAt,50)).toBe(1);
  expect(timerSeconds(105_000,endAt,50)).toBe(0);
  expect(timerSeconds(999,null,17)).toBe(17);
 });
 it('formats hours, minutes and seconds reliably',()=>{
  expect(digitalTimer(0)).toBe('00:00');
  expect(digitalTimer(9)).toBe('00:09');
  expect(digitalTimer(125)).toBe('02:05');
  expect(digitalTimer(3725)).toBe('1:02:05');
 });
 it('does not fabricate servings if original recipe lacks a yield',()=>{
  expect(boundedServings(4,null)).toBe(1);
  expect(boundedServings(4,2)).toBe(2);
  expect(boundedServings(300,2)).toBe(8);
  expect(boundedServings(0.1,2)).toBe(0.25);
  expect(()=>boundedServings(0,2)).toThrow();
 });
 it('counts only unique existing recipe steps as completed',()=>{
  const {step}=fixture();
  const next={...step,id:crypto.randomUUID(),position:1};
  const ids=new Set([step.id,'unrelated']);
  expect(stepProgress(ids,[step,next])).toBe(50);
  expect(stepProgress(new Set(),[])).toBe(0);
  ids.add(next.id);
  expect(stepProgress(ids,[step,next])).toBe(100);
 });
});
