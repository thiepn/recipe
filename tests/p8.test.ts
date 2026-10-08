import {describe,expect,it,vi} from 'vitest';
import { RecipeCoreApi } from '../src/api/core.ts';
import { lunaDraftSchema,lunaHelpSchema,uiLanguage,suggestedRecipeDraft } from '../src/ai/contracts.ts';
import { createImportedRecipe } from '../src/import/recipe-import.ts';

const draft={
 title:'Vegetable rice',description:'Simple',
 ingredients:['200 g rice','120 g carrots'],steps:['Cook rice','Saute carrots'],
 servings:2,totalMinutes:25,notes:[],uncertainties:[],
};
const aiOutput=(capability:string,data:unknown)=>({
 ok:true,data:{capability,version:1,model:'gpt-6-luna',data},meta:{requestId:'request-1'},
});
const fetcher=(payload:unknown)=>vi.fn(async (url:RequestInfo|URL,init?:RequestInit)=>{
 expect(String(url)).toContain('/v1/recipe/ai/');
 const headers=new Headers(init?.headers);
 expect(headers.get('Authorization')).toBe('Bearer verified-account-token');
 expect(headers.get('X-Thiepn-App')).toBeNull();
 expect(init?.credentials).toBe('omit');
 return Response.json(payload);
});
const api=(fetchMock:typeof fetch)=>new RecipeCoreApi({
 baseUrl:'https://core.example',
 getAccessToken:()=>Promise.resolve('verified-account-token'),
 fetch:fetchMock,
});
describe('P8 Luna Recipe client',()=>{
 it('sends typed generation requests through Account-protected Core Gateway',async()=>{
  const mocked=fetcher(aiOutput('recipe.generate',draft));
  const core=api(mocked as typeof fetch);
  const result=await core.lunaGenerate({
   request:'Rice with carrots',availableIngredients:['rice'],
   avoidIngredients:['peanuts'],servings:2,language:'de',
  });
  expect(result.title).toBe('Vegetable rice');
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(mocked.mock.calls[0]?.[1]?.body)).input.availableIngredients).toEqual(['rice']);
 });
 it('validates extraction and help structured output, discarding malformed results',async()=>{
  const extraction=api(fetcher(aiOutput('recipe.extract',{...draft,ingredients:[]})) as typeof fetch);
  await expect(extraction.lunaExtract({
   sourceText:'Recipe title\nIngredients\n300 g rice\nInstructions\nCook rice',sourceKind:'text',language:'en',
  })).rejects.toThrow();
  const helper=api(fetcher(aiOutput('recipe.cookingHelp',{answer:'Use medium heat.',cautions:[],suggestedChanges:[]})) as typeof fetch);
  expect((await helper.lunaHelp({recipe:{title:'Rice',ingredients:['rice'],steps:['Boil']},
    question:'How can I adapt this?',language:'en'})).answer).toContain('medium heat');
 });
 it('rejects invalid input before a network request',async()=>{
  const mocked=fetcher(aiOutput('recipe.generate',draft));
  await expect(api(mocked as typeof fetch).lunaGenerate({
   request:'go',availableIngredients:[],avoidIngredients:[],servings:0,language:'en',
  })).rejects.toThrow();
  expect(mocked).not.toHaveBeenCalled();
 });
 it('maps locale and enforces strict Luna response bounds',()=>{
  expect(uiLanguage('de-DE')).toBe('de');
  expect(uiLanguage('ko-KR')).toBe('ko');
  expect(uiLanguage('fr-FR')).toBe('en');
  expect(lunaDraftSchema.safeParse({...draft,steps:[]}).success).toBe(false);
  expect(lunaHelpSchema.safeParse({answer:'Good',cautions:[],suggestedChanges:[]}).success).toBe(true);
 });
 it('creates reviewable private drafts from output, never directly persists them',async()=>{
  const review=suggestedRecipeDraft(draft,'generate');
  const document=await createImportedRecipe(review);
  expect(document.recipe.state).toBe('draft');
  expect(document.steps).toHaveLength(2);
  expect(review.warnings.join(' ')).toContain('Review');
 });
});
